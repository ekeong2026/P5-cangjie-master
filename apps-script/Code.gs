/** 五年級打字遊戲後端：貼到與成績試算表綁定的 Apps Script Code.gs。
 * 首次在編輯器執行 setup，然後部署為網頁應用程式。
 * 公開接口只使用班別與學號；這不是有密碼驗證的學生帳戶系統。
 * 測試檔案可用 require('./MasteryCore.gs')／require('./MasteryStore.gs') 取得同一份實作；
 * 為避免雙重載入造成兩個建構子，Code.gs 載入時會先把結果註冊到 globalThis，
 * 測試只在「尚未註冊」時載入，兩條路徑都能取得同一個物件。
 */
// Node 測試以 require 載入本檔時登錄全域物件；Apps Script 沒有 require／module，整段略過。
if (typeof require === 'function' && typeof module !== 'undefined') {
  globalThis.MasteryCore = globalThis.MasteryCore || require('./MasteryCore.gs');
  globalThis.MasteryStore = globalThis.MasteryStore || require('./MasteryStore.gs');
}

const LOG_SHEET = '遊戲紀錄';
const SUMMARY_SHEET = '成績總覽';
const DATA_CACHE_KEY = 'typing_game_leaderboard_v2';
// 交卷不再清除快取，接受最多 60 秒顯示延遲，避免多人同時開榜觸發重算。
const DATA_CACHE_SECONDS = 60;
// requestId 去重只掃最近 N 筆，避免資料量增長後每次提交都掃描全表。
const REQUEST_ID_SCAN_ROWS = 500;
// 第 13 欄「完成時間」為離線補送的歸屬日期依據（S3）：掌握進度以「遊戲完成時間」而非
// 「接收時間」判斷屬於哪一天，否則跨午夜的補送會佔用隔天的額度。舊資料列此欄為空時，
// 沿用接收時間（與第 12 欄為空時視為「無資料」同一套相容規則）。
const LOG_HEADERS = ['請求編號', '接收時間', '年級', '班別', '學號', '模式', '本次得分', '本次擊倒數', '完成秒數', '題量', '周次', '本次得分字', '完成時間'];
// 第 11 欄「週次最佳秒數」為排行榜手速週榜（speedByWeek）的唯一來源；
// 沒有這一欄，改讀總覽後便無法重建各週手速天梯。
// 總覽分兩段：固定 8 欄（下表）＋尾端動態追加的「得分:<模式代號>」欄。
// 動態欄一律追加在尾端，才能沿用 ensureSheet_「前綴相符、尾端可補」的檢查規則；
// 若插在中間，之後再加模式就會因表頭不符而拋錯。
const SUMMARY_FIXED_HEADERS = ['年級', '班別', '學號', '累計得分', '累計擊倒數', '最佳10字秒數', '最後接收時間', '週次最佳秒數'];
const MODE_COLUMN_PREFIX = '得分:';
// 動態分項欄的上限。放寬模式驗證後，公開端點可送任意模式代號；
// 沒有上限的話，惡意或錯誤的請求會讓總覽無限長出欄位。
const MAX_MODE_COLUMNS = 24;
// 模式代號格式。必須與 js/modes.js 的 window.P5_MODE_PATTERN 相同（有測試守門）。
const MODE_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
// 模式機制：只列出「不是預設 code」的挑戰線模式。
// 新增主線模式（站 4、5、6…）永遠不必改這裡，也不必重新部署後端。
const MODE_MECHANISMS = { speed: 'timed' };
function mechOf_(mode) { return MODE_MECHANISMS[mode] || 'code'; }
// 總覽增量更新失敗時留下的標記；排行榜改讀總覽後，這是最需要被發現的偏差。
const SUMMARY_DIRTY_KEY = 'SUMMARY_DIRTY';

function setup() {
  // getActiveSpreadsheet 只在編輯器初始化使用；網頁接口改用已儲存的 ID。
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('請從成績試算表的「擴充功能 → Apps Script」開啟並執行 setup。');
  PropertiesService.getScriptProperties().setProperty('SCORE_SPREADSHEET_ID', book.getId());
  ensureSheet_(book, LOG_SHEET, LOG_HEADERS);
  ensureSummarySheet_(book);
  refreshSummary();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('打字遊戲')
    .addItem('更新成績總覽', 'refreshSummary')
    .addItem('更新掌握進度', 'refreshMastery')
    .addItem('比對並補寫掌握進度', 'reconcileMastery')
    .addItem('重建進度抽屜', 'rebuildMasteryDrawers')
    .addSeparator()
    .addItem('顯示系統狀態', 'showSystemStatus')
    .addItem('清除所有進度抽屜', 'clearMasteryDrawers')
    .addToUi();
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action && e.parameter.action !== 'get_data') {
      throw new Error('不支援的查詢。');
    }
    return json_(readDataCached_());
  } catch (error) {
    return json_({ status: 'error', message: error.message });
  }
}

function doPost(e) {
  try {
    const payload = validate_(JSON.parse(e && e.postData ? e.postData.contents : '{}'));
    return handleSubmit_(payload);
  } catch (error) {
    return json_({ status: 'error', message: error.message });
  }
}

/* 交卷處理：鎖只包住「讀抽屜 → 每日首答判斷 → 寫抽屜」這一段共享資源，
   Sheet 寫入及驗證全部移出鎖外（解法 3）。
   理由：Script Properties 的讀—改—寫必須原子，否則兩台裝置同時交卷會互相覆蓋；
   但 Sheet 寫入彼此獨立（紀錄以 appendRow 追加、總覽每生一行各寫各的），
   留在鎖內只會把持鎖時間由數十毫秒拉長到一秒以上，撞上 30 個同時執行的上限。 */
function handleSubmit_(payload) {
  const receivedAt = new Date();
  // 「今天」以遊戲實際完成時間為準（S3）：離線補送的分數應歸屬完成當天，
  // 而不是送出當天，否則跨午夜的補送會白白佔用隔天的額度。
  // 未帶完成時間戳時退回接收時間（舊版前端）。
  const today = MasteryCore.hkDate(payload.completedAt ? payload.completedAt.at : receivedAt);

  // ── 第一步（鎖外）：只做去重檢查，先不寫紀錄。 ──
  // 必須在抽屜判斷之前：重試同一筆若又跑一次首答判斷，會把已得分的字算成「未得分」而重複加分。
  let sheet;
  try {
    sheet = book_().getSheetByName(LOG_SHEET);
    if (!sheet) throw new Error('請先執行 setup。');
    if (hasRequestId_(sheet, payload.requestId)) {
      return json_({ status: 'success', requestId: payload.requestId, duplicate: true, earned: 0,
        newlyScored: [], ignored: [] });
    }
  } catch (readError) {
    throw readError;
  }

  // ── 第二步（鎖內）：抽屜的讀—每日首答判斷—寫，不含任何 Sheet 存取。 ──
  const lock = LockService.getScriptLock();
  let drawer, picked;
  try {
    if (!lock.tryLock(30000)) throw new Error('系統繁忙，請稍後再試。');
    drawer = MasteryStore.read(payload.cls, payload.num);
    // 抽屜遺失（或跨日被清空）時，先以 Sheet 的「掌握進度」為真相補回，再判斷。
    if (!drawer.version) drawer = MasteryStore.readFromSheet(payload.cls, payload.num, today);
    // 所有模式共用同一個進度地圖，鍵＝「模式前綴:漢字」；前綴由 validate_ 組好。
    picked = MasteryCore.applyRound(payload.round, drawer.map, today, payload.prefix);
    drawer.map = picked.map;
    MasteryStore.writeDrawer(payload.cls, payload.num, drawer, today);
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }

  // 後端判斷後的分數（不接受前端宣稱）。
  // 帶 round 時：只採計「今天首次答對」的字，分數由 applyRound 算出。
  // 未帶 round（舊版前端）：沿用前端送來的 scoreDelta，維持向後相容。
  const finalScore = payload.round.length > 0 ? picked.earned : payload.scoreDelta;
  const killDelta = payload.round.length > 0 ? (picked.newlyScored.length > 0 ? payload.killDelta : 0) : payload.killDelta;
  const scoredChars = picked.newlyScored.join('');

  // ── 第三步（鎖外）：寫入紀錄，再更新總覽與掌握進度（盡力而為）。 ──
  try {
    sheet.appendRow([
      payload.requestId, receivedAt, 5, payload.cls, payload.num, payload.mode,
      finalScore, killDelta, payload.bestTime, payload.wordCount, payload.weekKey,
      scoredChars,
      // 完成時間：離線補送時與接收時間不同，重建須據此歸屬日期（S3）。
      payload.completedAt ? payload.completedAt.at : receivedAt
    ]);
    updateSummaryStudent_(Object.assign({}, payload, { scoredChars, scoreDelta: finalScore, killDelta: killDelta }), receivedAt);
  } catch (writeError) {
    markSummaryDirty_();
    console.error('交卷寫入失敗，已標記待重建：' + writeError.message);
  }
  MasteryStore.writeSheet(payload.cls, payload.num, drawer, today, receivedAt);

  // 交卷不再清除排行榜快取：快取最多保留 60 秒，避免多人同時開榜觸發重算。
  // 掌握進度／成績總覽另有每天 06:00 的重建作業兜底，可修正任何偏差。
  return json_({ status: 'success', requestId: payload.requestId, earned: picked.earned,
    newlyScored: picked.newlyScored, ignored: picked.ignored });
}

/** 交卷去重與「本次得分字」的落地由紀錄表的第一欄決定；重試不得重複累計。 */
function hasRequestId_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  // 只掃最近 REQUEST_ID_SCAN_ROWS 筆。重試都在短時間內發生，無須掃描全部歷史。
  const count = Math.min(lastRow - 1, REQUEST_ID_SCAN_ROWS);
  const startRow = lastRow - count + 1;
  return sheet.getRange(startRow, 1, count, 1)
    .createTextFinder(requestId)
    .matchEntireCell(true)
    .matchCase(true)
    .findNext() !== null;
}

function validate_(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('資料格式不正確。');
  if (p.grade !== 5 || !/^P5[A-F]$/.test(p.cls) || !Number.isInteger(p.num) || p.num < 1 || p.num > 36) {
    throw new Error('只接受 P5A–P5F，學號 1–36。');
  }
  if (typeof p.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(p.requestId)) {
    throw new Error('缺少有效的請求編號。');
  }
  const mode = p.gameMode || p.mode;
  // 模式代號只驗格式，不再寫白名單 → 之後新增模式（站 4、5、6…）後端完全不必改。
  if (typeof mode !== 'string' || !MODE_PATTERN.test(mode)) throw new Error('遊戲模式不正確。');
  const timed = mechOf_(mode) === 'timed';
  const delta = p.scoreDelta;
  if (!Number.isInteger(delta) || delta < 0 || delta > 10000) throw new Error('本次得分不正確。');
  if (!Number.isInteger(p.killDelta) || p.killDelta < 0 || p.killDelta > 1) throw new Error('本次擊倒數不正確。請使用最新的遊戲版本。');
  // 週次只有週次字庫模式（機制 timed）必填；其餘模式可省略或送空字串。
  const weekKey = typeof p.weekKey === 'string' ? p.weekKey : '';
  if (weekKey !== '' && !/^w\d{1,2}(?:_hw\d{1,2})?$/.test(weekKey)) throw new Error('周次不正確。');
  if (timed && !weekKey) throw new Error('周次不正確。');
  if (p.wordCount !== 10 && p.wordCount !== 20) throw new Error('題量不正確。');
  let bestTime = '';
  if (timed) {
    if (typeof p.bestTime !== 'number' || !Number.isFinite(p.bestTime) || p.bestTime <= 0 || p.bestTime >= 900) {
      throw new Error('完成秒數必須大於 0 且小於 900。');
    }
    if (delta !== 0 || p.killDelta !== 0) throw new Error('手速賽不累計討伐積分。');
    bestTime = p.bestTime;
  }
  // 一輪／一場的逐字作答（每日首答判斷用）。未帶則相容舊版前端，走不加分的路徑。
  const round = normalizeRound_(p.round, mode);
  // 完成時間戳：離線補送時前端會帶上實際完成時間，後端據此判斷歸屬日期。
  const completedAt = parseCompletedAt_(p.completedAt);
  return { requestId: p.requestId, cls: p.cls, num: p.num, mode,
    // 進度鍵前綴：週次字庫模式為「模式.週次」（例 speed.w7_hw1），其餘為模式代號本身。
    prefix: MasteryCore.prefixFor(mode, timed ? weekKey : ''),
    scoreDelta: delta, killDelta: p.killDelta, bestTime,
    wordCount: p.wordCount, weekKey,
    round, completedAt,
    // 「本次得分字」由後端判斷後填入，不接受前端提供，避免前端自行宣稱得分。
    scoredChars: '' };
}

/** 驗證前端帶來的完成時間戳（S3 離線補送）。
 *  規則：不得為未來（容許少量時鐘偏差）、不得超過 24 小時；逾期記錄為「逾期」供教師處理，
 *  不靜默丟棄。未帶時間戳時回傳 null，視為「現在完成」。 */
const BACKFILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function parseCompletedAt_(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('完成時間格式不正確。');
  const at = new Date(value);
  if (isNaN(at.getTime())) throw new Error('完成時間格式不正確。');
  const now = Date.now();
  if (at.getTime() > now + CLOCK_SKEW_MS) throw new Error('完成時間不可為未來時間。');
  // 逾期的補送仍接受（學生的分數不該憑空消失），但標記出來由教師決定是否採計。
  return { at: at, overdue: now - at.getTime() > BACKFILL_MAX_AGE_MS };
}

/** 正規化逐字作答陣列；每項只保留 { char, correct, earned }，不信任其他欄位。 */
function normalizeRound_(value, mode) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('作答紀錄格式不正確。');
  if (value.length > 40) throw new Error('單次作答數量超出上限。');
  return value.map(function (item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('作答紀錄格式不正確。');
    const char = String(item.char == null ? '' : item.char).trim();
    if (!MasteryCore.validChar(char)) throw new Error('作答字元不正確。');
    const earned = Number(item.earned);
    if (!Number.isFinite(earned) || earned < 0 || earned > 10000) throw new Error('單字得分不正確。');
    return { char, correct: item.correct === true, earned: Math.round(earned) };
  });
}

/** 空白學生骨架；回合輸出與總覽讀取共用，確保輸出欄位完全一致。
 *  modeScores 是「模式代號 → 分數」的動態對照表，加模式時不必改這個結構。 */
function blankStudent_(cls, num) {
  return { cls, num, name: cls + ' ' + String(num).padStart(2, '0') + '號',
    score: 0, grandTotal: 0, totalScore: 0, kills: 0,
    modeScores: {}, weekly_speed: {}, best10: null, lastTime: '' };
}

/** 由「遊戲紀錄」掃描全部紀錄彙總。只供重建及退化回退使用，不在一般讀取路徑上。 */
function aggregateLog_() {
  const sheet = book_().getSheetByName(LOG_SHEET);
  if (!sheet) throw new Error('請先執行 setup。');
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, LOG_HEADERS.length).getValues() : [];
  const students = {};
  for (const letter of 'ABCDEF') {
    const cls = 'P5' + letter;
    for (let num = 1; num <= 36; num++) students[cls + '_' + num] = blankStudent_(cls, num);
  }
  const best = {};
  const seen = new Set();
  for (const row of rows) {
    const [id, received, grade, cls, num, mode, delta, kills, seconds, count, week] = row;
    const st = students[cls + '_' + num];
    const normalizedId = String(id || '').trim();
    // 新紀錄以 requestId 去重；沒有 ID 的歷史列則逐筆保留及計算。
    if ((normalizedId && seen.has(normalizedId)) || grade !== 5 || !st) continue;
    if (normalizedId) seen.add(normalizedId);
    st.grandTotal += Number(delta) || 0;
    st.kills += Number(kills) || 0;
    // 分項分數依模式代號動態累加（modeScores）；新模式自動生效，不必改這裡。
    // 分數同樣計入總分，但不影響下面的秒數彙總——天梯只認秒數。
    // 0 分的紀錄不建立鍵（與「只讀總覽」路徑略過 0 的做法對稱，兩條路徑輸出才會完全一致）。
    const modeName = String(mode == null ? '' : mode).trim();
    if (MODE_PATTERN.test(modeName) && Number(delta) !== 0) {
      st.modeScores[modeName] = (st.modeScores[modeName] || 0) + Number(delta);
    }
    const date = received instanceof Date ? received : new Date(received);
    if (!isNaN(date.getTime())) {
      const iso = date.toISOString();
      if (iso > st.lastTime) st.lastTime = iso;
    }
    if (mode === 'speed' && typeof seconds === 'number' && seconds > 0 && seconds < 900 && count === 10) {
      const key = cls + '_' + num + '_' + week;
      if (!best[key] || seconds < best[key].bestTime) {
        best[key] = { cls, num, name: st.name, bestTime: seconds, wordCount: count, weekKey: week };
      }
      st.weekly_speed[week] = Math.min(st.weekly_speed[week] || Infinity, seconds);
      st.best10 = Math.min(st.best10 || Infinity, seconds);
    }
  }
  for (const st of Object.values(students)) st.score = st.totalScore = st.grandTotal;
  return { students, best };
}

/** 由各生每週最佳秒數還原手速紀錄表；與 aggregateLog_ 的 best 結構相同。 */
function speedRecords_(students) {
  const best = {};
  for (const st of Object.values(students)) {
    for (const [week, seconds] of Object.entries(st.weekly_speed)) {
      const key = st.cls + '_' + st.num + '_' + week;
      if (!best[key] || seconds < best[key].bestTime) {
        best[key] = { cls: st.cls, num: st.num, name: st.name, bestTime: seconds, wordCount: 10, weekKey: week };
      }
    }
  }
  return best;
}

/** 把學生及手速紀錄組成排行榜輸出。兩種資料來源共用，故此函式是「輸出是否一致」的關鍵。 */
function buildLeaderboard_(students, best) {
  const combatLeaderboard = Object.values(students).sort((a, b) => b.grandTotal - a.grandTotal || a.cls.localeCompare(b.cls) || a.num - b.num);
  // 依周次分組，避免另一周的最佳秒數混入當周榜單。
  const speedByWeek = { overall: [] };
  const overall = {};
  // 固定以排序後的鍵走訪，令並列秒數的取捨在任何資料來源下都一致。
  for (const key of Object.keys(best).sort()) {
    const record = best[key];
    (speedByWeek[record.weekKey] = speedByWeek[record.weekKey] || []).push(record);
    const studentKey = record.cls + '_' + record.num;
    if (!overall[studentKey] || record.bestTime < overall[studentKey].bestTime) overall[studentKey] = record;
  }
  speedByWeek.overall = Object.values(overall);
  Object.values(speedByWeek).forEach(list => list.sort((a, b) => a.bestTime - b.bestTime || a.cls.localeCompare(b.cls) || a.num - b.num));
  const class_top10 = {};
  for (const letter of 'ABCDEF') {
    const cls = 'P5' + letter;
    class_top10[cls] = combatLeaderboard.filter(st => st.cls === cls && st.grandTotal > 0).slice(0, 10);
  }
  return { status: 'success', combatLeaderboard, speedByWeek,
    top40: combatLeaderboard.filter(st => st.grandTotal > 0).slice(0, 40), class_top10 };
}

/** 退化路徑：總覽尚未建立時，臨時改讀原始紀錄，避免學生看到空白排行榜。 */
function readDataFromLog_() {
  const { students, best } = aggregateLog_();
  return buildLeaderboard_(students, best);
}

/** 一般讀取路徑：只讀「成績總覽」（每生一行），不掃原始紀錄。
 *  欄位一律依表頭名稱定位，不寫死欄號 —— 動態分項欄（得分:<模式>）才能在加模式後自動生效。 */
function readData_() {
  const sheet = book_().getSheetByName(SUMMARY_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return readDataFromLog_();
  const headers = summaryHeaders_(sheet);
  const col = name => headers.indexOf(name);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const students = {};
  for (const letter of 'ABCDEF') {
    const cls = 'P5' + letter;
    for (let num = 1; num <= 36; num++) students[cls + '_' + num] = blankStudent_(cls, num);
  }
  for (const row of rows) {
    if (Number(row[col('年級')]) !== 5) continue;
    const cls = String(row[col('班別')] === undefined || row[col('班別')] === null ? '' : row[col('班別')]).trim();
    const st = students[cls + '_' + Number(row[col('學號')])];
    if (!st) continue;
    st.grandTotal = Number(row[col('累計得分')]) || 0;
    st.kills = Number(row[col('累計擊倒數')]) || 0;
    const best10 = Number(row[col('最佳10字秒數')]);
    st.best10 = isFinite(best10) && best10 > 0 ? best10 : null;
    st.lastTime = isoString_(row[col('最後接收時間')]);
    st.weekly_speed = parseWeekSpeeds_(row[col('週次最佳秒數')]);
    headers.forEach(function (name, index) {
      if (name.indexOf(MODE_COLUMN_PREFIX) !== 0) return;
      const mode = name.slice(MODE_COLUMN_PREFIX.length);
      if (!mode) return;
      // 0 分視同「沒得分」，不建立鍵 —— 與掃描紀錄路徑（也略過 0）的輸出才會完全一致。
      const value = Number(row[index]) || 0;
      if (value !== 0) st.modeScores[mode] = value;
    });
    st.score = st.totalScore = st.grandTotal;
  }
  return buildLeaderboard_(students, speedRecords_(students));
}

/** 儲存格可能被試算表自動轉成日期物件，兩種形態都要能還原成 ISO 字串。
 * 用鴨子型別而非 instanceof，因跨執行環境時 instanceof Date 會失效。
 */
function isoString_(value) {
  if (value && typeof value === 'object' && typeof value.toISOString === 'function') {
    const time = typeof value.getTime === 'function' ? value.getTime() : NaN;
    return isNaN(time) ? '' : value.toISOString();
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && value > 0) return new Date(value).toISOString();
  return '';
}

/** 週次／功課鍵的合法格式。字庫以「週次＋功課」為一組（如 w7_hw1），
 *  排行榜手速週榜亦以同一組鍵分組，故兩者必須使用相同語法。 */
const WEEK_KEY_PATTERN = /^w\d{1,2}(?:_hw\d{1,2})?$/;

/** 解析「週次最佳秒數」欄，格式為 `w7_hw1:35.2;w8_hw1:33.1`。
 *  早期版本只接受 `w7`，會把帶功課的鍵整個丟掉，令手速週榜留白——已一併修正。 */
function parseWeekSpeeds_(text) {
  const out = {};
  if (typeof text !== 'string' || text === '') return out;
  for (const part of text.split(';')) {
    const index = part.lastIndexOf(':');
    if (index <= 0) continue;
    const week = part.slice(0, index).trim();
    const seconds = Number(part.slice(index + 1));
    if (!WEEK_KEY_PATTERN.test(week) || !isFinite(seconds) || seconds <= 0 || seconds >= 900) continue;
    if (!out[week] || seconds < out[week]) out[week] = seconds;
  }
  return out;
}

/** 序列化「週次最佳秒數」，依週次數字（再依功課）排序，令重建結果穩定可比。 */
function serializeWeekSpeeds_(map) {
  const order = week => {
    const m = /^w(\d{1,2})(?:_hw(\d{1,2}))?$/.exec(week);
    return m ? [Number(m[1]), Number(m[2] || 0)] : [9999, 9999];
  };
  const weeks = Object.keys(map || {})
    .filter(week => WEEK_KEY_PATTERN.test(week) && isFinite(map[week]) && map[week] > 0)
    .sort((a, b) => {
      const [wa, ha] = order(a), [wb, hb] = order(b);
      return wa - wb || ha - hb || a.localeCompare(b);
    });
  return weeks.map(week => week + ':' + map[week]).join(';');
}

function readDataCached_() {
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(DATA_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    // 快取失效時仍可直接讀取試算表，不影響排行榜。
  }
  const data = readData_();
  try {
    cache.put(DATA_CACHE_KEY, JSON.stringify(data), DATA_CACHE_SECONDS);
  } catch (error) {
    // 資料超過快取限制時，退回即時計算。
  }
  return data;
}

function clearDataCache_() {
  try {
    CacheService.getScriptCache().remove(DATA_CACHE_KEY);
  } catch (error) {
    // 清除快取失敗不應阻止成績寫入。
  }
}

function refreshSummary() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    writeSummary_();
  } finally {
    lock.releaseLock();
  }
}

/** 由「遊戲紀錄」重建「掌握進度」表；教師選單及每日 06:00 皆呼叫此函式。 */
function refreshMastery() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    writeMasterySheet_();
    rebuildMasteryDrawers();
  } finally {
    lock.releaseLock();
  }
}

/* 每日 06:00 由觸發器呼叫的兜底重建（0K）。
   刻意排在清晨，避開與學生交卷搶同一把指令碼鎖。
   冪等：可重複執行、結果一致；失敗時 Google 會電郵通知擁有者。 */
function nightlyRebuild() {
  const startedAt = new Date();
  try {
    const lock = LockService.getScriptLock();
    // 清晨不應有學生交卷；若真的撞上（例如學校在別的時區），等 5 分鐘再放棄。
    lock.waitLock(300000);
    try {
      writeSummary_();
      writeMasterySheet_();
      rebuildMasteryDrawers();
    } finally {
      lock.releaseLock();
    }
    console.log('每日重建完成：' + startedAt.toISOString());
    return { status: 'ok', startedAt: startedAt.toISOString() };
  } catch (error) {
    // 記錄後再拋出，讓 Google 的觸發器失敗通知帶上原因。
    console.error('每日重建失敗：' + error.message);
    throw error;
  }
}

/* 觸發器的單一來源：先清掉舊的 nightlyRebuild 觸發器再重建，避免重複累積（上限 20 個）。
   教師只需在編輯器手動執行一次；本機測試不建立實際觸發器。 */
function setupTriggers() {
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'nightlyRebuild') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('nightlyRebuild').timeBased().atHour(6).nearMinute(0).everyDays(1).create();
  return { status: 'ok', removed: existing.length, created: 1 };
}

/* 由「遊戲紀錄」的「本次得分字」欄重建「掌握進度」。
   冪等：以 (班別, 學號) 為鍵彙總，重複執行結果一致。
   舊資料列該欄為空 → 視為「無資料」而非「未得分」，不影響歷史行為。
   進度鍵已含模式前綴（例 connected:更、speed.w7_hw1:更），故新增模式時這裡完全不必改。 */
function writeMasterySheet_() {
  const sheet = book_().getSheetByName(LOG_SHEET);
  if (!sheet) throw new Error('請先執行 setup。');
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, LOG_HEADERS.length).getValues() : [];
  const today = MasteryCore.hkDate(new Date());
  // key = 班別_學號 → { 進度鍵 → 值 }；進度鍵已含模式前綴。
  const book = {};
  const seen = new Set();
  for (const row of rows) {
    const [id, received, grade, cls, num, mode, , , , , week, scoredChars, completed] = row;
    if (grade !== 5 || !cls || !num) continue;
    const normalizedId = String(id || '').trim();
    if (normalizedId) { if (seen.has(normalizedId)) continue; seen.add(normalizedId); }
    const chars = String(scoredChars == null ? '' : scoredChars).trim();
    if (!chars) continue; // 舊格式列：無得分字資料，略過
    const modeName = String(mode == null ? '' : mode).trim();
    if (!MODE_PATTERN.test(modeName)) continue;
    // 歸屬日期以「完成時間」為準（第 13 欄）；舊資料列沒有這一欄時退回接收時間，
    // 與第 12 欄為空視為「無資料」屬同一套相容規則。
    const date = completed ? hkDateFrom_(completed) : hkDateFrom_(received);
    if (!date) continue;
    const weekKey = String(week == null ? '' : week).trim();
    const prefix = MasteryCore.prefixFor(modeName, mechOf_(modeName) === 'timed' ? weekKey : '');
    const key = cls + '_' + num;
    const entry = book[key] || (book[key] = {});
    Array.from(chars).forEach(function (ch) {
      if (!MasteryCore.validChar(ch)) return;
      const k = prefix + ':' + ch;
      const cur = entry[k];
      const curDate = cur ? MasteryCore.entryDate(cur) : '';
      if (!curDate || date > curDate) {
        // 較新的日期：次數由 1 重新起算（每日重置）。
        entry[k] = MasteryCore.entryValue(date, 1);
      } else if (date === curDate) {
        // 同一天再次得分：累加次數，上限為 MAX_PER_DAY。
        entry[k] = MasteryCore.entryValue(date,
          Math.min(MasteryCore.entryCount(cur) + 1, MasteryCore.MAX_PER_DAY));
      }
    });
  }
  const target = ensureSheet_(book_(), MasteryStore.SHEET_NAME, MasteryStore.HEADERS);
  const stamp = new Date().toISOString();
  const out = [];
  for (let i = 0; i < 36 * 6; i++) {
    const cls = 'P5' + String.fromCharCode(65 + Math.floor(i / 36)), num = (i % 36) + 1;
    // 長格式：每生固定 MODE_ROWS_PER_STUDENT 列，與交卷時的增量寫入共用同一組列。
    out.push(...MasteryStore.sheetRows(cls, num, book[cls + '_' + num] || {}, today, stamp));
  }
  target.getRange(2, 1, out.length, MasteryStore.HEADERS.length).setValues(out);
  SpreadsheetApp.flush();
  return { studentsToday: today, rows: out.length };
}

/** 以香港時區把紀錄時間轉成 YYYY-MM-DD；無法解析回傳空字串。 */
function hkDateFrom_(value) {
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return MasteryCore.hkDate(d);
  } catch (error) {
    return '';
  }
}

/* 由「掌握進度」表重建 Script Properties 抽屜（S6 救援）。
   長格式：每生一組列，每列一個模式前綴；這裡把它們合併回單一的進度地圖。
   只寫入「今天」的得分；其他日期不確定為未得分，交由下次交卷自 Sheet 補回。 */
function rebuildMasteryDrawers() {
  const sheet = book_().getSheetByName(MasteryStore.SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return { rebuilt: 0 };
  const today = MasteryCore.hkDate(new Date());
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, MasteryStore.HEADERS.length).getValues();
  const buckets = {};
  rows.forEach(function (row) {
    const cls = String(row[0] == null ? '' : row[0]).trim(), num = Number(row[1]);
    if (!/^P5[A-F]$/.test(cls) || !(num >= 1 && num <= 36)) return;
    const part = MasteryCore.parseProgress(row[3]);
    const bucket = buckets[cls + '_' + num] || (buckets[cls + '_' + num] = { cls: cls, num: num, map: {} });
    // 值可能帶次數（YYYY-MM-DD*n），原樣搬進抽屜，次數才不會被每日重建抹平。
    Object.keys(part).forEach(function (key) {
      if (MasteryCore.entryDate(part[key]) === today) bucket.map[key] = part[key];
    });
  });
  let rebuilt = 0;
  Object.values(buckets).forEach(function (bucket) {
    MasteryStore.writeDrawer(bucket.cls, bucket.num, { version: 'v2', date: today, map: bucket.map }, today);
    rebuilt += 1;
  });
  return { rebuilt: rebuilt };
}

/** 教師選單：比對抽屜與 Sheet，補齊差異（0G）。 */
function reconcileMastery() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // 先由 Sheet 重建抽屜，再由抽屜回寫 Sheet，使兩者一致且以紀錄為最終真相。
    const result = rebuildMasteryDrawers();
    writeMasterySheet_();
    return { status: 'ok', rebuiltDrawers: result.rebuilt };
  } finally {
    lock.releaseLock();
  }
}

/** 教師選單：清除所有 Script Properties 進度抽屜。
 *  用於格式改版後的重置，或抽屜損毀時配合「重建進度抽屜」重新產生。
 *  只刪「mb:」開頭的鍵，不動遊戲紀錄與成績總覽。 */
function clearMasteryDrawers() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let removed = 0;
  Object.keys(all).forEach(function (name) {
    if (name.indexOf(MasteryStore.KEY_PREFIX) !== 0) return;
    props.deleteProperty(name);
    removed += 1;
  });
  console.log('已清除 ' + removed + ' 筆進度抽屜。');
  return { status: 'ok', removed: removed };
}

/** 教師選單：顯示偏差標記、抽屜用量及逾期待處理紀錄（0L）。 */
function showSystemStatus() {
  const dirty = summaryDirtySince_();
  const usage = MasteryStore.usage();
  const lines = [
    '總覽偏差標記：' + (dirty ? '是（' + dirty + '，請執行「更新成績總覽」）' : '無'),
    '進度抽屜：' + usage.keys + ' 名學生，' + usage.chars + ' 字元（上限約 500 KB）'
  ];
  SpreadsheetApp.getUi().alert('打字遊戲系統狀態', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function writeSummary_() {
  const { students } = aggregateLog_();
  const sheet = ensureSummarySheet_(book_());
  // 重建時必須一併補齊「資料中出現過的模式」的分項欄，否則由紀錄重建會漏掉分項分數，
  // 且「只讀總覽」與「掃描紀錄」兩條路徑的輸出會不再一致。
  // 依模式代號排序建立，欄序與紀錄列的出現順序無關，重建才具冪等性。
  const modes = new Set();
  Object.values(students).forEach(st => Object.keys(st.modeScores).forEach(mode => modes.add(mode)));
  Array.from(modes).sort().forEach(mode => modeColumn_(sheet, mode));
  const headers = summaryHeaders_(sheet);
  // 分項欄值取自 modeScores；未出現的模式欄一律留 0。
  const modeColumns = headers.map((name, index) => ({ name, index }))
    .filter(column => column.name.indexOf(MODE_COLUMN_PREFIX) === 0);
  // 成績總覽固定依 P5A–P5F、學號 1–36 排列，方便教師查閱。
  const list = Object.values(students).sort((a, b) => a.cls.localeCompare(b.cls) || a.num - b.num);
  const rows = list.map(st => {
    const row = new Array(headers.length).fill('');
    row[0] = 5; row[1] = st.cls; row[2] = st.num;
    row[3] = st.grandTotal; row[4] = st.kills;
    row[5] = st.best10 === null ? '' : st.best10;
    row[6] = st.lastTime;
    row[7] = serializeWeekSpeeds_(st.weekly_speed);
    modeColumns.forEach(function (column) {
      const mode = column.name.slice(MODE_COLUMN_PREFIX.length);
      row[column.index] = st.modeScores[mode] || 0;
    });
    return row;
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  clearDataCache_();
  SpreadsheetApp.flush();
  clearSummaryDirty_();
}

/** 欄位一律依表頭名稱定位，不寫死欄號；動態分項欄才能在加模式後自動生效。 */
function updateSummaryStudent_(payload, receivedAt) {
  const sheet = ensureSummarySheet_(book_());
  // 先確保分項欄存在（必要時追加在尾端），再讀取該行，欄數才不會少一格。
  const modeColumnIndex = modeColumn_(sheet, payload.mode);
  const headers = summaryHeaders_(sheet);
  const rowNumber = 2 + (payload.cls.charCodeAt(2) - 'A'.charCodeAt(0)) * 36 + payload.num - 1;
  const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];

  // 如總覽排列曾被人手改動，或總覽尚未建立，先按原始紀錄安全重建，再取得正確的一行。
  if (!current || Number(current[0]) !== 5 || current[1] !== payload.cls || Number(current[2]) !== payload.num) {
    writeSummary_();
    return;
  }

  const updated = current.slice();
  const at = name => headers.indexOf(name);
  updated[at('累計得分')] = (Number(current[at('累計得分')]) || 0) + payload.scoreDelta;
  updated[at('累計擊倒數')] = (Number(current[at('累計擊倒數')]) || 0) + payload.killDelta;
  if (modeColumnIndex > 0) {
    // 分項欄對應 aggregateLog_ 的 modeScores，兩條路徑必須一致。
    updated[modeColumnIndex - 1] = (Number(current[modeColumnIndex - 1]) || 0) + payload.scoreDelta;
  }
  if (MODE_MECHANISMS[payload.mode] === 'timed' && payload.wordCount === 10) {
    const bestIndex = at('最佳10字秒數');
    const oldBest = Number(current[bestIndex]);
    updated[bestIndex] = oldBest > 0 ? Math.min(oldBest, payload.bestTime) : payload.bestTime;
    // 手速週榜改由這一欄提供，必須與最佳秒數同步維護。
    const weekIndex = at('週次最佳秒數');
    const weeks = parseWeekSpeeds_(current[weekIndex]);
    if (!weeks[payload.weekKey] || payload.bestTime < weeks[payload.weekKey]) weeks[payload.weekKey] = payload.bestTime;
    updated[weekIndex] = serializeWeekSpeeds_(weeks);
  }
  updated[at('最後接收時間')] = receivedAt.toISOString();
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([updated]);
}

/** 標記總覽已落後於原始紀錄；由重建（定時或教師選單）清除。 */
function markSummaryDirty_() {
  try {
    PropertiesService.getScriptProperties().setProperty(SUMMARY_DIRTY_KEY, new Date().toISOString());
  } catch (error) {
    // 標記失敗不應影響成績寫入。
  }
}

function clearSummaryDirty_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(SUMMARY_DIRTY_KEY);
  } catch (error) {
    // 清除失敗不應影響重建。
  }
}

/** 回傳總覽偏差標記，供教師選單顯示。無偏差時回傳空字串。 */
function summaryDirtySince_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(SUMMARY_DIRTY_KEY) || '';
  } catch (error) {
    return '';
  }
}

/** 讀出總覽表頭（去空白）。動態分項欄可能存在，故一律以實際表頭為準。 */
function summaryHeaders_(sheet) {
  const last = sheet.getLastColumn();
  if (last < 1) return SUMMARY_FIXED_HEADERS.slice();
  return sheet.getRange(1, 1, 1, last).getValues()[0]
    .map(value => String(value == null ? '' : value).trim());
}

/* 確保「成績總覽」存在且固定欄正確。
   刻意不用 ensureSheet_：一旦有了動態分項欄，實際欄數會多於固定欄，
   ensureSheet_ 的「不得多於給定欄數」檢查會誤判為欄位不符。 */
function ensureSummarySheet_(book) {
  const sheet = book.getSheetByName(SUMMARY_SHEET) || book.insertSheet(SUMMARY_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SUMMARY_FIXED_HEADERS.length).setValues([SUMMARY_FIXED_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const headers = summaryHeaders_(sheet);
  const used = headers.filter(value => value !== '').length;
  for (let i = 0; i < Math.min(used, SUMMARY_FIXED_HEADERS.length); i++) {
    if (headers[i] !== SUMMARY_FIXED_HEADERS[i]) throw new Error(SUMMARY_SHEET + ' 欄位不符，請另建成績試算表。');
  }
  if (used < SUMMARY_FIXED_HEADERS.length) {
    // 舊表缺少尾端固定欄：補上（此時還不會有動態分項欄，故直接接在後面）。
    sheet.getRange(1, used + 1, 1, SUMMARY_FIXED_HEADERS.length - used)
      .setValues([SUMMARY_FIXED_HEADERS.slice(used)]);
  }
  return sheet;
}

/* 取得（必要時建立）「得分:<模式代號>」欄的欄號（1 起算）。
   找不到時追加在表頭最尾端 —— 這樣 ensureSummarySheet_ 的「固定欄前綴相符」才永遠成立；
   若插在中間，之後再加模式就會因為表頭位移而被判定為欄位不符。
   回傳 0 代表已達 MAX_MODE_COLUMNS 上限，呼叫方應只計總分、不建欄。 */
function modeColumn_(sheet, mode) {
  const headers = summaryHeaders_(sheet);
  const name = MODE_COLUMN_PREFIX + mode;
  const found = headers.indexOf(name);
  if (found >= 0) return found + 1;
  const existing = headers.filter(header => header.indexOf(MODE_COLUMN_PREFIX) === 0).length;
  if (existing >= MAX_MODE_COLUMNS) {
    console.warn('總覽的模式分項欄已達上限 ' + MAX_MODE_COLUMNS + '，新模式 ' + mode + ' 只計入總分。');
    return 0;
  }
  const index = headers.filter(header => header !== '').length;
  sheet.getRange(1, index + 1).setValue(name);
  return index + 1;
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function book_() {
  const id = props_().getProperty('SCORE_SPREADSHEET_ID');
  if (!id) throw new Error('請先在 Apps Script 編輯器執行 setup。');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(book, name, headers) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const width = Math.max(sheet.getLastColumn(), headers.length);
  const actual = sheet.getRange(1, 1, 1, width).getValues()[0];
  // 既有欄位必須完全相符；容許舊表缺少尾端新增的欄位，並自動補上標題。
  const used = actual.filter(value => String(value).trim() !== '').length;
  if (used > headers.length) throw new Error(name + ' 欄位不符，請另建成績試算表。');
  for (let i = 0; i < used; i++) {
    if (String(actual[i]).trim() !== headers[i]) throw new Error(name + ' 欄位不符，請另建成績試算表。');
  }
  if (used < headers.length) {
    sheet.getRange(1, used + 1, 1, headers.length - used).setValues([headers.slice(used)]);
  }
  return sheet;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Node 測試以 require 載入本檔時匯出；Apps Script 沒有 module，整段略過。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doGet, doPost, setup, onOpen, validate_, hasRequestId_, aggregateLog_,
    buildLeaderboard_, readData_, readDataFromLog_, writeSummary_, updateSummaryStudent_,
    markSummaryDirty_, clearSummaryDirty_, ensureSheet_, ensureSummarySheet_, summaryHeaders_,
    modeColumn_, mechOf_, json_,
    refreshSummary, refreshMastery, writeMasterySheet_, rebuildMasteryDrawers,
    reconcileMastery, showSystemStatus, clearMasteryDrawers,
    parseCompletedAt_, nightlyRebuild, setupTriggers,
    SUMMARY_SHEET, SUMMARY_FIXED_HEADERS, MODE_COLUMN_PREFIX, MAX_MODE_COLUMNS, MODE_PATTERN,
    MODE_MECHANISMS, LOG_SHEET, LOG_HEADERS, SUMMARY_DIRTY_KEY
  };
}
