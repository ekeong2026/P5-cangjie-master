/**
 * 一次性工具：清除測試資料（不屬於正式後端，用完請刪除整個檔案）
 * ────────────────────────────────────────────────────────────
 * 用途：刪除「遊戲紀錄」中測試帳號留下的資料列。掌握進度與成績總覽
 *       隨後由教師選單重建，不在此腳本處理。
 *
 * 使用步驟：
 *   1. 先備份：在 Google 試算表「檔案 → 建立副本」，留存一份。
 *   2. 把本檔內容貼進 Apps Script 編輯器（新增一個 .gs 檔案）。
 *   3. 先執行 cleanupTestData_dryRun()  ← 只列清單，不刪任何東西。
 *   4. 核對清單無誤後，執行 cleanupTestData_apply()。
 *   5. 回到試算表執行「打字遊戲 → 更新成績總覽」及「更新掌握進度」。
 *   6. 刪除本檔（不要部署它；它不該留在正式專案裡）。
 *
 * ⚠️ 這是不可逆操作。Git 無法還原試算表，只有步驟 1 的副本可以。
 */

/** 要清除的測試帳號。新增測試帳號時改這裡。 */
var CLEANUP_TEST_STUDENTS = [
  { cls: 'P5A', num: 1 },
  { cls: 'P5F', num: 36 }
];

/** 只做檢查與列表，不刪除。 */
function cleanupTestData_dryRun() {
  return cleanupTestData_(false);
}

/** 實際刪除。 */
function cleanupTestData_apply() {
  return cleanupTestData_(true);
}

/**
 * @param {boolean} apply true 才真的刪除；false 只回報。
 * @return {Object} 統計與明細。
 */
function cleanupTestData_(apply) {
  var sheet = book_().getSheetByName(LOG_SHEET);
  if (!sheet) throw new Error('找不到「' + LOG_SHEET + '」工作表，請先執行 setup。');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { apply: apply, deleted: 0, message: '遊戲紀錄沒有資料列。' };

  // 只讀取需要的欄位：請求編號(1)、班別(4)、學號(5)、模式(6)、得分(7)、完成時間(13)
  var width = Math.max(LOG_HEADERS.length, 13);
  var rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();

  var hitRows = [];      // 1-based 實際列號
  var detail = [];
  var modeCount = {}, prefixCount = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var cls = String(row[3] == null ? '' : row[3]).trim();
    var num = Number(row[4]);
    var matched = CLEANUP_TEST_STUDENTS.some(function (t) { return t.cls === cls && t.num === num; });
    if (!matched) continue;

    var rowNo = i + 2;
    hitRows.push(rowNo);
    var rid = String(row[0] == null ? '' : row[0]);
    var mode = String(row[5] == null ? '' : row[5]);
    var score = Number(row[6]) || 0;
    modeCount[mode] = (modeCount[mode] || 0) + 1;
    var prefix = rid.split('-')[0] + '-';
    prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
    if (detail.length < 15) {
      detail.push(cls + ' ' + num + ' 號　' + rid + '　' + mode + '　' + score + ' 分');
    }
  }

  var totalScore = 0;
  hitRows.forEach(function (rowNo) {
    totalScore += Number(sheet.getRange(rowNo, 7).getValue()) || 0;
  });

  var result = {
    apply: apply,
    matched: hitRows.length,
    scoreRemoved: totalScore,
    byMode: modeCount,
    byRequestIdPrefix: prefixCount,
    sample: detail
  };

  if (!apply) {
    result.message = '這是檢查模式，尚未刪除任何資料。核對無誤後執行 cleanupTestData_apply()。';
    return result;
  }

  // 由下往上刪，避免列號位移。
  hitRows.sort(function (a, b) { return b - a; });
  hitRows.forEach(function (rowNo) { sheet.deleteRow(rowNo); });
  SpreadsheetApp.flush();

  result.message = '已刪除 ' + hitRows.length + ' 列。請接著執行「更新成績總覽」與「更新掌握進度」。';
  return result;
}

/**
 * 唯讀診斷：回報目前三個工作表的實際狀態，不修改任何東西。
 * 清除前後都可以執行，用來確認「刪列」與「重建」哪一步還沒做。
 */
function cleanupTestData_diagnose() {
  const inTargets = (cls, num) => CLEANUP_TEST_STUDENTS.some(t => t.cls === cls && t.num === num);

  // 遊戲紀錄
  const log = book_().getSheetByName(LOG_SHEET);
  const logRows = log ? Math.max(0, log.getLastRow() - 1) : 0;
  let inLog = 0;
  const ridSample = [];
  if (logRows > 0) {
    const width = Math.max(LOG_HEADERS.length, 13);
    log.getRange(2, 1, logRows, width).getValues().forEach(function (row) {
      const cls = String(row[3] == null ? '' : row[3]).trim(), num = Number(row[4]);
      if (!inTargets(cls, num)) return;
      inLog += 1;
      if (ridSample.length < 5) ridSample.push(String(row[0]));
    });
  }

  // 成績總覽
  const sum = book_().getSheetByName(SUMMARY_SHEET);
  const sumLines = [];
  if (sum && sum.getLastRow() > 1) {
    sum.getRange(2, 1, sum.getLastRow() - 1, SUMMARY_HEADERS.length).getValues().forEach(function (row) {
      const cls = String(row[1] == null ? '' : row[1]).trim(), num = Number(row[2]);
      if (!inTargets(cls, num)) return;
      sumLines.push(cls + ' ' + num + ' 號：總分 ' + row[3] + '｜模式一 ' + row[5]
        + '｜模式二 ' + row[6] + '｜模式三 ' + row[7] + '｜週次秒數 ' + row[10]);
    });
  }

  // 掌握進度
  const mas = book_().getSheetByName(MasteryStore.SHEET_NAME);
  const masLines = [];
  if (mas && mas.getLastRow() > 1) {
    mas.getRange(2, 1, mas.getLastRow() - 1, MasteryStore.HEADERS.length).getValues().forEach(function (row) {
      const cls = String(row[0] == null ? '' : row[0]).trim(), num = Number(row[1]);
      if (!inTargets(cls, num)) return;
      masLines.push(cls + ' ' + num + ' 號：模式一「' + row[2] + '」／模式三「' + row[4] + '」／模式二「' + row[6] + '」');
    });
  }

  const report = [
    '【遊戲紀錄】共 ' + logRows + ' 列；測試學生佔 ' + inLog + ' 列',
    ridSample.length ? '　前幾筆請求編號：' + ridSample.join('、') : '',
    '【成績總覽】' + (sumLines.length ? '' : '　（查無測試學生）'),
    sumLines.join('\n'),
    '【掌握進度】' + (masLines.length ? '' : '　（查無測試學生）'),
    masLines.join('\n')
  ].filter(Boolean).join('\n');

  Logger.log(report);
  return report;
}
