/**
 * =========================================================================
 * 🗺️ MODES.JS - 模式註冊表（前端唯一真相）
 *
 * 這裡是「有哪些模式」的唯一來源。加新模式＝在這裡加一筆資料 + 準備字庫，
 * 後端不需要改任何一行、也不需要重新部署（見 docs/MODE_GENERIC_DESIGN.md）。
 *
 * 兩層概念（重要）：
 *   - mechanism（機制）：玩法引擎，程式分支的依據，數量少且幾乎不變。
 *   - mode（模式）：站／關的身分，純資料，可任意增減。
 *
 * 欄位：
 *   id      模式識別碼。同時是後端進度鍵的前綴（例：進度鍵 `abbrev:五`）。
 *           必須符合 /^[a-z][a-z0-9_]{0,23}$/，且與 apps-script/Code.gs 的
 *           MODE_PATTERN 一致（有測試守門）。
 *   mech    機制：'code'（全碼依序捕捉）｜'twoPart'（字首＋字身）｜'timed'（限時）｜
 *           'survival'（5 條命生存）｜'pet'（寵物養成）｜'run'（橫向跑酷）｜
 *           'siege'（法陣守衛戰）。另有 'versus' 預留。
 *   line    'main'（主線，有解鎖順序）｜'challenge'（挑戰線，獨立入口，不設門檻）
 *   order   同線內的推進順序（真實站號）。主線一律用「站號」，
 *           之後補站直接給對應的站號，不必重排既有模式。
 *   ui      分頁按鈕的顯示順序。與 order 分開：分頁只排「visible 的模式」，
 *           所以未開放的模式（visible:false）不會在順序中留下空號。
 *           （目前：主線依序在前，挑戰線 speed 用較大的 ui 排在最後。）
 *   completeAt  本站的「完成門檻」（本機累積分）。主線解鎖鏈＝
 *           「顯示順序中，前一站達到它的 completeAt ⇒ 這一站開啓」，
 *           第一站永遠開啓；挑戰線不設門檻（永遠可玩）。
 *           ⚠ 只在 js/modes.js 寫一次，程式與 UI 都由此推導，不要另存解鎖旗標 ——
 *             旗標與分數一旦不同步就會「有分數卻顯示沒解鎖」。
 *   pool    DATA 內的題庫鍵名；週次字庫模式（weekly:true）不需要
 *   weekly  是否使用帳號 B 的週次字庫（進度鍵會多一層週次子前綴）
 *   visible 是否在分頁列出現（false＝保留程式路徑但先不上按鈕）
 *   icon / name / short / badge  顯示用文字
 *   note    計分說明（顯示在模式標籤下方的 .mode-scoring-note 區）
 *   view    玩法畫面的呈現設定（程式依「機制」分派，再由此取各模式的文字／分數）。
 *           欄位皆可省略，省略時用該機制的預設值（見 DEFAULTS）。
 *   =========================================================================
 */

window.P5_MODES = window.P5_MODES || [
  {
    id: 'connected', line: 'main', order: 1, ui: 1, mech: 'code', visible: true,
    pool: 'connected_words',
    // completeAt：本站（本機）累積分達此值 ⇒ 視為「完成」，下一關才開啓。
    // 解鎖鏈＝可見主線的顯示順序；門檻沿顯示順序**遞增**（2026-10-15 定案）：
    //   連體字 150 → 文字突圍 200 → 字形特徵 250 → 寵物 300 → 生存 350 → 難字 400。
    // 「還差 N 分」顯示的是**前一站**尚欠的分數。挑戰線不設門檻。
    completeAt: 150,
    icon: '⚔️', name: '連體字全碼突破', short: '連體字全碼突破', badge: '1~4碼連擊',
    note: '每個字每天最多計 <strong>3 次</strong>：第 1 次全額，第 2 次一半，第 3 次四分之一。'
      + '練滿 3 次之後只算練習、不再加分，明天重新開始。',
    view: {
      monster: '⚔️', color: '#1E3A8A', orbPrefix: 'corr',
      slots: ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼', '⑤ 五碼', '⑥ 六碼'],
      baseScore: 15, minBase: 3,
      hint: '【連體字全碼取碼】 取碼長度：{len} 碼 ｜ 依筆順連擊突破！',
      prompt: '請依筆順依序捕捉【 {char} 】的完整 {len} 碼倉頡字根！'
    }
  },
  {
    // 分體字：機制（字首＋字身）已實作，但尚未上分頁按鈕（visible:false）。
    // ui 已歸位到主線第 2 位（與 order 一致），開放時只要把 visible 改成 true。
    id: 'split', line: 'main', order: 2, ui: 2, mech: 'twoPart', visible: false,
    pool: 'split_words',
    completeAt: 150,
    icon: '🧩', name: '分體字結構挑戰', short: '分體字結構挑戰', badge: '字首＋字身',
    note: '每個字每天最多計 <strong>3 次</strong>：第 1 次全額，第 2 次一半，第 3 次四分之一。',
    view: { monster: '🧩', color: '#7C3AED', baseScore: 15, minBase: 3 }
  },
  {
    // 站 3：精簡原則＋先繁後簡（**文字突圍：字靈倖存者**，機制 siege）。
    // 字庫 45 字已就緒（js/data.js 的 abbrev_words，2026-10-14 由 29 字擴充）。
    // 玩法與其他站都不同：canvas 法陣保衛戰 —— 字靈從四面八方湧向中央法陣，
    // 依倉頡字根逐碼輸入即可擊破；完整打完一整字的碼才擊破（中途按錯要重拆）。
    // 計分完全沿用 code 那條路（送 round 給後端），後端零改動。
    id: 'abbrev', line: 'main', order: 3, ui: 3, mech: 'siege', visible: true,
    pool: 'abbrev_words',
    completeAt: 200,
    icon: '🧙', name: '文字突圍', short: '文字突圍', badge: '字靈倖存者',
    note: '字靈會從四面八方湧向中央法陣！依<strong>精簡／先繁後簡</strong>原則拆碼，'
      + '把一個字的字根<strong>完整打完</strong>才能擊破一隻字靈（中途按錯要重新拆解）。'
      + '分數規則是每個字每天最多計 <strong>3 次</strong>、第 1 次全額、之後遞減（與其他模式相同）。',
    view: {
      monster: '🧙', color: '#4F46E5', orbPrefix: 'siege',
      baseScore: 15, minBase: 3,
      hint: '【精簡／先繁後簡原則】 字靈拆碼：{len} 碼 ｜ 完整打完才能擊破！',
      prompt: '依序打完【 {char} 】的 {len} 碼倉頡字根，擊破來襲的字靈！'
    }
  },
  {
    // 站 4：字形特徵原則。字庫 28 字已就緒（js/data.js 的 feature_words）。
    // 與站 3 一樣，加這個模式沒有動到後端任何一行。
    id: 'feature', line: 'main', order: 4, ui: 4, mech: 'code', visible: true,
    pool: 'feature_words',
    completeAt: 250,
    icon: '🔷', name: '字形特徵原則', short: '字形特徵原則', badge: '取碼原則',
    note: '每個字每天最多計 <strong>3 次</strong>：第 1 次全額，第 2 次一半，第 3 次四分之一。'
      + '練滿 3 次之後只算練習、不再加分，明天重新開始。',
    view: {
      monster: '🔷', color: '#1D4ED8', orbPrefix: 'feat',
      slots: ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼', '⑤ 五碼', '⑥ 六碼'],
      baseScore: 15, minBase: 3,
      hint: '【字形特徵原則】 取碼長度：{len} 碼 ｜ 依字形特徵取碼！',
      prompt: '請依字形特徵捕捉【 {char} 】的 {len} 碼倉頡字根！'
    }
  },
  {
    // 站 5：包含省略原則（**寵物養成玩法**）。字庫 25 字已就緒（js/data.js 的 omit_words）。
    // 玩法與前面各站都不同：打對字＝餵寵物，累積經驗讓寵物進化。
    // 計分完全沿用 code 那條路（送 round 給後端），後端零改動。
    id: 'omit', line: 'main', order: 5, ui: 5, mech: 'pet', visible: true,
    pool: 'omit_words',
    completeAt: 300,
    icon: '🐣', name: '倉頡寵物', short: '倉頡寵物', badge: '養成進化',
    note: '打對每個字 = 餵寵物一口，經驗增加、寵物會<strong>進化變身</strong>。'
      + '分數規則是每個字每天最多計 <strong>3 次</strong>、第 1 次全額、之後遞減（與其他模式相同）。',
    view: {
      monster: '🐣', color: '#EC4899', orbPrefix: 'pet',
      slots: ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼', '⑤ 五碼', '⑥ 六碼'],
      baseScore: 15, minBase: 3,
      hint: '【包含省略原則】 取碼長度：{len} 碼 ｜ 省略包含，餵飽你的寵物！',
      prompt: '鍵入【 {char} 】的 {len} 碼倉頡字根，把牠餵飽！'
    }
  },
  {
    // 站 6：倉頡生存挑戰（2026-10-14 使用者定案：**由挑戰線搬入主線**，
    // 取代原「特殊字貫穿」的站 6 計劃）。
    // 玩法：5 條命，答錯扣 1 命、連續答對累積連擊倍率，命用完就結束。
    // 字庫暫沿用 connected_words（連體字）；機制 'survival' 走自己的引擎，
    // 計分完全沿用 code 那條路（送 round 給後端），後端零改動。
    id: 'survival', line: 'main', order: 6, ui: 6, mech: 'survival', visible: true,
    pool: 'connected_words',
    completeAt: 350,
    icon: '💀', name: '倉頡生存挑戰', short: '倉頡生存挑戰', badge: '5條命 連擊倍率',
    note: '有 <strong>5 條命</strong>：答錯一個鍵扣 <strong>1 條命</strong>並打斷連擊，命用完即結束。'
      + '連續答對累積<strong>連擊</strong>：連擊 5 → ×1.5、10 → ×2、20 → ×3'
      + '（超過 6 秒沒答對一字，連擊歸零）。分數規則是每個字每天最多計 <strong>3 次</strong>、'
      + '第 1 次全額、之後遞減（與其他模式相同）。',
    view: {
      monster: '💀', color: '#DC2626', orbPrefix: 'surv',
      baseScore: 15, minBase: 3
    }
  },
  {
    // 站 7：難字與複合字（維持既有內容，order 歸位到真實站號 7）。
    // ui=7：站 6 由生存挑戰進駐後，難字順移一位。
    id: 'special', line: 'main', order: 7, ui: 7, mech: 'code', visible: true,
    pool: 'special_words',
    completeAt: 400,
    icon: '🔮', name: '難字與複合字特訓', short: '難字與複合字特訓', badge: 'X難字/複合',
    note: '難字與複合字同樣每個字每天最多計 <strong>3 次</strong>（第 1 次全額，之後每次減半）；'
      + '練滿 3 次後仍可繼續練熟它，只是不再加分。',
    view: {
      monster: '🔮', color: '#059669', orbPrefix: 'spec',
      slots: ['① 首碼', '② 次碼', '③ 尾碼', '④ 末碼', '⑤ 五碼', '⑥ 六碼'],
      baseScore: 10, minBase: 2,
      hint: '【{type}】 特殊取碼規則特訓！',
      prompt: '捕捉【 {char} 】的特殊字根球（注意難字 X 鍵或複合字碼）！'
    }
  },
  {
    // 挑戰線：獨立入口，不佔主線進度，也不列入「冠軍之路」條件。
    // ui=8 ⇒ 排在所有主線模式之後（生存已於 2026-10-14 搬入主線站 6）。
    id: 'speed', line: 'challenge', order: 1, ui: 8, mech: 'timed', visible: true,
    weekly: true,
    icon: '⚡', name: '倉頡極速刷分手速賽', short: '倉頡極速刷分手速賽', badge: '10字 極速秒數天梯',
    note: '排名只看<strong>完成秒數（越快越前）</strong>；分數方面每個字每天最多計 <strong>3 次</strong>，'
      + '第 1 次全額、之後每次減半。用最短時間跑完，分數和排名一起拿。',
    view: { color: '#B45309' }
  },
];

/** 模式識別碼的合法格式；必須與 apps-script/Code.gs 的 MODE_PATTERN 相同。 */
window.P5_MODE_PATTERN = window.P5_MODE_PATTERN || /^[a-z][a-z0-9_]{0,23}$/;

/** 合法的機制名稱。程式只依機制分支，不依模式 id 分支。 */
window.P5_MECHS = window.P5_MECHS || ['code', 'twoPart', 'timed', 'survival', 'versus', 'pet', 'run', 'siege'];

/** 各機制的預設呈現設定；未指定的模式直接沿用，新增主線模式幾乎不必再寫 view。 */
window.P5_VIEW_DEFAULTS = window.P5_VIEW_DEFAULTS || {
  code: {
    monster: '⚔️', color: '#1E3A8A', orbPrefix: 'corr',
    slots: ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼', '⑤ 五碼', '⑥ 六碼'],
    baseScore: 15, minBase: 3,
    hint: '【 {short} 】 取碼長度：{len} 碼 ｜ 依筆順連擊突破！',
    prompt: '請依筆順依序捕捉【 {char} 】的完整 {len} 碼倉頡字根！'
  },
  twoPart: { monster: '🧩', color: '#7C3AED', baseScore: 15, minBase: 3 },
  timed: { color: '#B45309' },
  survival: { monster: '💀', color: '#DC2626', orbPrefix: 'surv', baseScore: 15, minBase: 3 },
  versus: { monster: '🤺', color: '#7C3AED', orbPrefix: 'vs', baseScore: 15, minBase: 3 },
  pet: {
    monster: '🐣', color: '#EC4899', orbPrefix: 'pet',
    slots: ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼', '⑤ 五碼', '⑥ 六碼'],
    baseScore: 15, minBase: 3,
    hint: '【 {short} 】 取碼長度：{len} 碼 ｜ 餵飽你的寵物！',
    prompt: '鍵入【 {char} 】的 {len} 碼倉頡字根！'
  },
  run: {
    monster: '🏃', color: '#0F766E', orbPrefix: 'run',
    slots: ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼', '⑤ 五碼', '⑥ 六碼'],
    baseScore: 15, minBase: 3,
    hint: '【 {short} 】 障礙字根：{len} 碼 ｜ 全部跳過就過關！',
    prompt: '按對字根鍵，讓角色跳過【 {char} 】的 {len} 個障礙！'
  },
  siege: {
    monster: '🧙', color: '#4F46E5', orbPrefix: 'siege',
    baseScore: 15, minBase: 3,
    hint: '【 {short} 】 字靈拆碼：{len} 碼 ｜ 完整打完才能擊破！',
    prompt: '依序打完【 {char} 】的 {len} 碼倉頡字根，擊破來襲的字靈！'
  }
};

/** 模式註冊表的查詢介面；避免各處自行 filter，規則只寫一次。 */
var P5Mode = (function () {
  'use strict';
  var list = window.P5_MODES || [];
  var byId = {};
  list.forEach(function (mode) { byId[mode.id] = mode; });

  function all() { return list.slice(); }
  function find(id) { return byId[id] || null; }
  /** 未註冊的模式一律視為最常見的 'code'，與後端的預設機制一致。 */
  function mechOf(id) { var m = byId[id]; return m ? m.mech : 'code'; }
  function poolOf(id) { var m = byId[id]; return (m && m.pool) || ''; }
  function visible() { return list.filter(function (m) { return m.visible !== false; }); }
  function line(name) { return list.filter(function (m) { return m.line === name; }); }
  /** 分頁按鈕順序：依 ui，未指定者排最後。 */
  function forTabs() {
    return visible().slice().sort(function (a, b) {
      return (a.ui == null ? 99 : a.ui) - (b.ui == null ? 99 : b.ui);
    });
  }

  /* 該模式的呈現設定：view 逐欄覆寫機制預設值。
     呼叫方只管用，不必知道哪個模式叫什麼名字。 */
  function viewOf(id) {
    var mech = mechOf(id);
    var defaults = (window.P5_VIEW_DEFAULTS || {})[mech] || {};
    var own = (find(id) || {}).view || {};
    var out = {};
    Object.keys(defaults).forEach(function (key) { out[key] = defaults[key]; });
    Object.keys(own).forEach(function (key) { out[key] = own[key]; });
    return out;
  }

  /* 週次字庫模式（機制 timed）的進度鍵前綴＝模式.週次；其餘模式即模式代號本身。 */
  function prefixFor(id, weekKey) {
    var m = find(id);
    var weekly = !!(m && m.weekly);
    var week = String(weekKey == null ? '' : weekKey).trim();
    return (weekly && week) ? id + '.' + week : id;
  }

  /* ── 主線解鎖鏈（2026-10-14 使用者定案：軟鎖，可進入但標示未開啓）────────
     規則只寫一次，就在這裡：
       「主線顯示順序」中，**前一站**的本機累積分達到它的 completeAt，
        這一站才算「已開啓」；第一站永遠開啓。
     解鎖狀態一律「即時由分數算出來」，**不另存旗標** ——
     否則分數與旗標一旦不同步，就會出現「有分數卻顯示沒解鎖」。
     注意：分數取自本機 modeScores，換電腦可能偏舊；因為是軟鎖，不影響遊玩。 */

  /** 可見主線，依顯示順序（＝學生看到的先後），就是解鎖鏈的順序。 */
  function mainSequence() {
    return forTabs().filter(function (m) { return m.line === 'main'; });
  }

  /** 主線第幾關（1 起算）；非主線（挑戰線）回 0。 */
  function stageOf(id) {
    var seq = mainSequence();
    for (var i = 0; i < seq.length; i++) {
      if (seq[i].id === id) return i + 1;
    }
    return 0;
  }

  /** 本站的完成門檻；未填者視為不需要門檻（0）。 */
  function completeAtOf(id) {
    var m = find(id);
    return (m && typeof m.completeAt === 'number') ? m.completeAt : 0;
  }

  /* 解鎖狀態：
     { staged, stageNo, isFirst, isLast, unlocked, prevId, prevName,
       need, prevScore, remaining, complete, selfScore }
     - unlocked  ：這一站現在算不算「已開啓」
     - remaining ：還差多少分（「🔒 還差 N 分」直接用這個）
     - complete  ：本站自己是否已達完成門檻（用於「主線全完成」判定） */
  function unlockOf(id, modeScores) {
    var seq = mainSequence();
    var idx = -1;
    for (var i = 0; i < seq.length; i++) {
      if (seq[i].id === id) { idx = i; break; }
    }
    var scores = modeScores || {};
    var selfScore = (typeof scores[id] === 'number') ? scores[id] : 0;

    // 挑戰線：不設門檻，永遠可玩。
    if (idx < 0) {
      return { staged: false, stageNo: 0, isFirst: false, isLast: false, unlocked: true,
        prevId: null, prevName: '', need: 0, prevScore: 0, remaining: 0,
        complete: false, selfScore: selfScore };
    }

    var prev = idx > 0 ? seq[idx - 1] : null;
    var need = prev ? completeAtOf(prev.id) : 0;
    var prevScore = prev ? ((typeof scores[prev.id] === 'number') ? scores[prev.id] : 0) : 0;
    return {
      staged: true,
      stageNo: idx + 1,
      isFirst: idx === 0,
      isLast: idx === seq.length - 1,
      unlocked: !prev || prevScore >= need,
      prevId: prev ? prev.id : null,
      prevName: prev ? (prev.short || prev.name || prev.id) : '',
      need: need,
      prevScore: prevScore,
      remaining: prev ? Math.max(0, need - prevScore) : 0,
      complete: completeAtOf(id) > 0 && selfScore >= completeAtOf(id),
      selfScore: selfScore
    };
  }

  /** 主線是否已全部完成（每站都達 completeAt）——「冠軍之路」條件。 */
  function mainComplete(modeScores) {
    var seq = mainSequence();
    var scores = modeScores || {};
    return seq.length > 0 && seq.every(function (m) {
      var gate = completeAtOf(m.id);
      if (gate <= 0) return true;
      return (typeof scores[m.id] === 'number' ? scores[m.id] : 0) >= gate;
    });
  }

  /** 以 {name} 佔位符填入文字。未提供的變數原樣保留，方便除錯。 */
  function fill(template, vars) {
    var text = String(template == null ? '' : template);
    var values = vars || {};
    return text.replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole;
    });
  }

  return {
    all: all, find: find, mechOf: mechOf, poolOf: poolOf,
    visible: visible, line: line, forTabs: forTabs,
    viewOf: viewOf, prefixFor: prefixFor, fill: fill,
    mainSequence: mainSequence, stageOf: stageOf, completeAtOf: completeAtOf,
    unlockOf: unlockOf, mainComplete: mainComplete
  };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = { P5Mode: P5Mode };
