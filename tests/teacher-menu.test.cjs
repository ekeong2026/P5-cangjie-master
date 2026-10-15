/** 任務 0L：教師選單擴充。
 * 涵蓋：選單項目與函式對應正確、各選單函式可獨立執行、狀態顯示的內容。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const LOG = '遊戲紀錄';
const LOG_HEADERS = ['請求編號', '接收時間', '年級', '班別', '學號', '模式', '本次得分', '本次擊倒數',
  '完成秒數', '題量', '周次', '本次得分字'];

/** 記錄式 UI mock：捕捉選單項目與 alert 內容。 */
function uiEnv(seed) {
  const env = makeEnv(seed);
  const menu = { items: [], alerts: [] };
  env.s.SpreadsheetApp.getUi = () => ({
    alert: (title, message) => { menu.alerts.push({ title, message }); },
    ButtonSet: { OK: 'OK' },
    createMenu: () => {
      const api = {
        addItem(label, fn) { menu.items.push({ label, fn }); return api; },
        addSeparator() { return api; },
        addToUi() {}
      };
      return api;
    }
  });
  env.menu = menu;
  return env;
}

test('選單包含六個項目，並保留既有的「更新成績總覽」', () => {
  const env = uiEnv();
  env.s.onOpen();
  const labels = env.menu.items.map(i => i.label);
  assert.deepEqual(labels, [
    '更新成績總覽', '更新掌握進度', '比對並補寫掌握進度', '重建進度抽屜',
    '顯示系統狀態', '清除所有進度抽屜'
  ]);
});

test('每個選單項目都指向真實存在的函式', () => {
  const env = uiEnv();
  env.s.onOpen();
  env.menu.items.forEach(item => {
    assert.equal(typeof env.s[item.fn], 'function', item.label + ' → ' + item.fn + ' 必須存在');
  });
});

test('「更新掌握進度」可獨立執行', () => {
  const seed = { [LOG]: [LOG_HEADERS,
    ['req-00000001', new Date(), 5, 'P5A', 7, 'connected', 10, 1, '', 10, 'w7', '更']] };
  const env = uiEnv(seed);
  assert.doesNotThrow(() => env.s.refreshMastery());
  const row = env.tables['掌握進度'].find(r => r[0] === 'P5A' && r[1] === 7 && r[2] === 'connected');
  assert.ok(row, '掌握進度應有 connected 這一列');
  assert.match(String(row[3]), /connected:更/, '掌握進度已重建');
});

test('「重建進度抽屜」可獨立執行', () => {
  const seed = { [LOG]: [LOG_HEADERS,
    ['req-00000001', new Date(), 5, 'P5A', 7, 'connected', 10, 1, '', 10, 'w7', '更']] };
  const env = uiEnv(seed);
  env.s.writeMasterySheet_();
  const result = env.s.rebuildMasteryDrawers();
  assert.equal(result.rebuilt, 216, '依表內列數重建（P5A–P5F × 36 人）');
  assert.match(String(env.props.get('mb:P5A_7')), /^v2\|/, 'P5A-7 抽屜已由今天的得分填回');
});

test('「比對並補寫掌握進度」可獨立執行', () => {
  const seed = { [LOG]: [LOG_HEADERS,
    ['req-00000001', new Date(), 5, 'P5A', 7, 'connected', 10, 1, '', 10, 'w7', '更']] };
  const env = uiEnv(seed);
  const result = env.s.reconcileMastery();
  assert.equal(result.status, 'ok');
});

test('「清除所有進度抽屜」只刪進度鍵，不動其他資料', () => {
  const env = uiEnv();
  env.props.set('mb:P5A_7', 'v2|2026-10-13|connected:更');
  env.props.set('SUMMARY_DIRTY', '2026-10-13T00:00:00Z');
  const result = env.s.clearMasteryDrawers();
  assert.equal(result.removed, 1);
  assert.equal(env.props.get('mb:P5A_7'), undefined);
  assert.equal(env.props.get('SUMMARY_DIRTY'), '2026-10-13T00:00:00Z', '其他鍵不得被刪');
});

test('「顯示系統狀態」報告偏差標記與抽屜用量', () => {
  const env = uiEnv();
  env.props.set('mb:P5A_7', 'v2|2026-10-13|connected:更');
  env.s.showSystemStatus();
  assert.equal(env.menu.alerts.length, 1);
  const message = env.menu.alerts[0].message;
  assert.match(message, /總覽偏差標記：無/);
  assert.match(message, /進度抽屜：1 名學生/);
});

test('有偏差標記時，狀態顯示明確指出並提示修正動作', () => {
  const env = uiEnv();
  env.props.set('SUMMARY_DIRTY', '2026-10-13T00:00:00Z');
  env.s.showSystemStatus();
  const message = env.menu.alerts[0].message;
  assert.match(message, /總覽偏差標記：是/);
  assert.match(message, /請執行「更新成績總覽」/);
});
