/** 任務 6：後端每日掌握判斷（mock）。
 * 涵蓋：同日重複 requestId 不重複計分、同日已得分字不加分、跨日可再得分、
 *       抽屜遺失時由 Sheet 重建、容量異常時只寫 Sheet 不阻斷、舊格式請求相容。
 *
 * v2：所有模式共用同一個進度地圖（鍵＝模式前綴:漢字），總覽的分項欄改為動態。
 * 因此本檔一律以「表頭名稱」定位欄位，不再寫死欄號。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const LOG = '遊戲紀錄';
const SUMMARY = '成績總覽';
const MASTERY = '掌握進度';
const MODE_ROWS = 16;

/** 今天（香港時間）的日期字串，供測試對齊。 */
function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function yesterdayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
}

function payload(over = {}) {
  return Object.assign({
    grade: 5, cls: 'P5A', num: 7, mode: 'connected',
    scoreDelta: 0, killDelta: 1, wordCount: 10, weekKey: 'w7',
    requestId: 'req-' + Math.random().toString(36).slice(2, 12),
    round: [{ char: '更', correct: true, earned: 15 }]
  }, over);
}
function post(env, p) {
  return JSON.parse(env.s.doPost({ postData: { contents: JSON.stringify(p) } }));
}
function summaryOf(env, cls, num) {
  return env.tables[SUMMARY].find(r => r[1] === cls && r[2] === num) || null;
}
/** 依表頭名稱取總覽的某一格（動態分項欄也適用）。 */
function summaryCol(env, cls, num, name) {
  const headers = env.tables[SUMMARY][0].map(v => String(v == null ? '' : v).trim());
  const index = headers.indexOf(name);
  if (index < 0) return undefined;
  return summaryOf(env, cls, num)[index];
}
function modeScore(env, cls, num, mode) {
  return summaryCol(env, cls, num, '得分:' + mode);
}
function logRows(env) { return env.tables[LOG].slice(1); }
/** 掌握進度表（長格式）中，某生某模式前綴的那一列。 */
function masteryRow(env, cls, num, prefix) {
  return (env.tables[MASTERY] || []).find(r => r[0] === cls && r[1] === num && String(r[2]) === prefix) || null;
}

/** 種一張「掌握進度」表：P5A-7 的列區塊（每生 16 列）在第 98 列起。 */
function masterySeed(prefix, progressText, date) {
  const rows = [['班別', '學號', '模式', '當日進度', '最後更新日', '更新時間']];
  while (rows.length < 97) rows.push(['', '', '', '', '', '']);
  for (let i = 0; i < MODE_ROWS; i++) {
    rows.push(i === 0 ? ['P5A', 7, prefix, progressText, date, ''] : ['P5A', 7, '', '', '', '']);
  }
  return rows;
}

test('新模式：第一次交卷，後端判定為今日首答並計分', () => {
  const env = makeEnv();
  const result = post(env, payload());
  assert.equal(result.status, 'success');
  assert.equal(result.earned, 15, '後端依 round 判定得分');
  assert.deepEqual(result.newlyScored, ['更']);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 15, '總覽累計得分');
});

test('同 requestId 重複提交不重複計分', () => {
  const env = makeEnv();
  const p = payload();
  post(env, p);
  const again = post(env, p);
  assert.equal(again.duplicate, true);
  assert.equal(again.earned, 0);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 15, '仍是 15，未翻倍');
  assert.equal(logRows(env).length, 1, '紀錄只有一列');
});

test('同日第 2、3 次仍計分，第 4 次起不再計分', () => {
  const env = makeEnv();
  const first = post(env, payload({ requestId: 'req-aaaaaaaa', round: [{ char: '更', correct: true, earned: 15 }] }));
  const second = post(env, payload({ requestId: 'req-bbbbbbbb', round: [{ char: '更', correct: true, earned: 8 }] }));
  assert.equal(first.earned, 15, '第 1 次計分');
  assert.equal(second.earned, 8, '第 2 次仍計分（倍率由前端套用）');
  assert.deepEqual(second.newlyScored, ['更']);
  const third = post(env, payload({ requestId: 'req-cccc0003', round: [{ char: '更', correct: true, earned: 4 }] }));
  assert.equal(third.earned, 4, '第 3 次仍計分');
  const fourth = post(env, payload({ requestId: 'req-dddddddd', round: [{ char: '更', correct: true, earned: 4 }] }));
  assert.equal(fourth.earned, 0, '第 4 次不再計分');
  assert.deepEqual(fourth.newlyScored, []);
  assert.deepEqual(fourth.ignored, ['更']);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 27, '15 + 8 + 4，第 4 次不計');
});

test('一輪內同一字重複答對只算一次', () => {
  const env = makeEnv();
  const result = post(env, payload({
    round: [
      { char: '更', correct: true, earned: 15 },
      { char: '更', correct: true, earned: 15 }
    ]
  }));
  assert.equal(result.earned, 15, '只計一次');
  assert.deepEqual(result.newlyScored, ['更']);
});

test('跨日後同一字可再次得分', () => {
  const env = makeEnv();
  // 抽屜記錄為昨天（v2 格式），今天應視為失效
  env.props.set('mb:P5A_7', 'v2|' + yesterdayStr() + '|connected:更');
  const result = post(env, payload());
  assert.equal(result.earned, 15, '昨天的日期不等於今天，可再得分');
});

test('抽屜遺失時，可由「掌握進度」表補回今日進度（含次數）', () => {
  const env = makeEnv({
    [MASTERY]: masterySeed('connected', 'connected:更:' + todayStr() + '*3', todayStr())
  });
  // 抽屜被清空，但 Sheet 說今天已用滿次數
  const result = post(env, payload({ round: [{ char: '更', correct: true, earned: 15 }] }));
  assert.equal(result.earned, 0, '依 Sheet 判定為今日已用滿次數');
  assert.deepEqual(result.ignored, ['更']);
});

test('抽屜遺失時補回的次數是「已有幾次」，不是重來', () => {
  const env = makeEnv({
    [MASTERY]: masterySeed('connected', 'connected:更:' + todayStr() + '*2', todayStr())
  });
  const result = post(env, payload({ round: [{ char: '更', correct: true, earned: 5 }] }));
  assert.equal(result.earned, 5, '第 3 次仍可計分');
  assert.deepEqual(result.newlyScored, ['更']);
  const row = masteryRow(env, 'P5A', 7, 'connected');
  assert.ok(row, '掌握進度應有 connected 這一列');
  assert.match(String(row[3]), /\*3$/, '次數由 2 累加到 3');
});

test('容量異常時只寫 Sheet，不阻斷學生交卷', () => {
  const env = makeEnv();
  env.state.failProps = true;
  const result = post(env, payload());
  assert.equal(result.status, 'success', '交卷仍成功');
  assert.equal(result.earned, 15);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 15, '成績已寫入 Sheet');
});

test('舊格式請求（未帶 round）向後相容，沿用 scoreDelta', () => {
  const env = makeEnv();
  const result = post(env, payload({ round: undefined, scoreDelta: 42, killDelta: 1 }));
  assert.equal(result.status, 'success');
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 42, '沿用前端分數');
});

test('不同模式的分項分數各自記在對應的動態欄位', () => {
  const env = makeEnv();
  post(env, payload({ mode: 'connected', round: [{ char: '更', correct: true, earned: 10 }] }));
  post(env, payload({ mode: 'special', round: [{ char: '體', correct: true, earned: 10 }] }));
  assert.equal(modeScore(env, 'P5A', 7, 'special'), 10, '特殊字得分');
  assert.equal(modeScore(env, 'P5A', 7, 'connected'), 10, '連體字得分不受影響');
});

test('一輪中已用滿次數的字與可再計分的字混合：只計可再計分的', () => {
  const env = makeEnv();
  // 先把「更」推到當天上限（3 次）
  ['req-first0001', 'req-first0002', 'req-first0003'].forEach((id) => {
    post(env, payload({ requestId: id, round: [{ char: '更', correct: true, earned: 15 }] }));
  });
  const result = post(env, payload({
    requestId: 'req-second000',
    round: [
      { char: '更', correct: true, earned: 15 },  // 已用滿 → 0
      { char: '中', correct: true, earned: 12 }   // 新字 → 12
    ]
  }));
  assert.equal(result.earned, 12);
  assert.deepEqual(result.newlyScored, ['中']);
  assert.deepEqual(result.ignored, ['更']);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 57, '15 × 3 + 12');
});

test('答錯的題目不會佔用當日額度', () => {
  const env = makeEnv();
  const result = post(env, payload({
    round: [{ char: '更', correct: false, earned: 0 }]
  }));
  assert.equal(result.earned, 0);
  assert.deepEqual(result.newlyScored, [], '答錯不記為已得分');
  // 之後答對同字仍可得分
  const retry = post(env, payload({ round: [{ char: '更', correct: true, earned: 15 }] }));
  assert.equal(retry.earned, 15);
});

// ── 任務 11：模式二（手速賽）每日首答加分 ──────────────

/** 模式二交卷：整場 10 字，每字分攤 9 分（30 秒 → 90 分）。 */
function speedWords(chars, earned = 9) {
  return Array.from(chars, c => ({ char: c, correct: true, earned }));
}
function speedPayload(over) {
  return Object.assign({
    grade: 5, cls: 'P5A', num: 7,
    mode: 'speed', gameMode: 'speed', scoreDelta: 0, killDelta: 0,
    bestTime: 30, wordCount: 10, weekKey: 'w7_hw1'
  }, over || {});
}

test('模式二：整場 10 字首答，分數計入總分與模式二欄位', () => {
  const env = makeEnv();
  const result = post(env, speedPayload({
    requestId: 'speed-first-01', round: speedWords('更中田大日月天地枝本')
  }));
  assert.equal(result.status, 'success');
  assert.equal(result.earned, 90, '10 字 × 9 分');
  assert.equal(result.newlyScored.length, 10);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 90, 'grandTotal 應計入模式二分數');
  assert.equal(modeScore(env, 'P5A', 7, 'speed'), 90, '得分:speed 應由 0 變為 90');
  assert.equal(modeScore(env, 'P5A', 7, 'connected'), undefined, '未得分模式不建欄');
});

test('模式二：同週次同日最多計 3 次，第 4 場起不再計分', () => {
  const env = makeEnv();
  for (const n of [1, 2, 3]) {
    post(env, speedPayload({ requestId: 'speed-rep-0' + n, round: speedWords('更中田大日月天地枝本') }));
  }
  const fourth = post(env, speedPayload({
    requestId: 'speed-rep-04', round: speedWords('更中田大日月天地枝本')
  }));
  assert.equal(fourth.earned, 0, '第 4 場不再計分');
  assert.deepEqual(fourth.newlyScored, []);
  assert.equal(fourth.ignored.length, 10);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 270, '前三場合計 90 × 3');
});

test('模式二：不同週次／功課的同一個字可各自得分', () => {
  const env = makeEnv();
  const r1 = post(env, speedPayload({
    requestId: 'speed-w7-01', weekKey: 'w7_hw1', round: speedWords('更中田大日月天地枝本')
  }));
  const r2 = post(env, speedPayload({
    requestId: 'speed-w8-01', weekKey: 'w8_hw1', round: speedWords('更中田大日月天地枝本')
  }));
  assert.equal(r1.earned, 90);
  assert.equal(r2.earned, 90, '換週次後同字應可再得分');
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 180);
  assert.equal(modeScore(env, 'P5A', 7, 'speed'), 180, '得分:speed 累加兩場');
});

test('模式二：同週次但不同功課亦可各自得分', () => {
  const env = makeEnv();
  const r1 = post(env, speedPayload({
    requestId: 'speed-hw1', weekKey: 'w7_hw1', round: speedWords('更中田大日月天地枝本')
  }));
  const r2 = post(env, speedPayload({
    requestId: 'speed-hw2', weekKey: 'w7_hw2', round: speedWords('更中田大日月天地枝本')
  }));
  assert.equal(r1.earned, 90);
  assert.equal(r2.earned, 90);
});

test('模式二：同一 requestId 重送不重複計分', () => {
  const env = makeEnv();
  const p = speedPayload({ requestId: 'speed-dup-01', round: speedWords('更中田大日月天地枝本') });
  const first = post(env, p);
  const again = post(env, p);
  assert.equal(first.earned, 90);
  assert.equal(again.duplicate, true);
  assert.equal(again.earned, 0);
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 90);
});

test('模式二：秒數天梯資料仍正確寫入紀錄，彙總不受加分影響', () => {
  const env = makeEnv();
  post(env, speedPayload({ requestId: 'speed-ladder-01', bestTime: 28.5, round: speedWords('更中田大日月天地枝本') }));
  const row = logRows(env).find(r => r[0] === 'speed-ladder-01');
  assert.ok(row, '紀錄應存在');
  assert.equal(row[5], 'speed', '模式必須記為 speed');
  assert.equal(row[8], 28.5, 'bestTime 原樣寫入');
  assert.equal(row[9], 10, 'wordCount 原樣寫入');
  assert.equal(row[10], 'w7_hw1', 'weekKey 原樣寫入');
  // 最佳 10 字秒數與週次最佳秒數仍必須更新。
  assert.equal(summaryCol(env, 'P5A', 7, '最佳10字秒數'), 28.5, '最佳秒數欄不受影響');
  assert.match(String(summaryCol(env, 'P5A', 7, '週次最佳秒數')), /w7_hw1:28\.5/, '週次最佳秒數欄不受影響');
});

test('模式二：較慢的一場不覆蓋較快的最佳秒數，但仍可得分', () => {
  const env = makeEnv();
  post(env, speedPayload({ requestId: 'speed-fast', bestTime: 25, round: speedWords('更中田大日月天地枝本') }));
  const slow = post(env, speedPayload({
    requestId: 'speed-slow', bestTime: 55, weekKey: 'w8_hw1', round: speedWords('更中田大日月天地枝本')
  }));
  assert.equal(slow.earned, 90, '較慢但仍首答，應得分');
  assert.equal(summaryCol(env, 'P5A', 7, '最佳10字秒數'), 25, '最佳秒數應保留較快的 25');
  assert.match(String(summaryCol(env, 'P5A', 7, '週次最佳秒數')), /w8_hw1:55/, '另一週次各自記錄');
});

test('模式二：已用滿 3 次的字不再計分，只加計其餘新字', () => {
  const env = makeEnv();
  // 先把同一批 10 字打三場，推到當天上限
  for (const n of [1, 2, 3]) {
    post(env, speedPayload({
      requestId: 'speed-part-' + n, round: speedWords('更中田大日月天地枝本')
    }));
  }
  // 第四場：3 個已達上限的字 + 7 個新字，只有新的 7 個拿分。
  const second = post(env, speedPayload({
    requestId: 'speed-part-4',
    round: speedWords('更中田甲乙丙丁戊己庚'.split(''))
  }));
  assert.equal(second.earned, 63, '7 個新字 × 9 分');
  assert.deepEqual(second.newlyScored, '甲乙丙丁戊己庚'.split(''));
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 333, '90 × 3 + 63');
});

test('模式二：舊版前端（無 round）仍可上傳秒數，且不計分', () => {
  const env = makeEnv();
  const result = post(env, speedPayload({ requestId: 'speed-legacy-01' }));
  assert.equal(result.status, 'success');
  assert.equal(result.earned, 0, '未帶 round 時不得計分');
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 0);
  assert.equal(summaryCol(env, 'P5A', 7, '最佳10字秒數'), 30, '秒數仍必須寫入');
});

test('模式二：掌握進度表記錄含週次前綴的鍵', () => {
  const env = makeEnv();
  post(env, speedPayload({ requestId: 'speed-key-01', round: speedWords('更中田大日月天地枝本') }));
  const row = masteryRow(env, 'P5A', 7, 'speed.w7_hw1');
  assert.ok(row, '掌握進度應有 speed.w7_hw1 這一列');
  assert.match(String(row[3]), /speed\.w7_hw1:/, '模式二得分字應含週次前綴');
  assert.equal(masteryRow(env, 'P5A', 7, 'connected'), null, '未玩的模式不得佔用列');
});

test('模式二：跨日後同一週次同字可再得分', () => {
  const env = makeEnv();
  // 先以「昨天」交一場（用 completedAt 指定歸屬日期）。
  post(env, speedPayload({
    requestId: 'speed-yday', completedAt: new Date(Date.now() - 86400000).toISOString(),
    round: speedWords('更中田大日月天地枝本')
  }));
  const todayResult = post(env, speedPayload({
    requestId: 'speed-today', round: speedWords('更中田大日月天地枝本')
  }));
  assert.equal(todayResult.earned, 90, '換日即失效，同字可再得分');
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), 180);
});

// ── 通用化驗收：加新模式時後端完全不必改 ──────────────

test('新模式代號（未註冊）直接可用：驗證、計分、總覽自動加欄', () => {
  const env = makeEnv();
  // 'abbrev' 不在任何後端白名單／對照表裡，模擬站 4 上線時的情況。
  const result = post(env, payload({
    requestId: 'req-abbrev01', mode: 'abbrev', weekKey: '',
    round: [{ char: '五', correct: true, earned: 12 }]
  }));
  assert.equal(result.status, 'success', '後端不應拒絕未註冊的新模式');
  assert.equal(result.earned, 12);
  assert.equal(modeScore(env, 'P5A', 7, 'abbrev'), 12, '總覽自動長出「得分:abbrev」欄');
  const row = masteryRow(env, 'P5A', 7, 'abbrev');
  assert.ok(row, '掌握進度以新模式前綴記錄');
  assert.match(String(row[3]), /abbrev:五:/, '進度鍵含新模式前綴');
  // 新模式與既有模式互不干擾
  post(env, payload({ requestId: 'req-abbrev02', mode: 'connected', round: [{ char: '五', correct: true, earned: 12 }] }));
  assert.equal(modeScore(env, 'P5A', 7, 'connected'), 12);
  assert.equal(modeScore(env, 'P5A', 7, 'abbrev'), 12, '兩模式各自獨立計分');
});

test('非法模式代號被拒絕（格式驗證取代舊白名單）', () => {
  const env = makeEnv();
  for (const mode of ['Connected', '9bad', 'a b', 'mode' + 'x'.repeat(30), '', '中文模式']) {
    const result = post(env, payload({ mode }));
    assert.equal(result.status, 'error', '應拒絕：' + mode);
  }
});

test('總覽的模式分項欄不超過上限，超出時只計總分', () => {
  const env = makeEnv();
  const limit = env.exported.MAX_MODE_COLUMNS;
  for (let i = 0; i < limit + 2; i++) {
    post(env, payload({
      requestId: 'req-limit-' + String(i).padStart(4, '0'), mode: 'm' + i,
      round: [{ char: '更', correct: true, earned: 1 }]
    }));
  }
  const headers = env.tables[SUMMARY][0].filter(h => String(h).indexOf('得分:') === 0);
  assert.equal(headers.length, limit, '分項欄數不得超過上限');
  // 超出上限的模式仍要計入總分
  const expected = (limit + 2) * 1;
  assert.equal(summaryCol(env, 'P5A', 7, '累計得分'), expected, '超出上限的分數仍計入總分');
});
