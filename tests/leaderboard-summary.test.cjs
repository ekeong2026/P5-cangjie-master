/** 排行榜改讀「成績總覽」彙總表（任務 0C）的等價性與壓力控制測試。
 *
 * 核心保證：任何情況下，「只讀總覽」的輸出必須與「掃描全部原始紀錄」的輸出逐欄相同。
 * readDataFromLog_() 就是修改前的舊演算法，故可直接作為比對基準。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./apps-script-env.cjs');

const LOG = '遊戲紀錄', SUMMARY = '成績總覽';
const LOG_HEADERS = ['請求編號', '接收時間', '年級', '班別', '學號', '模式', '本次得分', '本次擊倒數', '完成秒數', '題量', '周次', '本次得分字'];
const SUMMARY_FIXED_HEADERS = ['年級', '班別', '學號', '累計得分', '累計擊倒數', '最佳10字秒數', '最後接收時間', '週次最佳秒數'];

function logRow(over = {}) {
  return [
    over.id === undefined ? '' : over.id,
    new Date(over.at || '2026-10-05T01:00:00Z'),
    over.grade === undefined ? 5 : over.grade,
    over.cls === undefined ? 'P5A' : over.cls,
    over.num === undefined ? 1 : over.num,
    over.mode || 'connected',
    over.delta === undefined ? 0 : over.delta,
    over.kills === undefined ? 0 : over.kills,
    over.seconds === undefined ? '' : over.seconds,
    over.count === undefined ? 10 : over.count,
    over.week === undefined ? 'w7' : over.week,
    ''
  ];
}

function withLog(rows) { return { [LOG]: [LOG_HEADERS.slice()].concat(rows) }; }

/** 涵蓋多模式、多週次、重複編號、歷史無編號列、非 5 年級列及不合法手速列。 */
function richRows() {
  return [
    logRow({ id: 'req-aaaa0001', cls: 'P5A', num: 1, mode: 'connected', delta: 42, kills: 1, week: 'w7' }),
    logRow({ id: 'req-aaaa0001', cls: 'P5A', num: 1, mode: 'connected', delta: 42, kills: 1, week: 'w7' }), // 重複編號
    logRow({ id: 'req-aaaa0002', cls: 'P5A', num: 1, mode: 'special', delta: 8, week: 'w7' }),
    logRow({ id: 'req-aaaa0003', cls: 'P5A', num: 1, mode: 'speed', seconds: 31.5, week: 'w7' }),
    logRow({ id: 'req-aaaa0004', cls: 'P5A', num: 1, mode: 'speed', seconds: 33.2, week: 'w8' }),
    logRow({ id: 'req-aaaa0005', cls: 'P5A', num: 1, mode: 'speed', seconds: 30.25, week: 'w8' }), // 同週更快
    logRow({ id: 'req-aaaa0006', cls: 'P5A', num: 1, mode: 'speed', seconds: 29.5, week: 'w9', count: 20 }), // 20 字賽不計手速榜
    logRow({ id: 'req-aaaa0007', cls: 'P5A', num: 1, mode: 'speed', seconds: 0, week: 'w9' }),   // 不合法秒數
    logRow({ id: 'req-aaaa0008', cls: 'P5A', num: 1, mode: 'speed', seconds: 900, week: 'w9' }), // 不合法秒數
    logRow({ id: 'req-bbbb0001', cls: 'P5B', num: 3, mode: 'split', delta: 12, week: 'w7' }),
    logRow({ id: 'req-bbbb0002', cls: 'P5B', num: 3, mode: 'speed', seconds: 31.5, week: 'w7' }), // 與 P5A1 並列
    logRow({ id: 'req-cccc0001', cls: 'P5F', num: 36, mode: 'connected', delta: 500, kills: 1, week: 'w8' }),
    logRow({ id: 'req-dddd0001', cls: 'P5A', num: 2, mode: 'connected', delta: 7, week: 'w8' }),
    logRow({ cls: 'P5A', num: 4, mode: 'connected', delta: 5, kills: 1, week: 'w7' }),          // 歷史列無編號
    logRow({ id: 'req-eeee0001', grade: 6, cls: 'P5A', num: 5, mode: 'connected', delta: 999 }), // 非 5 年級
    logRow({ id: 'req-ffff0001', cls: 'P5Z', num: 9, mode: 'connected', delta: 999 })            // 不存在的班別
  ];
}

const canon = value => JSON.parse(JSON.stringify(value));

function assertSameAsLog(env, label) {
  assert.deepEqual(canon(env.s.readData_()), canon(env.s.readDataFromLog_()), label);
}

function request(over = {}) {
  return Object.assign({ requestId: 'req-12345678', grade: 5, cls: 'P5A', num: 7, mode: 'connected', scoreDelta: 42, killDelta: 1, wordCount: 10, weekKey: 'w7' }, over);
}
const post = (env, payload) => JSON.parse(env.s.doPost({ postData: { contents: JSON.stringify(payload) } }));

test('新版 setup 建立 8 欄固定表頭的成績總覽，並補滿 6 班 × 36 人', () => {
  const env = makeEnv();
  assert.deepEqual(env.tables[SUMMARY][0], SUMMARY_FIXED_HEADERS);
  assert.equal(env.tables[SUMMARY].length, 217, '總覽應補滿 6 班 × 36 人');
});

test('舊版總覽（固定欄含模式分項）會被拒絕，不靜默寫入錯位資料', () => {
  // 舊制的「連體字得分／分體字得分／特殊字得分」已改為尾端動態欄「得分:<模式>」，
  // 位置不同，故必須重建（一次性重置），不能沿用。
  const legacy = [['年級', '班別', '學號', '累計得分', '累計擊倒數', '連體字得分', '分體字得分', '特殊字得分', '最佳10字秒數', '最後接收時間']];
  assert.throws(() => makeEnv({ [SUMMARY]: legacy }), /欄位不符/);
});

test('既有 8 欄固定表頭可續用，首次得分後在尾端追加動態分項欄', () => {
  const env = makeEnv({ [SUMMARY]: [SUMMARY_FIXED_HEADERS.slice()] });
  post(env, request({ requestId: 'req-hdr00001', scoreDelta: 5 }));
  assert.equal(env.tables[SUMMARY][0][8], '得分:connected', '動態欄必須追加在尾端');
});

test('重建後，「只讀總覽」與「掃描原始紀錄」逐欄完全一致', () => {
  const env = makeEnv(withLog(richRows()));
  env.s.refreshSummary();
  assertSameAsLog(env, '重建後輸出必須一致');
});

test('交卷增量更新後，兩條路徑仍然一致', () => {
  const env = makeEnv(withLog(richRows()));
  env.s.refreshSummary();
  post(env, request({ requestId: 'req-new00001', scoreDelta: 30, killDelta: 1 }));
  post(env, request({ requestId: 'req-new00002', cls: 'P5C', num: 12, mode: 'special', scoreDelta: 15, killDelta: 0 }));
  post(env, request({ requestId: 'req-new00003', cls: 'P5C', num: 12, mode: 'speed', scoreDelta: 0, killDelta: 0, bestTime: 27.75, wordCount: 10, weekKey: 'w8' }));
  assertSameAsLog(env, '增量更新後輸出必須一致');
  assert.equal(env.s.readData_().combatLeaderboard.find(st => st.cls === 'P5A' && st.num === 7).grandTotal, 30);
});

test('同一學生的手速成績依週次隔離，各週只保留最快', () => {
  const env = makeEnv(withLog(richRows()));
  env.s.refreshSummary();
  const data = env.s.readData_();
  const p5a1 = data.combatLeaderboard.find(st => st.cls === 'P5A' && st.num === 1);
  assert.deepEqual(canon(p5a1.weekly_speed), { w7: 31.5, w8: 30.25 });
  assert.equal(p5a1.best10, 30.25, '20 字賽及不合法秒數不得計入最佳 10 字秒數');
  assert.deepEqual(canon(data.speedByWeek.w7.map(r => r.num)), [1, 3], 'w7 榜不得混入 w8 成績');
  assert.deepEqual(canon(data.speedByWeek.w7.map(r => r.bestTime)), [31.5, 31.5]);
  assert.deepEqual(canon(data.speedByWeek.w8.map(r => r.bestTime)), [30.25]);
  assert.equal(data.speedByWeek.w9, undefined, '無合法手速成績的週次不應出現');
  assert.deepEqual(canon(data.speedByWeek.overall.map(r => r.bestTime)), [30.25, 31.5]);
});

test('top40 與班級前十隻計有分學生，且名次依分數遞減', () => {
  const env = makeEnv(withLog(richRows()));
  env.s.refreshSummary();
  const data = env.s.readData_();
  // P5A 1 號＝連體字 42 ＋ 特殊字 8 ＝ 50；P5F 36 號＝500；P5B 3 號＝12。
  assert.deepEqual(canon(data.combatLeaderboard.slice(0, 3).map(st => st.grandTotal)), [500, 50, 12]);
  assert.deepEqual(canon(data.top40.slice(0, 3).map(st => st.grandTotal)), [500, 50, 12]);
  assert.equal(data.top40.every(st => st.grandTotal > 0), true);
  assert.equal(data.class_top10.P5A.length, 3);
  assert.equal(data.class_top10.P5B.length, 1);
  assert.equal(data.class_top10.P5D.length, 0);
  assert.equal(data.combatLeaderboard.length, 216);
});

test('總覽尚未建立時退回讀原始紀錄，不以空白排行榜示人', () => {
  const env = makeEnv(withLog(richRows()));
  env.tables[SUMMARY].length = 1; // 只留標題列
  const data = env.s.readData_();
  assert.equal(data.combatLeaderboard.find(st => st.cls === 'P5F' && st.num === 36).grandTotal, 500);
});

test('總覽更新失敗時，學生成績仍算數、偏差被標記', () => {
  const env = makeEnv();
  env.state.failSheet = SUMMARY;
  const result = post(env, request({ scoreDelta: 42 }));
  assert.equal(result.status, 'success', '不可讓學生因總覽故障而重試失敗');
  assert.equal(env.tables[LOG].length, 2, '原始紀錄必須已寫入');
  assert.ok(env.props.get('SUMMARY_DIRTY'), '必須留下偏差標記供重建發現');
});

test('重建成功後清除偏差標記', () => {
  const env = makeEnv();
  env.state.failSheet = SUMMARY;
  post(env, request({ scoreDelta: 42 }));
  env.state.failSheet = null;
  env.s.refreshSummary();
  assert.equal(env.props.has('SUMMARY_DIRTY'), false);
  assert.equal(env.s.summaryDirtySince_(), '');
  assert.equal(env.tables[SUMMARY].length, 217);
});

test('週次最佳秒數欄依週次數字排序，格式穩定', () => {
  const env = makeEnv();
  post(env, request({ requestId: 'req-w9xxxxx1', mode: 'speed', scoreDelta: 0, killDelta: 0, bestTime: 40, wordCount: 10, weekKey: 'w9' }));
  post(env, request({ requestId: 'req-w7xxxxx2', mode: 'speed', scoreDelta: 0, killDelta: 0, bestTime: 35.5, wordCount: 10, weekKey: 'w7' }));
  post(env, request({ requestId: 'req-w10xxxx3', mode: 'speed', scoreDelta: 0, killDelta: 0, bestTime: 33.25, wordCount: 10, weekKey: 'w10' }));
  const row = env.tables[SUMMARY].find(r => r[1] === 'P5A' && r[2] === 7);
  assert.equal(row[7], 'w7:35.5;w9:40;w10:33.25', '週次最佳秒數欄依週次數字排序');
  assert.equal(row[5], 33.25, '最佳10字秒數欄');
});

test('手速賽不影響總分，但排行榜仍讀得到秒數', () => {
  const env = makeEnv();
  post(env, request({ mode: 'speed', scoreDelta: 0, killDelta: 0, bestTime: 31.5, wordCount: 10 }));
  const data = env.s.readData_();
  const st = data.combatLeaderboard.find(s => s.cls === 'P5A' && s.num === 7);
  assert.equal(st.grandTotal, 0);
  assert.deepEqual(canon(st.weekly_speed), { w7: 31.5 });
  assert.equal(data.top40.length, 0);
  assert.deepEqual(canon(data.speedByWeek.w7.map(r => r.bestTime)), [31.5]);
});

test('排行榜一般讀取不再掃描原始紀錄', () => {
  const env = makeEnv(withLog(richRows()));
  env.s.refreshSummary();
  const original = env.s.aggregateLog_;
  let scanned = 0;
  env.s.aggregateLog_ = function () { scanned++; return original.apply(this, arguments); };
  env.s.readData_();
  assert.equal(scanned, 0, 'readData_ 不應再掃描遊戲紀錄');
  env.s.readDataFromLog_();
  assert.equal(scanned, 1, '只有重建／回退路徑才掃描');
});

test('排行榜輸出結構與前端取用欄位齊全', () => {
  const env = makeEnv(withLog(richRows()));
  env.s.refreshSummary();
  const data = env.s.readData_();
  assert.deepEqual(Object.keys(data).sort(), ['class_top10', 'combatLeaderboard', 'speedByWeek', 'status', 'top40']);
  const st = data.combatLeaderboard[0];
  for (const field of ['cls', 'num', 'name', 'score', 'grandTotal', 'totalScore', 'kills', 'modeScores', 'weekly_speed', 'best10', 'lastTime']) {
    assert.ok(field in st, '缺少欄位：' + field);
  }
  // 分項分數改為動態對照表；前端不得再依賴固定的 mode1/2/3Score。
  assert.equal('mode1Score' in st, false, '舊的固定分項欄位應已移除');
  assert.ok('overall' in data.speedByWeek);
});
