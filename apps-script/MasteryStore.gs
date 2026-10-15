/* 掌握進度雙層儲存：Script Properties 抽屜＝加速器（鎖內讀寫），
   Sheet「掌握進度」＝真相（鎖外盡力寫入，失敗只回報，交由每日 06:00 重建修正）。
   所有寫入函式只回報成功與否、不拋錯，以免單一儲存層故障阻斷學生交卷。

   掌握進度表採「長格式」：每生固定 MODE_ROWS_PER_STUDENT 列，每列一個「模式前綴」。
   ★ 固定列區塊讓交卷時可以 O(1) 定位（不必搜尋整張表）；
   ★ 表頭 schema 與模式數量無關，加新模式時完全不需改表頭。
   「當日進度」欄是自成一體的序列化片段（鍵含模式前綴），可單獨解析，
   故即使列被搬移或部分損毀，仍能逐列還原。 */
var MasteryStore = (function () {
  'use strict';
  var SHEET_NAME = '掌握進度';
  var HEADERS = ['班別', '學號', '模式', '當日進度', '最後更新日', '更新時間'];
  // 每位學生配置的列數。一天內的前綴數＝已玩的主線站數 ＋ 手速賽週次數，
  // 主線 7 站＋每週字庫 4 組已是上限，16 留有餘裕；超出時只保留前 16 個並回報。
  var MODE_ROWS_PER_STUDENT = 16;
  var KEY_PREFIX = 'mb:';

  function drawerKey(cls, num) { return KEY_PREFIX + cls + '_' + num; }

  /* 該生列區塊的第一列（1 起算）。與「成績總覽」的每生一列不同，這裡每生 16 列。 */
  function firstRow(cls, num) {
    return 2 + (cls.charCodeAt(2) - 'A'.charCodeAt(0)) * 36 * MODE_ROWS_PER_STUDENT
      + (num - 1) * MODE_ROWS_PER_STUDENT;
  }

  /* 讀抽屜；遺失或損毀時回傳空抽屜，由呼叫方決定是否自 Sheet 重建。 */
  function read(cls, num) {
    return MasteryCore.parseDrawer(props_().getProperty(drawerKey(cls, num)));
  }

  /* 抽出該生「今天」的進度，依模式前綴分組。 */
  function groupToday(map, today) {
    var groups = {};
    Object.keys(map || {}).forEach(function (key) {
      if (MasteryCore.entryDate(map[key]) !== today) return;
      var at = key.indexOf(':');
      if (at <= 0) return;
      var prefix = key.slice(0, at);
      if (!groups[prefix]) groups[prefix] = {};
      groups[prefix][key] = map[key];
    });
    return groups;
  }

  /* 組出某生整段列區塊（固定 MODE_ROWS_PER_STUDENT 列）。
     供交卷時的增量寫入與重建時的全表重寫共用，確保兩條路徑產出一致。 */
  function sheetRows(cls, num, map, today, stamp) {
    var groups = groupToday(map, today);
    var prefixes = Object.keys(groups).sort();
    if (prefixes.length > MODE_ROWS_PER_STUDENT) {
      console.warn(SHEET_NAME + '：' + cls + ' ' + num + ' 今天有 ' + prefixes.length
        + ' 個模式前綴，超出 ' + MODE_ROWS_PER_STUDENT + ' 列，僅保留前 ' + MODE_ROWS_PER_STUDENT + ' 個。');
      prefixes = prefixes.slice(0, MODE_ROWS_PER_STUDENT);
    }
    var rows = [];
    for (var i = 0; i < MODE_ROWS_PER_STUDENT; i++) {
      var prefix = prefixes[i];
      if (!prefix) { rows.push([cls, num, '', '', '', '']); continue; }
      rows.push([cls, num, prefix, MasteryCore.serializeDaily(groups[prefix], today), today, stamp]);
    }
    return rows;
  }

  /* 抽屜遺失時以 Sheet「掌握進度」為真相重建（S6）。
     只還原「今天」的得分，與抽屜本身只保留當天的設計一致；更早的日期由重建流程處理。 */
  function readFromSheet(cls, num, today) {
    try {
      var sheet = book_().getSheetByName(SHEET_NAME);
      if (!sheet || sheet.getLastRow() < firstRow(cls, num)) return MasteryCore.emptyDrawer();
      var rows = sheet.getRange(firstRow(cls, num), 1, MODE_ROWS_PER_STUDENT, HEADERS.length).getValues();
      var map = {};
      rows.forEach(function (row) {
        if (!row || row[0] !== cls || Number(row[1]) !== num) return;
        var part = MasteryCore.parseProgress(row[3]);
        Object.keys(part).forEach(function (key) {
          // 只保留當天；其他日期不確定為未得分，交由重建修正，避免誤判為已得分。
          if (MasteryCore.entryDate(part[key]) === today) map[key] = part[key];
        });
      });
      return { version: 'v2', date: today, map: map };
    } catch (error) {
      console.error('自 Sheet 重建抽屜失敗，改以空抽屜繼續：' + error.message);
      return MasteryCore.emptyDrawer();
    }
  }

  /* 寫抽屜（鎖內）。容量等錯誤只回報，呼叫方應改為只寫 Sheet、不阻斷學生。 */
  function writeDrawer(cls, num, drawer, today) {
    var value = MasteryCore.serializeDrawer(drawer.map, today);
    try {
      props_().setProperty(drawerKey(cls, num), value);
      return { ok: true, value: value };
    } catch (error) {
      console.error('進度抽屜寫入失敗（可能已達容量上限），改為只寫 Sheet：' + error.message);
      return { ok: false, value: value, error: error.message };
    }
  }

  /* 寫 Sheet 該生的列區塊（鎖外，盡力）。失敗只回報，交由每日重建修正。 */
  function writeSheet(cls, num, drawer, today, receivedAt) {
    try {
      var sheet = ensureSheet_(book_(), SHEET_NAME, HEADERS);
      var stamp = receivedAt && typeof receivedAt.toISOString === 'function' ? receivedAt.toISOString() : new Date().toISOString();
      var rows = sheetRows(cls, num, drawer.map, today, stamp);
      sheet.getRange(firstRow(cls, num), 1, rows.length, HEADERS.length).setValues(rows);
      return { ok: true };
    } catch (error) {
      console.error('掌握進度 Sheet 寫入失敗，交由重建修正：' + error.message);
      return { ok: false, error: error.message };
    }
  }

  /* 抽屜用量統計，供教師選單檢查是否逼近容量上限。 */
  function usage() {
    var all = props_().getProperties(), keys = 0, chars = 0;
    Object.keys(all).forEach(function (name) {
      if (name.indexOf(KEY_PREFIX) === 0) { keys++; chars += name.length + String(all[name]).length; }
    });
    return { keys: keys, chars: chars };
  }

  return {
    SHEET_NAME: SHEET_NAME,
    HEADERS: HEADERS,
    MODE_ROWS_PER_STUDENT: MODE_ROWS_PER_STUDENT,
    KEY_PREFIX: KEY_PREFIX,
    drawerKey: drawerKey,
    firstRow: firstRow,
    sheetRows: sheetRows,
    read: read,
    readFromSheet: readFromSheet,
    writeDrawer: writeDrawer,
    writeSheet: writeSheet,
    usage: usage
  };
}());

// Node 測試以 require 載入時匯出；Apps Script 沒有 module，整段略過。
if (typeof module !== 'undefined' && module.exports) module.exports = MasteryStore;
