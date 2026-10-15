const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');

function csv(file){return fs.readFileSync(file,'utf8').replace(/^\ufeff/,'').trim().split(/\r?\n/).map(line=>Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g),m=>m[1].replace(/""/g,'"')));}

function env(){
  const cache=new Map(),tables={},sheets={};
  for(const name of ['平台設定','周次設定','字庫內容'])tables[name]=csv('migration/mode2/'+name+'.csv');
  for(const name of Object.keys(tables)){
    const table=tables[name];
    sheets[name]={
      getName:()=>name,
      getLastRow:()=>table.length,
      getLastColumn:()=>Math.max(0,...table.map(row=>row.length)),
      getDataRange:()=>({getDisplayValues:()=>table}),
      insertColumnBefore:column=>table.forEach(row=>row.splice(column-1,0,'')),
      getRange:(row,column,numRows=1,numColumns=1)=>({
        getDisplayValue:()=>String(table[row-1]?.[column-1]??''),
        getDisplayValues:()=>table.slice(row-1,row-1+numRows).map(values=>values.slice(column-1,column-1+numColumns)),
        setValue:value=>{table[row-1]=table[row-1]||[];table[row-1][column-1]=value;},
        setValues:values=>{values.forEach((valuesRow,rowOffset)=>valuesRow.forEach((value,columnOffset)=>{table[row-1+rowOffset]=table[row-1+rowOffset]||[];table[row-1+rowOffset][column-1+columnOffset]=value;}));},
        setNumberFormat:()=>{}
      }),
      setFrozenRows:()=>{}
    };
  }
  const book={getId:()=> 'test-book',getSheetByName:name=>sheets[name],insertSheet:()=>{throw new Error('unexpected insert');},setSpreadsheetTimeZone:()=>{}};
  const properties=new Map();
  const s={
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||'test-book',setProperty:(key,value)=>properties.set(key,value)})},
    SpreadsheetApp:{openById:()=>book,getActiveSpreadsheet:()=>book,getUi:()=>({alert:()=>{},createMenu:()=>({addItem(){return this;},addToUi(){}})})},
    CacheService:{getScriptCache:()=>({get:key=>cache.get(key),put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()],base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),newBlob:text=>({getBytes:()=>Buffer.from(text)})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>text})}
  };
  vm.createContext(s);
  for(const file of ['apps-script/word-bank/WordBankCore.gs','apps-script/word-bank/Code.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),s);
  return {s,cache,tables,sheets};
}

test('dedicated GET returns sixteen banks and no student or score fields',()=>{const {s}=env();const p=JSON.parse(s.doGet({parameter:{action:'get_word_bank'}}));assert.equal(p.status,'success');assert.equal(Object.keys(p.weeklyBanks).length,16);assert.equal(p.schoolYear,'2026/2027');assert.equal(p.combatLeaderboard,undefined);assert.equal(s.doPost,undefined);});
test('editing settings invalidates cache and empty new year remains successful',()=>{const {s,tables}=env();s.doGet({});tables['平台設定'][1][1]='2027/2028';tables['周次設定'].splice(1);tables['字庫內容'].splice(1);s.onEdit({range:{getSheet:()=>({getName:()=> '平台設定'})}});const p=JSON.parse(s.doGet({}));assert.equal(p.schoolYear,'2027/2028');assert.equal(p.status,'success');assert.equal(Object.keys(p.weeklyBanks).length,0);});
test('invalid action and invalid published data return errors',()=>{const {s,tables}=env();assert.equal(JSON.parse(s.doGet({parameter:{action:'get_data'}})).status,'error');tables['字庫內容'][1][4]='ZZ';assert.equal(JSON.parse(s.doGet({})).status,'error');});
test('editing either input list refreshes the derived root preview',()=>{const {s,tables,sheets}=env();tables['字庫內容'][1][3]='明 天';tables['字庫內容'][1][4]='AB MK';s.onEdit({range:{getSheet:()=>sheets['字庫內容'],getRow:()=>2,getNumRows:()=>1,getColumn:()=>4,getNumColumns:()=>2}});assert.equal(tables['字庫內容'][1][5],'明=日月，天=一大');});
test('new backend remains readable while the live sheet still uses the legacy columns',()=>{const {s,tables}=env();tables['周次設定'].forEach(row=>row.shift());tables['字庫內容'].forEach(row=>row.shift());const p=JSON.parse(s.doGet({}));assert.equal(p.status,'success');assert.equal(Object.keys(p.weeklyBanks).length,16);});
test('one-time schema upgrade adds active school year without deleting existing banks',()=>{const {s,tables}=env();tables['周次設定'].forEach(row=>row.shift());tables['字庫內容'].forEach(row=>row.shift());s.upgradeWordBankSchema();assert.deepEqual(tables['周次設定'][0],['學年','周次','標題','開始時間','結束時間','狀態']);assert.deepEqual(tables['字庫內容'][0],['學年','周次','組別','字詞清單','倉頡碼清單','字根預覽']);assert.ok(tables['周次設定'].slice(1).every(row=>row[0]==='2026/2027'));assert.ok(tables['字庫內容'].slice(1).every(row=>row[0]==='2026/2027'));const p=JSON.parse(s.doGet({}));assert.equal(Object.keys(p.weeklyBanks).length,16);});
