const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function core(){return globalCore;}
let globalCore;
test.before(()=>{const s={};vm.runInNewContext(fs.readFileSync('js/word-bank-core.js','utf8'),s);globalCore=s.WordBankCore;});
function fixture(){return {settings:[['設定','值'],['學年','2026/2027']],weeks:[['學年','周次','標題','開始時間','結束時間','狀態'],['2026/2027','w7','第7周','2026-10-12T00:00:00+08:00','2026-10-18T23:59:59+08:00','已發布']],words:[['學年','周次','組別','字詞清單','倉頡碼清單','字根預覽'],...Array.from({length:4},(_,i)=>['2026/2027','w7',String(i+1),'明','AB','明=日月'])]};}
function build(f){return core().build(f.settings,f.weeks,f.words);}
test('published week creates all four compatible banks',()=>{const p=build(fixture());assert.equal(p.schoolYear,'2026/2027');assert.equal(Object.keys(p.weeklyBanks).length,4);assert.equal(p.weeklyBanks.w7_hw1.words[0].full,'日月 (AB)');});
test('draft is excluded',()=>{const f=fixture();f.weeks[1][5]='草稿';assert.equal(Object.keys(build(f).weeklyBanks).length,0);});
test('archived week is retained in the sheet but excluded from downloads',()=>{const f=fixture();f.weeks[1][5]='已封存';assert.equal(Object.keys(build(f).weeklyBanks).length,0);});
test('same week number can be retained across years and only the active year is downloaded',()=>{const f=fixture();f.weeks.push(['2025/2026','w7','舊第7周','2025-10-13T00:00:00+08:00','2025-10-19T23:59:59+08:00','已發布']);for(let i=1;i<=4;i++)f.words.push(['2025/2026','w7',String(i),'舊','Q','舊=手']);const p=build(f);assert.equal(Object.keys(p.weeklyBanks).length,4);assert.equal(p.weeklyBanks.w7_hw1.words[0].char,'明');});
test('valid empty year is authoritative',()=>{const f=fixture();f.weeks.splice(1);f.words.splice(1);assert.equal(Object.keys(build(f).weeklyBanks).length,0);});
test('missing group cannot publish',()=>{const f=fixture();f.words.pop();assert.throws(()=>build(f),/四組/);});
test('invalid code date year and duplicate group rejected',()=>{for(const change of [f=>f.words[1][4]='ZZ',f=>f.weeks[1][3]='2026-02-30 12:00',f=>f.settings[1][1]='2026/2028',f=>f.words.push(f.words[1])]){const f=fixture();change(f);assert.throws(()=>build(f));}});
test('unknown week reference rejected',()=>{const f=fixture();f.words[1][1]='w99';assert.throws(()=>build(f));});
test('untrusted response with invalid word rejected',()=>{const p=build(fixture());p.status='success';p.version='x';p.weeklyBanks.w7_hw1.words[0].keys=['Z'];assert.throws(()=>core().validate(p));});

test('dual lists accept common separators and derive root preview',()=>{const f=fixture();f.words[1][3]='明，天\n地 枝';f.words[1][4]='AB,MK\nGPD DJE';const bank=build(f).weeklyBanks.w7_hw1;assert.deepEqual(Array.from(bank.words,w=>w.char),['明','天','地','枝']);assert.equal(core().preview(f.words[1][3],f.words[1][4]),'明=日月，天=一大，地=土心木，枝=木十水');});

test('mismatched lists and conflicting code are rejected',()=>{for(const change of [f=>{f.words[1][3]='明 天';f.words[1][4]='AB';},f=>{f.words[1][3]='明 明';f.words[1][4]='AB AC';}]){const f=fixture();change(f);assert.throws(()=>build(f));}});

test('identical repeated word retains original weighting',()=>{const f=fixture();f.words[1][3]='明 明';f.words[1][4]='AB AB';assert.equal(build(f).weeklyBanks.w7_hw1.words.length,2);});

function csv(file){return fs.readFileSync(file,'utf8').replace(/^\ufeff/,'').trim().split(/\r?\n/).map(line=>Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g),m=>m[1].replace(/""/g,'"')));}
test('all sixteen dual-list banks match migration manifest counts and code order',()=>{const table=csv('migration/mode2/字庫內容.csv'),p=core().build(csv('migration/mode2/平台設定.csv'),csv('migration/mode2/周次設定.csv'),table);const manifest=JSON.parse(fs.readFileSync('migration/mode2/manifest.json','utf8'));assert.equal(Object.keys(p.weeklyBanks).length,16);assert.equal(Object.values(p.weeklyBanks).reduce((n,b)=>n+b.words.length,0),640);for(const g of manifest.groups)assert.equal(p.weeklyBanks[g.key].words.length,g.count);for(const r of table.slice(1)){const chars=r[3].split(/\s+/),codes=r[4].split(/\s+/),bank=p.weeklyBanks[r[1]+'_hw'+r[2]];assert.equal(bank.words.length,chars.length);chars.forEach((char,i)=>{assert.equal(bank.words[i].char,char);assert.equal(bank.words[i].keys.join(''),codes[i]);});}assert.equal(core().validate({...p,status:'success',version:'migration'}).schoolYear,'2026/2027');});
test('browser and Apps Script validator stay identical',()=>assert.equal(fs.readFileSync('js/word-bank-core.js','utf8'),fs.readFileSync('apps-script/word-bank/WordBankCore.gs','utf8')));
