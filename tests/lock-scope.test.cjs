/** 任務 0D：鎖範圍縮小。
 * 核心保證：LockService 只包「讀抽屜 → 判斷 → 寫抽屜」。
 * 正常路徑（抽屜存在）持鎖期間不得有任何 Sheet 存取；
 * 唯一例外是抽屜遺失時讀「掌握進度」補回的那一次 getValues（S6 必要，且只讀一行）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const LOG = '遊戲紀錄';

function request(over = {}) {
  return Object.assign({
    requestId: 'req-12345678', grade: 5, cls: 'P5A', num: 7, mode: 'connected',
    scoreDelta: 42, killDelta: 1, wordCount: 10, weekKey: 'w7'
  }, over);
}
function post(env, payload) {
  return JSON.parse(env.s.doPost({ postData: { contents: JSON.stringify(payload) } }));
}
/** 交卷前先把抽屜填好，模擬「抽屜存在」的正常路徑。 */
function primeDrawer(env, cls = 'P5A', num = 7) {
  env.props.set('mb:' + cls + '_' + num, 'v2|' + hkToday() + '|connected:更');
}
/** 香港時間的今天（YYYY-MM-DD）。 */
function hkToday() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }

/** 種一張「掌握進度」表：標題列 + P5A-7 的 16 列區塊（區塊起點在第 98 列）。 */
function masteryShelf() {
  const rows = [['班別', '學號', '模式', '當日進度', '最後更新日', '更新時間']];
  while (rows.length < 97) rows.push(['', '', '', '', '', '']);
  rows.push(['P5A', 7, 'connected', 'connected:更:' + hkToday(), hkToday(), '']);
  for (let i = 1; i < 16; i++) rows.push(['', '', '', '', '', '']);
  return rows;
}

test('抽屜存在時，持鎖期間完全沒有 Sheet 存取', () => {
  const env = makeEnv();
  primeDrawer(env);
  const result = post(env, request());
  assert.equal(result.status, 'success');
  assert.equal(env.state.lockAttempts, 1, '應恰好取鎖一次');
  assert.deepEqual(env.state.sheetOpsWhileLocked, [], '正常路徑鎖內不得碰 Sheet');
});

test('多筆連續交卷，每筆各取鎖一次且鎖內不碰 Sheet', () => {
  const env = makeEnv();
  primeDrawer(env);
  for (let i = 0; i < 5; i++) {
    post(env, request({ requestId: 'req-' + String(i).padStart(8, '0') }));
  }
  assert.equal(env.state.lockAttempts, 5);
  assert.deepEqual(env.state.sheetOpsWhileLocked, []);
});

test('抽屜遺失時，鎖內只有一次讀取「掌握進度」的補回', () => {
  // 先讓「掌握進度」表存在且有足夠列數，否則會因列數不足而提前跳過讀取。
  const env = makeEnv({ '掌握進度': masteryShelf() });
  const result = post(env, request());
  assert.equal(result.status, 'success');
  assert.deepEqual(env.state.sheetOpsWhileLocked, ['getValues:掌握進度'],
    '抽屜遺失才允許讀一行補回，且不得有寫入');
});

test('重複 requestId 直接回 duplicate，連鎖都不必取', () => {
  const env = makeEnv();
  primeDrawer(env);
  post(env, request());
  const attemptsAfterFirst = env.state.lockAttempts;
  const again = post(env, request());
  assert.equal(again.duplicate, true);
  assert.equal(env.state.lockAttempts, attemptsAfterFirst, '重試不應再進入抽屜判斷');
});

test('抽屜寫入完成後才釋放鎖；鎖外才更新總覽與紀錄', () => {
  const env = makeEnv();
  primeDrawer(env);
  const result = post(env, request());
  assert.equal(result.status, 'success');
  assert.match(String(env.props.get('mb:P5A_7')), /^v2\|/, '抽屜已落地');
  const summary = env.tables['成績總覽'].find(row => row[1] === 'P5A' && row[2] === 7);
  assert.equal(summary[3], 42, '總覽在鎖外更新');
});
