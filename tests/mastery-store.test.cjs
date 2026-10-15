/** 雙層儲存（任務 0F）測試：抽屜＝加速器、Sheet＝真相。
 * 重點：寫入失敗只回報不拋錯；容量錯誤時不阻斷學生；Sheet 行位置與格式正確。
 *
 * v2：掌握進度表改「長格式」——每生固定 MODE_ROWS_PER_STUDENT 列，每列一個模式前綴，
 * schema 與模式數量無關，加新模式時表頭不必改。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const DAY1 = '2026-10-12';
const SHEET = '掌握進度';

function drawer(map = { 'connected:更': DAY1 }, over = {}) {
  return Object.assign({ version: 'v2', date: DAY1, map }, over);
}

test('讀取不存在的抽屜回傳空集合', () => {
  const env = makeEnv();
  const d = env.s.MasteryStore.read('P5A', 1);
  assert.equal(d.version, '');
  assert.deepEqual(JSON.parse(JSON.stringify(d)), { version: '', date: '', map: {} });
});

test('抽屜寫入後可原樣讀回（含次數）', () => {
  const env = makeEnv();
  const d = drawer({
    'connected:更': DAY1,
    'connected:中': DAY1 + '*2',
    'speed.w7_hw1:更': DAY1 + '*3'
  });
  const result = env.s.MasteryStore.writeDrawer('P5A', 1, d, DAY1);
  assert.equal(result.ok, true);
  assert.equal(result.value, 'v2|' + DAY1 + '|connected:中2更,speed.w7_hw1:更3');
  const back = env.s.MasteryStore.read('P5A', 1);
  assert.equal(back.version, 'v2');
  assert.equal(back.date, DAY1);
  assert.deepEqual(JSON.parse(JSON.stringify(back.map)), {
    'connected:更': DAY1,
    'connected:中': DAY1 + '*2',
    'speed.w7_hw1:更': DAY1 + '*3'
  });
});

test('Sheet 每生固定 16 列，落在班別×學號的區塊起點，欄位格式正確', () => {
  const env = makeEnv();
  const d = drawer({
    'connected:更': DAY1, 'connected:中': DAY1, 'special:日': DAY1, 'speed.w7_hw1:更': DAY1
  });
  const stamp = new Date('2026-10-12T08:00:00Z');
  const result = env.s.MasteryStore.writeSheet('P5B', 1, d, DAY1, stamp);
  assert.equal(result.ok, true);
  const table = env.tables[SHEET];
  assert.equal(table[0][0], '班別');
  assert.deepEqual(table[0], ['班別', '學號', '模式', '當日進度', '最後更新日', '更新時間']);

  // P5B 1 號 = 第 578 行（index 577）
  const first = env.s.MasteryStore.firstRow('P5B', 1);
  assert.equal(first, 578);
  let row = table[first - 1];
  assert.equal(row[0], 'P5B');
  assert.equal(row[1], 1);
  assert.equal(row[2], 'connected', '前綴依字母排序，第一個是 connected');
  assert.equal(row[3], 'connected:中:' + DAY1 + ';connected:更:' + DAY1, '當日進度以 ; 串接、依鍵排序');
  assert.equal(row[4], DAY1);
  assert.equal(row[5], '2026-10-12T08:00:00.000Z');

  row = table[first];
  assert.equal(row[2], 'special');
  assert.equal(row[3], 'special:日:' + DAY1);

  row = table[first + 1];
  assert.equal(row[2], 'speed.w7_hw1');
  assert.equal(row[3], 'speed.w7_hw1:更:' + DAY1);

  // 其餘列為空，但仍寫上班別／學號，方便 O(1) 定位與人工檢視
  row = table[first + 2];
  assert.equal(row[0], 'P5B');
  assert.equal(row[1], 1);
  assert.equal(row[2], '', '未使用的列以空白保留');
  assert.equal(table.length, first + 15, '區塊固定 16 列（第 578～593 行）');
});

test('第 2 天的分數不寫進今天的列（當日進度只留當天）', () => {
  const env = makeEnv();
  env.s.MasteryStore.writeSheet('P5A', 1, drawer({ 'connected:更': '2026-10-11' }), DAY1);
  const table = env.tables[SHEET];
  const first = env.s.MasteryStore.firstRow('P5A', 1);
  assert.equal(table[first - 1][2], '', '昨天的資料不得寫入今天的長格式列');
  assert.equal(table[first - 1][3], '');
});

test('抽屜容量錯誤時回報失敗但不拋錯、不阻斷', () => {
  const env = makeEnv();
  env.state.failProps = true;
  const result = env.s.MasteryStore.writeDrawer('P5A', 1, drawer(), DAY1);
  assert.equal(result.ok, false);
  assert.ok(result.error, '應附錯誤訊息');
  assert.equal(env.s.MasteryStore.read('P5A', 1).version, '', '抽屜不應有資料');
  // 容量失敗後仍應能只寫 Sheet
  env.state.failProps = false;
  assert.equal(env.s.MasteryStore.writeSheet('P5A', 1, drawer(), DAY1).ok, true);
});

test('Sheet 寫入失敗時回報但不拋錯', () => {
  const env = makeEnv();
  env.state.failSheet = SHEET;
  const result = env.s.MasteryStore.writeSheet('P5A', 1, drawer(), DAY1);
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('用量統計只計算進度抽屜的鍵', () => {
  const env = makeEnv();
  env.s.MasteryStore.writeDrawer('P5A', 1, drawer(), DAY1);
  env.s.MasteryStore.writeDrawer('P5A', 2, drawer({ 'connected:中': DAY1 }), DAY1);
  const u = env.s.MasteryStore.usage();
  assert.equal(u.keys, 2, '不得計入 SCORE_SPREADSHEET_ID 等其他鍵');
  assert.ok(u.chars > 0);
  assert.ok(u.chars < 1024, '兩名學生的用量不應異常放大');
});

test('分組壓縮：同一前綴的多個字只寫一次前綴', () => {
  const env = makeEnv();
  const chars = '更中田大日月天地枝本'.split('');
  const map = {};
  chars.forEach((c) => { map['connected:' + c] = DAY1; });
  const value = env.s.MasteryCore.serializeDrawer(map, DAY1);
  // 10 個字只出現一次 'connected:'（外加一次 'v2|日期|' 的固定開銷）
  assert.equal(value.split('connected:').length - 1, 1, '前綴只寫一次');
  const expected = chars.slice().sort().join(''); // 鍵依字碼排序，故字序與輸入不同
  assert.equal(value, 'v2|' + DAY1 + '|connected:' + expected);
  assert.ok(value.length < 40, '10 字 1 模式應遠小於逐字寫前綴的長度');
});

test('行位置公式為每生 16 列，且班別×學號對齊', () => {
  const env = makeEnv();
  const s = env.s.MasteryStore;
  assert.equal(s.MODE_ROWS_PER_STUDENT, 16);
  assert.equal(s.firstRow('P5A', 1), 2);
  assert.equal(s.firstRow('P5A', 2), 18);
  assert.equal(s.firstRow('P5A', 36), 562);
  assert.equal(s.firstRow('P5B', 1), 578);
  assert.equal(s.firstRow('P5F', 36), 3442);
  // 相鄰班別的最後一列與下一班第一列不得重疊
  assert.equal(s.firstRow('P5B', 1) - s.firstRow('P5A', 36), 16);
});

test('不同學生的抽屜互不干擾', () => {
  const env = makeEnv();
  env.s.MasteryStore.writeDrawer('P5A', 1, drawer({ 'connected:更': DAY1 + '*3' }), DAY1);
  env.s.MasteryStore.writeDrawer('P5A', 2, drawer({ 'connected:中': DAY1 }), DAY1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.s.MasteryStore.read('P5A', 1).map)), { 'connected:更': DAY1 + '*3' });
  assert.deepEqual(JSON.parse(JSON.stringify(env.s.MasteryStore.read('P5A', 2).map)), { 'connected:中': DAY1 });
});
