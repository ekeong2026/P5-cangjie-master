/* 模式二資料驗證；與 Apps Script WordBankCore.gs 使用相同內容。 */
var WordBankCore = (function () {
  'use strict';
  var radicals = '日月金木水火土竹戈十大中一弓人心手口尸廿山女田難卜';
  function fail(message) { throw new Error(message); }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function year(v) { var s=text(v), m=/^(\d{4})\/(\d{4})$/.exec(s); if(!m || +m[2]!==+m[1]+1) fail('學年須為連續年份，例如 2026/2027。'); return s; }
  function date(v) {
    var s=text(v), m=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\+08:00)?$/.exec(s);
    if(!m) fail('日期須為 YYYY-MM-DD HH:mm 或香港時區 ISO 格式。');
    var parts=m.slice(1,7).map(function(x){return +(x||0);});
    var d=new Date(Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]));
    if(d.getUTCFullYear()!==parts[0] || d.getUTCMonth()!==parts[1]-1 || d.getUTCDate()!==parts[2] || d.getUTCHours()!==parts[3] || d.getUTCMinutes()!==parts[4] || d.getUTCSeconds()!==parts[5]) fail('日期不存在或時間無效。');
    return s.slice(0,10)+'T'+m[4]+':'+m[5]+':'+(m[6]||'00')+'+08:00';
  }
  function rows(table, headers) {
    if(!Array.isArray(table)||!table.length||headers.some(function(h,i){return text(table[0][i])!==h;})) fail('欄位標題不正確：'+headers.join('、'));
    return table.slice(1).filter(function(row){return row.some(function(v){return text(v)!=='';});});
  }
  function versionedRows(table, modernHeaders, legacyHeaders, activeYear) {
    if(Array.isArray(table)&&table.length&&modernHeaders.every(function(h,i){return text(table[0][i])===h;})) return rows(table,modernHeaders);
    if(Array.isArray(table)&&table.length&&legacyHeaders.every(function(h,i){return text(table[0][i])===h;})) {
      return rows(table,legacyHeaders).map(function(row){return [activeYear].concat(row);});
    }
    fail('欄位標題不正確：'+modernHeaders.join('、'));
  }
  function word(char,code) {
    char=text(char);code=text(code).toUpperCase();
    if(Array.from(char).length!==1 || !/^[A-Y]{1,5}$/.test(code)) fail('字詞須為一個字，倉頡碼須為 A–Y 的 1–5 個字母。');
    var keys=code.split(''), codes=keys.map(function(k){return radicals[k.charCodeAt(0)-65];});
    var full=codes.join('')+' ('+code+')';
    return {char:char,keys:keys,codes:codes,full:full,secret:char+'：'+full};
  }
  function wordList(chars,codes) {
    var charList=Array.from(text(chars).replace(/[\s,，;；]+/g,''));
    var codeList=text(codes).split(/[\s,，;；]+/).filter(function(v){return v!=='';});
    if(!charList.length || charList.length!==codeList.length) fail('字詞清單與倉頡碼清單的數量必須相同。');
    var seen={};
    return charList.map(function(char,i){
      var w=word(char,codeList[i]), code=w.keys.join('');
      if(seen[w.char]&&seen[w.char]!==code)fail('同字不同碼：'+w.char);
      seen[w.char]=code;return w;
    });
  }
  function preview(chars,codes) { return wordList(chars,codes).map(function(w){return w.char+'='+w.codes.join('');}).join('，'); }
  function build(settings,weeks,words) {
    var config=Object.create(null);
    rows(settings,['設定','值']).forEach(function(r){var k=text(r[0]);if(Object.prototype.hasOwnProperty.call(config,k))fail('設定重複：'+k);config[k]=text(r[1]);});
    var schoolYear=year(config['學年']), map=Object.create(null), banks={};
    versionedRows(weeks,['學年','周次','標題','開始時間','結束時間','狀態'],['周次','標題','開始時間','結束時間','狀態'],schoolYear).forEach(function(r){
      var rowYear=year(r[0]),key=text(r[1]),state=text(r[5]),id=rowYear+'|'+key;
      if(!/^w\d{1,2}$/.test(key)||map[id])fail('學年及周次無效或重複：'+id);
      if(state!=='草稿'&&state!=='已發布'&&state!=='已封存')fail('狀態須為草稿、已發布或已封存。');
      var wk={schoolYear:rowYear,week:key,title:text(r[2]),published:rowYear===schoolYear&&state==='已發布',groups:[[],[],[],[]]};map[id]=wk;
      if(wk.published){wk.start=date(r[3]);wk.end=date(r[4]);if(!wk.title||Date.parse(wk.start)>Date.parse(wk.end))fail('標題或日期範圍不正確。');}
    });
    versionedRows(words,['學年','周次','組別','字詞清單','倉頡碼清單','字根預覽'],['周次','組別','字詞清單','倉頡碼清單','字根預覽'],schoolYear).forEach(function(r){
      var rowYear=year(r[0]);if(rowYear!==schoolYear)return;
      var id=rowYear+'|'+text(r[1]),wk=map[id];if(!wk)fail('字庫引用不存在的學年及周次：'+id);
      if(!wk.published)return;
      var group=Number(r[2]);
      if(!Number.isInteger(group)||group<1||group>4)fail('組別必須是 1–4。');
      if(wk.groups[group-1].length)fail(wk.week+' 第'+group+'組重複。');
      wk.groups[group-1]=wordList(r[3],r[4]);
    });
    Object.values(map).filter(function(w){return w.published;}).forEach(function(w){
      if(w.groups.some(function(g){return !g.length;}))fail(w.week+' 須有完整四組字庫。');
      w.groups.forEach(function(g,i){var k=w.week+'_hw'+(i+1);banks[k]={key:k,week:w.week,weekName:w.title,hwName:'功課'+(i+1),title:w.title+'功課'+(i+1),startDate:w.start,endDate:w.end,dateRange:w.start+' - '+w.end,words:g};});
    });
    return {schoolYear:schoolYear,weeklyBanks:banks};
  }
  function validate(payload) {
    if(!payload || payload.status!=='success'||typeof payload.version!=='string'||!payload.version||!payload.weeklyBanks||Array.isArray(payload.weeklyBanks)||typeof payload.weeklyBanks!=='object')fail('字庫接口格式不正確。');
    var schoolYear=year(payload.schoolYear),weeks={},banks={};
    Object.keys(payload.weeklyBanks).forEach(function(k){
      var b=payload.weeklyBanks[k],m=/^(w\d{1,2})_hw([1-4])$/.exec(k);
      if(!m||!b||b.week!==m[1]||b.key!==k||typeof b.title!=='string'||!b.title||!Array.isArray(b.words)||!b.words.length)fail('字庫格式不正確：'+k);
      var start=date(b.startDate),end=date(b.endDate);if(Date.parse(start)>Date.parse(end))fail('字庫日期不正確。');
      var wk=weeks[m[1]];if(wk&&(wk.start!==start||wk.end!==end))fail('同周日期不一致。');
      if(!wk)wk=weeks[m[1]]={start:start,end:end,count:0};wk.count++;
      var seen={};var list=b.words.map(function(w){
        if(!w||!Array.isArray(w.keys))fail('字碼格式不正確。');var normalized=word(w.char,w.keys.join(''));
        if(seen[normalized.char]&&seen[normalized.char]!==normalized.keys.join(''))fail('同字不同碼。');seen[normalized.char]=normalized.keys.join('');return normalized;
      });
      banks[k]={key:k,week:m[1],weekName:text(b.weekName)||('第'+m[1].slice(1)+'周'),title:b.title,hwName:'功課'+m[2],startDate:start,endDate:end,dateRange:start+' - '+end,words:list};
    });
    Object.values(weeks).forEach(function(w){if(w.count!==4)fail('須有完整四組字庫。');});
    return {status:'success',schoolYear:schoolYear,version:payload.version,weeklyBanks:banks};
  }
  return {build:build,validate:validate,preview:preview};
}());
