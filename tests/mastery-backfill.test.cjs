/** 任務 0G：補寫機制與完成時間戳驗證。
 * 涵蓋：掌握進度重建的冪等性、抽屜重建、比對補寫、時間戳邊界。
 *
 * v2：掌握進度表改「長格式」——每生固定 16 列，第 3 欄「模式」存模式前綴，
 * 第 4 欄「當日進度」才是序列化片段。故一律以「前綴所在的列」取值。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const LOG = '遊戲紀錄';
const MASTERY = '掌握進度';
const LOG_HEADERS = ['請求編號', '接收時間', '年級', '班別', '學號', '模式', '本次得分', '本次擊倒數',
  '完成秒數', '題量', '周次', '本次得分字'];

/** 香港時間的今天（YYYY-MM-DD）。 */
function hkToday() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }

function logRow(over = {}) {
  return Object.assign([
    'req-00000001', new Date(), 5, 'P5A', 7, 'connected', 10, 0, '', 10, 'w7', '更日'
  ], over);
}
function seedLog(rows) { return { [LOG]: [LOG_HEADERS].concat(rows) }; }

/** 取某生掌握的 16 列區塊（長格式）。 */
function masteryBlock(env, cls, num) {
  const table = env.tables[MASTERY] || [];
  const start = env.s.MasteryStore.firstRow(cls, num) - 1;
  return table.slice(start, start + env.s.MasteryStore.MODE_ROWS_PER_STUDENT);
}
/** 取某生某模式前綴的那一列。 */
function masteryRow(env, cls, num, prefix) {
  return masteryBlock(env, cls, num).find(r => String(r[2]) === prefix) || null;
}

test('掌握進度由紀錄重建，且重複執行結果一致（冪等）', () => {
  const today = hkToday();
  const env = makeEnv(seedLog([logRow(), logRow({ 0: 'req-00000002', 11: '中文' })]));
  env.s.writeMasterySheet_();
  // 只比較資料欄（第 0–4 欄）；第 5 欄是執行時間，每次都不同，不屬於冪等範圍。
  const dataOnly = () => env.tables[MASTERY].map(r => r.slice(0, 5));
  const first = JSON.stringify(dataOnly());
  env.s.writeMasterySheet_();
  assert.equal(JSON.stringify(dataOnly()), first, '第二次重建的資料必須完全相同');
  const row = masteryRow(env, 'P5A', 7, 'connected');
  assert.ok(row, '應有 connected 這一列');
  assert.match(String(row[3]), new RegExp('connected:更:' + today));
  assert.match(String(row[3]), new RegExp('connected:日:' + today));
  assert.match(String(row[3]), new RegExp('connected:中:' + today));
});

test('舊格式列（本次得分字為空）不產生任何掌握進度', () => {
  const env = makeEnv(seedLog([logRow({ 11: '' })]));
  env.s.writeMasterySheet_();
  const block = masteryBlock(env, 'P5A', 7);
  assert.equal(block.length, 16, '每生固定 16 列');
  block.forEach((r) => assert.equal(String(r[2]), '', '無資料不等於未得分'));
});

test('同 requestId 的重複紀錄在重建時只計一次', () => {
  const env = makeEnv(seedLog([logRow(), logRow()]));
  env.s.writeMasterySheet_();
  const row = masteryRow(env, 'P5A', 7, 'connected');
  assert.equal(String(row[3]).split(';').length, 2, '更、日 各一次');
});

test('重建：同一天同一字多列會累加次數，不會被抹平', () => {
  const env = makeEnv(seedLog([
    logRow({ 0: 'req-00000011' }), logRow({ 0: 'req-00000012' }), logRow({ 0: 'req-00000013' })
  ]));
  env.s.writeMasterySheet_();
  const row = masteryRow(env, 'P5A', 7, 'connected');
  assert.match(String(row[3]), /connected:更:[^*;]+\*3/, '三列同字 → 3 次');
});

test('抽屜可由掌握進度表重建，且只還原今天的得分', () => {
  const today = hkToday();
  const env = makeEnv({ [MASTERY]: [
    ['班別', '學號', '模式', '當日進度', '最後更新日', '更新時間'],
    ['P5A', 7, 'connected', 'connected:更:' + today + ';connected:日:2026-01-01', today, '']
  ] });
  const result = env.s.rebuildMasteryDrawers();
  assert.equal(result.rebuilt, 1);
  const drawer = env.props.get('mb:P5A_7');
  // 今天的「更」保留；舊日期的「日」被丟棄（避免誤判為已得分）
  assert.equal(drawer, 'v2|' + today + '|connected:更');
});

test('重建抽屜：多個模式前綴合併回同一個進度地圖', () => {
  const today = hkToday();
  const env = makeEnv({ [MASTERY]: [
    ['班別', '學號', '模式', '當日進度', '最後更新日', '更新時間'],
    ['P5A', 7, 'connected', 'connected:更:' + today, today, ''],
    ['P5A', 7, 'special', 'special:體:' + today + '*2', today, '']
  ] });
  env.s.rebuildMasteryDrawers();
  const drawer = env.s.MasteryCore.parseDrawer(env.props.get('mb:P5A_7'));
  assert.deepEqual(JSON.parse(JSON.stringify(drawer.map)), {
    'connected:更': today,
    'special:體': today + '*2'
  });
});

test('比對並補寫：抽屜被清空後可由 Sheet 補回', () => {
  const env = makeEnv(seedLog([logRow()]));
  env.s.writeMasterySheet_();
  env.props.delete('mb:P5A_7');
  env.s.reconcileMastery();
  assert.match(String(env.props.get('mb:P5A_7')), /^v2\|/, '抽屜已補回（v2 格式）');
});

test('完成時間戳：未帶時視為現在', () => {
  const env = makeEnv();
  assert.equal(env.s.parseCompletedAt_(undefined), null);
  assert.equal(env.s.parseCompletedAt_(''), null);
  assert.equal(env.s.parseCompletedAt_(null), null);
});

test('完成時間戳：不可為未來（容許 5 分鐘時鐘偏差）', () => {
  const env = makeEnv();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.throws(() => env.s.parseCompletedAt_(future), /未來/);
  // 3 分鐘偏差內可接受
  const slight = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  assert.equal(env.s.parseCompletedAt_(slight).overdue, false);
});

test('完成時間戳：24 小時內不算逾期，超過則標記逾期但仍接受', () => {
  const env = makeEnv();
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(env.s.parseCompletedAt_(recent).overdue, false);
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const parsed = env.s.parseCompletedAt_(old);
  assert.equal(parsed.overdue, true, '逾期不靜默丟棄，而是標記出來');
});

test('完成時間戳：格式錯誤一律拒絕', () => {
  const env = makeEnv();
  assert.throws(() => env.s.parseCompletedAt_('not-a-date'), /格式不正確/);
  assert.throws(() => env.s.parseCompletedAt_(12345), /格式不正確/);
});
