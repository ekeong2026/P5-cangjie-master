/** ② 階段部署重置演練（對應 docs/DEPLOY_GUIDE_SCORE_BACKEND.md 第二節）。
 *
 * 使用者端要做的重置是「刪兩張衍生表 ＋ 清指令碼屬性，再跑 setup() 重建」。
 * 這裡在沙箱裡完整重現一次，確認：
 *   - 刪表後 setup() 不會拋錯，且自動以「新格式」重建；
 *   - 遊戲紀錄為 0 列時，總覽仍會建立 216 位學生的空白列（不會殘留舊分數）；
 *   - 殘留的 mb:* 抽屜與 SUMMARY_DIRTY 被清掉後，交卷路徑仍正常。
 *
 * 這支測試是「部署指引可照著做」的機器證明 —— 指引改了就要讓它一起過。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const LOG = '遊戲紀錄';
const SUMMARY = '成績總覽';
const MASTERY = '掌握進度';
const FIXED = ['年級', '班別', '學號', '累計得分', '累計擊倒數', '最佳10字秒數', '最後接收時間', '週次最佳秒數'];
const MODE_ROWS = 16;   // MasteryStore.MODE_ROWS_PER_STUDENT

/** 重現使用者端第二節的重置動作。
 *  注意：沙箱的 `props` 是 Map（不是物件），且 requestId 必須符合
 *  /^[A-Za-z0-9_-]{8,100}$/ —— 兩者都是本檔先前踩到的坑。 */
function resetLikeUser(env) {
  env.tables[LOG] = [];                 // 紀錄本來就是 0 列（新後端）；確保是空表
  delete env.tables[SUMMARY];           // 刪「成績總覽」
  delete env.tables[MASTERY];           // 刪「掌握進度」
  Array.from(env.props.keys()).forEach(name => {
    if (name.indexOf('mb:') === 0 || name === 'SUMMARY_DIRTY') env.props.delete(name);
  });
}

function post(env, p) {
  return JSON.parse(env.s.doPost({ postData: { contents: JSON.stringify(p) } }));
}

/** 一筆合法的探針請求（requestId 至少 8 字元，全為 [A-Za-z0-9_-]）。 */
function probe(requestId, over = {}) {
  return Object.assign({
    requestId: requestId, grade: 5, cls: 'P5A', num: 1, mode: 'abbrev',
    scoreDelta: 0, killDelta: 0, wordCount: 10, weekKey: '',
    round: [{ char: '五', correct: true, earned: 12 }]
  }, over);
}

test('重置後 setup() 不拋錯，並以 8 欄新格式重建 216 位學生', () => {
  const env = makeEnv();
  resetLikeUser(env);
  assert.equal(env.tables[SUMMARY], undefined, '前置：總覽已刪除');
  assert.equal(env.tables[MASTERY], undefined, '前置：掌握進度已刪除');

  env.s.setup();

  const summary = env.tables[SUMMARY];
  assert.ok(summary, 'setup() 應重建總覽');
  assert.deepEqual(Array.from(summary[0]), FIXED, '表頭為 8 個固定欄');
  assert.equal(summary[0].filter(h => String(h).indexOf('得分:') === 0).length, 0,
    '全新表不應有任何動態分項欄（還沒有任何模式得過分）');
  assert.equal(summary.length, 1 + 216, '應為 1 表頭 ＋ 216 位學生');
  const scored = summary.slice(1).filter(r => Number(r[3]) !== 0);
  assert.equal(scored.length, 0, '重建後不得殘留任何分數');
});

test('重置後總覽表頭仍可續用：第一位學生得分時才在尾端長出分項欄', () => {
  const env = makeEnv();
  resetLikeUser(env);
  env.s.setup();

  post(env, probe('reset-probe-0001'));

  const headers = env.tables[SUMMARY][0].map(v => String(v == null ? '' : v).trim());
  assert.deepEqual(headers.slice(0, FIXED.length), FIXED, '固定 8 欄位置不變');
  assert.equal(headers[FIXED.length], '得分:abbrev', '動態分項欄追加在尾端');
  const row = env.tables[SUMMARY].find(r => r[1] === 'P5A' && r[2] === 1);
  assert.equal(Number(row[FIXED.length]), 12, '該模式分項為 12');
  assert.equal(Number(row[3]), 12, '累計得分同步為 12');
});

test('重置後「掌握進度」以長格式 6 欄建立，且當日進度帶模式前綴', () => {
  const env = makeEnv();
  resetLikeUser(env);
  env.s.setup();
  post(env, probe('reset-probe-0002'));

  const table = env.tables[MASTERY];
  assert.ok(table, '寫入後應建立掌握進度表');
  assert.deepEqual(Array.from(table[0]),
    ['班別', '學號', '模式', '當日進度', '最後更新日', '更新時間'], '長格式 6 欄');

  // 交卷路徑是「稀疏寫入」：只寫該生那 16 列的區塊（+1 表頭），
  // 不像 setup()／refreshMastery 會把 216 生全部鋪滿。
  assert.equal(table.length, 1 + MODE_ROWS, 'P5A 1 的區塊：1 表頭 ＋ 16 列');

  const row = table.find(r => r[0] === 'P5A' && r[1] === 1 && String(r[2]) === 'abbrev');
  assert.ok(row, '應有 P5A 1 的 abbrev 列');
  assert.match(String(row[3]), /^abbrev:五:/, '當日進度含模式前綴');

  // 全量重建（setup／選單「更新掌握進度」）才會鋪滿 216 生 × 16 列。
  env.s.refreshMastery();
  assert.equal(env.tables[MASTERY].length, 1 + 216 * MODE_ROWS,
    '全量重建後為 1 表頭 ＋ 216 生 × 16 列');
});

test('清掉 mb:* 抽屜後，交卷會自「掌握進度」表補回，次數不被歸零', () => {
  const env = makeEnv();
  resetLikeUser(env);
  env.s.setup();

  assert.equal(post(env, probe('reset-probe-0003')).earned, 12, '第 1 次得分');

  // 抽屜被清掉（模擬指令碼屬性被清、或逾時丟失）
  Array.from(env.props.keys()).forEach(name => {
    if (name.indexOf('mb:') === 0) env.props.delete(name);
  });
  assert.equal(Array.from(env.props.keys()).filter(k => k.indexOf('mb:') === 0).length, 0,
    '前置：抽屜已清空');

  // 後端會自 Sheet 的「掌握進度」補回今天已得分的字（S6 救援路徑）。
  const restored = env.s.MasteryStore.readFromSheet('P5A', 1, env.s.MasteryCore.hkDate(new Date()));
  assert.equal(restored.version, 'v2', '應重建出抽屜');
  assert.equal(restored.map['abbrev:五'], env.s.MasteryCore.hkDate(new Date()),
    '補回的進度鍵含模式前綴，且為今天的日期');

  // 再交一次：後端知道「今天已用過這個字」，會把次數由 1 累加為 2。
  // ★ 注意：遞減倍率（第 2 次 50%）由前端套用，後端只採信 round[].earned 的數值。
  //   這是既有的信任模型（見 MEMORY.md「計分架構」），不是本次改動造成的。
  post(env, probe('reset-probe-0004'));
  const row = env.tables[MASTERY].find(r => r[0] === 'P5A' && r[1] === 1 && String(r[2]) === 'abbrev');
  assert.match(String(row[3]), /\*2$/, '次數應累加為 2（沒有被抽屜遺失歸零）');
});

test('抽屜遺失且尚未寫過 Sheet 時，回退為空抽屜並照常計分（不會拋錯）', () => {
  const env = makeEnv();
  resetLikeUser(env);
  env.s.setup();

  // 完全沒有掌握進度表的情況（例如剛重置、第一次交卷）
  delete env.tables[MASTERY];
  const r = post(env, probe('reset-probe-0006'));
  assert.equal(r.status, 'success', '不應因查無 Sheet 而失敗');
  assert.equal(r.earned, 12, '視為今天第一次得分');
  assert.equal(env.tables[MASTERY].length, 1 + MODE_ROWS, '交卷後才建立掌握進度表');
});

test('正常交卷不會標記 SUMMARY_DIRTY（只有寫入失敗才標記）', () => {
  const env = makeEnv();
  resetLikeUser(env);
  env.s.setup();
  assert.equal(env.props.has('SUMMARY_DIRTY'), false, '前置：SUMMARY_DIRTY 不存在');

  const r = post(env, probe('reset-probe-0005', { cls: 'P5B', num: 9, mode: 'connected',
    killDelta: 1, round: [{ char: '更', correct: true, earned: 15 }] }));
  assert.equal(r.status, 'success');
  assert.equal(r.earned, 15);
  // markSummaryDirty_ 只在「紀錄／總覽寫入」的 catch 區塊被呼叫；
  // 正常路徑會走 updateSummaryStudent_ 直接更新，因此不應留下偏差標記。
  assert.equal(env.props.has('SUMMARY_DIRTY'), false, '正常交卷不應標記待重建');
});

test('總覽寫入失敗時會標記 SUMMARY_DIRTY，讓重建作業兜底', () => {
  const env = makeEnv();
  resetLikeUser(env);
  env.s.setup();
  // 模擬總覽被鎖住／寫入失敗（sheetOps 由沙箱的 guard 觸發時機不好掌握，
  // 這裡直接讓 updateSummaryStudent_ 拋錯，驗證 catch 區塊的行為）。
  const original = env.s.updateSummaryStudent_;
  env.s.updateSummaryStudent_ = () => { throw new Error('模擬總覽寫入失敗'); };
  try {
    const r = post(env, probe('reset-probe-0007'));
    assert.equal(r.status, 'success', '寫入失敗仍應讓學生拿到回應（交給重建兜底）');
    assert.equal(env.props.has('SUMMARY_DIRTY'), true, '應標記待重建');
  } finally {
    env.s.updateSummaryStudent_ = original;
  }
});

test('重置腳本的五個步驟都對得上現行程式的介面（防止指引與程式脫節）', () => {
  const env = makeEnv();
  // 1. setup 存在且可執行（第二節第 6 步）
  assert.equal(typeof env.s.setup, 'function');
  // 2. 教師選單的相關函式（第二節第 3 步的替代做法）
  assert.equal(typeof env.s.clearMasteryDrawers, 'function');
  assert.equal(typeof env.s.refreshMastery, 'function');
  assert.equal(typeof env.s.rebuildMasteryDrawers, 'function');
  // 3. 指引提到的三個工作表名稱與程式一致
  assert.equal(env.exported.LOG_SHEET, '遊戲紀錄');
  assert.equal(env.exported.SUMMARY_SHEET, '成績總覽');
  assert.equal(env.s.MasteryStore.SHEET_NAME, '掌握進度');
  // 4. 總覽固定 8 欄與動態欄上限
  assert.deepEqual(Array.from(env.exported.SUMMARY_FIXED_HEADERS), FIXED);
  assert.equal(env.exported.MAX_MODE_COLUMNS, 24, '動態欄上限與指引一致');
  assert.equal(String(env.exported.MODE_PATTERN), String(/^[a-z][a-z0-9_]{0,23}$/));
  // 5. 重置要清掉的指令碼屬性鍵（mb:* 前綴與 SUMMARY_DIRTY）
  assert.equal(env.exported.SUMMARY_DIRTY_KEY, 'SUMMARY_DIRTY');
  assert.equal(env.s.MasteryStore.KEY_PREFIX, 'mb:');
  // 6. 掌握進度每生固定 16 列（指引的「長格式」說明）
  assert.equal(env.s.MasteryStore.MODE_ROWS_PER_STUDENT, MODE_ROWS);
  // 7. 交卷的 requestId 驗證：過短的 ID 會被拒（指引範例用的是 phase2-verify-001）
  //    validate_ 的檢查順序是 cls/num → requestId，故這裡要一併帶上必填欄位。
  assert.throws(() => env.s.validate_({
    grade: 5, cls: 'P5A', num: 36, mode: 'abbrev', requestId: 'short'
  }), /請求編號/, '過短的 requestId 應被拒（至少 8 字元）');
  // 合法長度的 ID 不會因格式被拒（其他欄位照常驗證）
  assert.doesNotThrow(() => env.s.validate_({
    requestId: 'phase2-verify-001', grade: 5, cls: 'P5A', num: 36, mode: 'abbrev',
    scoreDelta: 0, killDelta: 0, wordCount: 10, weekKey: '',
    round: [{ char: '五', correct: true, earned: 12 }]
  }), '指引 6.2 的範例請求應可通過驗證');
});
