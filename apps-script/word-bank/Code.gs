/** 帳號 B 專用：與字庫試算表綁定，另加入 WordBankCore.gs。不得貼到成績後端。 */
const WB_SHEETS = {
  '平台設定': ['設定','值'],
  '周次設定': ['學年','周次','標題','開始時間','結束時間','狀態'],
  '字庫內容': ['學年','周次','組別','字詞清單','倉頡碼清單','字根預覽']
};
const WB_LEGACY_SHEETS = {
  '周次設定': ['周次','標題','開始時間','結束時間','狀態'],
  '字庫內容': ['周次','組別','字詞清單','倉頡碼清單','字根預覽']
};
const WB_CACHE = 'p5_mode2_word_bank_v1';
function setupWordBank() {
  const book=SpreadsheetApp.getActiveSpreadsheet();
  if(!book)throw new Error('請從字庫試算表的擴充功能開啟 Apps Script。');
  book.setSpreadsheetTimeZone('Asia/Hong_Kong');
  PropertiesService.getScriptProperties().setProperty('WORD_BANK_SPREADSHEET_ID',book.getId());
  Object.keys(WB_SHEETS).forEach(name=>{
    const sheet=book.getSheetByName(name)||book.insertSheet(name);
    if(sheet.getLastRow()===0){sheet.getRange(1,1,1,WB_SHEETS[name].length).setValues([WB_SHEETS[name]]);sheet.setFrozenRows(1);}
    if(name==='平台設定'&&sheet.getLastRow()===1)sheet.getRange(2,1,1,2).setValues([['學年','2026/2027']]);
  });
  upgradeYearColumns_(book,activeSchoolYear_(book));
  book.getSheetByName('周次設定').getRange('D:E').setNumberFormat('@');
  book.getSheetByName('字庫內容').getRange('D:F').setNumberFormat('@');
  clearWordBankCache();
}
function onOpen(){SpreadsheetApp.getUi().createMenu('模式二字庫').addItem('初始化／升級工作表','setupWordBank').addItem('升級現有字庫為跨學年格式','upgradeWordBankSchema').addItem('檢查已發布字庫／更新快取','checkWordBank').addToUi();}
function activeSchoolYear_(book){
  const sheet=book.getSheetByName('平台設定');
  if(!sheet)throw new Error('缺少工作表：平台設定');
  const rows=sheet.getDataRange().getDisplayValues();
  const match=rows.slice(1).find(row=>String(row[0]||'').trim()==='學年');
  const value=String(match&&match[1]||'').trim();
  if(!/^(\d{4})\/(\d{4})$/.test(value)||Number(value.slice(5))!==Number(value.slice(0,4))+1)throw new Error('平台設定的學年格式不正確。');
  return value;
}
function sameHeaders_(actual,expected){return expected.every((header,index)=>String(actual[index]||'').trim()===header);}
function upgradeYearColumns_(book,schoolYear){
  Object.keys(WB_LEGACY_SHEETS).forEach(name=>{
    const sheet=book.getSheetByName(name);
    if(!sheet)throw new Error('缺少工作表：'+name);
    const width=Math.max(sheet.getLastColumn(),WB_SHEETS[name].length);
    const headers=sheet.getRange(1,1,1,width).getDisplayValues()[0];
    if(sameHeaders_(headers,WB_SHEETS[name]))return;
    if(!sameHeaders_(headers,WB_LEGACY_SHEETS[name]))throw new Error(name+' 欄位標題不正確，未進行自動升級。');
    sheet.insertColumnBefore(1);
    sheet.getRange(1,1).setValue('學年');
    const count=sheet.getLastRow()-1;
    if(count>0)sheet.getRange(2,1,count,1).setValues(Array.from({length:count},()=>[schoolYear]));
  });
}
function upgradeWordBankSchema(){
  const book=SpreadsheetApp.getActiveSpreadsheet();
  if(!book)throw new Error('請從字庫試算表的「擴充功能 → Apps Script」開啟。');
  const schoolYear=activeSchoolYear_(book);
  upgradeYearColumns_(book,schoolYear);
  book.getSheetByName('周次設定').getRange('D:E').setNumberFormat('@');
  book.getSheetByName('字庫內容').getRange('D:F').setNumberFormat('@');
  clearWordBankCache();
  SpreadsheetApp.getUi().alert('跨學年格式已就緒；原有資料已標示為 '+schoolYear+'，沒有刪除字庫。');
}
function onEdit(e){
  if(!e||!e.range)return;
  const sheet=e.range.getSheet(),name=sheet.getName();
  if(!WB_SHEETS[name])return;
  if(name==='字庫內容'){
    const hasYear=sheet.getRange(1,1).getDisplayValue()==='學年';
    const charsColumn=hasYear?4:3, codesColumn=charsColumn+1;
    const firstColumn=e.range.getColumn(),lastColumn=firstColumn+e.range.getNumColumns()-1;
    if(firstColumn<=codesColumn&&lastColumn>=charsColumn){
      const firstRow=Math.max(2,e.range.getRow()),lastRow=e.range.getRow()+e.range.getNumRows()-1;
      if(lastRow>=firstRow)refreshWordPreviews_(sheet,firstRow,lastRow-firstRow+1);
    }
  }
  clearWordBankCache();
}
function refreshWordPreviews_(sheet,firstRow,rowCount){
  const hasYear=sheet.getRange(1,1).getDisplayValue()==='學年';
  const charsColumn=hasYear?4:3, previewColumn=charsColumn+2;
  const inputs=sheet.getRange(firstRow,charsColumn,rowCount,2).getDisplayValues();
  const previews=inputs.map(row=>{
    if(!String(row[0]||'').trim()&&!String(row[1]||'').trim())return [''];
    try{return [WordBankCore.preview(row[0],row[1])];}
    catch(error){return ['⚠ '+error.message];}
  });
  sheet.getRange(firstRow,previewColumn,rowCount,1).setValues(previews);
}
function clearWordBankCache(){CacheService.getScriptCache().remove(WB_CACHE);}
function readWordBank_(){
  const id=PropertiesService.getScriptProperties().getProperty('WORD_BANK_SPREADSHEET_ID');
  if(!id)throw new Error('請先執行 setupWordBank。');
  const book=SpreadsheetApp.openById(id);
  const tables=Object.keys(WB_SHEETS).map(name=>{const s=book.getSheetByName(name);if(!s)throw new Error('缺少工作表：'+name);return s.getDataRange().getDisplayValues();});
  const result=WordBankCore.build(tables[0],tables[1],tables[2]);
  const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(result),Utilities.Charset.UTF_8);
  return Object.assign({status:'success',version:Utilities.base64EncodeWebSafe(hash),generatedAt:new Date().toISOString()},result);
}
function checkWordBank(){
  clearWordBankCache();
  try{const data=readWordBank_();SpreadsheetApp.getUi().alert('檢查通過：'+data.schoolYear+'，'+Object.keys(data.weeklyBanks).length+' 組已發布字庫。');}
  catch(error){SpreadsheetApp.getUi().alert('檢查失敗：'+error.message);}
}
function doGet(e){
  let result;
  try{
    if(e&&e.parameter&&e.parameter.action&&e.parameter.action!=='get_word_bank')throw new Error('不支援的查詢。');
    const cache=CacheService.getScriptCache();const cached=cache.get(WB_CACHE);
    if(cached)result=JSON.parse(cached);
    else{result=readWordBank_();const json=JSON.stringify(result);if(Utilities.newBlob(json).getBytes().length<95000){try{cache.put(WB_CACHE,json,60);}catch(error){/* 快取不可用仍回傳有效資料 */}}}
  }catch(error){result={status:'error',message:error.message};}
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
