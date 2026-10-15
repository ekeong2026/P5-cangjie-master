const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {makeEnv}=require('./apps-script-env.cjs');
const SUMMARY_HEADERS=['年級','班別','學號','累計得分','累計擊倒數','最佳10字秒數','最後接收時間','週次最佳秒數'];

const LOG='遊戲紀錄',SUMMARY='成績總覽';
function request(over={}){
  return Object.assign({requestId:'req-12345678',grade:5,cls:'P5A',num:7,mode:'connected',scoreDelta:42,killDelta:1,wordCount:10,weekKey:'w7'},over);
}
function post(env,payload){return JSON.parse(env.s.doPost({postData:{contents:JSON.stringify(payload)}}));}
function logRows(env){return env.tables[LOG].slice(1);}
function summaryRow(env,cls,num){
  const found=env.tables[SUMMARY].slice(1).find(row=>row[1]===cls&&row[2]===num);
  return found||null;
}
/** 依表頭名稱取總覽的某一格；動態分項欄（得分:模式）也適用。 */
function summaryCol(env,cls,num,name){
  const headers=env.tables[SUMMARY][0].map(v=>String(v==null?'':v).trim());
  const at=headers.indexOf(name);
  if(at<0)return undefined;
  return summaryRow(env,cls,num)[at];
}
const before=()=>makeEnv();

test('setup 為既有 11 欄紀錄表自動補上第 12、13 欄',()=>{
  const legacy=[['請求編號','接收時間','年級','班別','學號','模式','本次得分','本次擊倒數','完成秒數','題量','周次']];
  const env=makeEnv({[LOG]:legacy});
  assert.deepEqual(env.tables[LOG][0],['請求編號','接收時間','年級','班別','學號','模式','本次得分','本次擊倒數','完成秒數','題量','周次','本次得分字','完成時間']);
  assert.deepEqual(env.tables[SUMMARY][0],SUMMARY_HEADERS);
});

test('欄位不符時仍會拒絕，不會靜默寫入錯位資料',()=>{
  const wrong=[['請求編號','接收時間','年級','班別','學號','模式','本次得分','本次擊倒數','完成秒數','題量','錯欄']];
  assert.throws(()=>makeEnv({[LOG]:wrong}),/欄位不符/);
});

test('交卷寫入 13 欄，得分字由後端決定而非前端提供',()=>{
  const env=before();
  const result=post(env,request({scoredChars:'更:2026-10-12'}));
  assert.equal(result.status,'success');
  const row=logRows(env)[0];
  assert.equal(row.length,13);
  assert.equal(row[0],'req-12345678');
  assert.equal(row[10],'w7');
  assert.equal(row[11],'','前端不得自行宣稱得分字');
  // 第 13 欄為完成時間，供重建時的歸屬日期判斷（S3）。
  // 用鴨子型別判斷：沙箱與測試屬不同 realm，instanceof Date 會失效。
  assert.equal(typeof row[12].toISOString,'function','完成時間應為時間物件');
});

test('交卷不再清除排行榜快取',()=>{
  const env=before();
  env.cache.set('typing_game_leaderboard_v2','cached');
  post(env,request());
  assert.equal(env.cache.get('typing_game_leaderboard_v2'),'cached');
});

test('重複 requestId 回傳 duplicate 且不重複寫入',()=>{
  const env=before();
  post(env,request());
  const again=post(env,request());
  assert.equal(again.duplicate,true);
  assert.equal(logRows(env).length,1);
  assert.equal(summaryRow(env,'P5A',7)[3],42);
});

test('去重只掃最近 500 筆，久遠紀錄不阻擋新提交',()=>{
  const rows=[];
  rows.push(['old-req-0001',new Date('2026-01-01T00:00:00Z'),5,'P5A',1,'connected',10,0,'',10,'w1','']);
  for(let i=0;i<600;i++)rows.push(['req-'+String(i).padStart(10,'0'),new Date('2026-10-01T00:00:00Z'),5,'P5B',1,'connected',1,0,'',10,'w7','']);
  const env=makeEnv({[LOG]:[['請求編號','接收時間','年級','班別','學號','模式','本次得分','本次擊倒數','完成秒數','題量','周次','本次得分字']].concat(rows)});
  const result=post(env,request({requestId:'old-req-0001'}));
  assert.equal(result.status,'success');
  assert.equal(result.duplicate,undefined);
  assert.equal(logRows(env).length,602);
});

test('最近提交仍會被去重擋下',()=>{
  const env=before();
  post(env,request());
  assert.equal(post(env,request()).duplicate,true);
});

test('模式一／三成績正確累加並計入動態分項欄',()=>{
  const env=before();
  post(env,request({scoreDelta:42,killDelta:1}));
  post(env,request({requestId:'req-abcdefgh',mode:'special',scoreDelta:8,killDelta:0}));
  const row=summaryRow(env,'P5A',7);
  assert.equal(row[3],50);
  assert.equal(row[4],1);
  assert.equal(summaryCol(env,'P5A',7,'得分:connected'),42);
  assert.equal(summaryCol(env,'P5A',7,'得分:special'),8);
});

test('手速賽只記錄秒數，不加總分',()=>{
  const env=before();
  const result=post(env,request({mode:'speed',scoreDelta:0,killDelta:0,bestTime:31.5,wordCount:10}));
  assert.equal(result.status,'success');
  const row=summaryRow(env,'P5A',7);
  assert.equal(row[3],0);
  assert.equal(summaryCol(env,'P5A',7,'最佳10字秒數'),31.5);
});

test('多出的欄位不會影響排行榜累加',()=>{
  const env=before();
  post(env,request({scoreDelta:5}));
  post(env,request({requestId:'req-bbbbbbbb',scoreDelta:7}));
  const data=env.s.readData_();
  assert.equal(data.combatLeaderboard.find(st=>st.cls==='P5A'&&st.num===7).grandTotal,12);
});

test('不合法資料一律被拒絕',()=>{
  const env=before();
  // 模式代號只驗格式（不再有白名單），故用「不符合格式」的值測試。
  for(const bad of [
    {num:99},{cls:'P6A'},{mode:'Unknown'},{mode:'bad mode'},{scoreDelta:-1},{killDelta:2},
    {wordCount:5},{weekKey:'week7'},{requestId:'short'},
    {mode:'speed',scoreDelta:10},{mode:'speed',bestTime:0}
  ])assert.equal(post(env,request(bad)).status,'error','應拒絕：'+JSON.stringify(bad));
  assert.equal(logRows(env).length,0);
});

test('排行榜快取有效期為 60 秒，去重只掃 500 筆',()=>{
  const env=before();
  assert.equal(vm.runInContext('DATA_CACHE_SECONDS',env.s),60);
  assert.equal(vm.runInContext('REQUEST_ID_SCAN_ROWS',env.s),500);
  assert.equal(vm.runInContext('LOG_HEADERS.length',env.s),13);
  assert.equal(vm.runInContext('LOG_HEADERS[11]',env.s),'本次得分字');
  assert.equal(vm.runInContext('LOG_HEADERS[12]',env.s),'完成時間');
});
