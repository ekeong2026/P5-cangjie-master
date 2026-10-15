/** 模式註冊表（js/modes.js）健全性測試。
 *  這張表是「有哪些模式」的唯一真相，加新模式只改這裡；
 *  若表本身有錯（重複 id、字庫不存在、機制打錯），前端會靜默失效，故以測試守門。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const s = { window: {}, console };
  vm.createContext(s);
  vm.runInContext(fs.readFileSync('js/data.js', 'utf8')
    + '\nthis.DATA = DATA;', s, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync('js/modes.js', 'utf8')
    + '\nthis.P5Mode = P5Mode; this.P5_MODE_PATTERN = window.P5_MODE_PATTERN; this.P5_MECHS = window.P5_MECHS;'
    + '\nthis.P5_VIEW_DEFAULTS = window.P5_VIEW_DEFAULTS;',
    s, { filename: 'modes.js' });
  // cangjie.js 的頂層只有宣告與函式（DOM 呼叫都在函式體內），可在沙箱載入，
  // 用來驗「字根 → 字母」的對照是否被手寫錯。
  vm.runInContext(fs.readFileSync('js/cangjie.js', 'utf8')
    + '\nthis.CANGJIE_RADICAL_MAP = CANGJIE_RADICAL_MAP;',
    s, { filename: 'cangjie.js' });
  // vm 內建立的陣列／物件與宿主不同 realm，一律先轉成宿主物件再斷言。
  s.ids = Array.from(s.P5Mode.all(), m => m.id);
  s.tabs = Array.from(s.P5Mode.forTabs(), m => m.id);
  s.viewOf = id => JSON.parse(JSON.stringify(s.P5Mode.viewOf(id)));
  // app.js 是頂層函式集合，直接載入會在 vm 內碰到大量 DOM 依賴；
  // 這裡只靜態抽出槽位上限常數（它是單一純量宣告，安全）。
  const appSrc = fs.readFileSync('js/app.js', 'utf8');
  const m = appSrc.match(/const\s+MAX_CODE_SLOTS\s*=\s*(\d+)/);
  s.MAX_CODE_SLOTS = m ? Number(m[1]) : undefined;
  return s;
}

test('每個模式都有必要欄位，且 id 符合後端相同的格式', () => {
  const { P5Mode, P5_MODE_PATTERN } = load();
  const list = P5Mode.all();
  assert.ok(list.length >= 3, '至少要有現有 3 個模式');
  for (const mode of list) {
    for (const field of ['id', 'mech', 'line', 'order', 'icon', 'name', 'short', 'badge', 'note']) {
      assert.ok(mode[field] !== undefined && mode[field] !== '', `${mode.id} 缺少 ${field}`);
    }
    assert.ok(P5_MODE_PATTERN.test(mode.id), `${mode.id} 不符合模式 id 格式`);
    assert.ok(['main', 'challenge'].includes(mode.line), `${mode.id} 的 line 不合法`);
    assert.ok(Number.isInteger(mode.order) && mode.order >= 1, `${mode.id} 的 order 不合法`);
  }
});

test('模式 id 不得重複，主線 order 也不得重複', () => {
  const { P5Mode, ids } = load();
  assert.equal(new Set(ids).size, ids.length, 'id 重複：' + ids.join(','));
  const mainOrders = Array.from(P5Mode.line('main'), m => m.order);
  assert.equal(new Set(mainOrders).size, mainOrders.length, '主線 order 重複');
});

test('mech 必須是已知的機制名稱', () => {
  const { P5Mode, P5_MECHS } = load();
  for (const mode of P5Mode.all()) {
    assert.ok(P5_MECHS.includes(mode.mech), `${mode.id} 的機制 ${mode.mech} 不合法`);
  }
});

test('每個模式指向的字庫都存在於 DATA，且每筆都有可用的字與字根', () => {
  const { P5Mode, DATA } = load();
  for (const mode of P5Mode.all()) {
    if (!mode.pool) {
      assert.ok(mode.weekly === true, `${mode.id} 既無 pool 也非週次字庫`);
      continue;
    }
    const pool = DATA[mode.pool];
    assert.ok(Array.isArray(pool) && pool.length > 0, `${mode.id} 的字庫 ${mode.pool} 不存在或為空`);
    for (const word of pool) {
      assert.equal(Array.from(String(word.char)).length, 1, `${mode.pool} 有非單一漢字的項目`);
      assert.equal(typeof word.full, 'string', `${mode.pool} 的「${word.char}」缺少 full`);
      if (mode.mech === 'twoPart') {
        // 分體字用「字首碼／字身碼」兩段，而不是單一 codes。
        const parts = ['prefix', 'body'];
        for (const part of parts) {
          const codes = word[part + '_codes'], keys = word[part + '_keys'];
          assert.ok(Array.isArray(codes) && codes.length >= 1 && codes.length <= 3,
            `${mode.pool} 的「${word.char}」${part} 字根數不合法`);
          assert.equal(keys.length, codes.length, `${mode.pool} 的「${word.char}」${part} keys 與 codes 數量不符`);
        }
      } else {
        assert.ok(Array.isArray(word.codes) && word.codes.length >= 1 && word.codes.length <= 5,
          `${mode.pool} 的「${word.char}」字根數不合法`);
        assert.equal(word.keys.length, word.codes.length, `${mode.pool} 的「${word.char}」keys 與 codes 數量不符`);
      }
    }
  }
});

test('每筆字庫的 keys 必須與字根對照表一致（防手寫錯字母）', () => {
  const { DATA, CANGJIE_RADICAL_MAP } = load();
  const pools = Object.keys(DATA).filter(k => k.endsWith('_words'));
  let checked = 0;
  for (const poolKey of pools) {
    for (const word of DATA[poolKey]) {
      const segs = [];
      if (Array.isArray(word.codes)) segs.push([word.codes, word.keys, '']);
      if (Array.isArray(word.prefix_codes)) segs.push([word.prefix_codes, word.prefix_keys, '字首']);
      if (Array.isArray(word.body_codes)) segs.push([word.body_codes, word.body_keys, '字身']);
      for (const [codes, keys, label] of segs) {
        codes.forEach((c, i) => {
          checked++;
          assert.equal(keys[i], CANGJIE_RADICAL_MAP[c],
            `${poolKey} 的「${word.char}」${label}第 ${i + 1} 碼字根「${c}」`
            + `應對應 ${CANGJIE_RADICAL_MAP[c]}，實際寫成 ${keys[i]}`);
        });
      }
    }
  }
  assert.ok(checked > 100, '應檢查到足量字根，實際 ' + checked);
});

test('非 twoPart 字庫的 full 必須等於「字根 (字母)」', () => {
  const { DATA, P5Mode } = load();
  // split_words（twoPart）的 full 存的是整字全碼，語意不同，不在此驗。
  const twoPartPools = new Set(Array.from(P5Mode.all())
    .filter(m => m.pool && P5Mode.mechOf(m.id) === 'twoPart')
    .map(m => m.pool));
  for (const mode of P5Mode.all()) {
    if (!mode.pool || twoPartPools.has(mode.pool)) continue;
    for (const word of DATA[mode.pool]) {
      const expect = word.codes.join('') + ' (' + word.keys.join('') + ')';
      assert.equal(word.full, expect,
        `${mode.pool} 的「${word.char}」full 應為「${expect}」，實際「${word.full}」`);
    }
  }
});

test('站 3 字庫（abbrev_words）至少 40 字，確保字靈倖存者的隨機性', () => {
  // 2026-10-14 使用者要求「加多點字庫、加大隨機性」→ 29 字擴到 45 字。
  // 這條守門避免日後無意間把字庫縮回去（三階題庫每階都要夠多才不會一直重複）。
  const { DATA } = load();
  const pool = DATA.abbrev_words;
  assert.ok(Array.isArray(pool) && pool.length >= 40,
    `abbrev_words 只有 ${pool ? pool.length : 0} 字，應至少 40 字`);
  const byTier = { '2-3碼': 0, '4碼': 0, '5碼以上': 0 };
  for (const w of pool) {
    const len = w.codes.length;
    if (len >= 5) byTier['5碼以上']++;
    else if (len === 4) byTier['4碼']++;
    else byTier['2-3碼']++;
  }
  for (const [tier, n] of Object.entries(byTier)) {
    assert.ok(n >= 5, `abbrev_words 的「${tier}」只有 ${n} 個，太容易重複`);
  }
});

test('可見模式的計分說明不得為空（學生看得到）', () => {
  const { P5Mode } = load();
  for (const mode of P5Mode.visible()) {
    assert.ok(mode.note && mode.note.trim().length >= 10, `${mode.id} 的計分說明太短`);
  }
});

test('未註冊的模式視為預設機制 code（與後端一致）', () => {
  const { P5Mode } = load();
  assert.equal(P5Mode.mechOf('brand_new_mode'), 'code');
  assert.equal(P5Mode.poolOf('brand_new_mode'), '');
  assert.equal(P5Mode.find('brand_new_mode'), null);
  assert.equal(P5Mode.mechOf('speed'), 'timed');
  assert.equal(P5Mode.poolOf('connected'), 'connected_words');
});

// ── view（呈現設定）與前綴 ─────────────────────────────

test('viewOf 由機制預設值補齊，模式自身設定可覆寫', () => {
  const { P5_VIEW_DEFAULTS, viewOf } = load();
  // 未註冊 → 用 code 的預設值
  assert.equal(viewOf('brand_new_mode').baseScore, P5_VIEW_DEFAULTS.code.baseScore);
  assert.equal(viewOf('brand_new_mode').monster, P5_VIEW_DEFAULTS.code.monster);
  // 難字模式覆寫了基礎分與怪獸圖示
  const specialView = viewOf('special');
  assert.equal(specialView.baseScore, 10);
  assert.equal(specialView.minBase, 2);
  assert.equal(specialView.monster, '🔮');
  // 分體字沿用 twoPart 的預設
  assert.equal(viewOf('split').monster, P5_VIEW_DEFAULTS.twoPart.monster);
  assert.equal(viewOf('split').baseScore, 15);
});

test('每個可見模式都有可用的結算分數與提示文字模板', () => {
  const { P5Mode, viewOf } = load();
  for (const mode of P5Mode.visible()) {
    const view = viewOf(mode.id);
    if (mode.mech === 'timed') continue; // 手速賽走自己的流程，不用 arena 模板
    assert.ok(Number.isInteger(view.baseScore) && view.baseScore > 0, `${mode.id} 的 baseScore 不合法`);
    assert.ok(Number.isInteger(view.minBase) && view.minBase > 0, `${mode.id} 的 minBase 不合法`);
    assert.ok(view.minBase <= view.baseScore, `${mode.id} 的保底分不得高於基礎分`);
    assert.ok(typeof view.monster === 'string' && view.monster !== '', `${mode.id} 缺少怪獸圖示`);
  }
});

test('fill 以 {name} 佔位符填值，未提供的原樣保留', () => {
  const { P5Mode } = load();
  assert.equal(P5Mode.fill('捕捉【 {char} 】共 {len} 碼', { char: '更', len: 3 }), '捕捉【 更 】共 3 碼');
  assert.equal(P5Mode.fill('{char} / {missing}', { char: '日' }), '日 / {missing}');
  assert.equal(P5Mode.fill(null, {}), '');
});

test('prefixFor：週次字庫模式為「模式.週次」，其餘為模式代號', () => {
  const { P5Mode } = load();
  assert.equal(P5Mode.prefixFor('connected', 'w7'), 'connected', '非週次模式忽略週次');
  assert.equal(P5Mode.prefixFor('speed', 'w7_hw1'), 'speed.w7_hw1');
  assert.equal(P5Mode.prefixFor('speed', ''), 'speed', '未指定週次時只用模式代號');
  assert.equal(P5Mode.prefixFor('abbrev', ''), 'abbrev', '主線新模式即模式代號本身');
  assert.equal(P5Mode.prefixFor('abbrev', 'w9_hw2'), 'abbrev', '未標記 weekly 者不加週次');
  assert.equal(P5Mode.prefixFor('brand_new_mode', 'w9_hw2'), 'brand_new_mode', '未註冊者仍回原字串');
});

/* ── ③ 開站 3：新增 abbrev、分頁順序、顯示名稱去編號 ───────────────── */

test('③ 站 3 abbrev 已註冊，且設定正確（字靈倖存者／法陣守衛戰）', () => {
  const { P5Mode } = load();
  const m = P5Mode.find('abbrev');
  assert.ok(m, 'abbrev 必須在註冊表中');
  assert.equal(m.line, 'main', 'abbrev 屬主線');
  assert.equal(m.order, 3, 'abbrev 是主線第 3 站');
  assert.equal(m.mech, 'siege', 'abbrev 改用 siege 機制（法陣守衛戰）');
  assert.equal(m.pool, 'abbrev_words', 'abbrev 指向 abbrev_words 字庫');
  assert.notEqual(m.visible, false, 'abbrev 本次開放，應可見');
  assert.equal(P5Mode.mechOf('abbrev'), 'siege');
  assert.equal(P5Mode.poolOf('abbrev'), 'abbrev_words');
  assert.equal(m.name, '文字突圍', '站 3 顯示名稱為字靈倖存者主題');
  assert.ok(/字靈/.test(m.note), '站 3 的計分說明應提到字靈');
});

test('④ 站 4 feature 已註冊，且設定正確', () => {
  const { P5Mode } = load();
  const m = P5Mode.find('feature');
  assert.ok(m, 'feature 必須在註冊表中');
  assert.equal(m.line, 'main', 'feature 屬主線');
  assert.equal(m.order, 4, 'feature 是主線第 4 站');
  assert.equal(m.mech, 'code', 'feature 用 code 機制');
  assert.equal(m.pool, 'feature_words', 'feature 指向 feature_words 字庫');
  assert.notEqual(m.visible, false, 'feature 本次開放，應可見');
  assert.equal(P5Mode.mechOf('feature'), 'code');
  assert.equal(P5Mode.poolOf('feature'), 'feature_words');
});

/* ── 生存模式（survival 機制）：站 6（2026-10-14 由挑戰線搬入主線）── */

test('生存模式 survival 已註冊為主線站 6，且設定正確（機制 survival）', () => {
  const { P5Mode } = load();
  const m = P5Mode.find('survival');
  assert.ok(m, 'survival 必須在註冊表中');
  assert.equal(m.line, 'main', 'survival 屬主線（由挑戰線搬入，取代原「特殊字貫穿」計劃）');
  assert.equal(m.order, 6, 'survival 是真實站號 6');
  assert.equal(m.mech, 'survival', 'survival 用 survival 機制');
  assert.ok(m.pool, 'survival 需要字庫池');
  assert.notEqual(m.visible, false, 'survival 本次開放，應可見');
  assert.equal(P5Mode.mechOf('survival'), 'survival');
  assert.ok(P5Mode.completeAtOf('survival') > 0, '主線每一站都要有完成門檻');
});

test('survival 機制的 view 由預設值補齊（💀／#DC2626／baseScore 15）', () => {
  const { viewOf, P5_VIEW_DEFAULTS } = load();
  const v = viewOf('survival');
  assert.equal(v.monster, '💀');
  assert.equal(v.color, '#DC2626');
  assert.equal(v.baseScore, P5_VIEW_DEFAULTS.survival.baseScore);
  assert.ok(v.minBase > 0 && v.minBase <= v.baseScore, '保底分合法且不高於基礎分');
});

test('survival 的進度前綴即模式代號（非週次字庫）', () => {
  const { P5Mode } = load();
  assert.equal(P5Mode.prefixFor('survival', ''), 'survival');
  assert.equal(P5Mode.prefixFor('survival', 'w7_hw1'), 'survival', '未標記 weekly 者不加週次');
});

test('分頁順序：主線依站號在前，挑戰線（極速賽）排在最後', () => {
  const { tabs } = load();
  // 只驗可見的模式；split 仍 visible:false，不應出現在分頁列。
  assert.deepEqual(tabs, ['connected', 'abbrev', 'feature', 'omit', 'survival', 'special', 'speed'],
    '實際分頁：' + tabs.join(' → '));
  assert.equal(tabs[tabs.length - 1], 'speed', '挑戰線必須排在最後');
  assert.ok(tabs.indexOf('omit') < tabs.indexOf('survival'), '生存（站 6）排在寵物（站 5）之後');
  assert.ok(tabs.indexOf('survival') < tabs.indexOf('special'), '生存（站 6）排在難字（站 7）之前');
  assert.ok(tabs.indexOf('omit') < tabs.indexOf('speed'), '主線（含站 6 生存）排在挑戰線之前');
  assert.ok(tabs.indexOf('split') < 0, 'split 尚未開放，不應出現');
});

test('站 5 寵物養成（omit）已註冊，機制為 pet、字庫指向 omit_words', () => {
  const { P5Mode } = load();
  const m = P5Mode.find('omit');
  assert.ok(m, 'omit 必須在註冊表中');
  assert.equal(m.line, 'main', 'omit 屬主線');
  assert.equal(m.order, 5, 'omit 是主線第 5 站');
  assert.equal(m.mech, 'pet', 'omit 用 pet 機制（寵物養成）');
  assert.equal(m.pool, 'omit_words', 'omit 指向 omit_words 字庫');
  assert.notEqual(m.visible, false, 'omit 本次開放，應可見');
  assert.equal(P5Mode.mechOf('omit'), 'pet');
  assert.equal(P5Mode.poolOf('omit'), 'omit_words');
});

test('pet 機制的 view 由預設值補齊（🐣／#EC4899／baseScore 15）', () => {
  const { viewOf, P5_VIEW_DEFAULTS } = load();
  const v = viewOf('omit');
  assert.equal(v.monster, '🐣');
  assert.equal(v.color, '#EC4899');
  assert.equal(v.baseScore, P5_VIEW_DEFAULTS.pet.baseScore);
  assert.ok(v.minBase > 0 && v.minBase <= v.baseScore, '保底分合法且不高於基礎分');
});

test('omit 的進度前綴即模式代號（非週次字庫）', () => {
  const { P5Mode } = load();
  assert.equal(P5Mode.prefixFor('omit', ''), 'omit');
  assert.equal(P5Mode.prefixFor('omit', 'w7_hw1'), 'omit', '未標記 weekly 者不加週次');
});

test('主線 order 一律是站號，且不重複（含 abbrev=3、feature=4、omit=5、survival=6、special=7）', () => {
  const { P5Mode } = load();
  const byId = {};
  Array.from(P5Mode.line('main')).forEach(m => { byId[m.id] = m.order; });
  assert.equal(byId.abbrev, 3);
  assert.equal(byId.feature, 4);
  assert.equal(byId.omit, 5, '寵物養成是真實的站 5');
  assert.equal(byId.survival, 6, '生存挑戰是真實的站 6（由挑戰線搬入，取代原貫穿字計劃）');
  assert.equal(byId.split, 2);
  assert.equal(byId.connected, 1);
  assert.equal(byId.special, 7, '難字是真實的站 7');
  const orders = Object.values(byId);
  assert.equal(new Set(orders).size, orders.length, '主線 order 不得重複');
});

test('顯示名稱不含「模式 N」編號（編號只留在文件）', () => {
  const { P5Mode } = load();
  for (const mode of P5Mode.all()) {
    assert.ok(!/模式\s*\d/.test(mode.name), `${mode.id} 的 name 仍含編號：${mode.name}`);
    assert.ok(!/模式\s*\d/.test(mode.short), `${mode.id} 的 short 仍含編號：${mode.short}`);
  }
});

test('學生看到的分頁文字即模式的 name（無編號），且說明非空', () => {
  const { P5Mode } = load();
  const tabs = Array.from(P5Mode.forTabs());
  tabs.forEach(m => {
    assert.ok(m.name && m.name.length > 0, `${m.id} 缺少 name`);
    assert.ok(m.note && m.note.length > 0, `${m.id} 缺少計分說明 note`);
  });
  assert.equal(tabs.find(m => m.id === 'abbrev').name, '文字突圍');
  assert.equal(tabs.find(m => m.id === 'feature').name, '字形特徵原則');
});

/* ── 槽位容量守門（回歸：站 3 的 5 碼字曾讓第 5 碼找不到槽位而崩掉整局）──
   兩件事必須一致：
   1) index.html 提供的 slot-N／val-N 數量 ≥ MAX_CODE_SLOTS
   2) 所有「用標準槽位」的字庫最長碼數 ≤ MAX_CODE_SLOTS
   任一邊不足，學生打到該碼時就會 null.className 崩潰。

   註：'run'（跑酷，已從站 3 卸下、引擎保留）與 'pet'（寵物）用的是**動態生成**的
   槽位（run-slot-N／pet-slot-N），不受 MAX_CODE_SLOTS 限制；
   但字庫仍以「單碼上限 6」為合理界線，故一併納入檢查。 */
test('使用槽位的字庫最長碼數不得超過前端槽位上限', () => {
  const { DATA, P5Mode, MAX_CODE_SLOTS } = load();
  assert.equal(typeof MAX_CODE_SLOTS, 'number', 'app.js 應定義 MAX_CODE_SLOTS');
  assert.ok(MAX_CODE_SLOTS >= 5, 'MAX_CODE_SLOTS 至少 5（站 3 有 5 碼字）');

  // 收集所有「有槽位」的機制的 pool（twoPart 用字首／字身，不在此列）
  const SLOT_MECHS = ['code', 'run', 'pet'];
  const pools = new Set();
  Array.from(P5Mode.all()).forEach(m => {
    if (SLOT_MECHS.includes(m.mech) && m.pool) pools.add(m.pool);
  });
  assert.ok(pools.size > 0, '應至少有一個使用槽位的字庫');

  for (const poolKey of pools) {
    const pool = DATA[poolKey] || [];
    for (const w of pool) {
      const len = (w.codes || []).length;
      assert.ok(len <= MAX_CODE_SLOTS,
        `${poolKey} 的【${w.char}】有 ${len} 碼，超過槽位上限 ${MAX_CODE_SLOTS}`
        + '（請在 index.html 補 slot/val，或調高 MAX_CODE_SLOTS）');
    }
  }
});

test('index.html 的標準槽位數 ≥ MAX_CODE_SLOTS', () => {
  const { MAX_CODE_SLOTS } = load();
  const html = fs.readFileSync('index.html', 'utf8');
  for (let i = 1; i <= MAX_CODE_SLOTS; i++) {
    assert.ok(html.includes(`id="slot-${i}"`), `index.html 缺少 id="slot-${i}"`);
    assert.ok(html.includes(`id="val-${i}"`), `index.html 缺少 id="val-${i}"`);
    assert.ok(html.includes(`id="label-slot-${i}"`), `index.html 缺少 id="label-slot-${i}"`);
  }
});

test('catchOrb 對缺槽位有防護（不得直接 null.className）', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  assert.ok(src.includes('if (currentSlot && currentVal)'),
    'catchOrb 應先檢查槽位存在才寫入，否則長碼字會崩掉整局');
});

/* ── siege（法陣守衛戰）機制：站 3 現行玩法 ── */
test('siege 機制已登錄，且站 3 的 view 有法陣預設值', () => {
  const { P5_MECHS, viewOf } = load();
  assert.ok(Array.from(P5_MECHS).includes('siege'), "P5_MECHS 應含 'siege'");

  const v = viewOf('abbrev');   // 站 3 是唯一的 siege 模式
  assert.equal(v.monster, '🧙', 'siege 機制的角色圖示');
  assert.equal(v.orbPrefix, 'siege', 'siege 機制的前綴');
  assert.equal(typeof v.baseScore, 'number', 'siege 機制應有基礎分');
  assert.ok(v.minBase > 0 && v.minBase <= v.baseScore, '保底分合法且不高於基礎分');
  assert.ok(/擊破/.test(v.hint), 'siege 機制的提示文字應提到擊破');
});

test('siege 模式的進度前綴就是模式代號（與其他主線一致）', () => {
  const { P5Mode } = load();
  assert.equal(P5Mode.prefixFor('abbrev', ''), 'abbrev');
  assert.equal(P5Mode.prefixFor('abbrev', 'w7_hw1'), 'abbrev', '非週次模式不加週次前綴');
});

test('siege 模式仍在主線第 3 站，且分頁順序不變', () => {
  const { P5Mode } = load();
  const main = {};
  Array.from(P5Mode.line('main')).forEach(m => { main[m.id] = m.order; });
  assert.equal(main.abbrev, 3, 'abbrev 仍是主線第 3 站');
  const tabs = Array.from(P5Mode.forTabs()).map(m => m.id);
  assert.ok(tabs.indexOf('abbrev') < tabs.indexOf('feature'), '分頁順序仍為 abbrev → feature');
  assert.ok(tabs.indexOf('omit') < tabs.indexOf('special'), 'omit 仍在 special 之前');
});

test('app.js 的 siege 引擎與 setGameMode 分支都已接上', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  for (const fn of ['enterSiegeArena', 'siegeStartGame', 'siegeInputKey', 'siegeApplyHit',
    'siegeDefeatEnemy', 'siegeSpawnEnemy', 'siegeSubmitResults', 'siegeSettleAndReturn',
    'siegeRestHere', 'siegeHandleKeydown', 'siegeCastUltimate']) {
    assert.ok(src.includes(`function ${fn}`), `app.js 缺少 ${fn}`);
  }
  assert.ok(src.includes("mechOf(mode) === 'siege'"), 'setGameMode 應有 siege 分支');
  assert.ok(src.includes('if (siegeRafId) { cancelAnimationFrame(siegeRafId)'),
    'setGameMode 應停掉 siege 的動畫迴圈');
});

test('index.html 有法陣舞台的必要元素', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const needed = ['siege-arena-section', 'siege-stage', 'siege-canvas', 'siege-roots-grid',
    'siege-start-btn', 'siege-ready-overlay', 'siege-upgrade-overlay', 'siege-over-overlay',
    'siege-settle-btn', 'siege-hp-fill', 'siege-wave-val', 'siege-score-val',
    'siege-ult-btn', 'siege-kill-count', 'siege-earned-preview', 'siege-abort-btn'];
  for (const id of needed) {
    assert.ok(html.includes(`id="${id}"`), `index.html 缺少 id="${id}"`);
  }
  assert.ok(html.includes('siegeRestHere()'), '休息鈕應呼叫 siegeRestHere()');
  assert.ok(html.includes('siegeStartGame()'), '開始鈕應呼叫 siegeStartGame()');
});

/* ── 🔴 迴歸守門：集中結算型玩法（生存／寵物／跑酷／法陣）都必須帶 earned 送分 ──
   2026-10-14 發現的真 bug：這四個模式原本用 `earned: 0` 送 round，
   後端只採信 round[].earned ⇒ 學生打完卻 0 分。
   守門方式：四個結算函式都必須呼叫共用的 buildEarnedRound()。 */
test('所有集中結算型玩法都經由 buildEarnedRound 送分（不得再送全 0）', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  assert.ok(src.includes('function buildEarnedRound'),
    'app.js 應有共用的 buildEarnedRound');

  const settles = ['runRestAndSettle', 'petRestAndSettle', 'onSurvivalMatchComplete', 'siegeSubmitResults'];
  for (const fn of settles) {
    const at = src.indexOf(`function ${fn}`);
    assert.ok(at >= 0, `找不到 ${fn}`);
    // 取函式本體（到下一個同層的 "    function " 或 100 行為止）
    const body = src.slice(at, at + 6000);
    assert.ok(body.includes('buildEarnedRound('), `${fn} 必須用 buildEarnedRound 計算 earned`);
    assert.ok(!/earned:\s*0\s*\}\)\);/.test(body),
      `${fn} 不得再把 earned 全 0 送給後端（那等於學生白打）`);
  }
});

/* ── run（跑酷）機制：2026-10-14 已從站 3 卸下、程式碼保留（dormant） ──
   保留目的：日後若要把它放到別站或挑戰線，一行註冊就能復活。
   這裡只守門「引擎還在」，不再斷言任何模式使用它。 */
test('run 機制與引擎仍保留（已卸下站 3，可隨時復活）', () => {
  const { P5_MECHS } = load();
  assert.ok(Array.from(P5_MECHS).includes('run'), "P5_MECHS 仍保留 'run'");

  const src = fs.readFileSync('js/app.js', 'utf8');
  for (const fn of ['enterRunArena', 'loadRunWord', 'processRunKeyInput',
    'confirmRunWordSpace', 'runRestAndSettle', 'runRestHere', 'handleRunKeydown']) {
    assert.ok(src.includes(`function ${fn}`), `app.js 缺少 ${fn}`);
  }
  assert.ok(src.includes("mechOf(mode) === 'run'"), 'setGameMode 仍保留 run 分支');
  assert.ok(src.includes('if (runTickTimer) { clearInterval(runTickTimer)'),
    'setGameMode 仍清掉跑酷計時器');
});

test('index.html 仍保留跑酷舞台（已卸下站 3）', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const needed = ['run-arena-section', 'run-stage', 'run-hero', 'run-obstacle-layer',
    'run-obstacle-slots', 'run-target-char', 'run-command-hint', 'run-round-flash',
    'run-distance-val', 'run-earned-preview', 'run-abort-btn'];
  for (const id of needed) {
    assert.ok(html.includes(`id="${id}"`), `index.html 缺少 id="${id}"`);
  }
  assert.ok(html.includes('runRestHere()'), '休息鈕應呼叫 runRestHere()');
});

/* ── 主線解鎖鏈（2026-10-14 使用者定案：本站分數達標才開下一關；軟鎖）── */
test('解鎖鏈：主線每一站都要有 completeAt，挑戰線不設門檻', () => {
  const { P5Mode } = load();
  const seq = Array.from(P5Mode.mainSequence());
  assert.ok(seq.length >= 4, '主線至少要有多個關卡才談得上解鎖');
  seq.forEach((m, i) => {
    assert.ok(typeof m.completeAt === 'number' && m.completeAt > 0,
      `主線第 ${i + 1} 關（${m.id}）缺少 completeAt`);
  });
  // 順序＝分頁顯示順序（就是學生看到的先後），且只含 main
  const uiOrder = Array.from(P5Mode.forTabs(), m => m.id);
  assert.deepEqual(seq.map(m => m.id), uiOrder.filter(id => P5Mode.find(id).line === 'main'),
    '解鎖鏈順序必須與分頁顯示順序一致');
  Array.from(P5Mode.line('challenge')).forEach(m => {
    assert.equal(P5Mode.completeAtOf(m.id), 0, `挑戰線的 ${m.id} 不應有門檻`);
  });
});

test('解鎖鏈：主線編號依顯示順序自動生成（不寫死站號）', () => {
  const { P5Mode } = load();
  const seq = Array.from(P5Mode.mainSequence());
  seq.forEach((m, i) => {
    assert.equal(P5Mode.stageOf(m.id), i + 1, `${m.id} 應是第 ${i + 1} 關`);
  });
  assert.equal(P5Mode.stageOf('speed'), 0, '挑戰線沒有主線編號');
  assert.equal(P5Mode.stageOf('not_registered'), 0);
  // 編號由順序決定 ⇒ 日後插入新站會自動重排，不會留下空號
  assert.equal(new Set(seq.map(m => P5Mode.stageOf(m.id))).size, seq.length, '編號不得重複');
});

test('解鎖鏈：前一站達標才開啓，未達標仍可進入（unlocked=false 但不擋）', () => {
  const { P5Mode } = load();
  const seq = Array.from(P5Mode.mainSequence());
  const first = seq[0].id, second = seq[1].id;

  // 完全沒有分數：只有第一關開啓
  const zero = P5Mode.unlockOf(first, {});
  assert.equal(zero.unlocked, true, '第一關永遠開啓');
  assert.equal(zero.isFirst, true);
  const zeroSecond = P5Mode.unlockOf(second, {});
  assert.equal(zeroSecond.unlocked, false, '沒有分數時第二關不開啓');
  assert.equal(zeroSecond.remaining, P5Mode.completeAtOf(first), '還差＝第一關的門檻');

  // 差一點點
  const almost = P5Mode.unlockOf(second, { [first]: P5Mode.completeAtOf(first) - 1 });
  assert.equal(almost.unlocked, false);
  assert.equal(almost.remaining, 1, '還差 1 分');

  // 剛好達標
  const just = P5Mode.unlockOf(second, { [first]: P5Mode.completeAtOf(first) });
  assert.equal(just.unlocked, true, '達標即開啓（>= 而非 >）');
  assert.equal(just.remaining, 0);

  // 挑戰線永遠可玩
  const challenge = P5Mode.unlockOf('speed', {});
  assert.equal(challenge.unlocked, true, '挑戰線不設門檻');
  assert.equal(challenge.staged, false);
});

test('解鎖鏈：complete 與 mainComplete（冠軍之路）由分數即時算出', () => {
  const { P5Mode } = load();
  const seq = Array.from(P5Mode.mainSequence());
  assert.equal(P5Mode.mainComplete({}), false, '沒有分數就不算走完主線');
  const allDone = {};
  seq.forEach(m => { allDone[m.id] = P5Mode.completeAtOf(m.id); });
  assert.equal(P5Mode.mainComplete(allDone), true, '每站都達標＝走完主線');
  const self = P5Mode.unlockOf(seq[0].id, allDone);
  assert.equal(self.complete, true, '本站達標要標記 complete');
  assert.equal(P5Mode.unlockOf(seq[0].id, {}).complete, false);
});

test('app.js／CSS：分頁渲染有接上解鎖狀態與關卡編號', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  assert.ok(src.includes('function currentModeScores'), 'app.js 缺少 currentModeScores');
  assert.ok(src.includes('function refreshUnlockUI'), 'app.js 缺少 refreshUnlockUI');
  assert.ok(src.includes('function unlockOf('), 'app.js 缺少 unlockOf 轉呼叫');
  assert.ok(src.includes('mode-stage-chip'), 'renderModeTabs 應產生關卡編號');
  assert.ok(src.includes('mode-badge-locked'), '未開啓要有專屬膠囊樣式');
  assert.ok(src.includes("+ (locked ? ' locked' : '')"), '未開啓要加 locked class');
  // 登入後必須重畫（initAllViews 在登入前就跑過，那時還沒有學生）
  const login = src.slice(src.indexOf('function loadStudentProfile'));
  assert.ok(login.slice(0, 1200).includes('renderModeTabs()'),
    'loadStudentProfile 必須重畫分頁，否則登入後仍顯示未登入的解鎖狀態');
  // 分數一變就要重畫（跨過門檻時放開啓儀式）
  const save = src.slice(src.indexOf('function saveStudentStats'), src.indexOf('function saveStudentStats') + 1500);
  assert.ok(save.includes('refreshUnlockUI('), 'saveStudentStats 應在分數變動後刷新解鎖狀態');

  const css = fs.readFileSync('css/style.css', 'utf8');
  for (const cls of ['.mode-stage-chip', '.mode-tab-btn.locked', '.mode-badge-pill.mode-badge-locked',
    '.mode-badge-pill.mode-badge-done']) {
    assert.ok(css.includes(cls), `css 缺少 ${cls}`);
  }
});

/* ── 真鎖＋安全網＋教師全開（2026-10-14 使用者定案）────────────────── */
test('真鎖安全網：權威旗標只在榜單「帶著分項分數」時打開，且真鎖必須同時滿足三條件', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  assert.ok(src.includes('let cloudScoresKnown = false;'), 'app.js 缺少 cloudScoresKnown 宣告');
  assert.ok(/combatLeaderboard\.some\(/.test(src),
    '只有榜單真的帶 modeScores 才可把 cloudScoresKnown 設為 true（舊後端不帶 ⇒ 維持軟鎖）');
  assert.ok(/cloudScoresKnown = true/.test(src), '抓取成功時要把權威旗標打開');
  // 真鎖三條件：未達標（locked）＋有雲端權威分數（cloudScoresKnown）＋已登入（currentStudent）
  assert.ok(src.includes('const hardLocked = locked && cloudScoresKnown && !!currentStudent;'),
    '真鎖必須同時滿足「未達標＋有雲端分數＋已登入」');
  assert.ok(src.includes('if (hardLocked) {'), '點擊時要先擋真鎖');
  assert.ok(src.includes('（達標後才能進入）'), '真鎖的提示文字');
  assert.ok(src.includes('（仍可先進來玩）'), '軟鎖的提示文字必須保留');
  assert.ok(src.includes("+ (hardLocked ? ' hard-locked' : '')"), '分頁要標記 hard-locked class');
});

test('教師全開：?teacher 參數、本機旗標與可點擊徽章都接好', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  assert.ok(src.includes("const TEACHER_UNLOCK_KEY = 'p5_unlock_all';"));
  assert.ok(src.includes('function isTeacherUnlock()'));
  assert.ok(src.includes('function initTeacherUnlock()'));
  assert.ok(src.includes('function renderTeacherUnlockBadge()'));
  assert.ok(src.includes("get('teacher')"), '要解析 ?teacher 參數');
  assert.ok(src.includes('teacher-unlock-badge'), '要有可點擊的徽章');
  assert.ok(src.includes('const teacherAll = isTeacherUnlock();'), 'renderModeTabs 要用教師全開');
  assert.ok(src.includes('const locked = !teacherAll && unlock.staged && !unlock.unlocked;'),
    '教師全開時不得再標 locked');
  // initAllViews 要在畫分頁前先解析參數（教師全開要第一時間生效）
  const initStart = src.indexOf('function initAllViews');
  const init = src.slice(initStart, initStart + 500);
  assert.ok(init.indexOf('initTeacherUnlock()') > -1
    && init.indexOf('initTeacherUnlock()') < init.indexOf('renderModeTabs()'),
    'initAllViews 必須先 initTeacherUnlock 再 renderModeTabs');
  const css = fs.readFileSync('css/style.css', 'utf8');
  assert.ok(css.includes('.mode-tab-btn.hard-locked'), 'css 缺少真鎖樣式');
  assert.ok(css.includes('.teacher-unlock-badge'), 'css 缺少教師徽章樣式');
});

test('登入時會抓一次雲端榜單（換電腦的解鎖進度靠這份權威分數）', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  const login = src.slice(src.indexOf('function submitStudentLogin'),
    src.indexOf('function isValidStudentIdentity'));
  assert.ok(login.includes('fetchCloudLeaderboard(true)'), 'submitStudentLogin 應在登入後立刻抓榜單');
});

test('雲端分項併入後會寫回本機（離線／重整保得住解鎖進度）', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  const fn = src.slice(src.indexOf('function getStudentStats'), src.indexOf('function generateRequestId'));
  assert.ok(fn.includes('cloudMerged'), 'getStudentStats 應追蹤雲端併入是否有變動');
  assert.ok(/if \(cloudMerged\)/.test(fn), '有變動就要寫回 SafeStorage');
  assert.ok(fn.includes('SafeStorage.setItem(key, JSON.stringify(stats))'), '寫回要用同一個 key');
});
