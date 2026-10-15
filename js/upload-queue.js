/* =========================================================================
 * 🔁 UPLOAD-QUEUE.JS — 上傳佇列與退避重試的純邏輯（可測試、無瀏覽器相依）
 *
 * 目的（任務 0E）：
 *   - 失敗時以指數退避重試（1s、2s、4s、8s…上限 30s），不再固定 1.2 秒硬重試兩次。
 *   - 每筆佇列項目保留「遊戲完成時間戳」completedAt，供後端判斷離線補送的歸屬日期。
 *   - 佇列上限由「最近 30 筆」改為可設定（預設 200），且超限時明確回報被丟棄的筆數，
 *     不再靜默截斷。
 *
 * 這個檔案不含任何 fetch／localStorage 呼叫，純資料運算，方便在 Node 內測試。
 * 實際的傳送與儲存由 js/app.js 負責。
 * ========================================================================= */
(function (root) {
  'use strict';

  var DEFAULT_MAX_QUEUE = 200;
  var DEFAULT_BASE_DELAY_MS = 1000;
  var DEFAULT_MAX_DELAY_MS = 30000;
  var DEFAULT_MAX_ATTEMPTS = 5;

  /* 指數退避：第 n 次重試等待 base * 2^(n-1)，上限 maxDelay。
     加入 ±20% 抖動，避免多台裝置同時重試造成尖峰。 */
  function backoffDelay(attempt, options) {
    var opt = options || {};
    var base = Number(opt.baseDelayMs) || DEFAULT_BASE_DELAY_MS;
    var max = Number(opt.maxDelayMs) || DEFAULT_MAX_DELAY_MS;
    var n = Math.floor(Number(attempt));
    if (!Number.isFinite(n) || n < 1) n = 1;
    var raw = base * Math.pow(2, n - 1);
    var capped = Math.min(raw, max);
    var jitter = opt.jitter === false ? 0 : capped * 0.2;
    var random = typeof opt.random === 'function' ? opt.random : Math.random;
    return Math.round(capped - jitter + random() * jitter * 2);
  }

  /* 是否還有重試額度。 */
  function shouldRetry(attempt, options) {
    var max = Number((options || {}).maxAttempts) || DEFAULT_MAX_ATTEMPTS;
    return Math.floor(Number(attempt)) < max;
  }

  /* 組佇列項目：保留完成時間戳，讓後端能判斷這是即時交卷還是離線補送。 */
  function makeQueueItem(payload, completedAt) {
    return {
      payload: payload,
      completedAt: completedAt || new Date().toISOString(),
      queuedAt: new Date().toISOString()
    };
  }

  /* 讀入佇列：容忍損毀的 JSON，一律回傳陣列。 */
  function parseQueue(raw) {
    if (!raw) return [];
    try {
      var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed.filter(function (item) { return item && item.payload; }) : [];
    } catch (error) {
      return [];
    }
  }

  /* 依 requestId 去重後加入佇列；回傳新的佇列與被丟棄的筆數。
     同 requestId 的重複項目只保留一筆，避免重試造成重複補送。 */
  function enqueue(queue, item, options) {
    var max = Number((options || {}).maxQueue) || DEFAULT_MAX_QUEUE;
    var list = (Array.isArray(queue) ? queue : []).slice();
    var id = item && item.payload && item.payload.requestId;
    if (id) list = list.filter(function (q) { return !(q && q.payload && q.payload.requestId === id); });
    list.push(item);
    var dropped = 0;
    if (list.length > max) {
      dropped = list.length - max;
      list = list.slice(-max);
    }
    return { queue: list, dropped: dropped };
  }

  /* 依 requestId 標記已補送成功並移除；保留補送期間新增的項目。 */
  function dequeue(queue, requestId) {
    return (Array.isArray(queue) ? queue : []).filter(function (item) {
      return !(item && item.payload && item.payload.requestId === requestId);
    });
  }

  var api = {
    DEFAULT_MAX_QUEUE: DEFAULT_MAX_QUEUE,
    DEFAULT_MAX_ATTEMPTS: DEFAULT_MAX_ATTEMPTS,
    backoffDelay: backoffDelay,
    shouldRetry: shouldRetry,
    makeQueueItem: makeQueueItem,
    parseQueue: parseQueue,
    enqueue: enqueue,
    dequeue: dequeue
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.UploadQueue = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
