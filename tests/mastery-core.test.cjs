const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

let core;
test.before(()=>{
  // 以同一個 realm 載入，讓 deepStrictEqual 可直接比較核心回傳的物件與陣列。
  core=vm.runInThisContext(fs.readFileSync('js/mastery-core.js','utf8')+'\nMasteryCore;',{filename:'mastery-core.js'});
});

const MODE1='更中田大日月天地枝本未末玉王土心木水人';
const DAY1='2026-10-12',DAY2='2026-10-13';
// v2：所有進度鍵一律帶模式前綴。
const M1='connected',M3='special',SP='speed.w7_hw1',SP2='speed.w7_hw2';

function seq(values){let i=0;return()=>values[i++%values.length];}
function sorted(list){return Array.from(list).sort();}
function keys(map){return Object.keys(map).sort();}

test('香港時區日期在午夜邊界正確換日',()=>{
  assert.equal(core.hkDate(new Date('2026-10-12T15:59:59Z')),DAY1);
  assert.equal(core.hkDate(new Date('2026-10-12T16:00:00Z')),DAY2);
  assert.equal(core.hkDate('2026-10-12T00:00:00+08:00'),DAY1);
  assert.equal(core.hkDate(Date.parse('2026-10-12T23:59:59+08:00')),DAY1);
});

test('無效時間被拒絕',()=>{
  assert.throws(()=>core.hkDate('not-a-date'),/時間/);
  assert.throws(()=>core.hkDate(new Date('bad')),/時間/);
});

test('進度字串可解析並只保留當天',()=>{
  const map=core.parseProgress(M1+':更:'+DAY1+';'+M1+':中:'+DAY2+';'+M1+':大:'+DAY1);
  assert.equal(map[M1+':更'],DAY1);
  assert.equal(map[M1+':中'],DAY2);
  assert.equal(map[M1+':大'],DAY1);
  assert.equal(core.serializeDaily(map,DAY1),M1+':大:'+DAY1+';'+M1+':更:'+DAY1);
  assert.equal(core.serializeDaily(map,DAY2),M1+':中:'+DAY2);
  assert.equal(core.serializeDaily(map,'2026-10-14'),'');
});

test('序列化不累積舊日期，容量固定',()=>{
  let map={};
  for(const day of ['2026-10-10','2026-10-11',DAY1])map=core.applyRound([{char:'更',correct:true,earned:10}],map,day,M1).map;
  assert.equal(core.serializeDaily(map,DAY1),M1+':更:'+DAY1);
  assert.equal(core.serializeAll(map),M1+':更:'+DAY1);
});

test('破損或空白進度字串安全回傳空集合',()=>{
  const bad=[null,undefined,'',';;','更','更:','更:abc',':2026-10-12',
    'connected','connected:','connected:abc','connected:更:abc',
    'Connected:更:'+DAY1,        // 前綴須小寫開頭
    'connected:明天:'+DAY1,      // 非單一漢字
    'connected|更:'+DAY1];       // 分隔符不得出現
  for(const value of bad){
    assert.deepEqual(core.parseProgress(value),{},'input='+value);
  }
});

test('同日每個字最多計分 3 次，第 4 次起不再計分',()=>{
  const K=M1+':更';
  const first=core.applyRound([{char:'更',correct:true,earned:18}],{},DAY1,M1);
  assert.equal(first.earned,18);
  assert.deepEqual(first.newlyScored,['更']);
  assert.deepEqual(first.ignored,[]);
  const second=core.applyRound([{char:'更',correct:true,earned:9}],first.map,DAY1,M1);
  assert.equal(second.earned,9,'第 2 次仍計分（倍率由前端套用）');
  assert.deepEqual(second.newlyScored,['更']);
  assert.equal(core.serializeDaily(second.map,DAY1),K+':'+DAY1+'*2','次數記為 2');
  const third=core.applyRound([{char:'更',correct:true,earned:5}],second.map,DAY1,M1);
  assert.equal(third.earned,5);
  assert.equal(core.serializeDaily(third.map,DAY1),K+':'+DAY1+'*3');
  const fourth=core.applyRound([{char:'更',correct:true,earned:5}],third.map,DAY1,M1);
  assert.equal(fourth.earned,0,'第 4 次不再計分');
  assert.deepEqual(fourth.newlyScored,[]);
  assert.deepEqual(fourth.ignored,['更']);
  assert.equal(core.serializeDaily(fourth.map,DAY1),K+':'+DAY1+'*3','次數不會超過上限');
});

// ── 每天前三次計分（遞減）────────────────────────────

test('decayFor：第 1 次全額，之後遞減，超過 3 次為 0',()=>{
  assert.equal(core.decayFor(1),1);
  assert.equal(core.decayFor(2),0.5);
  assert.equal(core.decayFor(3),0.25);
  assert.equal(core.decayFor(4),0);
  assert.equal(core.decayFor(0),0);
  assert.equal(core.decayFor('abc'),0);
  assert.equal(core.MAX_PER_DAY,3);
});

test('countOf / remainingFor：只算今天，且夾在上限內',()=>{
  const map=core.parseProgress(M1+':更:'+DAY1+'*2;'+M1+':中:'+DAY2);
  assert.equal(core.countOf(map,M1+':更',DAY1),2);
  assert.equal(core.countOf(map,M1+':中',DAY1),0,'昨天的日期不算今天');
  assert.equal(core.countOf({},M1+':更',DAY1),0);
  assert.equal(core.remainingFor(map,M1+':更',DAY1),1);
  assert.equal(core.remainingFor(core.parseProgress(M1+':更:'+DAY1+'*9'),M1+':更',DAY1),0,'超過上限夾在 0');
});

test('進度值編碼：只寫日期即為 1 次（與舊資料互通）',()=>{
  assert.equal(core.entryValue(DAY1,1),DAY1,'次數 1 不寫數字');
  assert.equal(core.entryValue(DAY1,2),DAY1+'*2');
  assert.equal(core.entryDate(DAY1+'*3'),DAY1);
  assert.equal(core.entryCount(DAY1),1,'沒有次數即為 1 次');
  assert.equal(core.entryCount(DAY1+'*3'),3);
  assert.equal(core.validEntry(DAY1),true);
  assert.equal(core.validEntry(DAY1+'*3'),true);
  assert.equal(core.validEntry(DAY1+'*'),false);
  assert.equal(core.validEntry('abc'),false);
});

test('舊格式進度字串（無次數）讀進來是 1 次，往回寫也維持原樣',()=>{
  const map=core.parseProgress(M1+':更:'+DAY1);
  assert.equal(core.countOf(map,M1+':更',DAY1),1,'舊資料一律視為 1 次');
  assert.equal(core.serializeDaily(map,DAY1),M1+':更:'+DAY1,'次數 1 不會被加上數字');
});

test('跨日重置：昨天的次數不延續到今天',()=>{
  const day1=core.applyRound([{char:'更',correct:true,earned:18}],{},DAY1,M1);
  const again=core.applyRound([{char:'更',correct:true,earned:9}],day1.map,DAY1,M1);
  assert.equal(core.countOf(again.map,M1+':更',DAY1),2);
  const day2=core.applyRound([{char:'更',correct:true,earned:18}],again.map,DAY2,M1);
  assert.equal(core.countOf(day2.map,M1+':更',DAY2),1,'跨日重新從第 1 次起算');
  assert.equal(core.serializeDaily(day2.map,DAY2),M1+':更:'+DAY2);
});

test('跨日後同字可再得分',()=>{
  const day1=core.applyRound([{char:'更',correct:true,earned:18}],{},DAY1,M1);
  const day2=core.applyRound([{char:'更',correct:true,earned:20}],day1.map,DAY2,M1);
  assert.equal(day2.earned,20);
  assert.deepEqual(day2.newlyScored,['更']);
  assert.equal(core.serializeDaily(day2.map,DAY2),M1+':更:'+DAY2);
});

test('一輪內同字重複答對只算一次',()=>{
  const round=core.applyRound([{char:'更',correct:true,earned:10},{char:'更',correct:true,earned:10}],{},DAY1,M1);
  assert.equal(round.earned,10);
  assert.deepEqual(round.newlyScored,['更']);
  assert.deepEqual(round.ignored,['更']);
});

test('答錯不加分也不佔用當日額度',()=>{
  const round=core.applyRound([{char:'更',correct:false,earned:18}],{},DAY1,M1);
  assert.equal(round.earned,0);
  assert.deepEqual(round.newlyScored,[]);
  assert.deepEqual(round.ignored,[]);
  const retry=core.applyRound([{char:'更',correct:true,earned:18}],round.map,DAY1,M1);
  assert.equal(retry.earned,18);
});

test('負分與非數字得分一律視為 0，不扣分',()=>{
  const round=core.applyRound([{char:'更',correct:true,earned:-50},{char:'中',correct:true,earned:'abc'}],{},DAY1,M1);
  assert.equal(round.earned,0);
  assert.deepEqual(sorted(round.newlyScored),sorted(['更','中']));
});

test('出題優先抽當天未得分的字',()=>{
  const map=core.parseProgress(M1+':更:'+DAY1+';'+M1+':中:'+DAY1);
  const picked=core.pickNextChars(MODE1,map,DAY1,5,seq([0.9,0.8,0.7,0.6,0.5]),M1);
  assert.equal(picked.length,5);
  assert.ok(picked.every(char=>char!=='更'&&char!=='中'));
  assert.equal(new Set(picked).size,5);
});

test('未得分字不足時以當天已得分的字補足',()=>{
  const pool='更中大';
  const map=core.parseProgress(M1+':更:'+DAY1+';'+M1+':中:'+DAY1);
  const picked=core.pickNextChars(pool,map,DAY1,3,seq([0.1,0.2,0.3]),M1);
  assert.deepEqual(sorted(picked),sorted(['更','中','大']));
});

test('當天全部字已得分後仍可抽題作複習',()=>{
  const pool='更中大';
  const map=core.parseProgress(M1+':更:'+DAY1+';'+M1+':中:'+DAY1+';'+M1+':大:'+DAY1);
  const picked=core.pickNextChars(pool,map,DAY1,2,seq([0.4,0.6]),M1);
  assert.equal(picked.length,2);
  assert.ok(picked.every(char=>['更','中','大'].includes(char)));
});

test('題庫不足時回傳全部可用的字',()=>{
  assert.deepEqual(sorted(core.pickNextChars('更中',{},DAY1,5,null,M1)),sorted(['更','中']));
  assert.deepEqual(core.pickNextChars('',{},DAY1,5,null,M1),[]);
  assert.deepEqual(core.pickNextChars(MODE1,{},DAY1,0,null,M1),[]);
});

test('出題可接受陣列題庫且不重複',()=>{
  const picked=core.pickNextChars(['更','中','大'],{},DAY1,3,seq([0.5]),M1);
  assert.equal(picked.length,3);
  assert.equal(new Set(picked).size,3);
});

test('出題與進度統計可直接吃 DATA 的物件題庫',()=>{
  // 迴歸：舊版 poolChars 只認字串，OBJECT 題庫會被轉成 "[object Object]" 而拋錯，
  // 令結算畫面的「今日掌握 n / N 字」直接失敗。
  const pool=[{char:'更'},{char:'中'},{char:'大'}];
  const picked=core.pickNextChars(pool,{},DAY1,2,seq([0.5]),M1);
  assert.equal(picked.length,2);
  assert.ok(picked.every(c=>['更','中','大'].includes(c)));
  const map=core.parseProgress(M1+':更:'+DAY1);
  assert.deepEqual(core.progress(map,DAY1,pool,M1),{scored:1,total:3});
});

test('進度統計只計算當天已得分',()=>{
  const map=core.parseProgress(M1+':更:'+DAY1+';'+M1+':中:'+DAY2);
  assert.deepEqual(core.progress(map,DAY1,'更中大',M1),{scored:1,total:3});
  assert.deepEqual(core.progress(map,DAY2,'更中大',M1),{scored:1,total:3});
  assert.deepEqual(core.progress({},DAY1,'更中大',M1),{scored:0,total:3});
});

test('不同模式的前綴互不干擾：同一天同字可分別得分',()=>{
  const a=core.applyRound([{char:'更',correct:true,earned:10}],{},DAY1,M1);
  const b=core.applyRound([{char:'更',correct:true,earned:30}],a.map,DAY1,M3);
  assert.equal(b.earned,30);
  assert.deepEqual(keys(b.map),[M1+':更',M3+':更']);
  assert.equal(core.countOf(b.map,M1+':更',DAY1),1);
  assert.equal(core.countOf(b.map,M3+':更',DAY1),1);
});

test('模式二以週次加功課作為前綴，同字不同周各自獨立',()=>{
  const week1=core.applyRound([{char:'更',correct:true,earned:30}],{},DAY1,SP);
  const week2=core.applyRound([{char:'更',correct:true,earned:30}],week1.map,DAY1,SP2);
  assert.equal(week2.earned,30);
  assert.deepEqual(sorted(core.serializeDaily(week2.map,DAY1).split(';')),
    sorted([SP+':更:'+DAY1,SP2+':更:'+DAY1]));
  const again=core.applyRound([{char:'更',correct:true,earned:30}],week2.map,DAY1,SP);
  assert.equal(again.earned,30,'同週次第 2 次仍計分');
  assert.deepEqual(again.newlyScored,['更']);
  const daily=core.serializeDaily(again.map,DAY1);
  assert.ok(daily.includes(SP+':更:'+DAY1+'*2'),'同週次次數累加為 2');
  assert.ok(!daily.includes(SP2+':更:'+DAY1+'*'),'另一週次仍維持 1 次');
});

test('非單字題目會被拒絕',()=>{
  assert.throws(()=>core.keyOf('明天',M1),/單一漢字/);
  assert.throws(()=>core.keyOf('',M1),/單一漢字/);
  assert.throws(()=>core.keyOf('|',M1),/單一漢字/);
});

test('模式前綴格式：合法前綴與非法前綴',()=>{
  for(const ok of ['a','ab','connected','abbrev','speed','speed.w7_hw1','survival','versus2','a'.repeat(24)]){
    assert.equal(core.validPrefix(ok),true,'應合法：'+ok);
  }
  for(const bad of ['','A','1a','_a','a'.repeat(25),'connected.','speed.W7','speed.w7:hw1','connected 更','a:b']){
    assert.equal(core.validPrefix(bad),false,'應非法：'+bad);
  }
});

test('validKey 只接受「前綴:單一漢字」',()=>{
  assert.equal(core.validKey('connected:更'),true);
  assert.equal(core.validKey('speed.w7_hw1:更'),true);
  assert.equal(core.validKey('更'),false,'v2 的鍵必須帶前綴');
  assert.equal(core.validKey('w7_hw1:更'),true,'舊週次前綴仍是合法前綴，只是不再由本版本產生');
  assert.equal(core.validKey('connected:明天'),false);
  assert.equal(core.validKey('connected:'),false);
  assert.equal(core.validKey(':更'),false);
});

test('prefixFor 由模式 id 與週次組出前綴',()=>{
  assert.equal(core.prefixFor('connected'),'connected');
  assert.equal(core.prefixFor('connected',''),'connected');
  assert.equal(core.prefixFor('speed','w7_hw1'),'speed.w7_hw1');
  assert.throws(()=>core.prefixFor('Connected'),/模式代號/);
  assert.throws(()=>core.prefixFor('connected','badweek'),/週次/);
  assert.throws(()=>core.prefixFor('connected','w7_hw1:x'),/週次/);
});

test('掌握清單可供教師報表使用',()=>{
  const map=core.parseProgress(M1+':更:'+DAY1+';'+M1+':中:'+DAY2);
  assert.deepEqual(core.masteredKeys(map),[M1+':中',M1+':更']);
});

test('瀏覽器與 Apps Script 使用的核心內容完全一致',()=>{
  assert.equal(fs.readFileSync('js/mastery-core.js','utf8'),fs.readFileSync('apps-script/MasteryCore.gs','utf8'));
});

// ── 任務 1／2：一輪紀錄組成（buildRound）與提示（summarizeRound） ──

test('buildRound 只送正確的題目，錯誤題略過',()=>{
  const map={};
  const round=core.buildRound([
    {char:'更',correct:true,earned:15},
    {char:'中',correct:false,earned:15},
    {char:'大',correct:true,earned:10}
  ],MODE1,map,DAY1,M1);
  assert.deepEqual(round.map(r=>r.char),['更','大']);
});

test('buildRound：今天還有次數送原分，用完 3 次才送 0',()=>{
  const map=core.parseProgress(M1+':更:'+DAY1+'*3;'+M1+':中:'+DAY1);
  const round=core.buildRound([
    {char:'更',correct:true,earned:15},
    {char:'中',correct:true,earned:12}
  ],MODE1,map,DAY1,M1);
  assert.equal(round.find(r=>r.char==='更').earned,0,'今天已用滿 3 次 → 送 0');
  assert.equal(round.find(r=>r.char==='中').earned,12,'今天還有次數 → 送原分');
});

test('buildRound：昨天得分的字今天可再得分',()=>{
  const map=core.parseProgress(M1+':更:'+DAY2);
  const round=core.buildRound([{char:'更',correct:true,earned:15}],MODE1,map,DAY1,M1);
  assert.equal(round[0].earned,15,'昨天的日期不等於今天，應可再得分');
});

test('buildRound：負分或非數字一律視為 0',()=>{
  const round=core.buildRound([
    {char:'更',correct:true,earned:-5},
    {char:'中',correct:true,earned:'abc'}
  ],MODE1,{},DAY1,M1);
  assert.deepEqual(round.map(r=>r.earned),[0,0]);
});

test('buildRound：空的或非陣列輸入安全回傳空陣列',()=>{
  assert.deepEqual(core.buildRound([],MODE1,{},DAY1,M1),[]);
  assert.deepEqual(core.buildRound(null,MODE1,{},DAY1,M1),[]);
  assert.deepEqual(core.buildRound(undefined,MODE1,{},DAY1,M1),[]);
});

test('summarizeRound：有新增得分字時列出字',()=>{
  const msg=core.summarizeRound(['更','中'],[],{},MODE1,DAY1);
  assert.match(msg,/今日新增/);
  assert.match(msg,/更/);
});

test('summarizeRound：全部都是已得分字時顯示上限提示',()=>{
  const msg=core.summarizeRound([],['更','中'],{},MODE1,DAY1);
  assert.equal(msg,'這模式得分已到上限');
});

test('summarizeRound：沒有得分也沒有忽略時回傳空字串',()=>{
  assert.equal(core.summarizeRound([],[],{},MODE1,DAY1),'');
});


// ── 任務 8：模式二（手速賽）加分核心邏輯 ─────────────────

test('speedRoundScore：10 字賽沿用現行公式 Math.max(20, round(150 - t*2))',()=>{
  assert.equal(core.speedRoundScore(30, 10), 90);   // 150-60
  assert.equal(core.speedRoundScore(50, 10), 50);   // 150-100
  assert.equal(core.speedRoundScore(20, 10), 110);  // 150-40
});

test('speedRoundScore：極快時不超過公式上限，仍受 150 封頂',()=>{
  assert.equal(core.speedRoundScore(0, 10), 150);
  assert.equal(core.speedRoundScore(1, 10), 148);
});

test('speedRoundScore：極慢時保底 20 分，不會出現負分',()=>{
  assert.equal(core.speedRoundScore(65, 10), 20);   // 150-130=20
  assert.equal(core.speedRoundScore(200, 10), 20);  // 保底
  assert.equal(core.speedRoundScore(899, 10), 20);
});

test('speedRoundScore：秒數達 900 視為無效（與後端 bestTime < 900 一致）',()=>{
  assert.equal(core.speedRoundScore(900, 10), 0);
  assert.equal(core.speedRoundScore(1200, 10), 0);
});

test('speedRoundScore：20 字賽為 10 字公式乘 1.8 後四捨五入',()=>{
  assert.equal(core.speedRoundScore(30, 20), Math.round(90 * 1.8));
  assert.equal(core.speedRoundScore(50, 20), Math.round(50 * 1.8));
  // 保底分同樣乘 1.8（現行前端行為：先取 max(20,...) 再乘）
  assert.equal(core.speedRoundScore(200, 20), Math.round(20 * 1.8));
});

test('speedRoundScore：非法輸入安全回傳 0，不拋錯',()=>{
  for (const [t,w] of [[NaN,10],[-1,10],['abc',10],[30,NaN],[30,0],[30,15],[undefined,10]]){
    assert.equal(core.speedRoundScore(t,w),0,'t='+t+' w='+w);
  }
});

test('speedRoundScore：邊界秒數 0 與 900 皆可接受（0 視為有效極速）',()=>{
  assert.equal(core.speedRoundScore(0, 10), 150);
  assert.equal(core.speedRoundScore(899, 10), 20);
});

test('模式二掌握鍵含週次：不同週次同字各自可得分',()=>{
  const w7=core.applyRound([{char:'更',correct:true,earned:90}],{},DAY1,SP);
  assert.equal(w7.earned,90);
  const w8=core.applyRound([{char:'更',correct:true,earned:90}],w7.map,DAY1,'speed.w8_hw1');
  assert.equal(w8.earned,90,'不同週次的同一個字應各自可得分');
  assert.deepEqual(keys(w8.map),['speed.w7_hw1:更','speed.w8_hw1:更']);
});

test('模式二掌握鍵：同一週次同日同字第 4 次才不再計分',()=>{
  const first=core.applyRound([{char:'更',correct:true,earned:90}],{},DAY1,SP);
  const second=core.applyRound([{char:'更',correct:true,earned:45}],first.map,DAY1,SP);
  assert.equal(second.earned,45,'第 2 次仍計分');
  assert.deepEqual(second.newlyScored,['更']);
  assert.equal(core.countOf(second.map,SP+':更',DAY1),2);
  let map=second.map;
  for(let i=0;i<2;i++) map=core.applyRound([{char:'更',correct:true,earned:22}],map,DAY1,SP).map;
  const fifth=core.applyRound([{char:'更',correct:true,earned:22}],map,DAY1,SP);
  assert.equal(fifth.earned,0,'第 4 次之後不再計分');
  assert.deepEqual(fifth.ignored,['更']);
});

test('模式二掌握鍵：跨日後同一週次同字可再得分',()=>{
  const day1=core.applyRound([{char:'更',correct:true,earned:90}],{},DAY1,SP);
  const day2=core.applyRound([{char:'更',correct:true,earned:88}],day1.map,DAY2,SP);
  assert.equal(day2.earned,88,'換日即失效，可再得分');
});

test('模式二與模式一／三的鍵互不干擾',()=>{
  // 模式一用純前綴鍵，模式二再多一層週次，同一天同字兩邊都能得分。
  const m1=core.applyRound([{char:'更',correct:true,earned:10}],{},DAY1,M1);
  const m2=core.applyRound([{char:'更',correct:true,earned:90}],m1.map,DAY1,SP);
  assert.equal(m1.earned,10);
  assert.equal(m2.earned,90);
  assert.deepEqual(keys(m2.map),[M1+':更',SP+':更']);
});

test('模式二掌握鍵會被抽屜壓縮格式正確保存與還原',()=>{
  let map={};
  map=core.applyRound([{char:'更',correct:true,earned:90}],map,DAY1,SP).map;
  map=core.applyRound([{char:'中',correct:true,earned:80}],map,DAY1,'speed.w8_hw1').map;
  const text=core.serializeDrawer(map,DAY1);
  const parsed=core.parseDrawer(text);
  assert.deepEqual(keys(parsed.map),['speed.w7_hw1:更','speed.w8_hw1:中']);
  assert.equal(parsed.map['speed.w7_hw1:更'],DAY1);
});

test('週次字串非法時 prefixFor 會拋錯，speedRoundScore 不受影響',()=>{
  assert.equal(core.speedRoundScore(30,10),90);
  assert.throws(()=>core.prefixFor('speed','badweek'),/週次/);
  assert.throws(()=>core.applyRound([{char:'更',correct:true,earned:90}],{},DAY1,'Bad'),/模式前綴/);
});

// ── 任務 8b：模式二逐字分攤（防「整場重刷」刷分） ──────────

test('speedRoundEarned：整場首答時總和等於 speedRoundScore',()=>{
  for (const [t,count] of [[30,10],[50,10],[200,10],[30,20],[200,20]]){
    const total=core.speedRoundScore(t,count);
    const list=core.speedRoundEarned(t,count);
    assert.equal(list.length,count);
    assert.equal(list.reduce((a,b)=>a+b,0),total,'t='+t+' count='+count);
  }
});

test('speedRoundEarned：每個字都拿到整數分，不會出現小數',()=>{
  core.speedRoundEarned(33,10).forEach(v=>{
    assert.equal(Number.isInteger(v),true);
    assert.ok(v>=0);
  });
});

test('speedRoundEarned：10 字 90 分時，正常情況下每字 9 分',()=>{
  assert.deepEqual(core.speedRoundEarned(30,10),Array(10).fill(9));
});

test('speedRoundEarned：除不盡時餘數補到前面的字，總和仍精確',()=>{
  const list=core.speedRoundEarned(34,10); // 150-68=82 → 82/10
  assert.equal(list.reduce((a,b)=>a+b,0),82);
  assert.equal(Math.max(...list)-Math.min(...list)<=1,true,'每字差距不得超過 1');
});

test('speedRoundEarned：非法輸入回傳全 0 陣列（長度仍為題量）',()=>{
  assert.deepEqual(core.speedRoundEarned(NaN,10),Array(10).fill(0));
  assert.deepEqual(core.speedRoundEarned(30,15),Array(15).fill(0));
});
