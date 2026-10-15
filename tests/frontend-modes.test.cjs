/* 前端通用化驗收（② 階段 V1～V4）：
   在註冊表加一個「新模式」後，前端不需改任何一行就能玩、能計分、能出現在分頁列。
   這裡用假模式 demo（機制 code）與 demoWeekly（機制 timed，週次字庫）驗證。

   注意：app.js 是頂層函式集合，函式宣告會落在 context 上；但 `let`／`const` 這類
   頂層詞法宣告只存在於全域詞法環境，故一律以 vm.runInContext 取值，不透過 s.X。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

/** 假 DOM：renderModeTabs 只用到這幾個 API。 */
function fakeElement(tag) {
  let html = '';
  const el = {
    tagName: tag, id: '', className: '', type: '', textContent: '',
    children: [], style: {}, _handlers: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(event, handler) { this._handlers[event] = handler; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    // renderModeTabs 以 innerHTML='' 清空容器；同步清掉 children 才驗得準。
    set(value) { html = value; if (value === '') el.children.length = 0; }
  });
  return el;
}

/** 註冊表加一個新模式（模擬「站 4 上線」時只改 js/modes.js）。 */
const EXTRA_MODES = [
  {
    id: 'demo', line: 'main', order: 4, ui: 4, mech: 'code', visible: true,
    pool: 'connected_words',
    icon: '🆕', name: '模式 4：新原則特訓', short: '新原則特訓', badge: '新站',
    note: '每個字每天最多計 <strong>3 次</strong>。'
  },
  {
    id: 'demoWeekly', line: 'challenge', order: 2, ui: 5, mech: 'timed', visible: true,
    weekly: true,
    icon: '🌀', name: '新模式週次賽', short: '週次賽', badge: '週次',
    note: '排名只看完成秒數。'
  }
];

function env() {
  const storage = new Map();
  const document = {
    createElement: fakeElement,
    createTextNode: text => ({ nodeValue: String(text) }),
    querySelector: sel => (sel === '.mode-tab-bar' ? document._bar : sel === '.mode-scoring-note-row' ? document._note : null),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    readyState: 'loading',
    activeElement: null,
    _bar: fakeElement('div'),
    _note: fakeElement('div')
  };
  const s = {
    console,
    URL, AbortController, Date, Math, JSON, Number, String, Array, Object, Error, Set, Promise, RegExp,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    alert: () => {}, performance: { now: () => 0 },
    fetch: async () => ({ ok: true }),
    CONFIG: { GAS_WEBHOOK_URL: '' },
    MODE2_WEEKLY_BANKS: {}, SPEED_WEEK_SCHEDULES: [],
    DATA: {
      connected_words: [{ char: '更', codes: ['一', '中', '田', '大'], keys: ['M', 'L', 'W', 'K'], full: '一中田大 (MLWK)', secret: '' }],
      special_words: [], split_words: [],
      cangjie_clean_letters: [{ code: '一' }, { code: '中' }, { code: '木' }, { code: '大' }],
      benchmark_leaderboard: []
    },
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    document,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  s.window = s;
  vm.createContext(s);
  return { s, storage, document };
}

/** 建立一個已載入 4 個預設模式 ＋ 2 個假模式的完整環境。 */
function envWithExtras() {
  const built = env();
  const { s } = built;
  // 1) 先讓 modes.js 把預設清單寫進 window.P5_MODES。
  vm.runInContext(fs.readFileSync('js/modes.js', 'utf8'), s, { filename: 'modes.js' });
  // 2) 模擬「站 4 上線」：只在註冊表加資料，不動 app.js 一行。
  vm.runInContext('window.P5_MODES = window.P5_MODES.concat(P5_EXTRA);', Object.assign(s, { P5_EXTRA: EXTRA_MODES }));
  // 3) 重建註冊表索引，再依 index.html 的順序載入其餘程式。
  vm.runInContext(fs.readFileSync('js/modes.js', 'utf8') + '\nthis.P5Mode=P5Mode;', s, { filename: 'modes-2.js' });
  vm.runInContext(fs.readFileSync('js/cangjie.js', 'utf8'), s, { filename: 'cangjie.js' });
  vm.runInContext(fs.readFileSync('js/mastery-core.js', 'utf8') + '\nthis.MasteryCore=MasteryCore;', s, { filename: 'mastery-core.js' });
  vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), s, { filename: 'app.js' });
  return built;
}

const run = (s, code) => vm.runInContext(code, s);

test('新模式只要在註冊表加一筆，出題就會自動使用它的字庫（不必改 app.js）', () => {
  const { s } = envWithExtras();
  const char = run(s, 'getNextQuiz("demo") && getNextQuiz("demo").char');
  assert.equal(char, '更', '新模式應能從 registry 指定的字庫取題');
});

test('未註冊的模式沒有字庫，出題回 undefined 且不拋錯', () => {
  const { s } = envWithExtras();
  assert.equal(run(s, 'typeof getNextQuiz("not_registered")'), 'undefined');
});

test('新模式的計分自動寫進 modeScores，不必改前端', () => {
  const { s, storage } = envWithExtras();
  run(s, 'saveStudentStats("P5A", 1, 7, true, "demo")');
  const stats = JSON.parse(storage.get('p5_score_P5A_1'));
  assert.equal(stats.totalScore, 7);
  assert.equal(stats.kills, 1);
  assert.deepEqual(stats.modeScores, { demo: 7 });
});

test('舊版本機快取的 mode1/2/3Score 會就地併入 modeScores', () => {
  const { s, storage } = envWithExtras();
  storage.set('p5_score_P5A_2', JSON.stringify({ totalScore: 50, kills: 3, mode1Score: 42, mode3Score: 8 }));
  const stats = JSON.parse(run(s, 'JSON.stringify(getStudentStats("P5A", 2))'));
  assert.deepEqual(stats.modeScores, { connected: 42, special: 8 });
  assert.equal('mode1Score' in stats, false, '舊欄位讀過即移除');
  assert.equal('mode3Score' in stats, false);
  assert.equal(stats.totalScore, 50, '總分不受影響');
});

test('進度鍵前綴：新模式為模式代號，週次類模式為「模式.週次」', () => {
  const { s } = envWithExtras();
  assert.equal(run(s, 'masteryKey("demo", "更", "")'), 'demo:更');
  assert.equal(run(s, 'masteryKey("demoWeekly", "更", "w7_hw1")'), 'demoWeekly.w7_hw1:更');
  // 已註冊但非週次的模式，即使傳了週次也不加前綴（與後端一致）
  assert.equal(run(s, 'masteryKey("demo", "更", "w7_hw1")'), 'demo:更');
});

test('分頁列與計分說明由註冊表生成，新可見模式自動出現且順序依 ui', () => {
  const { s, document } = envWithExtras();
  run(s, 'renderModeTabs()');
  const ids = document._bar.children.map(b => b.id);
  assert.deepEqual(ids, [
    'mode-tab-connected', 'mode-tab-abbrev', 'mode-tab-feature', 'mode-tab-demo',
    'mode-tab-omit', 'mode-tab-demoWeekly', 'mode-tab-survival',
    'mode-tab-special', 'mode-tab-speed'
  ], '新模式依 ui 自動排入分頁列；同 ui 時依註冊順序（feature/demo 同 ui:4、omit/demoWeekly 同 ui:5）');
  const notes = document._note.children.map(p => p.className);
  assert.deepEqual(notes, [
    'mode-scoring-note mode-scoring-note-connected active',
    'mode-scoring-note mode-scoring-note-abbrev',
    'mode-scoring-note mode-scoring-note-feature',
    'mode-scoring-note mode-scoring-note-demo',
    'mode-scoring-note mode-scoring-note-omit',
    'mode-scoring-note mode-scoring-note-demoWeekly',
    'mode-scoring-note mode-scoring-note-survival',
    'mode-scoring-note mode-scoring-note-special',
    'mode-scoring-note mode-scoring-note-speed'
  ], '每個可見模式都有一句計分說明，預設模式為 active');
  // 按鈕文字含關卡編號、圖示與名稱；未開啓時以「還差 N 分」取代 badge
  const demo = document._bar.children.find(b => b.id === 'mode-tab-demo');
  const text = demo.children.map(c => c.nodeValue || c.textContent).join('');
  assert.match(text, /🆕/);
  assert.match(text, /模式 4：新原則特訓/);
  assert.match(text, /還差 250 分/, '未開啓的關卡要顯示還差幾分（門檻來自前一站 feature 的 completeAt）');
  assert.ok(demo.className.includes('locked'), '未達門檻的主線關卡應標為 locked');
  const chip = demo.children.find(c => c.className && c.className.includes('mode-stage-chip'));
  assert.equal(chip.textContent, '4', '關卡編號依顯示順序自動生成');
  // 點擊分頁會切換模式
  assert.equal(typeof demo._handlers.click, 'function');
});

test('解鎖：第一關永遠開啓、挑戰線不設門檻、生存已改掛主線編號（軟鎖）', () => {
  const { s, document } = envWithExtras();
  run(s, 'renderModeTabs()');
  const find = id => document._bar.children.find(b => b.id === 'mode-tab-' + id);
  const textOf = el => el.children.map(c => c.nodeValue || c.textContent).join('');

  const first = find('connected');
  assert.ok(!first.className.includes('locked'), '第一關永遠開啓');
  assert.match(textOf(first), /1~4碼連擊/, '已開啓的關卡保留原本的 badge');

  // 挑戰線只剩極速賽：不設門檻、編號位置顯示「挑戰」。
  const speedTab = find('speed');
  assert.ok(!speedTab.className.includes('locked'), 'speed 屬挑戰線，不設門檻');
  assert.equal(speedTab.children.find(x => x.className && x.className.includes('mode-stage-chip')).textContent,
    '挑戰', 'speed 的編號位置顯示「挑戰」');

  // 生存已於 2026-10-14 搬入主線站 6 ⇒ 有主線編號；未達門檻時標 locked（軟鎖仍可點）。
  // 註：本沙箱多掛了一個 main 模式 demo，編號因此順移（生存顯示 6、難字 7）。
  const survivalTab = find('survival');
  assert.equal(survivalTab.children.find(x => x.className && x.className.includes('mode-stage-chip')).textContent,
    '6', '生存是主線第 6 個可見關卡（此沙箱的真實站號 6）');
  assert.ok(survivalTab.className.includes('locked'), 'omit 未達門檻 ⇒ 生存標為未開啓');

  // 軟鎖：未開啓的關卡不得被 disable，且仍註冊了點擊切換
  //   （「點下去真的能進場」用真 DOM 在 tests/browser-modes.cjs 驗）。
  const locked = find('abbrev');
  assert.ok(locked.className.includes('locked'));
  assert.notEqual(locked.disabled, true, '未開啓的關卡不得停用（軟鎖）');
  assert.equal(typeof locked._handlers.click, 'function', '未開啓的關卡仍要能點擊切換');
  for (const tab of document._bar.children) {
    assert.notEqual(tab.disabled, true, `${tab.id} 不應被停用（軟鎖：都可進入）`);
  }
});

test('解鎖：前一站達門檻後，這一關自動開啓（由分數即時算出，不存旗標）', () => {
  const { s, document } = envWithExtras();
  run(s, 'currentStudent = { cls: "P5A", num: 1, name: "P5A 01號" }');
  s.localStorage.setItem('p5_score_P5A_1', JSON.stringify({
    totalScore: 150, kills: 0, modeScores: { connected: 150 }
  }));
  run(s, 'renderModeTabs()');
  const find = id => document._bar.children.find(b => b.id === 'mode-tab-' + id);

  // connected 達 150 ⇒ 下一關 abbrev 開啓；abbrev 未達 200 ⇒ feature 仍鎖
  assert.ok(!find('abbrev').className.includes('locked'), 'connected 達標後 abbrev 應開啓');
  assert.ok(find('feature').className.includes('locked'), 'abbrev 未達標，feature 仍鎖');
  assert.match(find('feature').children.map(c => c.nodeValue || c.textContent).join(''),
    /還差 200 分/, 'feature 的門檻來自 abbrev 的 completeAt=200');

  // 再補上 abbrev 的分數 ⇒ feature 開啓
  s.localStorage.setItem('p5_score_P5A_1', JSON.stringify({
    totalScore: 350, kills: 0, modeScores: { connected: 150, abbrev: 200 }
  }));
  run(s, 'renderModeTabs()');
  assert.ok(!document._bar.children.find(b => b.id === 'mode-tab-feature').className.includes('locked'),
    'abbrev 達標後 feature 應開啓');
});

test('真鎖：權威分數可用＋已登入時，未達標的關卡點擊不切換；安全網情境維持軟鎖', () => {
  const { s, document } = envWithExtras();
  // 樁：攔下 setGameMode 與 toast，驗「有沒有被叫」。
  run(s, 'window.__modeCalls = []; window.__toasts = [];');
  run(s, 'setGameMode = function(m){ window.__modeCalls.push(m); };');
  run(s, 'showPassToast = function(t){ window.__toasts.push(t); };');

  // ① 未登入：即使雲端可用也不得真鎖（安全網——還沒登入就被擋會出意外）。
  run(s, 'cloudScoresKnown = true');
  run(s, 'renderModeTabs()');
  const find = id => document._bar.children.find(b => b.id === 'mode-tab-' + id);
  assert.ok(find('abbrev').className.includes('locked'), '未登入沒有分數 ⇒ 未達標');
  assert.ok(!find('abbrev').className.includes('hard-locked'), '未登入不得真鎖');

  // ② 已登入但沒有雲端權威分數（離線）：軟鎖，點了仍可進入（安全網）。
  run(s, 'currentStudent = { cls: "P5A", num: 1, name: "P5A 01號" }');
  run(s, 'cloudScoresKnown = false');
  run(s, 'renderModeTabs()');
  assert.ok(find('abbrev').className.includes('locked'));
  assert.ok(!find('abbrev').className.includes('hard-locked'), '沒有雲端分數不得真鎖（離線安全網）');
  find('abbrev')._handlers.click();
  assert.equal(run(s, 'JSON.stringify(window.__modeCalls)'), '["abbrev"]', '軟鎖仍可進入');

  // ③ 權威分數可用＋已登入＋未達標 ⇒ 真鎖：點了不切換、只出提示。
  run(s, 'window.__modeCalls = []; window.__toasts = [];');
  run(s, 'cloudScoresKnown = true');
  s.localStorage.setItem('p5_score_P5A_1',
    JSON.stringify({ totalScore: 42, kills: 0, modeScores: { connected: 42 } }));
  run(s, 'renderModeTabs()');
  const abbrev = find('abbrev');
  assert.ok(abbrev.className.includes('hard-locked'), '權威分數不足且已登入 ⇒ 真鎖');
  abbrev._handlers.click();
  assert.equal(run(s, 'JSON.stringify(window.__modeCalls)'), '[]', '真鎖：不得切換過去');
  assert.match(run(s, 'window.__toasts.join("|")'), /還差 108 分/, '提示還差幾分（150-42）');
  assert.match(run(s, 'window.__toasts.join("|")'), /達標後才能進入/, '用真鎖的提示文字');

  // ④ 已達標的站不受影響。
  s.localStorage.setItem('p5_score_P5A_1',
    JSON.stringify({ totalScore: 150, kills: 0, modeScores: { connected: 150 } }));
  run(s, 'window.__modeCalls = [];');
  run(s, 'renderModeTabs()');
  find('abbrev')._handlers.click();
  assert.equal(run(s, 'JSON.stringify(window.__modeCalls)'), '["abbrev"]', '已開啓的站照常進入');
});

test('教師全開：所有關卡不再標鎖，關閉即恢復（含真鎖）', () => {
  const { s, document } = envWithExtras();
  run(s, 'currentStudent = { cls: "P5A", num: 1, name: "P5A 01號" }');
  run(s, 'cloudScoresKnown = true');
  run(s, 'renderModeTabs()');
  const find = id => document._bar.children.find(b => b.id === 'mode-tab-' + id);
  assert.ok(find('demo').className.includes('hard-locked'), '未全開時 demo 是真鎖');
  // ?teacher=1 寫入的是同一把鑰匙（p5_unlock_all）
  s.localStorage.setItem('p5_unlock_all', '1');
  run(s, 'renderModeTabs()');
  for (const tab of document._bar.children) {
    assert.ok(!tab.className.includes('locked'), tab.id + ' 教師全開時不得再標鎖');
  }
  s.localStorage.removeItem('p5_unlock_all');
  run(s, 'renderModeTabs()');
  assert.ok(find('demo').className.includes('hard-locked'), '關閉全開後應恢復真鎖');
});

test('未標記 visible:false 的模式不會出現在分頁列（split 仍在，但不顯示）', () => {
  const { s, document } = envWithExtras();
  run(s, 'renderModeTabs()');
  const ids = document._bar.children.map(b => b.id);
  assert.equal(ids.includes('mode-tab-split'), false, 'visible:false 的模式不生成按鈕');
  // 但程式路徑仍可用（機制已實作）
  assert.equal(run(s, 'MODE_REGISTRY.mechOf("split")'), 'twoPart');
});

test('前端機制表和後端一致：未註冊模式一律視為 code', () => {
  const { s } = envWithExtras();
  assert.equal(run(s, 'MODE_REGISTRY.mechOf("not_registered")'), 'code');
  assert.equal(run(s, 'MODE_REGISTRY.mechOf("demoWeekly")'), 'timed');
});

test('限時模式的結算預估用「該模式」的進度前綴，新增限時模式不必改前端', () => {
  const { s } = envWithExtras();
  const today = '2026-10-13';
  const words = [{ char: '更' }, { char: '中' }, { char: '田' }];
  const map = { 'demoWeekly.w7_hw1:更': today };   // 只有新模式的前綴有資料
  const call = mode => run(s, 'JSON.stringify(buildSpeedRound('
    + JSON.stringify(words) + ', 30, 10, ' + JSON.stringify(map) + ', '
    + JSON.stringify(today) + ", 'w7_hw1', " + JSON.stringify(mode) + '))');
  const sum = round => JSON.parse(round).reduce((a, r) => a + r.earned, 0);

  const weekly = sum(call('demoWeekly'));
  const other = sum(call('speed'));
  assert.ok(weekly > 0, '新模式應能算出得分');
  assert.ok(weekly < other, '只有 demoWeekly 的前綴命中「更」已計分，故總分較低：'
    + weekly + ' < ' + other);
});
