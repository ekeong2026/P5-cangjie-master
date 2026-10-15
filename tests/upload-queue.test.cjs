/** 任務 0E：上傳佇列與退避重試的純邏輯測試。
 * 涵蓋：指數退避與上限、重試額度、完成時間戳、佇列去重與上限、補送後保留新增項目。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../js/upload-queue.js');

test('退避時間為 1s、2s、4s、8s（無抖動時）', () => {
  const noJitter = { jitter: false };
  assert.equal(queue.backoffDelay(1, noJitter), 1000);
  assert.equal(queue.backoffDelay(2, noJitter), 2000);
  assert.equal(queue.backoffDelay(3, noJitter), 4000);
  assert.equal(queue.backoffDelay(4, noJitter), 8000);
});

test('退避時間設有上限，不會無限增長', () => {
  const noJitter = { jitter: false, maxDelayMs: 30000 };
  assert.equal(queue.backoffDelay(10, noJitter), 30000);
  assert.equal(queue.backoffDelay(20, noJitter), 30000);
});

test('抖動使等待時間落在 ±20% 之內', () => {
  const fixed = { random: () => 0.5 };
  assert.equal(queue.backoffDelay(1, fixed), 1000, '中位抖動等於原值');
  const low = { random: () => 0 };
  assert.equal(queue.backoffDelay(1, low), 800, '下限 -20%');
  const high = { random: () => 1 };
  assert.equal(queue.backoffDelay(1, high), 1200, '上限 +20%');
});

test('重試額度：預設 5 次，超過即放棄', () => {
  assert.equal(queue.shouldRetry(0), true);
  assert.equal(queue.shouldRetry(4), true);
  assert.equal(queue.shouldRetry(5), false);
  assert.equal(queue.shouldRetry(9), false);
  assert.equal(queue.shouldRetry(2, { maxAttempts: 2 }), false);
});

test('佇列項目保留完成時間戳，供後端判斷歸屬日期', () => {
  const item = queue.makeQueueItem({ requestId: 'req-1' }, '2026-10-13T08:00:00.000Z');
  assert.equal(item.completedAt, '2026-10-13T08:00:00.000Z');
  assert.equal(item.payload.requestId, 'req-1');
  assert.ok(item.queuedAt, '入列時間也要記下');
  // 未帶完成時間時，補上當下時間
  const auto = queue.makeQueueItem({ requestId: 'req-2' });
  assert.ok(auto.completedAt);
});

test('parseQueue 容忍損毀資料，一律回傳陣列', () => {
  assert.deepEqual(queue.parseQueue(null), []);
  assert.deepEqual(queue.parseQueue(''), []);
  assert.deepEqual(queue.parseQueue('{not json'), []);
  assert.deepEqual(queue.parseQueue('{"a":1}'), [], '非陣列視為空');
  const good = [{ payload: { requestId: 'a' } }, { nope: true }];
  assert.equal(queue.parseQueue(good).length, 1, '保留有效項目、濾掉無 payload 的');
});

test('同 requestId 入列會取代舊項，不重複堆積', () => {
  let q = [];
  q = queue.enqueue(q, queue.makeQueueItem({ requestId: 'req-a' })).queue;
  q = queue.enqueue(q, queue.makeQueueItem({ requestId: 'req-b' })).queue;
  const again = queue.enqueue(q, queue.makeQueueItem({ requestId: 'req-a' }));
  assert.equal(again.queue.length, 2, '仍是兩筆');
  assert.equal(again.dropped, 0);
});

test('佇列超過上限時明確回報丟棄筆數，不靜默截斷', () => {
  let q = [];
  for (let i = 0; i < 5; i++) {
    q = queue.enqueue(q, queue.makeQueueItem({ requestId: 'req-' + i }), { maxQueue: 3 }).queue;
  }
  const result = queue.enqueue(q, queue.makeQueueItem({ requestId: 'req-x' }), { maxQueue: 3 });
  assert.equal(result.queue.length, 3);
  assert.equal(result.dropped, 1, '必須回報被丟棄的筆數');
  assert.equal(result.queue[2].payload.requestId, 'req-x', '保留最新的');
});

test('補送成功後移除該筆，保留補送期間新增的項目', () => {
  let q = [];
  q = queue.enqueue(q, queue.makeQueueItem({ requestId: 'req-old' })).queue;
  // 補送進行中，使用者又交了一筆
  q = queue.enqueue(q, queue.makeQueueItem({ requestId: 'req-new' })).queue;
  const after = queue.dequeue(q, 'req-old');
  assert.equal(after.length, 1);
  assert.equal(after[0].payload.requestId, 'req-new', '新增的項目不得被誤刪');
});

test('瀏覽器與測試取得同一份實作', () => {
  assert.equal(typeof globalThis.UploadQueue.backoffDelay, 'function');
  assert.equal(globalThis.UploadQueue, queue);
});
