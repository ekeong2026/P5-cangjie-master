/** 進度抽屜（Script Properties）壓縮格式測試。
 * 格式定案（v2）：v2|YYYY-MM-DD|前綴:字串,前綴:字串
 *   字串＝逐字串接，字後接次數數字（1 省略），例：更2人天
 *   前綴＝模式識別碼，週次字庫模式再多一層子前綴，例：speed.w7_hw1
 * 日期只存一次；同一前綴的字只寫一次前綴。
 * ★ 按前綴分組是必要的容量設計：若每個字都寫一次前綴，
 *   一天 90 字／生 × 216 生會超過 500 KB 上限。
 * v1（無模式前綴）無法判斷字屬於哪個模式，一律視為空抽屜，由掌握進度表／每日重建補回。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

let core;
test.before(() => {
  core = vm.runInThisContext(fs.readFileSync('js/mastery-core.js', 'utf8') + '\nMasteryCore;', { filename: 'mastery-core.js' });
});

const DAY1 = '2026-10-12', DAY2 = '2026-10-13';
const M1 = 'connected', M3 = 'special';

function keys(map) { return Object.keys(map).sort(); }

test('空白、損毀及舊版本一律安全回傳空抽屜，不拋錯', () => {
  const empty = { version: '', date: '', map: {} };
  for (const v of [null, undefined, '', 'v1', 'v1|', 'v1|bad|||',
    'v1|' + DAY1 + '|更中|日|w7_hw1:田',      // v1 舊格式：一律不解析
    '更:2026-10-12',
    'v2|', 'v2|' + DAY1, 'v2|bad|connected:更', 'v2|' + DAY1 + '|connected:更|多一段']) {
    assert.deepEqual(core.parseDrawer(v), empty, 'input=' + v);
  }
});

test('抽屜序列化與解析互為逆運算', () => {
  const map = {
    [M1 + ':更']: DAY1, [M1 + ':中']: DAY1, [M3 + ':日']: DAY1,
    'speed.w7_hw1:更': DAY1, 'speed.w7_hw1:中': DAY1, 'speed.w8:日': DAY1
  };
  const value = core.serializeDrawer(map, DAY1);
  assert.equal(value, 'v2|' + DAY1 + '|connected:中更,special:日,speed.w7_hw1:中更,speed.w8:日');
  const back = core.parseDrawer(value);
  assert.equal(back.version, 'v2');
  assert.equal(back.date, DAY1);
  assert.deepEqual(back.map, map);
});

test('跨日自動失效：序列化只保留今天的字', () => {
  const value = core.serializeDrawer({ [M1 + ':更']: DAY2, [M1 + ':中']: DAY1 }, DAY2);
  assert.equal(value, 'v2|' + DAY2 + '|connected:更');
  const back = core.parseDrawer(value);
  assert.deepEqual(back.map, { [M1 + ':更']: DAY2 });
});

test('相同資料序列化結果穩定一致（冪等、可重建）', () => {
  const map = { [M1 + ':更']: DAY1, [M1 + ':中']: DAY1, [M1 + ':大']: DAY1, 'speed.w7_hw1:更': DAY1, 'speed.w8:更': DAY1, 'speed.w7_hw1:中': DAY1 };
  const a = core.serializeDrawer(map, DAY1);
  const b = core.serializeDrawer(map, DAY1);
  assert.equal(a, b);
  assert.equal(a, 'v2|' + DAY1 + '|connected:中大更,speed.w7_hw1:中更,speed.w8:更');
});

test('模式二同字不同週各自保留', () => {
  const map = { 'speed.w7_hw1:更': DAY1, 'speed.w8_hw2:更': DAY1 };
  const back = core.parseDrawer(core.serializeDrawer(map, DAY1));
  assert.deepEqual(back.map, map);
});

test('日期格式必須合法', () => {
  assert.throws(() => core.serializeDrawer({}, '12/10/2026'), /日期/);
  assert.throws(() => core.serializeDrawer({}, ''), /日期/);
});

test('抽屜帶次數：序列化與解析互為逆運算', () => {
  const map = {
    [M1 + ':更']: DAY1 + '*3', [M1 + ':中']: DAY1,
    [M3 + ':日']: DAY1 + '*2',
    'speed.w7_hw1:更': DAY1 + '*2', 'speed.w8:日': DAY1
  };
  const value = core.serializeDrawer(map, DAY1);
  assert.equal(value, 'v2|' + DAY1 + '|connected:中更3,special:日2,speed.w7_hw1:更2,speed.w8:日', '次數以「字＋數字」表示');
  const back = core.parseDrawer(value);
  assert.deepEqual(back.map, map);
  assert.equal(core.entryCount(back.map[M1 + ':更']), 3);
  assert.equal(core.entryCount(back.map[M1 + ':中']), 1, '未寫數字即 1 次');
});

test('次數超過上限時夾在 MAX_PER_DAY', () => {
  const back = core.parseDrawer('v2|' + DAY1 + '|connected:更9');
  assert.equal(core.entryCount(back.map[M1 + ':更']), core.MAX_PER_DAY);
  const out = core.serializeDrawer({ [M1 + ':更']: DAY1 + '*9' }, DAY1);
  assert.equal(out, 'v2|' + DAY1 + '|connected:更3');
});

test('前綴不合法的分組整段略過，不影響其他分組', () => {
  const back = core.parseDrawer('v2|' + DAY1 + '|Connected:更,connected:中,9bad:日,connected:田');
  assert.deepEqual(keys(back.map), [M1 + ':中', M1 + ':田']);
});

test('空的前綴分組（全部字都已過期）仍可安全往返', () => {
  assert.equal(core.serializeDrawer({}, DAY1), 'v2|' + DAY1 + '|');
  assert.deepEqual(core.parseDrawer('v2|' + DAY1 + '|').map, {});
});

test('最壞情況容量遠低於 500 KB 上限', () => {
  const hanzi = Array.from(new Set(Array.from('更中田大日月天地枝本未末玉王土心木水人一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥上下左右內外大小多少高低長短新舊前後遠近')));
  assert.ok(hanzi.length >= 68, '測試用字數不足：' + hanzi.length);
  const map = {};
  // 模擬「一天玩了多個模式、每個字都用滿 3 次」的極端情況。
  ['connected', 'abbrev', 'feature', 'omit', 'pierce'].forEach(mode => {
    hanzi.slice(0, 31).forEach(c => { map[mode + ':' + c] = DAY1 + '*3'; });
  });
  ['w7_hw1', 'w7_hw2', 'w7_hw3', 'w7_hw4'].forEach(w => {
    hanzi.slice(0, 42).forEach(c => { map['speed.' + w + ':' + c] = DAY1 + '*3'; });
  });
  const value = core.serializeDrawer(map, DAY1);
  assert.ok(value.length < 1200, '壓縮後每生應少於 1200 字元，實際：' + value.length);
  const perStudent = 12 + value.length; // 鍵 mb:P5A_01 約 9–12 字元
  assert.ok(210 * perStudent < 500 * 1024, '210 生總量應低於 500 KB，實際約 ' + Math.round(210 * perStudent / 1024) + ' KB');
  // 往返一致：最壞情況下解析不得遺漏任何字，且次數全為 3
  const back = core.parseDrawer(value);
  assert.equal(keys(back.map).length, 155 + 168);
  assert.ok(Object.keys(back.map).every(k => core.entryCount(back.map[k]) === 3), '次數必須完整還原');
});

test('前綴分組讓容量與「每個字都寫前綴」相差數倍（分組是必要的）', () => {
  const chars = Array.from('更中田大日月天地枝本未末玉王土心木水人一二三四五六七八九十');
  const grouped = {};
  chars.forEach(c => { grouped['connected:' + c] = DAY1 + '*3'; });
  const compact = core.serializeDrawer(grouped, DAY1).length;
  // 每個字都寫前綴的假想格式（不得採用）
  const naive = Object.keys(grouped).map(k => k + '*' + 3).join(';').length;
  assert.ok(naive > compact * 3, `分組應顯著更小：分組 ${compact}，逐字寫前綴 ${naive}`);
});

test('含分隔符的字元一律視為非法鍵，杜絕格式被撐破', () => {
  for (const ch of ['|', ',', ';', ':']) assert.throws(() => core.keyOf(ch, M1), /單一漢字/);
});

test('瀏覽器與 Apps Script 使用的核心內容完全一致', () => {
  assert.equal(fs.readFileSync('js/mastery-core.js', 'utf8'), fs.readFileSync('apps-script/MasteryCore.gs', 'utf8'));
});
