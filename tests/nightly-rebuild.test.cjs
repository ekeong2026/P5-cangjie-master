/** 任務 0K：每日 06:00 定時重建。
 * 涵蓋：nightlyRebuild 的冪等性、與增量結果一致、setupTriggers 單一來源。
 * 本機階段不建立真實觸發器，只驗證邏輯。
 *
 * v2：掌握進度表改「長格式」（每生 16 列，第 3 欄＝模式前綴，第 4 欄＝當日進度），
 * 成績總覽的分項欄改為尾端動態欄「得分:<模式>」。故一律以表頭名稱／前綴定位。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const LOG = '遊戲紀錄';
const SUMMARY = '成績總覽';
const MASTERY = '掌握進度';
const LOG_HEADERS = ['請求編號', '接收時間', '年級', '班別', '學號', '模式', '本次得分', '本次擊倒數',
  '完成秒數', '題量', '周次', '本次得分字'];

/** 香港時間的今天（YYYY-MM-DD）。 */
function hkToday() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
/** 香港時間今天往前 n 天的同一時刻；其香港日期即 today-n。 */
function hkAgo(n) { return new Date(Date.now() - n * 86400000); }

function logRow(over = {}) {
  return Object.assign([
    'req-00000001', new Date(), 5, 'P5A', 7, 'connected', 10, 1, '', 10, 'w7', '更'
  ], over);
}
function seedLog(rows) { return { [LOG]: [LOG_HEADERS].concat(rows) }; }
function summaryOf(env, cls, num) {
  return env.tables[SUMMARY].find(r => r[1] === cls && r[2] === num) || null;
}
/** 依表頭名稱取總覽的某一格；動態分項欄（得分:模式）也適用。 */
function summaryCol(env, cls, num, name) {
  const headers = env.tables[SUMMARY][0].map(v => String(v == null ? '' : v).trim());
  const at = headers.indexOf(name);
  if (at < 0) return undefined;
  return summaryOf(env, cls, num)[at];
}
/** 取某生掌握的 16 列區塊；masteryRow 再依模式前綴取列。 */
function masteryBlock(env, cls, num) {
  const table = env.tables[MASTERY] || [];
  const start = env.s.MasteryStore.firstRow(cls, num) - 1;
  return table.slice(start, start + env.s.MasteryStore.MODE_ROWS_PER_STUDENT);
}
function masteryRow(env, cls, num, prefix) {
  return masteryBlock(env, cls, num).find(r => String(r[2]) === prefix) || null;
}
/** 掌握進度的資料欄（去掉最後一欄「更新時間」，每次執行都不同）。 */
function masteryData(env) {
  return env.tables[MASTERY].map(r => r.slice(0, -1).map(v => String(v == null ? '' : v)));
}

test('nightlyRebuild 同時重建總覽與掌握進度', () => {
  const env = makeEnv(seedLog([logRow()]));
  const result = env.s.nightlyRebuild();
  assert.equal(result.status, 'ok');
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 10, '總覽累計得分');
  const m = masteryRow(env, 'P5A', 7, 'connected');
  assert.ok(m, '掌握進度應有 connected 這一列');
  assert.match(String(m[3]), new RegExp('connected:更:' + hkToday()));
});

test('nightlyRebuild 冪等：重複執行資料完全相同', () => {
  const env = makeEnv(seedLog([logRow(), logRow({ 0: 'req-00000002', 11: '日' })]));
  const dataOnly = () => JSON.stringify([
    env.tables[SUMMARY].map(r => r.map(v => String(v == null ? '' : v))),
    masteryData(env)
  ]);
  env.s.nightlyRebuild();
  const first = dataOnly();
  env.s.nightlyRebuild();
  env.s.nightlyRebuild();
  assert.equal(dataOnly(), first, '重複重建不得改變任何資料');
});

test('定時重建結果與交卷增量更新一致', () => {
  // 情境 A：逐筆交卷，靠增量更新
  const envA = makeEnv();
  const post = (env, payload) => JSON.parse(env.s.doPost({ postData: { contents: JSON.stringify(payload) } }));
  post(envA, { requestId: 'req-aaaaaaaa', grade: 5, cls: 'P5A', num: 7, mode: 'connected',
    scoreDelta: 10, killDelta: 1, wordCount: 10, weekKey: 'w7',
    round: [{ char: '更', correct: true, earned: 10 }] });
  // 情境 B：直接塞紀錄後定時重建
  const envB = makeEnv(seedLog([logRow()]));
  envB.s.nightlyRebuild();

  const pick = (env) => ({
    total: summaryCol(env, 'P5A', 7, '累計得分'),
    kills: summaryCol(env, 'P5A', 7, '累計擊倒數'),
    mode1: summaryCol(env, 'P5A', 7, '得分:connected'),
    chars: String(masteryRow(env, 'P5A', 7, 'connected')[3])
  });
  assert.deepEqual(pick(envA), pick(envB), '兩條路徑的結果必須一致');
});

test('定時重建會清除總覽偏差標記', () => {
  const env = makeEnv(seedLog([logRow()]));
  env.props.set('SUMMARY_DIRTY', '2026-10-13T00:00:00Z');
  env.s.nightlyRebuild();
  assert.equal(env.props.get('SUMMARY_DIRTY'), undefined, '重建後偏差標記應被清除');
});

test('setupTriggers 先清舊再建新，避免重複累積', () => {
  const env = makeEnv();
  env.s.setupTriggers();
  assert.equal(env.state.triggers.length, 1);
  assert.equal(env.state.triggers[0].getHandlerFunction(), 'nightlyRebuild');
  assert.equal(env.state.triggers[0]._hour, 6, '必須排在清晨 06:00');
  // 再執行一次不得變成兩個
  env.s.setupTriggers();
  assert.equal(env.state.triggers.length, 1, '不得重複建立');
});

test('重建失敗時拋出錯誤（讓 Google 觸發器通知擁有者）', () => {
  const env = makeEnv(seedLog([logRow()]));
  env.state.failSheet = LOG;
  assert.throws(() => env.s.nightlyRebuild(), /模擬試算表故障/);
});

// ── 任務 14：重建驗證（冪等性、增量與重建一致、模式二、跨午夜） ──

const LOG_HEADERS_13 = LOG_HEADERS.concat(['完成時間']);

/** 13 欄紀錄（含完成時間）；completed 為 '' 時代表舊格式列。 */
function logRow13(mode, week, scoredChars, received, completed, over = {}) {
  const base = [
    'req-' + Math.random().toString(36).slice(2, 12), received, 5, 'P5A', 7, mode,
    0, 0, mode === 'speed' ? 30 : '', 10, week, scoredChars, completed
  ];
  Object.entries(over).forEach(([i, v]) => { base[Number(i)] = v; });
  return base;
}

test('重建：模式二得分字以週次前綴寫入掌握進度表', () => {
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13, logRow13('speed', 'w7_hw1', '更中田', hkAgo(0), hkAgo(0))]
  });
  env.s.writeMasterySheet_();
  const m = masteryRow(env, 'P5A', 7, 'speed.w7_hw1');
  assert.ok(m, '應有 speed.w7_hw1 這一列');
  assert.match(String(m[3]), new RegExp('speed\\.w7_hw1:中:' + hkToday()));
  assert.match(String(m[3]), new RegExp('speed\\.w7_hw1:更:' + hkToday()));
  assert.match(String(m[3]), new RegExp('speed\\.w7_hw1:田:' + hkToday()));
  assert.equal(masteryRow(env, 'P5A', 7, 'connected'), null, '模式一列不得被寫入');
  assert.equal(masteryRow(env, 'P5A', 7, 'special'), null, '模式三列不得被寫入');
});

test('重建冪等：連續三次執行結果完全相同（含模式二）', () => {
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13,
      logRow13('connected', 'w7', '更中', hkAgo(0), hkAgo(0)),
      logRow13('special', 'w7', '日月', hkAgo(0), hkAgo(0)),
      logRow13('speed', 'w8_hw1', '天地', hkAgo(0), hkAgo(0))
    ]
  });
  env.s.nightlyRebuild();
  const strip = () => JSON.stringify(masteryData(env));
  const first = strip();
  env.s.nightlyRebuild();
  env.s.nightlyRebuild();
  assert.equal(strip(), first, '重複重建不得改變掌握進度');
});

test('重建：跨午夜補送以「完成時間」歸屬日期，而非接收時間', () => {
  // 昨天送達、今天才完成 → 應記在今天，而不是接收時間所屬的昨天。
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13, logRow13('connected', 'w7', '更', hkAgo(1), hkAgo(0))]
  });
  env.s.writeMasterySheet_();
  const m = masteryRow(env, 'P5A', 7, 'connected');
  assert.ok(m, '應依完成時間記在今天的列');
  assert.match(String(m[3]), new RegExp('connected:更:' + hkToday()));
});

test('重建：完成於昨天的補送不佔用今天的額度', () => {
  // 昨天完成、今天才送達 → 不得佔用今天的額度（避免跨午夜補送白白吃掉隔天）。
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13, logRow13('connected', 'w7', '更', hkAgo(0), hkAgo(1))]
  });
  env.s.writeMasterySheet_();
  assert.equal(masteryRow(env, 'P5A', 7, 'connected'), null, '今天的列必須是空的');
});

test('重建：完成時間欄為空的舊格式列退回接收時間', () => {
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13, logRow13('connected', 'w7', '更', hkAgo(0), '')]
  });
  env.s.writeMasterySheet_();
  const m = masteryRow(env, 'P5A', 7, 'connected');
  assert.ok(m, '舊格式列仍應被處理');
  assert.match(String(m[3]), /connected:更:/);
});

test('重建：無「本次得分字」的舊列視為無資料，不改動任何分數', () => {
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13,
      logRow13('connected', 'w7', '', hkAgo(1), hkAgo(1)),
      logRow13('connected', 'w7', '更', hkAgo(0), hkAgo(0))
    ]
  });
  env.s.writeMasterySheet_();
  const m = masteryRow(env, 'P5A', 7, 'connected');
  assert.equal(String(m[3]).split(';').filter(Boolean).length, 1, '只有一筆有效得分');
});

test('重建：模式一／三／二同時存在時各自獨立，互不覆蓋', () => {
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13,
      logRow13('connected', 'w7', '更', hkAgo(0), hkAgo(0)),
      logRow13('special', 'w7', '中', hkAgo(0), hkAgo(0)),
      logRow13('speed', 'w7_hw1', '田', hkAgo(0), hkAgo(0))
    ]
  });
  env.s.writeMasterySheet_();
  assert.match(String(masteryRow(env, 'P5A', 7, 'connected')[3]), /^connected:更:/);
  assert.match(String(masteryRow(env, 'P5A', 7, 'special')[3]), /^special:中:/);
  assert.match(String(masteryRow(env, 'P5A', 7, 'speed.w7_hw1')[3]), /^speed\.w7_hw1:田:/);
});

test('重建後總覽與增量更新結果一致（模式二分數）', () => {
  const env = makeEnv();
  // 交兩場模式二：w7_hw1 與 w8_hw1。
  const post = p => JSON.parse(env.s.doPost({ postData: { contents: JSON.stringify(p) } }));
  const words = '更中田大日月天地枝本'.split('').map(c => ({ char: c, correct: true, earned: 9 }));
  post({ grade: 5, cls: 'P5A', num: 7, mode: 'speed', scoreDelta: 0, killDelta: 0, bestTime: 30,
    wordCount: 10, weekKey: 'w7_hw1', requestId: 'inc-00000001', round: words });
  post({ grade: 5, cls: 'P5A', num: 7, mode: 'speed', scoreDelta: 0, killDelta: 0, bestTime: 28,
    wordCount: 10, weekKey: 'w8_hw1', requestId: 'inc-00000002', round: words });
  const names = ['累計得分', '累計擊倒數', '最佳10字秒數', '週次最佳秒數', '得分:speed'];
  const pick = () => names.map(name => String(summaryCol(env, 'P5A', 7, name)));
  const incremental = pick();

  env.s.writeSummary_();
  assert.deepEqual(pick(), incremental, '重建與增量必須逐欄一致');
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 180, '兩場各 90 分');
  assert.equal(summaryCol(env, 'P5A', 7, '得分:speed'), 180, '得分:speed 應為 180');
});

// ── 每天前三次計分：重建路徑必須保留次數 ────────────────────
// 若次數在每日 06:00 重建時被抹平，學生隔天就能把同一批字再刷三輪。

test('重建：同一字同一天多次得分會累加次數，不會被抹平', () => {
  const rows = [1, 2, 3].map(() => logRow13('connected', 'w7', '更', hkAgo(0), hkAgo(0)));
  const env = makeEnv({ [LOG]: [LOG_HEADERS_13].concat(rows) });
  env.s.writeMasterySheet_();
  const m = masteryRow(env, 'P5A', 7, 'connected');
  assert.equal(String(m[3]), 'connected:更:' + hkToday() + '*3', '同一天三次應記為 3 次');
});

test('重建：紀錄筆數異常時，次數夾在上限 3', () => {
  const rows = [1, 2, 3, 4, 5].map(() => logRow13('connected', 'w7', '更', hkAgo(0), hkAgo(0)));
  const env = makeEnv({ [LOG]: [LOG_HEADERS_13].concat(rows) });
  env.s.writeMasterySheet_();
  const m = masteryRow(env, 'P5A', 7, 'connected');
  assert.equal(String(m[3]), 'connected:更:' + hkToday() + '*3', '次數不得超過上限');
});

test('每日 06:00 重建後，抽屜的次數不會被歸零', () => {
  const rows = [1, 2, 3].map(() => logRow13('connected', 'w7', '更', hkAgo(0), hkAgo(0)));
  const env = makeEnv({ [LOG]: [LOG_HEADERS_13].concat(rows) });
  env.s.nightlyRebuild();
  const drawer = env.props.get('mb:P5A_7');
  assert.ok(drawer, '抽屜應存在');
  assert.equal(drawer, 'v2|' + hkToday() + '|connected:更3',
    '抽屜必須保留 3 次，否則隔天可再刷一輪');
});

test('重建：不同日期的多次得分只保留最新日期，不跨日累加', () => {
  const env = makeEnv({
    [LOG]: [LOG_HEADERS_13,
      logRow13('connected', 'w7', '更', hkAgo(1), hkAgo(1)),
      logRow13('connected', 'w7', '更', hkAgo(1), hkAgo(1)),
      logRow13('connected', 'w7', '更', hkAgo(0), hkAgo(0))
    ]
  });
  env.s.writeMasterySheet_();
  const m = masteryRow(env, 'P5A', 7, 'connected');
  assert.equal(String(m[3]), 'connected:更:' + hkToday(), '只保留今天，且計為 1 次（每日重置）');
});

test('增量與重建的掌握進度次數必須一致（模式一）', () => {
  const env = makeEnv();
  const post = p => JSON.parse(env.s.doPost({ postData: { contents: JSON.stringify(p) } }));
  // 同一天分三次交卷，每次同一字「更」
  ['inc-10000001', 'inc-10000002', 'inc-10000003'].forEach(id => {
    post({ grade: 5, cls: 'P5A', num: 7, mode: 'connected', scoreDelta: 0, killDelta: 0,
      wordCount: 10, weekKey: 'w7', requestId: id,
      round: [{ char: '更', correct: true, earned: 10 }] });
  });
  const incremental = String(masteryRow(env, 'P5A', 7, 'connected')[3]);
  env.s.writeMasterySheet_();
  const rebuilt = String(masteryRow(env, 'P5A', 7, 'connected')[3]);
  assert.match(incremental, /connected:更:\d{4}-\d{2}-\d{2}\*3/, '增量路徑應記為 3 次');
  assert.match(rebuilt, /connected:更:\d{4}-\d{2}-\d{2}\*3/, '重建路徑應記為 3 次');
  assert.equal(rebuilt, incremental, '兩條路徑的次數必須逐字一致');
});
