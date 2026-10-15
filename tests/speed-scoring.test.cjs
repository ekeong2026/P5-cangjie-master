/* 任務 9／12：模式二（手速賽）加分的前端組裝與上傳欄位。
   重點：秒數天梯欄位（bestTime／wordCount／weekKey）必須與計分欄位（round）同時正確，
   且前端不得自行宣稱得分（scoreDelta 一律 0，分數由後端判定後回填）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

/* 建立一個足以載入 app.js 的最小沙箱。
   app.js 是頂層函式集合（非 IIFE），函式宣告會落在 context 上，可直接呼叫。 */
function env() {
  const storage = new Map();
  const sent = [];
  const s = {
    console,
    URL, AbortController, Date, Math, JSON, Number, String, Array, Object, Error,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    alert: () => {}, performance: { now: () => 0 },
    fetch: async () => ({ ok: true }),
    CONFIG: { GAS_WEBHOOK_URL: '' },
    MODE2_WEEKLY_BANKS: {}, SPEED_WEEK_SCHEDULES: [],
    DATA: { connected_words: [], special_words: [], split_words: [], benchmark_leaderboard: [] },
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      readyState: 'loading',
      activeElement: null
    },
    addEventListener: () => {}
  };
  s.window = s;
  vm.createContext(s);
  // 依 index.html 的載入順序：config → modes → 核心邏輯 → app.js。
  // modes 必須先載入，否則 app.js 會退回沒有週次前綴的簡化註冊表。
  vm.runInContext(fs.readFileSync('js/modes.js', 'utf8') + '\nthis.P5Mode=P5Mode;', s, { filename: 'modes.js' });
  vm.runInContext(fs.readFileSync('js/mastery-core.js', 'utf8') + '\nthis.MasteryCore=MasteryCore;', s, { filename: 'mastery-core.js' });
  vm.runInContext(fs.readFileSync('js/upload-queue.js', 'utf8') + '\nthis.UploadQueue=UploadQueue;', s, { filename: 'upload-queue.js' });
  vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), s, { filename: 'app.js' });
  // 攔截上傳，只觀察 payload，不真的送出。
  s.sendReliableWebhook = payload => { sent.push(payload); return Promise.resolve(); };
  return { s, storage, sent };
}

const WORDS = '更中田大日月天地枝本'.split('').map(c => ({ char: c, keys: ['A'], codes: ['日'] }));

/** 帶假 DOM 元素的沙箱，供結算卡文案測試使用。 */
function envWithEls() {
  const els = {};
  const base = env();
  ['speed-score-pill', 'speed-stat-earned', 'speed-stat-earned-desc'].forEach(id => {
    els[id] = { textContent: '', style: {} };
  });
  base.s.document.getElementById = id => els[id] || null;
  return { s: base.s, els };
}

test('buildSpeedRound：每個字都帶正確標記與分攤後的分數', () => {
  const { s } = env();
  const round = s.buildSpeedRound(WORDS, 30, 10); // 150-60=90 → 每字 9
  assert.equal(round.length, 10);
  assert.deepEqual(Array.from(round, r => r.char), '更中田大日月天地枝本'.split(''));
  assert.ok(round.every(r => r.correct === true));
  assert.deepEqual(Array.from(round, r => r.earned), Array(10).fill(9));
});

test('buildSpeedRound：整場首答的總和等於 speedRoundScore（不會超發）', () => {
  const { s } = env();
  for (const [t, n] of [[30, 10], [47, 10], [200, 10], [34, 20], [200, 20]]) {
    const round = s.buildSpeedRound(WORDS.concat(WORDS), t, n).slice(0, n);
    const total = round.reduce((a, r) => a + r.earned, 0);
    assert.equal(total, s.MasteryCore.speedRoundScore(t, n), 't=' + t + ' n=' + n);
  }
});

test('buildSpeedRound：20 字賽的獎勵分是 10 字公式的 1.8 倍', () => {
  const { s } = env();
  const r10 = s.buildSpeedRound(WORDS, 30, 10).reduce((a, r) => a + r.earned, 0);
  const r20 = s.buildSpeedRound(WORDS.concat(WORDS), 30, 20).reduce((a, r) => a + r.earned, 0);
  assert.equal(r10, 90);
  assert.equal(r20, Math.round(90 * 1.8));
});

test('buildSpeedRound：缺 char 的項目被剔除，不影響其餘分數', () => {
  const { s } = env();
  const round = s.buildSpeedRound([{ char: '更' }, { keys: [] }, null, { char: '中' }], 30, 10);
  assert.deepEqual(Array.from(round, r => r.char), ['更', '中']);
});

test('buildSpeedRound：非陣列或空清單安全回傳空陣列', () => {
  const { s } = env();
  assert.deepEqual(Array.from(s.buildSpeedRound(null, 30, 10)), []);
  assert.deepEqual(Array.from(s.buildSpeedRound([], 30, 10)), []);
});

test('saveStudentStats（模式二）：秒數欄位與計分欄位同時正確', () => {
  const { s, sent } = env();
  const round = s.buildSpeedRound(WORDS, 30, 10);
  s.saveStudentStats('P5A', 7, 0, false, 'speed', 30, 10, 'w7_hw1', round);

  assert.equal(sent.length, 1);
  const p = sent[0];
  // 秒數天梯欄位：一個都不能少，否則手速榜會失效。
  assert.equal(p.bestTime, 30);
  assert.equal(p.wordCount, 10);
  assert.equal(p.weekKey, 'w7_hw1');
  assert.equal(p.mode, 'speed');
  assert.equal(p.cls, 'P5A');
  assert.equal(p.num, 7);
  // 前端不自行宣稱得分。
  assert.equal(p.scoreDelta, 0);
  assert.equal(p.killDelta, 0);
  // 逐字結果確實送出，供後端判斷每日首答。
  assert.equal(p.round.length, 10);
  assert.equal(p.round[0].char, '更');
  assert.equal(p.round[0].earned, 9);
});

test('saveStudentStats（模式二）：20 字賽的 wordCount 不再被寫死為 10', () => {
  const { s, sent } = env();
  s.saveStudentStats('P5B', 3, 0, false, 'speed', 45, 20, 'w8_hw1',
    s.buildSpeedRound(WORDS.concat(WORDS), 45, 20));
  assert.equal(sent[0].wordCount, 20, '20 字賽必須上傳 20，否則週榜分類會錯誤');
  assert.equal(sent[0].bestTime, 45);
});

test('saveStudentStats（模式二）：未帶 round 時仍相容（round 為空陣列）', () => {
  const { s, sent } = env();
  s.saveStudentStats('P5C', 1, 0, false, 'speed', 60, 10, 'w6_hw1');
  assert.deepEqual(Array.from(sent[0].round), []);
  assert.equal(sent[0].bestTime, 60);
});

test('saveStudentStats（模式一）：未帶 round 時行為與從前一致', () => {
  const { s, sent } = env();
  s.saveStudentStats('P5A', 1, 15, true, 'connected');
  const p = sent[0];
  assert.equal(p.scoreDelta, 15);
  assert.equal(p.killDelta, 1);
  assert.equal(p.mode, 'connected');
  assert.deepEqual(Array.from(p.round), []);
});

test('saveStudentStats：completedAt 時間戳必定存在（離線補送判斷歸屬日期用）', () => {
  const { s, sent } = env();
  s.saveStudentStats('P5A', 2, 10, false, 'connected');
  assert.equal(typeof sent[0].completedAt, 'string');
  assert.ok(!isNaN(Date.parse(sent[0].completedAt)));
});

// ── 任務 12：結算卡顯示本場得分（依本機掌握快取預估，雲端回寫後校正） ──

test('buildSpeedRound：今天已計分過的字改以遞減倍率計分', () => {
  const { s } = env();
  const today = s.MasteryCore.hkDate(new Date());
  // 前 4 字今天已在 w7_hw1 計分過 1 次 → 第 2 次為半額。
  const map = {};
  '更中田大'.split('').forEach(c => { map['speed.w7_hw1:' + c] = today; });
  const round = s.buildSpeedRound(WORDS, 30, 10, map, today, 'w7_hw1', 'speed');
  const byChar = {};
  round.forEach(r => { byChar[r.char] = r.earned; });
  assert.equal(round.reduce((a, r) => a + r.earned, 0), 72, '4 字半額 + 6 字全額 = 90 × 8/10 = 72');
  assert.ok(byChar['更'] > 0, '第 2 次仍給分');
  assert.ok(byChar['更'] < byChar['日'], '第 2 次的分數低於第 1 次');
});

test('buildSpeedRound：已用滿 3 次的字不再給分', () => {
  const { s } = env();
  const today = s.MasteryCore.hkDate(new Date());
  const map = {};
  '更中田大'.split('').forEach(c => { map['speed.w7_hw1:' + c] = today + '*3'; });
  const round = s.buildSpeedRound(WORDS, 30, 10, map, today, 'w7_hw1', 'speed');
  const byChar = {};
  round.forEach(r => { byChar[r.char] = r.earned; });
  assert.equal(byChar['更'], 0, '已用滿 3 次不得再給分');
  assert.equal(round.reduce((a, r) => a + r.earned, 0), 54, '90 × 6/10 = 54');
});

test('buildSpeedRound：本機預估總分與後端語義一致（第 2 次半額）', () => {
  const { s } = env();
  const today = s.MasteryCore.hkDate(new Date());
  const map = { ['speed.w7_hw1:更']: today };
  const round = s.buildSpeedRound(WORDS, 30, 10, map, today, 'w7_hw1', 'speed');
  // 權重：更＝0.5（第 2 次），其餘 9 字＝1 → 90 × 9.5/10 = 85.5 → 86
  assert.equal(round.reduce((a, r) => a + r.earned, 0), 86);
});

test('buildSpeedRound：未傳掌握資料時行為與從前一致（整場全給）', () => {
  const { s } = env();
  const round = s.buildSpeedRound(WORDS, 30, 10);
  assert.equal(round.reduce((a, r) => a + r.earned, 0), 90);
});

test('buildSpeedRound：昨天得分的字今天仍可得分', () => {
  const { s } = env();
  const today = s.MasteryCore.hkDate(new Date());
  const map = { ['speed.w7_hw1:更']: '2020-01-01' }; // 舊日期
  const round = s.buildSpeedRound(WORDS, 30, 10, map, today, 'w7_hw1', 'speed');
  assert.equal(round.reduce((a, r) => a + r.earned, 0), 90, '舊日期不算今天已得分');
});

test('結算卡欄位存在：speed-stat-earned 與 speed-score-pill', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="speed-stat-earned"/);
  assert.match(html, /id="speed-stat-earned-desc"/);
  assert.match(html, /id="speed-score-pill"/);
});

// ── 任務 12：結算卡文案（已得分字顯示上限提示） ──────────

test('renderSpeedEarned：整場都新得分時顯示基本說明', () => {
  const { s, els } = envWithEls();
  s.renderSpeedEarned(90, [
    { char: '更', earned: 9 }, { char: '中', earned: 9 }
  ]);
  assert.equal(els['speed-stat-earned'].textContent, '+90 分');
  assert.match(els['speed-stat-earned-desc'].textContent, /最多計分 3 次/);
});

test('renderSpeedEarned：整場都已用滿次數時顯示上限提示', () => {
  const { s, els } = envWithEls();
  s.renderSpeedEarned(0, [
    { char: '更', earned: 0 }, { char: '中', earned: 0 }
  ]);
  assert.equal(els['speed-stat-earned'].textContent, '+0 分');
  assert.match(els['speed-stat-earned-desc'].textContent, /上限/);
});

test('renderSpeedEarned：部分已達上限時同時顯示兩邊字數', () => {
  const { s, els } = envWithEls();
  s.renderSpeedEarned(27, [
    { char: '更', earned: 9 }, { char: '中', earned: 0 }, { char: '田', earned: 0 }
  ]);
  assert.equal(els['speed-stat-earned'].textContent, '+27 分');
  assert.match(els['speed-stat-earned-desc'].textContent, /1 字計分/);
  assert.match(els['speed-stat-earned-desc'].textContent, /2 字今天已達上限/);
});
test('renderSpeedEarned：缺少 DOM 元素時安全略過，不拋錯', () => {
  const { s } = env(); // env() 的 getElementById 一律回傳 null
  assert.doesNotThrow(() => s.renderSpeedEarned(90, [{ char: '更', earned: 9 }]));
});
