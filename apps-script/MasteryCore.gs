/* 每日掌握進度核心邏輯；與 Apps Script MasteryCore.gs 使用相同內容。
   規則：每名學生、每個字、每天最多計分 3 次（第 1 次全額，之後遞減）；
   跨香港時間午夜自動失效。
   進度字串格式：entry = 鍵 + ':' + 值，entry 之間以 ';' 分隔。
   值為 YYYY-MM-DD，或 YYYY-MM-DD*n（n＝當天已計分次數；n 為 1 時省略）。
   只寫日期時即為 1 次，故舊資料不必遷移。

   ★ 鍵一律帶「模式前綴」（v2）：
     key = <prefix> ':' <單一漢字>，例如 connected:更、abbrev:五。
     週次字庫模式（手速賽）再多一層子前綴，例如 speed.w7_hw1:更。
     前綴＝模式識別碼，可帶小數點子前綴；格式見 PREFIX_PATTERN。
     這樣「所有模式共用同一個進度地圖」，加新模式時儲存格式與後端都不必再改。
     v1 的舊鍵是「裸漢字」或「w7_hw1:字」，無法判斷屬於哪個模式，故不解析（見 parseDrawer）。 */
var MasteryCore = (function () {
  'use strict';
  var HK_OFFSET_MS = 8 * 60 * 60 * 1000;
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  // 模式前綴：模式 id（小寫英數底線，≤24 字元），可再接一層子前綴（週次等）。
  var PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,23}(?:\.[a-z0-9_]{1,24})?$/;
  var MODE_ID_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
  // 每個字每天最多計分次數；DECAY[n] 為當天第 n 次的計分倍率。
  var MAX_PER_DAY = 3;
  var DECAY = [0, 1, 0.5, 0.25];

  function fail(message) { throw new Error(message); }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function validDate(v) { return DATE_PATTERN.test(text(v)); }

  /* ── 進度值的編碼 ────────────────────────────────────
     值為「日期」或「日期*n」。只寫日期即代表當天 1 次；
     舊資料全部是純日期，因此讀進來自然是 1 次，無需遷移。 */
  function entryDate(v) { return text(v).split('*')[0]; }

  function entryCount(v) {
    var parts = text(v).split('*');
    if (parts.length < 2) return 1;
    var n = Math.floor(Number(parts[1]));
    return (Number.isFinite(n) && n >= 1) ? n : 1;
  }

  function validEntry(v) {
    var t = text(v), at = t.indexOf('*');
    if (at < 0) return validDate(t);
    if (!validDate(t.slice(0, at))) return false;
    var n = Math.floor(Number(t.slice(at + 1)));
    return Number.isFinite(n) && n >= 1;
  }

  /* 組出進度值；次數為 1 時只寫日期，維持與舊資料相同的精簡形式。 */
  function entryValue(date, count) {
    requireDate(date);
    var n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n <= 1) return date;
    return date + '*' + n;
  }

  /* 當天第 n 次的計分倍率；超出上限回傳 0（不再計分）。 */
  function decayFor(count) {
    var n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1 || n > MAX_PER_DAY) return 0;
    return DECAY[n];
  }

  /* 該鍵今天已計分幾次（0～MAX_PER_DAY）；非今天一律算 0。 */
  function countOf(map, key, today) {
    var v = (map || {})[key];
    if (v == null || entryDate(v) !== today) return 0;
    return Math.min(entryCount(v), MAX_PER_DAY);
  }

  /* 該鍵今天還可再計分幾次。 */
  function remainingFor(map, key, today) {
    return Math.max(0, MAX_PER_DAY - countOf(map, key, today));
  }

  function requireDate(today) {
    if (!validDate(today)) fail('日期格式不正確，須為 YYYY-MM-DD。');
    return today;
  }

  /* 以香港時間（UTC+8）取得 YYYY-MM-DD，午夜 00:00 換日。 */
  function hkDate(now) {
    var d = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
    if (isNaN(d.getTime())) fail('時間格式不正確。');
    var hk = new Date(d.getTime() + HK_OFFSET_MS);
    return hk.getUTCFullYear() + '-' + pad2(hk.getUTCMonth() + 1) + '-' + pad2(hk.getUTCDate());
  }

  /* 模式前綴（可帶一層子前綴，例如 speed.w7_hw1）。 */
  function validPrefix(prefix) { return PREFIX_PATTERN.test(text(prefix)); }

  /* 單一漢字；分隔符一律視為非法，杜絕撐破抽屜或試算表的儲存格式。 */
  function validChar(char) {
    var c = text(char);
    return c !== '' && !/[:;|,]/.test(c) && Array.from(c).length === 1;
  }

  /* 完整進度鍵＝模式前綴 + ':' + 單一漢字。 */
  function validKey(key) {
    var s = text(key), at = s.indexOf(':');
    if (at <= 0) return false;
    return validPrefix(s.slice(0, at)) && validChar(s.slice(at + 1));
  }

  /* 由模式 id 與（選用的）週次組出前綴；週次字庫模式例：speed + w7_hw1 → speed.w7_hw1。 */
  function prefixFor(modeId, weekKey) {
    var mode = text(modeId);
    if (!MODE_ID_PATTERN.test(mode)) fail('模式代號格式不正確。');
    var week = text(weekKey);
    if (!week) return mode;
    if (!/^w\d{1,2}(?:_hw\d{1,2})?$/.test(week)) fail('週次格式不正確。');
    return mode + '.' + week;
  }

  function keyOf(char, prefix) {
    var c = text(char);
    if (!validChar(c)) fail('題目字必須是單一漢字。');
    var p = text(prefix);
    if (!validPrefix(p)) fail('模式前綴格式不正確。');
    return p + ':' + c;
  }

  /* 解析進度字串；無法辨識的片段一律略過，不拋錯。值連同次數原樣保留。 */
  function parseProgress(value) {
    var map = {};
    text(value).split(';').forEach(function (entry) {
      var s = entry.trim(), at = s.lastIndexOf(':');
      if (at <= 0) return;
      var key = s.slice(0, at), v = s.slice(at + 1);
      if (!validEntry(v) || !validKey(key)) return;
      map[key] = v;
    });
    return map;
  }

  function keptKeys(map, today) {
    return Object.keys(map || {}).filter(function (key) { return entryDate(map[key]) === today; });
  }

  /* 只保留當天的片段，舊日期自動失效，容量不會累積。次數一併保留。 */
  function serializeDaily(map, today) {
    requireDate(today);
    return keptKeys(map, today).sort().map(function (key) { return key + ':' + map[key]; }).join(';');
  }

  /* 保留全部歷史，供教師報表及重建使用。 */
  function serializeAll(map) {
    return Object.keys(map || {}).filter(function (key) { return validEntry(map[key]); })
      .sort().map(function (key) { return key + ':' + map[key]; }).join(';');
  }

  function scoredKeys(map, today) {
    var set = {};
    keptKeys(map, today).forEach(function (key) { set[key] = true; });
    return set;
  }

  /* 題庫可為「漢字字串」或「題目物件陣列」（物件取 .char）；
     物件陣列的支援讓 progress() 可直接吃 DATA 的題庫。 */
  function poolChars(pool) {
    if (Array.isArray(pool)) {
      return pool.map(function (item) {
        return text(item && typeof item === 'object' ? item.char : item);
      }).filter(function (c) { return c !== ''; });
    }
    return Array.from(text(pool).replace(/[\s,，;；]+/g, ''));
  }

  function shuffle(list, random) {
    var out = list.slice();
    var rnd = typeof random === 'function' ? random : Math.random;
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /* 出題：先抽當天未得分的字；不足時以當天已得分的字補足作複習。 */
  function pickNextChars(pool, map, today, need, random, prefix) {
    requireDate(today);
    var count = Math.floor(Number(need));
    if (!Number.isFinite(count) || count <= 0) return [];
    var scored = scoredKeys(map, today), fresh = [], used = [];
    poolChars(pool).forEach(function (char) {
      (scored[keyOf(char, prefix)] ? used : fresh).push(char);
    });
    return shuffle(fresh, random).concat(shuffle(used, random)).slice(0, count);
  }

  /* 結算一輪（或一場）作答：逐字判斷當天還可再計分幾次（上限 MAX_PER_DAY）。
     分數仍採信前端送來的 earned（前端已依剩餘次數套用遞減），
     後端只負責「這個字今天還算不算分」以及把次數記進抽屜。 */
  function applyRound(results, map, today, prefix) {
    requireDate(today);
    var next = {};
    Object.keys(map || {}).forEach(function (key) { next[key] = map[key]; });
    var list = Array.isArray(results) ? results : [];
    var spent = {}, seen = {}, newlyScored = [], ignored = [], earned = 0;
    list.forEach(function (item) {
      if (!item || item.correct !== true) return;
      var char = text(item.char), key = keyOf(char, prefix);
      var points = Number(item.earned);
      if (!Number.isFinite(points) || points < 0) points = 0;
      var used = countOf(next, key, today);
      if (spent[key] || used >= MAX_PER_DAY) {
        if (!seen[key]) { seen[key] = true; ignored.push(char); }
        return;
      }
      spent[key] = true;
      next[key] = entryValue(today, used + 1);
      newlyScored.push(char);
      earned += Math.round(points);
    });
    return { earned: earned, newlyScored: newlyScored, ignored: ignored, map: next };
  }

  /* 當天進度，例如「模式一：今日 3 / 31 字」。 */
  function progress(map, today, pool, prefix) {
    requireDate(today);
    var chars = poolChars(pool), scored = scoredKeys(map, today), done = 0;
    chars.forEach(function (char) { if (scored[keyOf(char, prefix)]) done += 1; });
    return { scored: done, total: chars.length };
  }

  /* 曾得分的所有鍵，供教師掌握進度報表使用。 */
  function masteredKeys(map) {
    return Object.keys(map || {}).filter(function (key) { return validEntry(map[key]); }).sort();
  }

  /* 一輪 5 題結束時，把本輪逐題結果組成可送出的一輪紀錄。
     results：陣列，每項 { char, correct, earned }（earned 為該題原本的遊戲得分，
     已由前端依「當天第幾次」套用遞減）。這裡只負責把已用完次數的字歸零。
     只有「正確」的題目才需要送後端判斷；錯誤題目略過。 */
  function buildRound(results, pool, map, today, prefix) {
    requireDate(today);
    var list = Array.isArray(results) ? results : [];
    return list.filter(function (item) {
      return item && item.correct === true;
    }).map(function (item) {
      var char = text(item.char);
      var points = Number(item.earned);
      if (!Number.isFinite(points) || points < 0) points = 0;
      return {
        char: char,
        correct: true,
        // 今天還可再計分 → 送原分；已用完 MAX_PER_DAY 次 → 送 0，畫面顯示已達上限。
        earned: countOf(map, keyOf(char, prefix), today) >= MAX_PER_DAY ? 0 : Math.round(points)
      };
    });
  }

  /* 從後端回傳的本次得分結果，組出畫面提示。 */
  function summarizeRound(scoredNow, ignoredChars, todayMap, pool, today) {
    requireDate(today);
    var ignored = Array.isArray(ignoredChars) ? ignoredChars.slice() : [];
    var newly = Array.isArray(scoredNow) ? scoredNow.slice() : [];
    if (newly.length === 0 && ignored.length === 0) return '';
    if (newly.length > 0) return '✅ 今日新增 ' + newly.join('、');
    // 全部都是已得分字時，顯示上限提示。
    return '這模式得分已到上限';
  }

  /* 模式二（手速賽）單場獎勵分。
     沿用現行公式：Math.max(20, round(150 - 等效秒數 × 2))，20 字賽再乘 1.8。
     快慢極端都有界：最快封頂 150 分，最慢保底 20 分，不會出現負分。
     非法輸入回傳 0（視為不計分），不拋錯——前端結算不應因一個壞數字而中斷。 */
  function speedRoundScore(effectiveTime, wordCount) {
    var t = Number(effectiveTime), count = Number(wordCount);
    if (!Number.isFinite(t) || t < 0 || t >= 900) return 0;
    if (count !== 10 && count !== 20) return 0;
    var base = Math.max(20, Math.round(150 - t * 2));
    return count === 20 ? Math.round(base * 1.8) : base;
  }

  /* 把單場獎勵分攤到每個字上，避免「整場重刷」用同一批字反覆領取滿分。
     後端只會採計「當天首次答對」的字，故每字送的是分攤後的值：
     整場都首答 → 總和精確等於 speedRoundScore；只有 k 字首答 → 大約拿到 k/N 的分。
     除不盡的餘數補到前面的字，確保總和精確、且每字差距不超過 1。
     非法輸入回傳長度為 count 的全 0 陣列（不拋錯）。 */
  function speedRoundEarned(effectiveTime, wordCount) {
    var count = Number(wordCount);
    if (count !== 10 && count !== 20) return new Array(Number.isInteger(count) && count > 0 ? count : 0).fill(0);
    var total = speedRoundScore(effectiveTime, count);
    var base = Math.floor(total / count), rest = total - base * count, out = [];
    for (var i = 0; i < count; i++) out.push(base + (i < rest ? 1 : 0));
    return out;
  }

  /* ── 進度抽屜壓縮格式（v2）───────────────────────────
     v2|YYYY-MM-DD|<前綴>:<字串>,<前綴>:<字串>,...
     字串＝逐字串接，字後接次數數字（1 省略）：更2人天
     日期只存一次；同一前綴的字共用一次前綴，故每字只多一個次數字元。
     ★ 按前綴分組是必要的容量設計：若每個字都寫一次前綴，
       一天 90 字／生 × 216 生就會超過 500 KB 上限。 */

  function keysToday(map, today) {
    return Object.keys(map || {}).filter(function (key) { return entryDate(map[key]) === today && validKey(key); }).sort();
  }

  /* 反向解析「字」「字2」串。漢字與數字不會混淆，可安全逐字掃描。 */
  function readCharTokens(str, date, prefix, out) {
    var chars = Array.from(text(str));
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (!validChar(ch)) continue;
      var digits = '';
      while (i + 1 < chars.length && /[0-9]/.test(chars[i + 1])) { digits += chars[i + 1]; i += 1; }
      var n = digits ? Math.floor(Number(digits)) : 1;
      if (!Number.isFinite(n) || n < 1) n = 1;
      var key = prefix + ':' + ch;
      if (!validKey(key)) continue;
      out[key] = entryValue(date, Math.min(n, MAX_PER_DAY));
    }
  }

  /* 只保留今天的資料；昨天及更早的內容在序列化時自動捨棄。次數一併保留。 */
  function serializeDrawer(map, today) {
    requireDate(today);
    var groups = {};
    keysToday(map, today).forEach(function (key) {
      var at = key.indexOf(':');
      var prefix = key.slice(0, at), ch = key.slice(at + 1);
      if (!groups[prefix]) groups[prefix] = [];
      var n = Math.min(entryCount(map[key]), MAX_PER_DAY);
      groups[prefix].push(n > 1 ? ch + n : ch);
    });
    var body = Object.keys(groups).sort().map(function (prefix) {
      return prefix + ':' + groups[prefix].join('');
    }).join(',');
    return 'v2|' + today + '|' + body;
  }

  function emptyDrawer() { return { version: '', date: '', map: {} }; }

  /* 解析抽屜；無法辨識的內容一律回傳空抽屜，不拋錯。
     沒有次數數字的舊資料一律讀成 1 次。
     v1 抽屜（無模式前綴，分不清屬於哪個模式）一律視為空，
     由「掌握進度」表或每日重建補回。 */
  function parseDrawer(value) {
    var parts = text(value).split('|');
    if (parts.length !== 3 || parts[0] !== 'v2' || !validDate(parts[1])) return emptyDrawer();
    var date = parts[1], map = {};
    parts[2].split(',').forEach(function (group) {
      var g = group.trim();
      if (!g) return;
      var at = g.indexOf(':');
      if (at <= 0) return;
      var prefix = g.slice(0, at);
      if (!validPrefix(prefix)) return;
      readCharTokens(g.slice(at + 1), date, prefix, map);
    });
    return { version: 'v2', date: date, map: map };
  }

  return {
    MAX_PER_DAY: MAX_PER_DAY,
    hkDate: hkDate,
    validChar: validChar,
    validPrefix: validPrefix,
    validKey: validKey,
    prefixFor: prefixFor,
    keyOf: keyOf,
    entryDate: entryDate,
    entryCount: entryCount,
    validEntry: validEntry,
    entryValue: entryValue,
    decayFor: decayFor,
    countOf: countOf,
    remainingFor: remainingFor,
    parseProgress: parseProgress,
    serializeDaily: serializeDaily,
    serializeAll: serializeAll,
    pickNextChars: pickNextChars,
    applyRound: applyRound,
    progress: progress,
    masteredKeys: masteredKeys,
    buildRound: buildRound,
    summarizeRound: summarizeRound,
    speedRoundScore: speedRoundScore,
    speedRoundEarned: speedRoundEarned,
    serializeDrawer: serializeDrawer,
    parseDrawer: parseDrawer,
    emptyDrawer: emptyDrawer
  };
}());

// Node 測試以 require 載入時匯出；Apps Script 沒有 module，整段略過。
if (typeof module !== 'undefined' && module.exports) module.exports = MasteryCore;
