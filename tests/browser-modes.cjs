/* 前端通用化（② 階段 T3/T4/T8）的瀏覽器驗收：現有模式行為不變，且畫面文字改由註冊表驅動。
   * 需本機 Playwright（與 tests/browser-word-bank.cjs 相同的前置條件）。
   * 驗收重點：
     - V1：連體字／分體字／難字三個既有模式的出題與結算行為與從前一致
     - V3：畫面上的怪獸圖示、提示文字、槽位標籤、結算基礎分一律取自 js/modes.js
     - V4：分頁按鈕與計分說明由註冊表生成
     - T8：本機快取由 mode1/2/3Score 遷移為 modeScores，且新模式可自由記分
   用法：node tests/browser-modes.cjs
         （若 playwright 裝在非預設路徑，設 PLAYWRIGHT_MODULE=<模組路徑>） */
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

/** 依序點完當前題目的所有正確字根球；回傳結算後的狀態。
 *  必須是真正的函式（而非字串）——Playwright 對字串會當成「運算式」求值，不會呼叫。 */
function SOLVE_ROUND(mode) {
  const mech = MODE_REGISTRY.mechOf(mode);
  const twoPart = mech === 'twoPart';
  for (let guard = 0; guard < 10; guard++) {
    if (!currentQuiz) break;
    let needed;
    if (twoPart) {
      needed = (selectedPrefix.length < currentQuiz.prefix_codes.length)
        ? currentQuiz.prefix_codes[selectedPrefix.length]
        : currentQuiz.body_codes[selectedBody.length];
    } else {
      needed = currentQuiz.codes[selectedCodes.length];
    }
    if (needed === undefined) break;
    const orb = activeOrbs.find(o => o.code === needed && !o.el.classList.contains('caught'));
    if (!orb) break;
    catchOrb(orb);
    if (twoPart
      && selectedPrefix.length === currentQuiz.prefix_codes.length
      && selectedBody.length === currentQuiz.body_codes.length) break;
    if (!twoPart && selectedCodes.length === currentQuiz.codes.length) break;
  }
  return {
    score: sessionScore,
    correctCount: sessionCorrectCount,
    pending: pendingRoundResults.length,
    filled: selectedCodes.slice(),
    filledPrefix: selectedPrefix.slice(),
    filledBody: selectedBody.slice()
  };
}

/** 起一台靜態伺服器；gasUrl 會被寫進 config.js 的 GAS_WEBHOOK_URL。
    主流程傳 ''（完全離線、不依賴外部服務）；mock 雲端階段傳假端點，由 route 回假榜單。 */
function makeStaticServer(gasUrl) {
  return http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve('.', '.' + (name === '/' ? '/index.html' : name));
    try {
      let data = fs.readFileSync(file);
      if (name === '/js/config.js') {
        data = Buffer.from(data.toString()
          .replace(/window\.CONFIG\.DATA_URL = '[^']*';/, "window.CONFIG.DATA_URL = '';")
          .replace(/window\.CONFIG\.GAS_WEBHOOK_URL = '[^']*';/,
            'window.CONFIG.GAS_WEBHOOK_URL = ' + JSON.stringify(gasUrl) + ';'));
      }
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript'
        : name.endsWith('.css') ? 'text/css'
          : name.endsWith('.html') || name === '/' ? 'text/html' : 'application/octet-stream');
      res.end(data);
    } catch (e) { res.writeHead(404); res.end(); }
  });
}

(async () => {
  const server = makeStaticServer('');
  const mockServer = makeStaticServer('https://gas.example.test/exec');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await new Promise(r => mockServer.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  const mockUrl = 'http://127.0.0.1:' + mockServer.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext();
    // 種入「舊版本機快取」：分項分數是寫死的 mode1/2/3Score 三欄（T8 要驗的就是它會被遷移）。
    await context.addInitScript(() => {
      try {
        localStorage.setItem('p5_score_P5A_1',
          JSON.stringify({ totalScore: 50, kills: 3, mode1Score: 42, mode3Score: 8, lastUpdate: '2026-01-01T00:00:00.000Z' }));
        localStorage.removeItem('p5_score_P5A_2');
      } catch (e) { }
    });
    await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => typeof setGameMode === 'function' && typeof MODE_REGISTRY === 'object');

    // ── T8：本機儲存通用化（舊版三欄 → modeScores 動態對照表）──
    const migrated = await page.evaluate(() => {
      const stats = getStudentStats('P5A', 1);
      return {
        modeScores: stats.modeScores,
        legacyKeys: ['mode1Score', 'mode2Score', 'mode3Score'].filter(k => k in stats)
      };
    });
    assert.deepEqual(migrated.modeScores, { connected: 42, special: 8 },
      '舊版 mode1/3Score 就地併入 modeScores（42 → connected、8 → special）');
    assert.deepEqual(migrated.legacyKeys, [], '舊欄位讀過即移除，不會再被寫回');

    const written = await page.evaluate(() => {
      // 用「尚未註冊」的代號 abbrev 寫一次，證明前端不必認識模式清單也能記分。
      saveStudentStats('P5A', 1, 5, false, 'abbrev');
      return window.localStorage.getItem('p5_score_P5A_1');
    });
    const stored = JSON.parse(written);
    assert.equal(stored.modeScores.abbrev, 5, '新模式分項直接落進本機快取');
    assert.equal(stored.modeScores.connected, 42, '既有分項不受影響');
    assert.equal('mode1Score' in stored, false, '本機快取已完全不再出現舊欄位');

    // ── ③④：分頁與計分說明由註冊表生成；順序＝主線在前、挑戰線（極速賽）最後 ──
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.mode-tab-btn')).map(b => b.id));
    assert.deepEqual(tabs,
      ['mode-tab-connected', 'mode-tab-abbrev', 'mode-tab-feature', 'mode-tab-omit',
        'mode-tab-survival', 'mode-tab-special', 'mode-tab-speed'],
      '分頁只顯示 visible 的模式：連體字 → 文字突圍 → 字形特徵 → 倉頡寵物 → 倉頡生存挑戰 → 難字 → 極速賽（挑戰線在最後）');
    const tabTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.mode-tab-btn')).map(b => b.textContent));
    tabTexts.forEach(t => assert.ok(!/模式\s*\d/.test(t), '分頁文字不得含模式編號：' + t));
    assert.match(tabTexts[1], /文字突圍/, '第二個分頁是站 3 法陣守衛戰模式');
    assert.match(tabTexts[2], /字形特徵原則/, '第三個分頁是字形特徵模式');
    assert.match(tabTexts[3], /倉頡寵物/, '第四個分頁是包含省略（寵物養成）模式');
    assert.match(tabTexts[4], /倉頡生存挑戰/, '第五個分頁是站 6 生存挑戰（由挑戰線搬入主線）');
    assert.match(tabTexts[5], /難字與複合字特訓/, '第六個分頁是站 7 難字特訓');
    // 解鎖鏈的完整驗證（還差 N 分、軟鎖可進入、達標自動開啓）放在登入之後，
    // 因為分頁的解鎖狀態要看「這位學生」的分數。
    const note = await page.evaluate(() => {
      const el = document.querySelector('.mode-scoring-note-connected');
      return el ? { text: el.textContent, active: el.classList.contains('active') } : null;
    });
    assert.ok(note && note.active, '預設模式（連體字）的計分說明應為 active');
    assert.match(note.text, /怎麼得分/);
    assert.match(note.text, /每天最多計 3 次/, '說明文字取自註冊表的 note 欄位');

    // 登入並進入遊戲頁
    await page.evaluate(() => {
      switchTab('game');
      document.getElementById('login-num-select').value = '1';
      submitStudentLogin();
    });

    // ── 主線解鎖鏈（離線 ⇒ 安全網退回軟鎖）：編號自動生成、未達門檻標「還差 N 分」但仍可進入 ──
    // 種子資料只有 connected:42（< 150）⇒ 第 2 關之後都應該未開啓。
    const lockView = await page.evaluate(() => {
      const read = id => {
        const b = document.getElementById('mode-tab-' + id);
        if (!b) return null;
        const chip = b.querySelector('.mode-stage-chip');
        return {
          text: b.textContent,
          chip: chip ? chip.textContent : null,
          locked: b.classList.contains('locked'),
          hard: b.classList.contains('hard-locked'),
          disabled: b.disabled === true
        };
      };
      return { connected: read('connected'), abbrev: read('abbrev'),
        feature: read('feature'), speed: read('speed'), survival: read('survival'),
        special: read('special') };
    });
    assert.equal(lockView.connected.chip, '1', '第一關編號為 1（依顯示順序自動生成）');
    assert.equal(lockView.connected.locked, false, '第一關永遠開啓');
    assert.equal(lockView.abbrev.chip, '2', '第二關編號為 2');
    assert.equal(lockView.abbrev.locked, true, 'connected 只有 42 分（<150）⇒ 第二關未開啓');
    assert.match(lockView.abbrev.text, /還差 108 分/, '未開啓要顯示還差幾分（150-42）');
    assert.equal(lockView.abbrev.disabled, false, '軟鎖：未開啓的關卡不得停用');
    // 離線（config 無 URL ⇒ 抓不到雲端權威分數）⇒ 安全網：一律不得出現真鎖。
    assert.equal(lockView.abbrev.hard, false, '離線不得真鎖——安全網');
    assert.equal(lockView.survival.hard, false, '離線不得真鎖——安全網');
    assert.equal(lockView.speed.chip, '挑戰', '挑戰線不編主線號，標「挑戰」');
    assert.equal(lockView.speed.locked, false, '挑戰線不鎖');
    // 生存已於 2026-10-14 由挑戰線搬入主線（真實站 6）⇒ 編號與門檻比照主線。
    assert.equal(lockView.survival.chip, '5', '生存是主線第 5 個可見關卡（真實站號 6）');
    assert.equal(lockView.survival.locked, true, 'omit 只有 0 分 ⇒ 生存未開啓');
    assert.match(lockView.survival.text, /還差 300 分/, '生存未開啓顯示還差 300 分（＝寵物 omit 的門檻）');
    assert.equal(lockView.survival.disabled, false, '軟鎖：未開啓的關卡不得停用');
    assert.equal(lockView.special.chip, '6', '難字順移為第 6 個可見關卡（真實站號 7）');
    assert.equal(lockView.special.locked, true, '生存 0 分 ⇒ 難字也未開啓');

    // 軟鎖：真的點下去仍然進得去（老師帶班、換電腦都不會被擋）
    await page.click('#mode-tab-abbrev');
    await page.waitForTimeout(250);
    const softLock = await page.evaluate(() => ({
      mode: currentGameMode,
      active: (document.getElementById('mode-tab-abbrev') || {}).className || '',
      section: document.getElementById('siege-arena-section').style.display,
      toast: (document.getElementById('pass-toast-banner') || {}).textContent || ''
    }));
    assert.equal(softLock.mode, 'abbrev', '未開啓的關卡仍可進入（軟鎖）');
    assert.match(softLock.active, /active/);
    assert.equal(softLock.section, 'block', '進入後應顯示該關的舞台');
    assert.match(softLock.toast, /先完成【連體字全碼突破】/, '進入未開啓的關卡要先提示一句');
    assert.match(softLock.toast, /還差 \d+ 分/);

    // 達門檻的那一刻：分頁自動開啓（不存任何解鎖旗標，純由分數算）
    await page.evaluate(() => { setGameMode('connected'); });
    const unlocked = await page.evaluate(() => {
      const before = document.getElementById('mode-tab-abbrev').classList.contains('locked');
      // 幫 connected 補到門檻（模擬學生練到 150 分）
      saveStudentStats('P5A', 1, 108, false, 'connected');
      const tab = document.getElementById('mode-tab-abbrev');
      return {
        before: before,
        after: tab.classList.contains('locked'),
        text: tab.textContent,
        chip: (tab.querySelector('.mode-stage-chip') || {}).textContent
      };
    });
    assert.equal(unlocked.before, true, '補分前第二關是鎖的');
    assert.equal(unlocked.after, false, 'connected 達 150 分後第二關自動開啓');
    assert.ok(!/還差/.test(unlocked.text), '開啓後不應再顯示「還差」：' + unlocked.text);
    assert.equal(unlocked.chip, '2', '開啓後仍保留關卡編號');

    // 站 6 的門檻：把寵物補到 300 ⇒ 生存跟著自動開啓（解鎖鏈多一節仍然自動接上）
    const survivalUnlock = await page.evaluate(() => {
      const before = document.getElementById('mode-tab-survival').classList.contains('locked');
      saveStudentStats('P5A', 1, 300, false, 'omit');
      const tab = document.getElementById('mode-tab-survival');
      const chip = tab.querySelector('.mode-stage-chip');
      return { before: before, after: tab.classList.contains('locked'),
        chip: chip ? chip.textContent : null, text: tab.textContent };
    });
    assert.equal(survivalUnlock.before, true, '補分前生存（站 6）是鎖的');
    assert.equal(survivalUnlock.after, false, 'omit 達 300 分後生存自動開啓');
    assert.ok(!/還差/.test(survivalUnlock.text), '開啓後不應再顯示「還差」：' + survivalUnlock.text);
    assert.equal(survivalUnlock.chip, '5', '開啓後仍保留主線編號（真實站號 6、畫面顯示第 5 關）');

    // ── 連體字（mech=code，基礎分 15）──
    // 強制抽 4 碼字：槽位標籤只在「碼數 ≥ 該槽」時才寫入，
    // 抽到 2 碼字時第 3／4 槽維持前一個模式留下的文字，觀察不到本模式的標籤。
    const connectedView = await page.evaluate(() => {
      setGameMode('connected');
      const four = DATA.connected_words.filter(w => (w.codes || []).length === 4)[0];
      modeQuizQueues['connected'] = [four];
      currentQuiz = null;
      loadRound();
      return {
        monster: document.getElementById('monster-icon').textContent,
        hint: document.getElementById('target-sub-hint').textContent,
        prompt: document.getElementById('game-prompt').textContent,
        color: document.getElementById('game-prompt').style.color,
        labels: [1, 2, 3, 4].map(i => document.getElementById('label-slot-' + i).textContent),
        codeLen: currentQuiz ? currentQuiz.codes.length : 0,
        arena: document.getElementById('capture-arena').style.display,
        stdRow: document.getElementById('standard-slots-row').style.display,
        splitRow: document.getElementById('split-slots-row').style.display,
        orbCount: document.getElementById('orbs-container').children.length,
        quiz: currentQuiz && currentQuiz.char
      };
    });
    assert.equal(connectedView.monster, '⚔️', '怪獸圖示取自 view');
    assert.match(connectedView.hint, /連體字全碼取碼/);
    assert.match(connectedView.prompt, /請依筆順依序捕捉/);
    assert.equal(connectedView.codeLen, 4, '已強制抽到 4 碼連體字');
    assert.deepEqual(connectedView.labels, ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼'], '連體字槽位標籤');
    assert.match(connectedView.color, /30, 58, 138/, '提示色取自 view.color');
    assert.equal(connectedView.arena, 'block', '捕捉球戰場應顯示');
    assert.equal(connectedView.stdRow, 'flex');
    assert.equal(connectedView.splitRow, 'none');
    assert.ok(connectedView.orbCount > 0, '應生成字根球');
    assert.ok(connectedView.quiz, '應抽到題目');

    let solved = await page.evaluate(SOLVE_ROUND, 'connected');
    assert.equal(solved.correctCount, 1, '一輪答對一次');
    assert.ok(solved.score > 0, '應得分');
    assert.ok(solved.score <= 15, '連體字基礎分上限 15：實得 ' + solved.score);
    assert.equal(solved.pending, 1, '本輪結果應累積一筆，5 題後集中送出');

    // ── 🧙 站 3：文字突圍・字靈倖存者（mech=siege，法陣守衛戰，這是本輪驗收重點）──
    // 先攔下 webhook，最後要驗「送出的 round 真的帶分數」（不是全 0）。
    await page.evaluate(() => {
      window.__siegePayload = null;
      window.sendReliableWebhook = (payload) => { window.__siegePayload = payload; };
    });
    await page.evaluate(() => setGameMode('abbrev'));
    const siegeReady = await page.evaluate(() => ({
      section: document.getElementById('siege-arena-section').style.display,
      arena: document.getElementById('capture-arena').style.display,
      runSection: document.getElementById('run-arena-section').style.display,
      tabActive: (document.getElementById('mode-tab-abbrev') || {}).className || '',
      active: siegeActive,
      state: siegeState,
      readyOverlay: document.getElementById('siege-ready-overlay').style.display,
      keycaps: document.getElementById('siege-roots-grid').childElementCount,
      canvasW: document.getElementById('siege-canvas').width,
      hp: document.getElementById('siege-hp-text').textContent
    }));
    assert.equal(siegeReady.section, 'block', '法陣模式應顯示自己的舞台');
    assert.equal(siegeReady.arena, 'none', '法陣模式不顯示捕捉球戰場');
    assert.equal(siegeReady.runSection, 'none', '法陣模式不顯示（已卸下的）跑酷舞台');
    assert.match(siegeReady.tabActive, /active/, '切到 abbrev 後，該分頁應為 active');
    assert.equal(siegeReady.active, true, '進場後 siegeActive 應為 true');
    assert.equal(siegeReady.state, 'READY', '進場先停在準備畫面，按開始才出怪');
    assert.equal(siegeReady.readyOverlay, 'flex', '準備覆蓋層應顯示');
    assert.equal(siegeReady.keycaps, 24, '底部速查欄應有 24 個倉頡字母卡');
    assert.ok(siegeReady.canvasW > 0, 'canvas 應已依容器尺寸初始化');
    assert.match(siegeReady.hp, /100 \/ 100/, '初始生命值 100');

    // 按開始 → 進入 PLAYING
    const siegeStarted = await page.evaluate(() => {
      siegeStartGame();
      return {
        state: siegeState,
        readyOverlay: document.getElementById('siege-ready-overlay').style.display,
        wave: siegeWave
      };
    });
    assert.equal(siegeStarted.state, 'PLAYING', '按開始後應進入戰鬥');
    assert.equal(siegeStarted.readyOverlay, 'none', '開始後準備覆蓋層應隱藏');
    assert.equal(siegeStarted.wave, 1, '從第 1 波開始');

    // 固定出題：清掉本機掌握進度 → 只放指定題目 → 生成一隻字靈（避免自動出怪干擾）
    const siegeSpawned = await page.evaluate(() => {
      if (currentStudent) {
        window.localStorage.removeItem(`p5_mastery_${currentStudent.cls}_${currentStudent.num}`);
      }
      const word = DATA.abbrev_words.find(w => w.keys.length >= 3) || DATA.abbrev_words[0];
      siegeEnemies = [];
      siegeQueue = [word];
      siegeSpawnEnemy(performance.now());
      siegeSpawnInterval = 999999;   // 測試期間不再自動出怪
      siegeLastSpawnAt = performance.now();
      const e = siegeEnemies[0];
      return {
        count: siegeEnemies.length,
        char: e ? e.char : '',
        keys: e ? e.keys.slice() : [],
        expectedKeys: word.keys.slice(),
        inPool: !!e && DATA.abbrev_words.some(w => w.char === e.char)
      };
    });
    assert.equal(siegeSpawned.count, 1, '應生成一隻字靈');
    assert.ok(siegeSpawned.inPool, '字靈必須來自 abbrev_words 字庫（站 3 字庫）');
    assert.deepEqual(siegeSpawned.keys, siegeSpawned.expectedKeys, '字靈帶著該字的完整拆碼');

    // 完整打對才擊破：中途按錯 → 中斷鎖定並重置該字
    const siegeMiss = await page.evaluate(() => {
      const e = siegeEnemies[0];
      const wrong = e.keys[0] === 'A' ? 'B' : 'A';
      siegeInputKey(wrong);
      const after = {
        misses: siegeMissCount,
        typed: e.typedIndex,
        locked: siegeActiveTarget === null,
        kills: siegeKills
      };
      // 先按對第一碼鎖定，再按錯第二碼 → 進度歸零
      siegeInputKey(e.keys[0]);
      const lockedNow = siegeActiveTarget === e;
      const typedNow = e.typedIndex;
      const wrong2 = e.keys[1] === 'A' ? 'B' : 'A';
      siegeInputKey(wrong2);
      return {
        firstMiss: after.misses,
        firstTyped: after.typed,
        firstLocked: after.locked,
        kills: after.kills,
        lockedNow: lockedNow,
        typedNow: typedNow,
        typedAfterWrong: e.typedIndex,
        misses: siegeMissCount
      };
    });
    assert.equal(siegeMiss.firstMiss, 1, '首碼按錯應記一次失誤');
    assert.equal(siegeMiss.firstTyped, 0, '首碼按錯不應推進拆碼');
    assert.equal(siegeMiss.firstLocked, true, '按錯時不應鎖定目標');
    assert.equal(siegeMiss.kills, 0, '按錯不應擊破任何字靈');
    assert.equal(siegeMiss.lockedNow, true, '按對首碼後應鎖定該字靈');
    assert.equal(siegeMiss.typedNow, 1, '按對首碼應推進一碼');
    assert.equal(siegeMiss.typedAfterWrong, 0, '鎖定後按錯要重新拆解（完整打完才計分）');

    // 打完整字的碼 → 擊破 → 累積計分名單
    const siegeKill = await page.evaluate(() => {
      const e = siegeEnemies[0];
      for (let i = 0; i < e.keys.length; i++) siegeInputKey(e.keys[i]);
      return {
        kills: siegeKills,
        pending: siegeRoundResults.length,
        char: siegeRoundResults[0] ? siegeRoundResults[0].char : '',
        earned: siegeLastEarned,
        scoreText: document.getElementById('siege-score-val').textContent,
        enemiesLeft: siegeEnemies.length
      };
    });
    assert.equal(siegeKill.kills, 1, '完整打完應擊破一隻字靈');
    assert.equal(siegeKill.pending, 1, '擊破的字應進入計分名單');
    assert.equal(siegeKill.char, siegeSpawned.char, '計分名單記的是剛擊破的字');
    assert.ok(siegeKill.earned > 0, '今天第一次擊破應可計分：' + siegeKill.earned);
    assert.match(siegeKill.scoreText, /^\+[1-9]/);
    assert.equal(siegeKill.enemiesLeft, 0, '擊破後字靈應從場上移除');

    // 等擊破動畫播完（下一幀才移除實體，這裡再等一下確認畫面穩定）
    await page.waitForTimeout(120);

    // ★ 真實鍵盤事件：驗證 window keydown（siegeHandleKeydown）真的接上（學生是真的在打字）
    const siegeKeyboard = await page.evaluate(() => {
      siegeEnemies = [];
      siegeSpawnInterval = 999999;
      const word = DATA.abbrev_words.find(w => w.keys.length === 2) || DATA.abbrev_words[0];
      siegeQueue = [word];
      siegeSpawnEnemy(performance.now());
      siegeLastSpawnAt = performance.now();
      return { char: siegeEnemies[0].char, keys: siegeEnemies[0].keys.slice() };
    });
    for (const k of siegeKeyboard.keys) {
      await page.keyboard.press(k.toLowerCase());
      await page.waitForTimeout(40);
    }
    const siegeKeyboardDone = await page.evaluate(() => ({
      kills: siegeKills,
      pending: siegeRoundResults.length,
      last: siegeRoundResults.length
        ? siegeRoundResults[siegeRoundResults.length - 1].char : '',
      typedTotal: siegeTotalKeys
    }));
    assert.equal(siegeKeyboardDone.kills, 2, '真實鍵盤事件應能擊破字靈（keydown 已接上）');
    assert.equal(siegeKeyboardDone.last, siegeKeyboard.char, '最後擊破的字應是鍵盤打的那隻');
    assert.ok(siegeKeyboardDone.pending >= 2, '兩次擊破都應進入計分名單');

    // 核心循環：自動出怪（主循環會依間隔生成）
    const siegeAuto = await page.evaluate(async () => {
      siegeEnemies = [];
      siegeSpawnInterval = 60;
      siegeLastSpawnAt = 0;
      await new Promise(r => setTimeout(r, 400));
      return { spawned: siegeEnemies.length };
    });
    assert.ok(siegeAuto.spawned > 0, '主循環應會自動出怪：' + siegeAuto.spawned);

    // 字靈抵達法陣 → 扣血（但不扣分）
    const siegeDamage = await page.evaluate(async () => {
      siegeEnemies = [];
      siegeSpawnInterval = 999999;
      siegeSpawnInterval = 999999;
      const word = DATA.abbrev_words[0];
      siegeQueue = [word];
      siegeSpawnEnemy(performance.now());
      const e = siegeEnemies[0];
      const hpBefore = siegePlayer.hp;
      const pendingBefore = siegeRoundResults.length;
      // 放到法陣邊上，下一幀就會撞上
      e.x = siegeSize.w / 2 + (siegePlayer.radius + 12);
      e.y = siegeSize.h / 2;
      await new Promise(r => setTimeout(r, 350));
      return {
        hpBefore: hpBefore,
        hpAfter: siegePlayer.hp,
        killed: siegeEnemies.length,
        pendingAdded: siegeRoundResults.length - pendingBefore,
        misses: siegeMissCount
      };
    });
    assert.ok(siegeDamage.hpAfter < siegeDamage.hpBefore,
      '字靈撞到法陣應扣血：' + siegeDamage.hpBefore + ' → ' + siegeDamage.hpAfter);
    assert.equal(siegeDamage.killed, 0, '撞擊後字靈應消失');
    assert.equal(siegeDamage.pendingAdded, 0, '撞上法陣的字靈不算擊破、不進計分名單');

    // 大招「天火破界」：清場但不計分
    const siegeUlt = await page.evaluate(async () => {
      siegeEnemies = [];
      const words = DATA.abbrev_words.slice(1, 4);
      words.forEach(w => { siegeQueue = [w]; siegeSpawnEnemy(performance.now()); siegeLastSpawnAt = performance.now(); });
      const spawned = siegeEnemies.length;
      const pendingBefore = siegeRoundResults.length;
      siegePlayer.ultimate = 100;
      siegeCastUltimate();
      await new Promise(r => setTimeout(r, 120));
      return {
        spawned: spawned,
        left: siegeEnemies.filter(e => !e.markedForDeath).length,
        pendingAdded: siegeRoundResults.length - pendingBefore,
        charge: siegePlayer.ultimate,
        killsAdded: siegeKills
      };
    });
    assert.ok(siegeUlt.spawned > 0, '大招前應有字靈在場上');
    assert.equal(siegeUlt.left, 0, '大招應清空場上字靈');
    assert.equal(siegeUlt.pendingAdded, 0, '大招清掉的字靈不列入計分（不是自己拆的碼）');
    assert.equal(siegeUlt.charge, 0, '施放大招後充能歸零');

    // 休息結算 → 送出的 payload 必須帶 earned，且切回連體字
    const siegeRest = await page.evaluate(() => {
      const pending = siegeRoundResults.length;
      siegeRestHere();
      return {
        pending: pending,
        earned: siegeLastEarned,
        previewText: document.getElementById('siege-earned-preview').textContent,
        active: siegeActive,
        section: document.getElementById('siege-arena-section').style.display,
        arena: document.getElementById('capture-arena').style.display,
        tabActive: (document.getElementById('mode-tab-connected') || {}).className || '',
        payload: window.__siegePayload
      };
    });
    assert.ok(siegeRest.pending > 0, '休息前應已累積擊破結果');
    assert.ok(siegeRest.earned > 0, '休息時應算出預估得分：' + siegeRest.earned);
    assert.match(siegeRest.previewText, /^\+[1-9]/, '結算預覽應顯示正分');
    assert.equal(siegeRest.active, false, '休息後應結束法陣模式');
    assert.equal(siegeRest.section, 'none', '休息後法陣舞台應隱藏');
    assert.equal(siegeRest.arena, 'block', '休息後應切回連體字的捕捉球戰場');
    assert.match(siegeRest.tabActive, /active/, '休息後分頁應回到連體字');
    // ★ 計分／存分驗收：送出的 round 必須帶分數（回歸：全 0 等於學生白打）
    const payload = siegeRest.payload;
    assert.ok(payload, '結算應呼叫 sendReliableWebhook');
    assert.equal(payload.gameMode, 'abbrev', 'payload 的模式代號');
    assert.equal(payload.scoreDelta, 0, '前端不自行宣稱分數（由後端依 round 判定）');
    assert.ok(payload.round.length >= 2, 'payload 應帶本場所有擊破的字');
    assert.ok(payload.round.every(r => r.correct === true), 'round 每一筆都要是答對的');
    assert.ok(payload.round.every(r => r.earned > 0),
      '★ round 每一筆都要帶 earned（全 0 是 2026-10-14 修掉的舊 bug）：' + JSON.stringify(payload.round));
    assert.ok(payload.round.some(r => r.char === siegeSpawned.char), '第一次擊破的字應在 round 裡');

    // ── ④ 站 4：字形特徵原則（mech=code，新開的模式）──
    const featureView = await page.evaluate(() => {
      setGameMode('feature');
      const four = DATA.feature_words.filter(w => (w.codes || []).length === 4)[0];
      modeQuizQueues['feature'] = [four];
      currentQuiz = null;
      loadRound();
      return {
        monster: document.getElementById('monster-icon').textContent,
        hint: document.getElementById('target-sub-hint').textContent,
        prompt: document.getElementById('game-prompt').textContent,
        color: document.getElementById('game-prompt').style.color,
        labels: [1, 2, 3, 4].map(i => document.getElementById('label-slot-' + i).textContent),
        codeLen: currentQuiz ? currentQuiz.codes.length : 0,
        quizChar: currentQuiz && currentQuiz.char,
        inPool: !!(currentQuiz && DATA.feature_words.some(w => w.char === currentQuiz.char)),
        activeTab: (document.getElementById('mode-tab-feature') || {}).className || ''
      };
    });
    assert.equal(featureView.monster, '🔷', '字形特徵模式有自己的怪獸圖示');
    assert.match(featureView.hint, /字形特徵原則/, '提示文字取自註冊表 view.hint');
    assert.match(featureView.prompt, /字形特徵/, '題目提示取自註冊表 view.prompt');
    assert.equal(featureView.codeLen, 4, '已強制抽到 4 碼字形特徵字');
    assert.deepEqual(featureView.labels, ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼'], '字形特徵模式槽位標籤');
    assert.ok(featureView.quizChar, '應抽到題目');
    assert.ok(featureView.inPool, '抽到的字必須來自 feature_words 字庫');
    assert.match(featureView.activeTab, /active/, '切到 feature 後，該分頁應為 active');
    const featureSolved = await page.evaluate(SOLVE_ROUND, 'feature');
    assert.equal(featureSolved.correctCount, 1, '字形特徵模式一輪答對一次');
    assert.ok(featureSolved.score > 0 && featureSolved.score <= 15,
      '字形特徵模式基礎分上限 15：實得 ' + featureSolved.score);
    assert.notEqual(featureView.color, connectedView.color, '字形特徵提示色與連體字不同');

    // ── 🐣 站 5：包含省略原則（mech=pet，全新玩法：餵食 → 累積經驗 → 進化）──
    await page.evaluate(() => setGameMode('omit'));
    const petView = await page.evaluate(() => ({
      section: document.getElementById('pet-arena-section').style.display,
      arena: document.getElementById('capture-arena').style.display,
      tabActive: (document.getElementById('mode-tab-omit') || {}).className || '',
      stage: document.getElementById('pet-stage-badge').textContent,
      char: document.getElementById('pet-target-char').textContent,
      slotCount: document.getElementById('pet-slots-row').children.length,
      inPool: !!(petWordList[petIdx] && DATA.omit_words.some(w => w.char === petWordList[petIdx].char))
    }));
    assert.equal(petView.section, 'block', '寵物養成應顯示自己的競技場');
    assert.equal(petView.arena, 'none', '寵物養成不顯示捕捉球戰場');
    assert.match(petView.tabActive, /active/, '切到 omit 後，該分頁應為 active');
    assert.ok(petView.char, '應抽到題目');
    assert.ok(petView.slotCount > 0, '應生成字碼槽位');
    assert.ok(petView.inPool, '題目必須來自 omit_words 字庫');

    // 多碼字的槽位數＝碼數（回歸：5 碼字「麗」不可只顯示 4 格）
    const petFive = await page.evaluate(() => {
      const li = DATA.omit_words.find(w => w.char === '麗');
      if (!li) return null;
      petWordList = [li]; petIdx = 0; petInputCodes = []; petWordReadyForSpace = false;
      document.getElementById('pet-target-char').textContent = li.char;
      renderPetSlots();
      return { codes: li.codes.length, slots: document.getElementById('pet-slots-row').children.length };
    });
    if (petFive) {
      assert.equal(petFive.slots, petFive.codes, '槽位數應等於碼數（「麗」5 碼 → 5 格）');
    }

    // 提示計時器必須隨「答對一碼」推進到下一碼（回歸：提示永遠卡在第 1 碼）
    // 注意：probe 會動到 petCorrectCount／petMistakeCount，驗完要歸零以免污染後續斷言。
    const hintProbe = async () => {
      await page.evaluate(() => {
        const li = DATA.omit_words.find(w => w.char === '麗');
        petWordList = [li]; petIdx = 0; petInputCodes = []; petWordReadyForSpace = false;
        document.getElementById('pet-target-char').textContent = li.char;
        renderPetSlots();
        startPetHintTimer();
      });
      await page.waitForTimeout(3200);
      const first = await page.evaluate(() => {
        const g = document.querySelector('#pet-slots-row .hint-glow');
        return { slot: g ? g.id : null, text: document.getElementById('pet-feed-hint').textContent };
      });
      // 答對第 1 碼 → 提示文字應立刻還原成題目說明
      const cleared = await page.evaluate(() => {
        processPetKeyInput('M');
        const g = document.querySelector('#pet-slots-row .hint-glow');
        return { slot: g ? g.id : null, text: document.getElementById('pet-feed-hint').textContent };
      });
      await page.waitForTimeout(3200);
      const second = await page.evaluate(() => {
        const g = document.querySelector('#pet-slots-row .hint-glow');
        return { slot: g ? g.id : null, text: document.getElementById('pet-feed-hint').textContent };
      });
      // 歸零 probe 造成的計數偏移，並把題目還原成正常出題
      await page.evaluate(() => {
        petCorrectCount = 0; petMistakeCount = 0; petStreak = 0;
        petInputCodes = []; petWordReadyForSpace = false;
        if (petHintTimer) clearTimeout(petHintTimer);
        petWordList = []; petIdx = 0;
        loadPetWord();
      });
      return { first, cleared, second };
    };
    const hp = await hintProbe();
    assert.equal(hp.first.slot, 'pet-slot-0', '第 1 碼提示應亮在第 1 格');
    assert.match(hp.first.text, /提示：這個碼是【一】/, '第 1 碼提示內容');
    assert.equal(hp.cleared.slot, null, '答對後應先清掉舊提示');
    assert.equal(hp.second.slot, 'pet-slot-1', '提示應推進到第 2 格（回歸：修復前會卡在 pet-slot-0）');
    assert.match(hp.second.text, /提示：這個碼是【一】，按鍵 M/, '第 2 碼提示應對應第 2 碼（麗＝一一月月心）');

    // 餵食正確一字：經驗增加、連擊 +1、寵物心情更新
    const petFed = await page.evaluate(() => {
      const expBefore = petProgress.exp;
      const word = petWordList[petIdx];
      word.keys.forEach(k => processPetKeyInput(k));   // 全對
      const ready = petWordReadyForSpace;
      confirmPetWordSpace();                            // 送出餵食
      return {
        expBefore: expBefore,
        expAfter: petProgress.exp,
        persisted: loadPetProgress().exp,
        fed: petCorrectCount,
        streak: petStreak,
        ready: ready,
        stageBadge: document.getElementById('pet-stage-badge').textContent,
        mood: document.getElementById('pet-mood-val').textContent
      };
    });
    assert.equal(petFed.ready, true, '字碼全對後應等待空白鍵');
    assert.equal(petFed.fed, 1, '餵食次數應累加');
    assert.equal(petFed.streak, 1, '餵食成功連擊應為 1');
    assert.ok(petFed.expAfter > petFed.expBefore,
      '餵食後經驗應增加：' + petFed.expBefore + ' → ' + petFed.expAfter);
    assert.equal(petFed.persisted, petFed.expAfter, '經驗應寫回本機（每生一份進度）');
    assert.ok(petFed.stageBadge.length > 0, '應顯示寵物階段');
    assert.ok(petFed.mood.length > 0, '應顯示寵物心情');

    // 答錯只斷連擊、不扣命（與生存模式的懲罰刻意不同）
    const petWrong = await page.evaluate(() => {
      const word = petWordList[petIdx];
      const wrongKey = word.keys[0] === 'A' ? 'B' : 'A';
      processPetKeyInput(wrongKey);
      return {
        streak: petStreak, mistakes: petMistakeCount, fed: petCorrectCount,
        sad: document.getElementById('pet-figure').classList.contains('pet-sad')
      };
    });
    assert.equal(petWrong.streak, 0, '答錯應打斷連擊');
    assert.equal(petWrong.mistakes, 1, '失誤次數應累加');
    assert.equal(petWrong.fed, 1, '答錯不影響已餵食次數');
    assert.equal(petWrong.sad, true, '答錯時寵物應出現失望動畫');

    // 經驗跨門檻 → 進化（把經驗直接墊到門檻前一格再餵一次）
    const evolved = await page.evaluate(() => {
      const before = petStageFor(petProgress.exp);
      if (!before.next) return { hadNext: false };
      petProgress.exp = before.next.minExp - 1;   // 差 1 點就進化
      savePetProgress();
      renderPetStage();
      loadPetWord();                              // 換一題乾淨的
      const word = petWordList[petIdx];
      word.keys.forEach(k => processPetKeyInput(k));
      confirmPetWordSpace();
      const after = petStageFor(petProgress.exp);
      return {
        hadNext: true,
        beforeIdx: before.idx, afterIdx: after.idx,
        beforeStage: before.stage.emoji, afterStage: after.stage.emoji,
        flash: document.getElementById('pet-evolve-flash').style.display === 'flex',
        flashName: document.getElementById('pet-evolve-name').textContent
      };
    });
    assert.equal(evolved.hadNext, true, '蛋階段應有下一階段（可進化）');
    assert.ok(evolved.afterIdx > evolved.beforeIdx,
      '跨過經驗門檻後寵物應進化：階段 ' + evolved.beforeIdx + ' → ' + evolved.afterIdx);
    assert.notEqual(evolved.afterStage, evolved.beforeStage, '進化後寵物圖示應改變');
    assert.equal(evolved.flash, true, '進化應觸發全螢幕變身特效');
    assert.ok(evolved.flashName.length > 0, '變身特效應顯示新階段名稱');

    // 休息結算：把本輪結果轉成後端可認的 round，並回到連體字
    const petRest = await page.evaluate(() => {
      const pendingBefore = petRoundResults.length;
      petRestHere();
      return {
        pendingBefore: pendingBefore,
        earned: lastPetEarned,
        active: petActive,
        section: document.getElementById('pet-arena-section').style.display,
        arena: document.getElementById('capture-arena').style.display,
        tabActive: (document.getElementById('mode-tab-connected') || {}).className || ''
      };
    });
    assert.ok(petRest.pendingBefore > 0, '休息前應已累積餵食結果');
    assert.ok(petRest.earned >= 0, '休息時應算出預估得分：' + petRest.earned);
    assert.equal(petRest.active, false, '休息後應結束寵物養成');
    assert.equal(petRest.section, 'none', '休息後寵物競技場應隱藏');
    assert.equal(petRest.arena, 'block', '休息後應切回連體字的捕捉球戰場');
    assert.match(petRest.tabActive, /active/, '休息後分頁應回到連體字');

    // ── 難字（mech=code，基礎分 10、標籤與提示不同）──
    const specialView = await page.evaluate(() => {
      setGameMode('special');
      const four = DATA.special_words.filter(w => (w.codes || []).length === 4)[0];
      modeQuizQueues['special'] = [four];
      currentQuiz = null;
      loadRound();
      return {
        monster: document.getElementById('monster-icon').textContent,
        hint: document.getElementById('target-sub-hint').textContent,
        color: document.getElementById('game-prompt').style.color,
        labels: [1, 2, 3, 4].map(i => document.getElementById('label-slot-' + i).textContent),
        visibleSlots: [1, 2, 3, 4].filter(i => document.getElementById('slot-' + i).style.display !== 'none').length,
        codeLen: currentQuiz ? currentQuiz.codes.length : 0,
        quiz: currentQuiz && currentQuiz.char
      };
    });
    assert.equal(specialView.monster, '🔮', '難字模式有自己的怪獸圖示');
    assert.match(specialView.hint, /特殊取碼規則特訓/);
    assert.equal(specialView.codeLen, 4, '已強制抽到 4 碼難字');
    assert.equal(specialView.visibleSlots, 4);
    assert.deepEqual(specialView.labels, ['① 首碼', '② 次碼', '③ 尾碼', '④ 末碼'],
      '難字模式的槽位標籤整組取自註冊表（與連體字的「③ 三碼／④ 尾碼」不同）');
    assert.notEqual(specialView.color, connectedView.color, '難字提示色與連體字不同');
    assert.ok(specialView.quiz);
    solved = await page.evaluate(SOLVE_ROUND, 'special');
    assert.ok(solved.score > 0 && solved.score <= 10,
      '難字基礎分上限 10（比連體字低）：實得 ' + solved.score);

    // ── 分體字（mech=twoPart，字首＋字身兩段）──
    await page.evaluate(() => setGameMode('split'));
    const splitView = await page.evaluate(() => ({
      monster: document.getElementById('monster-icon').textContent,
      hint: document.getElementById('target-sub-hint').textContent,
      prompt: document.getElementById('game-prompt').textContent,
      stdRow: document.getElementById('standard-slots-row').style.display,
      splitRow: document.getElementById('split-slots-row').style.display,
      quiz: currentQuiz && currentQuiz.char
    }));
    assert.equal(splitView.monster, '🧩');
    assert.match(splitView.hint, /分體字取碼/);
    assert.match(splitView.prompt, /字首|字身/, '分體字的提示文字說明字首／字身');
    assert.equal(splitView.stdRow, 'none');
    assert.equal(splitView.splitRow, 'flex', '分體字應顯示字首／字身槽位');
    assert.ok(splitView.quiz);
    solved = await page.evaluate(SOLVE_ROUND, 'split');
    assert.ok(solved.filledPrefix.length > 0 && solved.filledBody.length > 0,
      '字首與字身都應被填滿');
    assert.ok(solved.score > 0 && solved.score <= 15, '分體字基礎分 15：實得 ' + solved.score);

    // ── 手速賽（mech=timed）：切換回備戰大廳，戰場隱藏 ──
    await page.evaluate(() => setGameMode('speed'));
    const speedView = await page.evaluate(() => ({
      speed: document.getElementById('speed-arena-section').style.display,
      arena: document.getElementById('capture-arena').style.display,
      tabs: document.querySelectorAll('.mode-tab-btn.active').length
    }));
    assert.equal(speedView.speed, 'block');
    assert.equal(speedView.arena, 'none', '限時模式不應顯示捕捉球戰場');
    assert.equal(speedView.tabs, 1, '同時只有一個分頁為 active');

    // ── 💀 生存模式（mech=survival）：備戰說明 → 開局 5 命 → 答錯扣命／答對累積連擊 → 命用完結算 ──
    await page.evaluate(() => setGameMode('survival'));
    const survivalReady = await page.evaluate(() => ({
      section: document.getElementById('survival-arena-section').style.display,
      ready: document.getElementById('survival-ready-stage').style.display,
      main: document.getElementById('survival-main-stage').style.display,
      arena: document.getElementById('capture-arena').style.display,
      tabActive: (document.getElementById('mode-tab-survival') || {}).className || ''
    }));
    assert.equal(survivalReady.section, 'block', '生存模式應顯示自己的競技場');
    assert.equal(survivalReady.ready, 'block', '先顯示備戰說明，不直接開始');
    assert.equal(survivalReady.main, 'none');
    assert.equal(survivalReady.arena, 'none', '生存模式不顯示捕捉球戰場');
    assert.match(survivalReady.tabActive, /active/, '切到 survival 後，該分頁應為 active');

    // 開局：5 條命、連擊歸零、題目來自 survival 的 pool
    const survivalStart = await page.evaluate(() => {
      launchSurvivalMatch();
      return {
        active: survivalActive,
        lives: survivalLives,
        maxLives: SURVIVAL_MAX_LIVES,
        combo: survivalCombo,
        main: document.getElementById('survival-main-stage').style.display,
        ready: document.getElementById('survival-ready-stage').style.display,
        char: document.getElementById('survival-target-char').textContent,
        inPool: !!(survivalWordList[survivalIdx]
          && DATA[MODE_REGISTRY.poolOf('survival')].some(w => w.char === survivalWordList[survivalIdx].char)),
        slotCount: document.getElementById('survival-slots-row').children.length,
        hearts: document.querySelectorAll('#survival-lives-row .survival-heart.alive').length
      };
    });
    assert.equal(survivalStart.active, true, '開局後 survivalActive 應為 true');
    assert.equal(survivalStart.lives, 5, '開局應有 5 條命：實際 ' + survivalStart.lives);
    assert.equal(survivalStart.maxLives, 5, '生命上限常數應為 5');
    assert.equal(survivalStart.combo, 0, '開局連擊應為 0');
    assert.equal(survivalStart.hearts, 5, '生命 HUD 應渲染 5 顆滿心');
    assert.equal(survivalStart.main, 'block');
    assert.equal(survivalStart.ready, 'none');
    assert.ok(survivalStart.inPool, '題目必須來自 survival 指定的字庫');
    assert.ok(survivalStart.slotCount > 0, '應生成字碼槽位');

    // 答錯一次：扣 1 條命（而非扣秒）
    const afterWrong = await page.evaluate(() => {
      const before = survivalLives;
      const word = survivalWordList[survivalIdx];
      const wrongKey = word.keys[0] === 'A' ? 'B' : 'A';   // 保證與首碼不同
      processSurvivalKeyInput(wrongKey);
      return {
        lost: before - survivalLives,
        lives: survivalLives,
        mistakes: survivalMistakeCount,
        combo: survivalCombo,
        hearts: document.querySelectorAll('#survival-lives-row .survival-heart.alive').length
      };
    });
    assert.equal(afterWrong.lost, 1, '答錯應扣 1 條命：實際扣 ' + afterWrong.lost);
    assert.equal(afterWrong.lives, 4, '剩餘命數應為 4');
    assert.equal(afterWrong.hearts, 4, '生命 HUD 應剩 4 顆滿心');
    assert.equal(afterWrong.mistakes, 1, '失誤次數應累加');
    assert.equal(afterWrong.combo, 0, '答錯應打斷連擊');

    // 答對一字：連擊 +1（不再加秒）
    const afterCorrect = await page.evaluate(() => {
      const word = survivalWordList[survivalIdx];
      word.keys.forEach(k => processSurvivalKeyInput(k));   // 全對
      const readyForSpace = survivalWordReadyForSpace;
      confirmSurvivalWordSpace();                           // 送出
      return {
        combo: survivalCombo,
        maxCombo: survivalMaxCombo,
        correct: survivalCorrectCount,
        readyForSpace: readyForSpace,
        pending: survivalRoundResults.length,
        lastMult: survivalRoundResults[survivalRoundResults.length - 1].multiplier
      };
    });
    assert.equal(afterCorrect.correct, 1, '答對字數應累加');
    assert.equal(afterCorrect.combo, 1, '答對一字連擊應為 1');
    assert.equal(afterCorrect.readyForSpace, true, '字碼全對後應等待空白鍵');
    assert.equal(afterCorrect.pending, 1, '逐字結果應累積，結束時一次送出');
    assert.equal(afterCorrect.lastMult, 1, '連擊 1 時倍率為 ×1');

    // 連擊倍率門檻：連擊 5 → ×1.5、10 → ×2、20 → ×3
    const tiers = await page.evaluate(() => {
      const out = {};
      [1, 4, 5, 9, 10, 19, 20].forEach(n => { survivalCombo = n; out[n] = survivalComboMultiplier(); });
      return out;
    });
    assert.equal(tiers[1], 1, '連擊 1 → ×1');
    assert.equal(tiers[4], 1, '連擊 4 → ×1（未達門檻）');
    assert.equal(tiers[5], 1.5, '連擊 5 → ×1.5');
    assert.equal(tiers[10], 2, '連擊 10 → ×2');
    assert.equal(tiers[20], 3, '連擊 20 → ×3');

    // 命用完（扣至 0）→ 自動結算
    const finished = await page.evaluate(() => {
      survivalCombo = 7;                      // 製造一個連擊以驗證結算卡
      survivalMaxCombo = 7;
      survivalLives = 0;                      // 直接模擬命耗盡
      // 用一次答錯觸發生命歸零判定路徑
      survivalLives = 1;
      const word = survivalWordList[survivalIdx];
      const wrongKey = word.keys[0] === 'A' ? 'B' : 'A';
      processSurvivalKeyInput(wrongKey);      // 最後一命
      return {
        active: survivalActive,
        main: document.getElementById('survival-main-stage').style.display,
        finish: document.getElementById('survival-finish-box').style.display,
        correctStat: document.getElementById('survival-stat-correct').textContent,
        comboStat: document.getElementById('survival-stat-combo').textContent,
        earnedStat: document.getElementById('survival-stat-earned').textContent
      };
    });
    assert.equal(finished.active, false, '命用完後應結束');
    assert.equal(finished.main, 'none');
    assert.equal(finished.finish, 'block', '應顯示結算卡');
    assert.match(finished.correctStat, /1 字/, '結算卡顯示答對字數');
    assert.match(finished.comboStat, /7 連/, '結算卡顯示最高連擊');
    assert.match(finished.earnedStat, /^-?\d+ 分$|^\+-?\d+ 分$/, '結算卡顯示得分');

    // 返回備戰說明
    const backToReady = await page.evaluate(() => {
      returnToSurvivalReadyStage();
      return {
        ready: document.getElementById('survival-ready-stage').style.display,
        finish: document.getElementById('survival-finish-box').style.display
      };
    });
    assert.equal(backToReady.ready, 'block');
    assert.equal(backToReady.finish, 'none');

    // 切回連體字：證明模式之間可自由切換且不殘留狀態
    await page.evaluate(() => setGameMode('connected'));
    const back = await page.evaluate(() => ({
      arena: document.getElementById('capture-arena').style.display,
      monster: document.getElementById('monster-icon').textContent,
      quiz: currentQuiz && currentQuiz.char
    }));
    assert.equal(back.arena, 'block');
    assert.equal(back.monster, '⚔️');
    assert.ok(back.quiz, '切回後應重新抽到題目');

    // ═══════════════════════════════════════════════════════════════════════
    // 🎭 mock 雲端：真鎖＋安全網＋教師全開（2026-10-14 使用者定案）
    //   - 雲端榜單帶著每人的分項分數 ⇒ 解鎖用「權威分數」，換電腦也能回復進度。
    //   - 有權威分數＋已登入 ⇒ 未達標真擋（點擊只提示）；離線／未登入 ⇒ 安全網退回軟鎖。
    //   - ?teacher=1 教師全開（左下角徽章；點徽章即關閉、恢復真鎖）。
    // ═══════════════════════════════════════════════════════════════════════
    const mockPayload = {
      status: 'success',
      combatLeaderboard: [
        { cls: 'P5A', num: 1, name: 'P5A 01號', score: 210, grandTotal: 210, totalScore: 210,
          kills: 4, title: '🥈【資深訓練家】', badge: '🥈【資深訓練家】',
          modeScores: { connected: 210 } }
      ]
    };
    const mockContext = await browser.newContext();
    await mockContext.route('**/*', route => {
      const u = route.request().url();
      if (u.startsWith(mockUrl)) return route.continue();
      if (u.startsWith('https://gas.example.test/')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(mockPayload) });
      }
      return route.abort();
    });
    const mp = await mockContext.newPage();
    mp.on('pageerror', e => errors.push('mock: ' + e.message));

    await mp.goto(mockUrl);
    await mp.waitForFunction(() => typeof setGameMode === 'function');
    await mp.evaluate(() => switchTab('game'));

    // ① 未登入：即使雲端榜單可用也不得真鎖（安全網——還沒登入就被擋會出意外）。
    const mockBeforeLogin = await mp.evaluate(() => ({
      locked: document.getElementById('mode-tab-abbrev').classList.contains('locked'),
      hard: document.getElementById('mode-tab-abbrev').classList.contains('hard-locked')
    }));
    assert.equal(mockBeforeLogin.locked, true, '未登入沒有分數 ⇒ 第二關未開啓');
    assert.equal(mockBeforeLogin.hard, false, '未登入不得真鎖（安全網）');

    // ② 登入 → 立刻抓雲端 ⇒ 分項併入本機（＝換電腦情境：B 機本機沒分數，靠雲端回復）
    await mp.evaluate(() => {
      document.getElementById('login-num-select').value = '1';
      submitStudentLogin();
    });
    await mp.waitForFunction(() => typeof cloudScoresKnown !== 'undefined' && cloudScoresKnown === true,
      null, { timeout: 8000 });
    await mp.waitForFunction(() => currentModeScores().connected === 210, null, { timeout: 8000 });

    const mockMerged = await mp.evaluate(() => {
      const stats = getStudentStats('P5A', 1);
      const ls = JSON.parse(window.localStorage.getItem('p5_score_P5A_1') || '{}');
      return {
        connected: stats.modeScores.connected,
        stored: (ls.modeScores || {}).connected,
        abbrevLocked: document.getElementById('mode-tab-abbrev').classList.contains('locked'),
        featureLocked: document.getElementById('mode-tab-feature').classList.contains('locked'),
        featureHard: document.getElementById('mode-tab-feature').classList.contains('hard-locked'),
        featureText: document.getElementById('mode-tab-feature').textContent
      };
    });
    assert.equal(mockMerged.connected, 210, '雲端分項分數應併入本機（換電腦回復進度）');
    assert.equal(mockMerged.stored, 210, '雲端分項要寫回 localStorage（離線後仍保得住）');
    assert.equal(mockMerged.abbrevLocked, false, 'connected 雲端 210 ≥ 150 ⇒ 第二關開啓');
    assert.equal(mockMerged.featureLocked, true, 'abbrev 未達 200 ⇒ 第三關仍鎖');
    assert.equal(mockMerged.featureHard, true, '有雲端權威分數且已登入 ⇒ 第三關是真鎖');
    assert.match(mockMerged.featureText, /還差 200 分/);

    // ③ 真鎖：點未達標的關卡 → 不切換、只出提示
    const mockHardClick = await mp.evaluate(() => {
      document.getElementById('mode-tab-feature').click();
      return {
        mode: currentGameMode,
        toast: (document.getElementById('pass-toast-banner') || {}).textContent || ''
      };
    });
    assert.equal(mockHardClick.mode, 'connected', '真鎖：未達標的關卡點了不得切換');
    assert.match(mockHardClick.toast, /達標後才能進入/, '應提示達標後才能進入：' + mockHardClick.toast);

    // 已開啓的關卡照常進入
    await mp.click('#mode-tab-abbrev');
    await mp.waitForTimeout(250);
    assert.equal(await mp.evaluate(() => currentGameMode), 'abbrev', '已開啓的關卡正常進入');

    // ④ 教師全開：?teacher=1 → 全部不鎖＋左下角徽章；點徽章即關閉、恢復真鎖
    const teacherPage = await mockContext.newPage();
    teacherPage.on('pageerror', e => errors.push('mock-teacher: ' + e.message));
    await teacherPage.goto(mockUrl + '?teacher=1');
    await teacherPage.waitForFunction(() => typeof setGameMode === 'function');
    await teacherPage.evaluate(() => {
      switchTab('game');
      document.getElementById('login-num-select').value = '1';
      submitStudentLogin();
    });
    // 等權威旗標就緒，確保「關閉全開後恢復真鎖」的斷言不受抓取時序影響。
    await teacherPage.waitForFunction(
      () => typeof cloudScoresKnown !== 'undefined' && cloudScoresKnown === true,
      null, { timeout: 8000 });
    await teacherPage.waitForTimeout(300);
    const teacherView = await teacherPage.evaluate(() => ({
      locks: Array.from(document.querySelectorAll('.mode-tab-btn'))
        .filter(b => b.classList.contains('locked')).map(b => b.id),
      badge: (document.getElementById('teacher-unlock-badge') || {}).textContent || ''
    }));
    assert.deepEqual(teacherView.locks, [], '教師全開時不得有任何鎖：' + teacherView.locks.join(','));
    assert.match(teacherView.badge, /教師全開/, '左下角應出現教師全開徽章');

    const teacherOff = await teacherPage.evaluate(() => {
      document.getElementById('teacher-unlock-badge').click();
      return {
        badgeGone: !document.getElementById('teacher-unlock-badge'),
        lockedBack: document.getElementById('mode-tab-feature').classList.contains('locked'),
        hardBack: document.getElementById('mode-tab-feature').classList.contains('hard-locked')
      };
    });
    assert.equal(teacherOff.badgeGone, true, '點徽章後徽章應消失');
    assert.equal(teacherOff.lockedBack, true, '關閉全開後未達標的關卡恢復鎖定');
    assert.equal(teacherOff.hardBack, true, '權威分數可用 ⇒ 恢復為真鎖');

    await mockContext.close();

    assert.deepEqual(errors, [], '整個流程不得有頁面錯誤');
    console.log('PASS browser-modes: 註冊表驅動的分頁與計分說明、三種機制的出題與結算、'
      + '本機快取通用化與舊欄位遷移、模式切換無殘留；'
      + '真鎖＋安全網（mock 雲端分項同步、換電腦回復、離線退回軟鎖）與教師全開，且無頁面錯誤。');
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
    await new Promise(r => mockServer.close(r));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
