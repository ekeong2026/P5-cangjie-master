
function inspectWebhookStatus() {
  const url = getGasWebhookUrl();
  const statusEl = document.getElementById('lb-cloud-status');
  const curStatus = statusEl ? statusEl.textContent : '未知';
  const lastSync = (typeof lastCloudSyncTime !== 'undefined' && lastCloudSyncTime) ? lastCloudSyncTime.toLocaleString() : '尚未成功連通';
  const msg = [
    '【雲端天梯連線診斷報告】',
    '',
    '1. 當前偵測到的 Webhook 網址:',
    url || '⚠️ (未讀取到，請確認 config.js 中的 GAS_WEBHOOK_URL 是否已填寫)',
    '',
    '2. 最新同步狀態:',
    curStatus,
    '',
    '3. 最後成功同步時間:',
    lastSync,
    '',
    '💡 常見故障排除排查指南：',
    '・若顯示連線失敗或超時：請確認 Apps Script 部署設定中的「誰可以存取」是否選為「任何人 (Anyone)」，若選成「只有我」會被 Google 權限阻擋。',
    '・若網址結尾為 /dev，請改為正式發布的 /exec 結尾網址。',
    '・若修改了 GitHub 的 config.js，GitHub Pages 通常需 1~2 分鐘編譯，請按 Ctrl+F5 強制重新整理。'
  ].join(String.fromCharCode(10));
  alert(msg);
}

function getGasWebhookUrl() {
  if (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.GAS_WEBHOOK_URL && !window.CONFIG.GAS_WEBHOOK_URL.includes('YourDeploymentIdHere')) {
    return window.CONFIG.GAS_WEBHOOK_URL;
  }
  if (typeof CONFIG !== 'undefined' && CONFIG.GAS_WEBHOOK_URL && !CONFIG.GAS_WEBHOOK_URL.includes('YourDeploymentIdHere')) {
    return CONFIG.GAS_WEBHOOK_URL;
  }
  return '';
}

/**
 * =========================================================================
 * 🎮 APP.JS - 遊戲業務邏輯、UI 互動與跨電腦雲端同步核心
 * 🤖 AI 迭代維護指南：
 *    - 本模組包含完整遊戲狀態機 (三大討伐模式 + 極速手速賽)
 *    - 包含排行榜渲染 (renderLeaderboardTable, renderSpeedLeaderboardTable)
 *    - 包含 Webhook 雙向資料傳輸 (sendReliableWebhook, fetchCloudLeaderboard)
 * =========================================================================
 */

const SafeStorage = {
      _mem: {},
      getItem(key) {
        try {
          if (window.localStorage) {
            const v = window.localStorage.getItem(key);
            if (v !== null) return v;
          }
        } catch(e) {}
        return this._mem[key] !== undefined ? this._mem[key] : null;
      },
      setItem(key, val) {
        const strVal = String(val);
        this._mem[key] = strVal;
        try {
          if (window.localStorage) window.localStorage.setItem(key, strVal);
        } catch(e) {}
      },
      removeItem(key) {
        delete this._mem[key];
        try {
          if (window.localStorage) window.localStorage.removeItem(key);
        } catch(e) {}
      },
      getAllKeys() {
        const keysSet = new Set(Object.keys(this._mem));
        try {
          if (window.localStorage) {
            for (let i = 0; i < window.localStorage.length; i++) {
              keysSet.add(window.localStorage.key(i));
            }
          }
        } catch(e) {}
        return Array.from(keysSet);
      }
    };

    // State Variables
    let activeTab = 'top40';
    let currentLeaderboardType = 'combat';
    let currentLeaderboardFilter = 'ALL';
    let speedLeaderboardWeek = 'w6_hw1';
    let speedLeaderboardWordCount = 10;
    let currentSpeedWeek = 'w6_hw1';
    let currentSpeedWordCount = 10;
    let isSpeedPracticeMode = false;
    let speedWordList = [];
    let lastSpeedRoundScore = 0;   // 本場手速賽理論獎勵分（供結算卡顯示）
    let lastSpeedEarned = 0;       // 本場預估實際得分（扣掉今天已在該週次得分的字）
    let speedWordIdx = 0;
    let speedInputCodes = [];
    let speedStartTime = null;
    let speedTimerInterval = null;
    let speedPenaltySeconds = 0.0;
    let speedMistakes = 0;
    let speedTotalKeys = 0;
    let speedCorrectKeys = 0;
    let speedHintTimer = null;
    let speedActive = false;
    let speedWordReadyForSpace = false;

    // 💀 生存模式（survival 機制）狀態：「生命值 × 連擊」玩法，不用秒數。
    //    初始 SURVIVAL_MAX_LIVES 條命，答錯一次扣 1 命（不重置連擊以外的進度），
    //    命用完即結束；答對連續累積連擊，連擊倍率直接放大每字得分。
    //    另設一個「生存秒數」僅作為節奏輔助（顯示存活時間），不影響勝負。
    const SURVIVAL_MAX_LIVES = 5;         // 初始生命數（用戶指定 5 條命）
    const SURVIVAL_LIFE_LOSS = 1;         // 每答錯一次扣幾條命
    const SURVIVAL_COMBO_TIERS = [       // 連擊倍率門檻（由高到低比對）
      { min: 20, mult: 3 },               // 連擊 20+ → ×3
      { min: 10, mult: 2 },               // 連擊 10+ → ×2
      { min: 5, mult: 1.5 },              // 連擊 5+  → ×1.5
    ];
    const SURVIVAL_COMBO_WINDOW_MS = 6000; // 超過此時間未答對一字，連擊歸零（節奏壓力）
    let survivalWordList = [];     // 本場出題（連續、可重複，邊玩邊補）
    let survivalQueue = [];        // 尚未出現的字（用完即重新洗牌補上）
    let survivalIdx = 0;           // 目前第幾題（從 0 起算，僅供顯示）
    let survivalInputCodes = [];   // 目前題已輸入的字碼
    let survivalLives = 0;         // 剩餘生命數
    let survivalCombo = 0;         // 目前連擊（連續答對字數，未超時）
    let survivalMaxCombo = 0;      // 本場最高連擊
    let survivalElapsedMs = 0;     // 本場存活毫秒（僅供顯示）
    let survivalTimerInterval = null;
    let survivalHintTimer = null;
    let survivalComboTimer = null; // 連擊超時歸零計時器
    let survivalActive = false;
    let survivalWordReadyForSpace = false;
    let survivalCorrectCount = 0;  // 本場答對字數
    let survivalMistakeCount = 0;  // 本場答錯次數
    let survivalTotalKeys = 0;     // 本場總擊鍵
    let survivalCorrectKeys = 0;   // 本場正確擊鍵
    let survivalLastTick = 0;      // 上一次計時的 performance.now()
    let survivalRoundResults = []; // 逐字結果，結束時一次送出（含連擊倍率）
    let lastSurvivalScore = 0;     // 本場預估得分（結算卡顯示）

    // 🐣 寵物養成（pet 機制）狀態：打對字＝餵食，累積經驗讓寵物進化。
    //    與生存模式一樣自成一組變數，不與其他機制共用。
    //    計分走 code 那條路（把答對的字用 round 送出），後端零改動。
    const PET_STAGES = [            // 進化階段（依經驗門檻，由低到高）；一律是「寵物本體」，不是道具
      { id: 'egg',     emoji: '🥚', name: '神秘蛋',   minExp: 0   },
      { id: 'baby',    emoji: '🐣', name: '幼龍',     minExp: 30  },
      { id: 'young',   emoji: '🐲', name: '小飛龍',   minExp: 80  },
      { id: 'grown',   emoji: '🐉', name: '巨龍',     minExp: 200 },
      { id: 'legend',  emoji: '🦖', name: '傳說龍王', minExp: 450 },
    ];
    const PET_EXP_PER_WORD = 5;    // 每個字給的經驗（4 碼字會再加）
    let petWordList = [];          // 本場出題（連續流）
    let petQueue = [];             // 尚未出現的字
    let petIdx = 0;
    let petInputCodes = [];
    let petActive = false;
    let petWordReadyForSpace = false;
    let petHintTimer = null;
    let petCorrectCount = 0;       // 本場已餵字數
    let petMistakeCount = 0;
    let petStreak = 0;             // 本場連續答對（連擊，只顯示不影響分數）
    let petTotalKeys = 0;
    let petCorrectKeys = 0;
    let petRoundResults = [];      // 逐字結果，休息時一次送出
    let petProgress = null;        // { exp, satiety, mood, lastFed } 存本機
    let lastPetEarned = 0;
    let currentClass = 'P5A';
    let currentStudent = null;       // { cls, num, name }
    let activeSkills = [];           // 當前已解鎖技能清單
    let gameStage = 1;               // 1..5 關卡循環
    let sessionScore = 0;            // 當前輪次得分
    let sessionCorrectCount = 0;     // 當前輪次答對關數
    let pendingRoundResults = [];    // 模式一／三本輪逐題結果，5 題後集中送出
    let comboCount = 0;              // 連擊數
    let roundMistakeCount = 0;       // 當前關卡累積失誤次數 (>=5次觸發提示)
    let currentGameMode = 'connected'; // 'connected' | 'split' | 'special'
    // 標準（code 機制）槽位上限＝單碼上限。index.html 必須提供同數量的 slot-N／val-N。
    // ⚠ 不可寫死 4：站 3 有 5 碼字（睡／豐／慧），寫死會在第 5 碼找不到槽位而崩潰。
    const MAX_CODE_SLOTS = 6;
    let currentQuiz = null;          // 當前題目物件
    let selectedCodes = [];          // code 機制（連體字／精簡／難字等）已捕捉字碼
    let selectedPrefix = [];         // twoPart 機制已捕捉字首碼
    let selectedBody = [];           // twoPart 機制已捕捉字身碼
    let activeOrbs = [];             // 畫面上的遊行球集合
    let wanderingSpeedMultiplier = 0.85;
    let animationFrameId = null;
    let autoNextTimer = null;
    let roundShieldActive = false;
    let isKiosk = false;
    let kioskInterval = null;

    // 題目佇列與跨輪防重複歷史紀錄 (保證每輪5關隨機且跨輪絕不連續重複)
    // 🗺️ 鍵＝模式 id，動態增減：加新模式時不必改這裡（見 js/modes.js）。
    let modeQuizQueues = {};
    let modeQuizHistory = {};

    // 🗺️ 模式註冊表查詢（js/modes.js）；未載入時退回最小可用版本，避免整頁失效。
    const MODE_REGISTRY = (typeof P5Mode !== 'undefined' && P5Mode)
      ? P5Mode
      : { mechOf: () => 'code', poolOf: () => '', viewOf: () => ({}), prefixFor: (id) => id, fill: (t) => String(t == null ? '' : t) };

    function getNextQuiz(mode) {
      if (!modeQuizQueues[mode] || modeQuizQueues[mode].length === 0) {
        const poolKey = MODE_REGISTRY.poolOf(mode);
        let pool = (poolKey && DATA[poolKey]) ? [...DATA[poolKey]] : [];

        // 🎯 每日掌握：全碼類模式優先抽「今天尚未得分」的字（任務 3）。
        // 分體字（twoPart）與手速賽（timed）出題路徑不動。
        if (MODE_REGISTRY.mechOf(mode) === 'code') {
          pool = prioritizeTodayChars(mode, pool);
        }

        // 使用 Fisher-Yates 隨機均勻洗牌演算法
        let shuffled = (typeof fisherYatesShuffle === 'function')
          ? fisherYatesShuffle(pool)
          : fisherYatesShuffle(pool);

        // 跨輪次防重複機制：剛洗完牌時，若前幾道題恰好在上一輪最後 5 題中出現過，將其沉底延後抽取
        const recent = modeQuizHistory[mode] || [];
        if (recent.length > 0 && shuffled.length > 5) {
          const fresh = [];
          const delayed = [];
          shuffled.forEach(item => {
            if (recent.slice(-5).includes(item.char)) {
              delayed.push(item);
            } else {
              fresh.push(item);
            }
          });
          shuffled = fresh.concat(delayed);
        }

        modeQuizQueues[mode] = shuffled;
      }

      const quiz = modeQuizQueues[mode].pop();
      if (quiz) {
        if (!modeQuizHistory[mode]) modeQuizHistory[mode] = [];
        modeQuizHistory[mode].push(quiz.char);
        if (modeQuizHistory[mode].length > 20) {
          modeQuizHistory[mode].shift();
        }
      }
      return quiz;
    }

    // 🎯 取出今天的掌握進度（從本機快取，雲端結果會覆寫它）
    // 值為日期或「日期*n」（n＝今天已計分次數），僅保留今天的。
    function getTodayMastery() {
      const today = MasteryCore.hkDate(new Date());
      try {
        if (!currentStudent) return { today, map: {} };
        const key = `p5_mastery_${currentStudent.cls}_${currentStudent.num}`;
        const map = MasteryCore.parseProgress(SafeStorage.getItem(key) || '');
        // 只保留今天的；舊日期自動失效。
        const filtered = {};
        Object.keys(map).forEach(k => {
          if (MasteryCore.entryDate(map[k]) === today) filtered[k] = map[k];
        });
        return { today, map: filtered };
      } catch (e) {
        return { today, map: {} };
      }
    }

    // 把今天尚未得分的字排到題庫前面；全部完成後才回到原本順序（複習）。
    // 保留題庫中重複項目的權重（同一字出現多次仍按原本次數保留）。
    function prioritizeTodayChars(mode, pool) {
      try {
        if (!currentStudent) return pool;
        const { map } = getTodayMastery();
        const fresh = [], done = [];
        pool.forEach(item => {
          (map[masteryKey(mode, item.char)] ? done : fresh).push(item);
        });
        return fresh.concat(done);
      } catch (e) {
        return pool;
      }
    }

    /* 進度鍵＝「模式前綴:漢字」；週次字庫模式（手速賽）再多一層 .週次。
       與後端 MasteryCore 的規則完全一致，改規則只需要改 registry。 */
    function masteryKey(mode, char, weekKey) {
      return MODE_REGISTRY.prefixFor(mode, weekKey || '') + ':' + char;
    }

    /* 🎯 把逐字結果轉成「可送後端的 round」，同時算出前端預估得分。
       ★ 這是所有「一輪／一場集中結算」型玩法（生存、寵物、跑酷、法陣）的唯一入口：
         - 依「今天第幾次計分」套用遞減倍率（第 1 次全額、第 2 次 50%、第 3 次 25%、之後 0）。
         - 同一場內重複出現的字也依次遞減（以 countMap 累加，不能只看本機快取）。
         - 最後交給 MasteryCore.buildRound：把「今天已達上限」的字歸零。
       ⚠ 送出的 round 一定要帶 earned，後端只採信 round[].earned；
         全部送 0 等於學生白打（2026-10-14 修：生存／寵物／跑酷原本就是這個漏洞）。
       basePoints：該模式每字全額分；pointsOf 可選，回傳該筆的加成前分數（例：生存連擊倍率）。 */
    function buildEarnedRound(results, pool, prefix, basePoints, pointsOf) {
      const { today, map } = getTodayMastery();
      const base = Number(basePoints) > 0 ? Number(basePoints) : 15;
      const countMap = {};
      const input = (Array.isArray(results) ? results : []).map(r => {
        const char = String((r && r.char) || '').trim();
        const key = prefix + ':' + char;
        const used = MasteryCore.countOf(map, key, today) + (countMap[key] || 0);
        countMap[key] = (countMap[key] || 0) + 1;
        const decay = MasteryCore.decayFor(used + 1);
        const raw = typeof pointsOf === 'function' ? Number(pointsOf(r)) : base;
        const points = (Number.isFinite(raw) && raw > 0) ? raw : base;
        const earned = decay > 0 ? Math.max(1, Math.round(points * decay)) : 0;
        return { char: char, correct: true, earned: earned };
      });
      const round = MasteryCore.buildRound(input, pool, map, today, prefix);
      const estimated = round.reduce((sum, r) => sum + (Number(r.earned) || 0), 0);
      return { round: round, estimated: estimated };
    }

    // Confetti Engine
    function burstConfetti() {
      const canvas = document.getElementById('confetti-canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      const pieces = [];
      const colors = ['#FACC15', '#EF4444', '#3B82F6', '#10B981', '#8B5CF6', '#F97316'];
      for (let i = 0; i < 95; i++) {
        pieces.push({
          x: canvas.width * 0.5,
          y: canvas.height * 0.35,
          vx: (Math.random() - 0.5) * 18,
          vy: (Math.random() - 0.7) * 18,
          size: Math.random() * 8 + 5,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          vrot: (Math.random() - 0.5) * 14,
          gravity: 0.35,
          opacity: 1
        });
      }
      
      function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        pieces.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += p.gravity;
          p.rotation += p.vrot;
          p.opacity -= 0.009;
          if (p.opacity > 0) {
            alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
          }
        });
        if (alive) requestAnimationFrame(render);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      render();
    }

    // Tier and Skills Engine
    

    

    function triggerSkillToast(icon, text) {
      const toast = document.getElementById('skill-toast');
      document.getElementById('skill-toast-icon').textContent = icon;
      document.getElementById('skill-toast-text').textContent = text;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2200);
    }

    function triggerStagePassToast(modeLabel, stageNum, scoreEarned, nextStageNum) {
      const toast = document.getElementById('stage-pass-toast');
      const icon = document.getElementById('stage-pass-toast-icon');
      const text = document.getElementById('stage-pass-toast-text');
      if (!toast) return;

      icon.textContent = nextStageNum ? '🎉' : '🏆';
      if (nextStageNum) {
        text.innerHTML = `<strong>${modeLabel}</strong> 第 ${stageNum} 關 通關成功！<span style="color:#FEF08A;font-weight:900;">+${scoreEarned} 分</span> ➔ 自動進入第 ${nextStageNum} 關...`;
      } else {
        text.innerHTML = `<strong>${modeLabel}</strong> 5 關挑戰全數通關！<span style="color:#FEF08A;font-weight:900;">+${scoreEarned} 分</span> ➔ 正在進行總結算...`;
      }
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1600);
    }

    // Local Storage & Stats Management
    function getStudentStats(cls, num) {
      const key = `p5_score_${cls}_${num}`;
      // 🗺️ 分項分數改為「模式代號 → 分數」的動態對照表（modeScores），加模式時不必改這裡。
      let stats = { totalScore: 0, kills: 0, modeScores: {} };
      const val = SafeStorage.getItem(key);
      if (val) {
        try {
          const saved = JSON.parse(val);
          if (saved && typeof saved === 'object') Object.assign(stats, saved);
        } catch (e) {}
      }
      if (!stats.modeScores || typeof stats.modeScores !== 'object') stats.modeScores = {};
      // 舊版快取的固定欄位（mode1/2/3Score）就地併入 modeScores，讀過一次即完成遷移。
      const legacy = { mode1Score: 'connected', mode2Score: 'split', mode3Score: 'special' };
      Object.keys(legacy).forEach(field => {
        if (typeof stats[field] === 'number') {
          const id = legacy[field];
          stats.modeScores[id] = (stats.modeScores[id] || 0) + stats[field];
          delete stats[field];
        }
      });

      // 🛡️ 雙向同步：從雲端榜單/基準資料庫獲取最新試算表真實累計總分與擊破數
      // 雲端併入是否有變動（有變動要寫回本機，見下方註解）。
      let cloudMerged = false;
      if (typeof DATA !== 'undefined' && Array.isArray(DATA.benchmark_leaderboard)) {
        const padNum = parseInt(num, 10);
        const cloudMatch = DATA.benchmark_leaderboard.find(item => 
          item.cls === cls && parseInt(item.num, 10) === padNum
        );
        if (cloudMatch) {
          const cloudPts = (typeof cloudMatch.grandTotal === 'number') ? cloudMatch.grandTotal : 
                           ((typeof cloudMatch.score === 'number') ? cloudMatch.score : (parseInt(cloudMatch.totalScore, 10) || 0));
          if (cloudPts > stats.totalScore) {
            stats.totalScore = cloudPts;
            cloudMerged = true;
          }
          if (cloudMatch.kills && cloudMatch.kills > stats.kills) {
            stats.kills = cloudMatch.kills;
            cloudMerged = true;
          }
          // 🔓 分項分數同步（解鎖鏈用）：後端排行榜 payload 一直帶著每生各模式分數
          //   （buildLeaderboard_ 直接回傳含 modeScores 的學生物件），
          //   併入本機並「取較大值」——與上面總分同一套合併策略。
          //   ⚠ 少了這段，解鎖鏈在真實遊玩中永遠不會前進（各結算一律送 scoreDelta: 0，
          //     而「後端回填」沒有實作；2026-10-14 深夜修）。
          if (cloudMatch.modeScores && typeof cloudMatch.modeScores === 'object') {
            Object.keys(cloudMatch.modeScores).forEach(modeId => {
              const cloudVal = Number(cloudMatch.modeScores[modeId]) || 0;
              if (cloudVal > (stats.modeScores[modeId] || 0)) {
                stats.modeScores[modeId] = cloudVal;
                cloudMerged = true;
              }
            });
          }
        }
      }
      // 🔓 併進來的雲端分數要立刻寫回本機：否則重整或離線後，剛同步到的解鎖進度會消失
      //   （真鎖要靠這份分數判斷；「還差 N 分」在離線時也能沿用上次同步值）。
      if (cloudMerged) {
        try { SafeStorage.setItem(key, JSON.stringify(stats)); } catch (e) {}
      }
      return stats;
    }

    // =========================================================================
    // 🛡️ 雲端上傳可靠性引擎 (冪等性 requestId + 離線補送隊列 + 結算批次發送)
    // =========================================================================
    function generateRequestId() {
      return 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }

    async function sendReliableWebhook(payload) {
      const url = getGasWebhookUrl();
      if (!url) return;

      if (!payload.requestId) {
        payload.requestId = generateRequestId();
      }
      // 🕒 完成時間戳：離線補送時後端據此判斷歸屬日期（S3）。
      if (!payload.completedAt) {
        payload.completedAt = new Date().toISOString();
      }

      // 記錄遊戲完成時間，隨佇列一起保留。
      const completedAt = payload.completedAt;
      let success = false;

      // 🚀 指數退避重試：1s、2s、4s、8s、16s（上限 30s），最多 5 次（任務 0E）。
      for (let attempt = 1; UploadQueue.shouldRetry(attempt - 1); attempt++) {
        try {
          if (attempt > 1) {
            await new Promise(r => setTimeout(r, UploadQueue.backoffDelay(attempt - 1)));
          }
          await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
          });
          success = true;
          break;
        } catch (err) {
          console.warn(`第 ${attempt} 次雲端上傳嘗試失敗:`, err);
        }
      }

      if (success) {
        // 成功上傳後觸發雲端榜單延遲刷新
        setTimeout(() => {
          if (typeof fetchCloudLeaderboard === 'function') fetchCloudLeaderboard(true);
        }, 1500);
        // 上傳成功且網路順暢，順帶檢查有無先前遺留的離線補送項目
        setTimeout(() => {
          flushPendingUploads();
        }, 2000);
      } else {
        // 經重試依然失敗，安全存入本機離線補送隊列（保留完成時間戳，不丟失）
        console.warn('雲端上傳暫時失敗，已安全移入待補送清單');
        try {
          const queue = UploadQueue.parseQueue(SafeStorage.getItem('p5_pending_uploads'));
          const result = UploadQueue.enqueue(queue, UploadQueue.makeQueueItem(payload, completedAt));
          SafeStorage.setItem('p5_pending_uploads', JSON.stringify(result.queue));
          if (result.dropped > 0) {
            // 不再靜默截斷：明確告知教師與學生有紀錄被丟棄。
            console.error(`待補送佇列已滿，${result.dropped} 筆最舊紀錄被丟棄，請通知老師處理。`);
            if (typeof showPassToast === 'function') {
              showPassToast(`⚠️ 待補送紀錄已滿，${result.dropped} 筆較舊紀錄被捨棄，請通知老師。`);
            }
          } else if (typeof showPassToast === 'function') {
            showPassToast('⚠️ 網路不穩，成績已安全暫存本機，連線恢復時將自動補送！');
          }
        } catch(e) {}
      }
    }

    // 🚀 當網路暢通或恢復時，自動清空並補發離線隊列
    // 一次只允許一個補送程序在跑，避免重疊執行造成重複補送（0E）。
    let flushingUploads = false;

    async function flushPendingUploads() {
      if (flushingUploads) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const url = getGasWebhookUrl();
      if (!url) return;

      flushingUploads = true;
      try {
        const queue = UploadQueue.parseQueue(SafeStorage.getItem('p5_pending_uploads'));
        if (queue.length === 0) return;

        let anySucceeded = false;
        let anyFailed = false;

        for (const item of queue) {
          const requestId = item && item.payload && item.payload.requestId;
          try {
            await fetch(url, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify(item.payload)
            });
            anySucceeded = true;
            // 依 requestId 移除已補送的項目，保留補送期間新增的紀錄。
            const remaining = UploadQueue.dequeue(
              UploadQueue.parseQueue(SafeStorage.getItem('p5_pending_uploads')), requestId);
            if (remaining.length > 0) {
              SafeStorage.setItem('p5_pending_uploads', JSON.stringify(remaining));
            } else {
              SafeStorage.removeItem('p5_pending_uploads');
            }
            await new Promise(r => setTimeout(r, 400)); // 輕微防洪間隔
          } catch (err) {
            anyFailed = true;
            break; // 網路仍不通，停止本輪，下次再試
          }
        }

        if (anySucceeded) {
          console.log('✅ 離線隊列補送成功！');
          if (typeof showPassToast === 'function') {
            showPassToast('☁️ 離線成績已成功補送至 Google 雲端試算表！');
          }
          setTimeout(() => {
            if (typeof fetchCloudLeaderboard === 'function') fetchCloudLeaderboard(true);
          }, 1200);
        }
        if (anyFailed) console.warn('部分離線紀錄仍未補送，將於下次連線時重試。');
      } catch(e) {} finally {
        flushingUploads = false;
      }
    }

    function saveStudentStats(cls, num, scoreDelta, isKill, mode, bestTime = null, wordCount = 10, weekKey = 'w6_hw1', round = null) {
      const key = `p5_score_${cls}_${num}`;
      const stats = getStudentStats(cls, num);
      // 🔓 解鎖比對用的「變動前」分數（只在寫入前拍一次，之後由 refreshUnlockUI 比對）。
      const scoresBefore = Object.assign({}, stats.modeScores || {});
      stats.totalScore += scoreDelta;
      if (isKill) stats.kills++;
      // 🗺️ 任何註冊或未註冊的模式都自動有一格，前端不必認識模式清單。
      const modeId = String(mode || '').trim();
      if (modeId) stats.modeScores[modeId] = (stats.modeScores[modeId] || 0) + scoreDelta;
      stats.lastUpdate = new Date().toISOString();
      SafeStorage.setItem(key, JSON.stringify(stats));

      // 🔓 分數一變就可能跨過關卡門檻 ⇒ 重畫分頁（跨過時放開啓儀式）。
      //    只有「正在玩的這位學生」才需要重畫，避免蓋掉別人的畫面。
      if (currentStudent && currentStudent.cls === cls && String(currentStudent.num) === String(num)) {
        refreshUnlockUI(scoresBefore);
      }

      // 🛡️ 即時同步記憶體中的 DATA.benchmark_leaderboard，確保榜單與技能館一致
      if (typeof DATA !== 'undefined' && Array.isArray(DATA.benchmark_leaderboard)) {
        const padNum = parseInt(num, 10);
        const cloudMatch = DATA.benchmark_leaderboard.find(item => 
          item.cls === cls && parseInt(item.num, 10) === padNum
        );
        if (cloudMatch) {
          cloudMatch.grandTotal = stats.totalScore;
          cloudMatch.score = stats.totalScore;
          cloudMatch.totalScore = stats.totalScore;
          cloudMatch.total = stats.totalScore;
          cloudMatch.kills = stats.kills;
          const { currentTier } = evalTierAndSkills(stats.totalScore);
          cloudMatch.title = currentTier.title;
          cloudMatch.badge = currentTier.badge;
        }
      }

      // 若為手速賽或關卡結算，發送可靠上傳
      sendReliableWebhook({
        grade: 5,
        cls: cls,
        num: num,
        roundScore: scoreDelta,
        scoreDelta: scoreDelta,
        gameMode: mode,
        mode: mode,
        bestTime: bestTime,
        wordCount: wordCount,
        weekKey: weekKey,
        totalScore: stats.totalScore,
        kills: stats.kills,
        killDelta: isKill ? 1 : 0,
        // 遊戲完成時間：離線補送時後端據此判斷歸屬日期。
        completedAt: new Date().toISOString(),
        timestamp: stats.lastUpdate,
        // 逐字作答（模式二整場送出）；後端據此判斷「當天首答」並回填分數。
        round: Array.isArray(round) ? round : []
      });
    }

    // ==========================================
    // 📊 統計棒形圖 (Bar Chart) 生成組件
    // ==========================================
    function buildBarChartHtml(title, subtitle, dataList, maxVal, barGradient, totalBadge) {
      const barsHtml = dataList.map(item => {
        const pct = Math.max(12, Math.round((item.val / Math.max(1, maxVal)) * 100));
        return `
          <div class="chart-bar-col">
            <div class="chart-bar-val">${item.val} 人</div>
            <div class="chart-bar-pillar" style="height: ${pct}%; background: ${barGradient};" title="${item.cls}：${item.val} 人"></div>
            <div class="chart-bar-label">${item.cls}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="chart-container-card">
          <div class="chart-header">
            <div>
              <div class="chart-title">${title}</div>
              <div style="font-size: 12px; color: #64748B; margin-top: 2px;">${subtitle}</div>
            </div>
            <div class="stat-pill" style="font-size: 12px; padding: 3px 10px; background: #F8FAFC; border-color: #CBD5E1;">
              <strong>${totalBadge}</strong>
            </div>
          </div>
          <div class="chart-bars-wrap">
            ${barsHtml}
          </div>
        </div>
      `;
    }

    function renderClassBarCharts() {
      const classes = ['P5A', 'P5B', 'P5C', 'P5D', 'P5E', 'P5F'];

      // 1. 各班入選前 40 名人數分佈統計
      const top40Counts = {};
      const top40List = (DATA && Array.isArray(DATA.top40)) ? DATA.top40 : [];
      top40List.forEach(s => top40Counts[s.cls] = (top40Counts[s.cls] || 0) + 1);
      let maxTop40 = 1;
      classes.forEach(c => {
        if ((top40Counts[c] || 0) > maxTop40) maxTop40 = top40Counts[c];
      });
      const top40Data = classes.map(c => ({ cls: c, val: top40Counts[c] || 0 }));
      const chartTop40El = document.getElementById('chart-top40-container');
      if (chartTop40El) {
        chartTop40El.innerHTML = buildBarChartHtml(
          '📊 各班入選全級前 40 名人數分佈 (統計棒形圖)',
          '統計 P5A 至 P5F 各班在全級前 40 名龍虎榜中所佔之傑出訓練家人數',
          top40Data,
          maxTop40,
          'linear-gradient(180deg, #60A5FA 0%, #2563EB 100%)',
          `全級前40名合計：${top40List.length} 人`
        );
      }

      // 2. 各班 400 分大滿貫人數分佈統計
      let maxPerf = 1;
      let totalPerf = 0;
      const perfData = classes.map(c => {
        const count = (DATA && DATA.perfect_students && DATA.perfect_students[c] ? DATA.perfect_students[c] : []).length;
        if (count > maxPerf) maxPerf = count;
        totalPerf += count;
        return { cls: c, val: count };
      });
      const chartPerfEl = document.getElementById('chart-perfect-container');
      if (chartPerfEl) {
        chartPerfEl.innerHTML = buildBarChartHtml(
          '📊 各班 400 分大滿貫滿分人數分佈 (統計棒形圖)',
          '統計各班達成 4 次作業 400 分全滿分榮譽之訓練家人數',
          perfData,
          maxPerf,
          'linear-gradient(180deg, #FDE047 0%, #D97706 100%)',
          `全級滿分合計：${totalPerf} 人`
        );
      }
    }

    // ==========================================
    // TAB 1: 🏆 全級前 40 名龍虎榜 (頒獎台 + 角色卡)
    // ==========================================
    
    // 🛡️ 日期安全解析輔助函式 (徹底防禦 undefined.replace 崩潰)
    function getSafeDateText(dateVal) {
      if (!dateVal || typeof dateVal !== 'string') return '';
      return dateVal.replace('2026-', '').replace(/^(\d{4}-)/, '').trim();
    }

    // 🛡️ 學生姓名去識別化格式化 (落實 GITHUB_PRIVACY_MODE 設定開關)
    function formatStudentDisplayName(student) {
      if (!student) return '';
      const cfg = (typeof CONFIG !== 'undefined') ? CONFIG : (typeof window !== 'undefined' ? window.CONFIG : null);
      if (cfg && cfg.GITHUB_PRIVACY_MODE) {
        const cls = student.cls || '';
        const num = parseInt(student.num, 10);
        if (cls && !isNaN(num)) {
          return `${cls} ${(num < 10 ? '0' : '') + num}號`;
        }
      }
      return student.name || `${student.cls || ''} ${(student.num < 10 ? '0' : '') + (student.num || '')}號`.trim();
    }

    function renderTop40() {
      const top40List = (DATA && Array.isArray(DATA.top40))
        ? DATA.top40.map((student, index) => ({ ...student, rank: Number(student.rank) || index + 1 }))
        : [];
      if (top40List.length < 3) {
        const podiumArea = document.getElementById('podium-area');
        if (podiumArea) {
          podiumArea.innerHTML = `
            <div style="text-align: center; padding: 32px 16px; color: #64748B; font-weight: 800; font-size: 15px; width: 100%;">
              🏆 龍虎榜數據同步中，請點擊上方【全級前40名龍虎榜】或登入挑戰開創紀錄！
            </div>
          `;
        }
        const listArea = document.getElementById('top40-list');
        if (listArea) listArea.innerHTML = '';
        return;
      }
      const top3 = top40List.slice(0, 3);
      const rest = top40List.slice(3);
      
      const podiumArea = document.getElementById('podium-area');
      const p2Score = top3[1].grandTotal ?? top3[1].total ?? top3[1].score ?? 0;
      const p2Badge = top3[1].badge || top3[1].title || '🔥 榮譽訓練家';
      const p2Time = getSafeDateText(top3[1].lastTime || top3[1].date);

      const p1Score = top3[0].grandTotal ?? top3[0].total ?? top3[0].score ?? 0;
      const p1Badge = top3[0].badge || top3[0].title || '👑 榮譽訓練家';
      const p1Time = getSafeDateText(top3[0].lastTime || top3[0].date);

      const p3Score = top3[2].grandTotal ?? top3[2].total ?? top3[2].score ?? 0;
      const p3Badge = top3[2].badge || top3[2].title || '🍃 榮譽訓練家';
      const p3Time = getSafeDateText(top3[2].lastTime || top3[2].date);

      podiumArea.innerHTML = `
        <div class="podium-step podium-2">
          <div class="crown-banner"><span class="emoji-icon">🥈</span></div>
          <img class="podium-pokemon-img" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png" alt="小火龍" title="小火龍 (Charmander) 🔥" onerror="handlePodiumImgError(this, '🔥')">
          <div class="podium-name">${formatStudentDisplayName(top3[1])}</div>
          <div class="podium-class">${top3[1].cls} (${top3[1].num}號) · 小火龍之火</div>
          <div class="podium-badge-score">${p2Score} 分 ｜ ${p2Badge}</div>
          ${p2Time ? `<div class="podium-time">⏱️ ${p2Time}</div>` : ''}
        </div>
        <div class="podium-step podium-1">
          <div class="crown-banner"><span class="emoji-icon">👑</span></div>
          <img class="podium-pokemon-img" style="width:88px; height:88px;" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png" alt="皮卡丘" title="皮卡丘 (Pikachu) ⚡" onerror="handlePodiumImgError(this, '⚡')">
          <div class="podium-name">${formatStudentDisplayName(top3[0])}</div>
          <div class="podium-class">${top3[0].cls} (${top3[0].num}號) · 皮卡丘雷霆</div>
          <div class="podium-badge-score">${p1Score} 分 ｜ ${p1Badge}</div>
          ${p1Time ? `<div class="podium-time">⏱️ ${p1Time}</div>` : ''}
        </div>
        <div class="podium-step podium-3">
          <div class="crown-banner"><span class="emoji-icon">🥉</span></div>
          <img class="podium-pokemon-img" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png" alt="妙蛙種子" title="妙蛙種子 (Bulbasaur) 🍃" onerror="handlePodiumImgError(this, '🍃')">
          <div class="podium-name">${formatStudentDisplayName(top3[2])}</div>
          <div class="podium-class">${top3[2].cls} (${top3[2].num}號) · 妙蛙飛葉</div>
          <div class="podium-badge-score">${p3Score} 分 ｜ ${p3Badge}</div>
          ${p3Time ? `<div class="podium-time">⏱️ ${p3Time}</div>` : ''}
        </div>
      `;
      
      const restPool = DATA.pokemon_pool.slice(3);
      const listArea = document.getElementById('top40-list');
      listArea.innerHTML = rest.map((s, idx) => {
        const pm = restPool[idx % restPool.length];
        const isElite = (s.rank >= 4 && s.rank <= 10);
        const displayName = formatStudentDisplayName(s);
        return `
          <div class="rank-card ${isElite ? 'rank-card-elite-flash' : ''}" data-student="${s.cls}-${s.num}-${displayName}">
            <div class="rank-left">
              <div class="rank-poke-avatar" style="background:${pm.color}; border-color:${pm.border};" title="${pm.name}">
                <img class="rank-poke-img" src="${pm.img}" alt="${pm.name}" onerror="handleRankImgError(this, '${pm.icon || '⚡'}')">
              </div>
              <div>
                <div class="st-name">
                  #${s.rank || idx + 1} ${formatStudentDisplayName(s)} <span class="st-poke-tag">${pm.name}</span>
                  ${isElite ? '<span class="badge-elite-top10">✨ TOP 10 菁英</span>' : ''}
                </div>
                <div class="st-class">${s.cls} · ${s.num}號 · 夥伴：${pm.name} (${pm.tag})</div>
              </div>
            </div>
            <div class="rank-right">
              <div class="st-score">${s.grandTotal ?? s.total ?? s.score ?? 0} 分</div>
              <div class="st-date">${getSafeDateText(s.lastTime || s.date) ? `交齊: ${getSafeDateText(s.lastTime || s.date)}` : (s.badge || '已登記戰績')}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // ==========================================
    // TAB 2: 🌟 各班前 10 名榮譽榜 (角色卡展示)
    // ==========================================
    function switchClass(cls) {
      currentClass = cls;
      document.querySelectorAll('.cls-chip').forEach(c => {
        c.classList.toggle('active', c.textContent.includes(cls));
      });
      renderClassCards();
    }

    function renderClassCards() {
      const container = document.getElementById('class-cards');
      const students = (DATA && DATA.class_top10 && DATA.class_top10[currentClass]) ? DATA.class_top10[currentClass] : [];
      const classOffset = ['P5A', 'P5B', 'P5C', 'P5D', 'P5E', 'P5F'].indexOf(currentClass) * 14;
      
      if (students.length === 0) {
        container.innerHTML = '<div style="padding:32px 16px;text-align:center;color:#64748B;font-weight:800;">🎮 此班尚未有成績紀錄</div>';
        return;
      }

      container.innerHTML = students.map((s, idx) => {
        const pm = DATA.pokemon_pool[(classOffset + idx) % DATA.pokemon_pool.length];
        let medal = '';
        let cardClass = 'rank-card';
        let honorBadge = '';

        // 各班前 10 名榮譽榜：前 3 名配置冠軍、亞軍、季軍專屬流光閃爍特效
        if (idx === 0) {
          medal = '<span class="emoji-icon">🥇</span> ';
          cardClass += ' rank-card-class-champion';
          honorBadge = '<span class="badge-class-honor gold"><span class="emoji-icon">👑</span> 班級冠軍</span>';
        } else if (idx === 1) {
          medal = '<span class="emoji-icon">🥈</span> ';
          cardClass += ' rank-card-class-runnerup';
          honorBadge = '<span class="badge-class-honor silver"><span class="emoji-icon">🥈</span> 班級亞軍</span>';
        } else if (idx === 2) {
          medal = '<span class="emoji-icon">🥉</span> ';
          cardClass += ' rank-card-class-third';
          honorBadge = '<span class="badge-class-honor bronze"><span class="emoji-icon">🥉</span> 班級季軍</span>';
        }

        return `
          <div class="${cardClass}" data-student="${currentClass}-${s.num}-${s.name}">
            <div class="rank-left">
              <div class="rank-poke-avatar" style="background:${pm.color}; border-color:${pm.border};" title="${pm.name}">
                <img class="rank-poke-img" src="${pm.img}" alt="${pm.name}" onerror="handleRankImgError(this, '${pm.icon || '⚡'}')">
              </div>
              <div>
                <div class="st-name">
                  ${medal}#${s.rank || idx + 1} ${formatStudentDisplayName(s)} <span class="st-poke-tag">${pm.name}</span>
                  ${honorBadge}
                </div>
                <div class="st-class">${currentClass} · ${s.num}號 · 夥伴：${pm.name} (${pm.tag})</div>
              </div>
            </div>
            <div class="rank-right">
              <div class="st-score">${s.grandTotal ?? s.total ?? s.score ?? 0} 分</div>
              <div class="st-date">${getSafeDateText(s.lastTime || s.date) ? `⏱️ ${getSafeDateText(s.lastTime || s.date)}` : (s.badge || '已登記戰績')}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // ==========================================
    // TAB 3: 🎉 400分滿分星光榜 (107人全員展示)
    // ==========================================
    function renderPerfectScorers() {
      const container = document.getElementById('perfect-class-groups');
      const classes = ['P5A', 'P5B', 'P5C', 'P5D', 'P5E', 'P5F'];
      let globalCounter = 0;
      
      container.innerHTML = classes.map(cls => {
        const members = (DATA && DATA.perfect_students && DATA.perfect_students[cls]) ? DATA.perfect_students[cls] : [];
        return `
          <div style="margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 17px; font-weight: 900; color: #1E3A8A;">● ${cls} 班</span>
              <span style="background: #DBEAFE; color: #1D4ED8; font-size: 12px; font-weight: 800; padding: 2px 10px; border-radius: 12px;">共 ${members.length} 位滿分</span>
            </div>
            <div class="perfect-grid">
              ${members.map((m) => {
                const pm = DATA.pokemon_pool[(globalCounter++) % DATA.pokemon_pool.length];
                return `
                  <div class="star-card" data-student="${cls}-${m}">
                    <div class="star-avatar" title="${pm.name}">
                      <img class="star-poke-img" src="${pm.img}" alt="${pm.name}" onerror="handleRankImgError(this, '${pm.icon || '⭐'}')">
                    </div>
                    <div class="star-name">${m}</div>
                    <div class="star-cls">${pm.name} · 400分</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');
    }

    // ==========================================
    // TAB 5: 📖 Top 12 錯字寶典與診斷
    // ==========================================
    function renderVocabTable() {
      const tbody = document.getElementById('vocab-tbody');
      const typos = [
        { rank: "第 1 名", char: "兔", count: "77 人次", hw: "功課3", code: "弓日戈 (NAI)", secret: "【分體字】字首「勹」取折筆【弓(N)】；字身「口」取【日(A)】，末筆撇彎鉤連點取【戈(I)】。切勿誤取「竹」或「口」！" },
        { rank: "第 2 名", char: "術", count: "60 人次", hw: "功課4", code: "竹人戈木 (HOID)", secret: "【行部包圍】字首左側「彳」取【竹人(HO)】；字身右側「术」取【戈木(ID)】。五年級是倉頡全碼，切勿按速成只取首尾！" },
        { rank: "第 3 名", char: "卵", count: "55 人次", hw: "功課3", code: "竹竹尸中戈 (HHSLI)", secret: "【分體字】左側首筆取撇【竹(H)】；右側撇取【竹(H)】，末筆點取【戈(I)】。" },
        { rank: "第 4 名", char: "錄", count: "54 人次", hw: "功課2", code: "金女弓水 (CVNE)", secret: "【左右分體】字首【金(C)】；字身「录」上部彑取【女弓(NV)】，下部氺取【水(E)】。" },
        { rank: "第 5 名", char: "卑", count: "54 人次", hw: "功課3", code: "竹竹十 (HHJ)", secret: "【上下分體】頂端撇筆取【竹(H)】；中間框筆取【竹(H)】，底端懸針十字取【十(J)】。" },
        { rank: "第 6 名", char: "歷", count: "54 人次", hw: "功課4", code: "一木卜中一 (MDYLM)", secret: "【半包圍全碼】外廓「厂」取【一(M)】；字身取禾【木(D)】＋止部【卜中一(YLM)】。標準全碼：一木卜中一 (MDYLM)。速成碼：一一 (MM)！" },
        { rank: "第 7 名", char: "究", count: "50 人次", hw: "功課3", code: "十金大弓 (JCKN)", secret: "【上下分體】字首穴部取寶蓋與八【十金(JC)】；字身九部取首筆【大(K)】與末筆彎折【弓(N)】。速成碼：十弓 (JN)！" },
        { rank: "第 8 名", char: "亞", count: "49 人次", hw: "功課4", code: "一中廿 (MLT)", secret: "【連體字】首筆頂橫【一(M)】；貫穿雙豎取【中(L)】；底端封口橫折取【廿(T)】。" },
        { rank: "第 9 名", char: "鬼", count: "46 人次", hw: "功課3", code: "竹戈竹山 (HIHU)", secret: "【連體字】頂端撇點取【竹戈(HI)】；字身下部兒與厶取【竹山(HU)】。" },
        { rank: "第 10 名", char: "演", count: "44 人次", hw: "功課1", code: "水十一金 (EJMC)", secret: "【左右分體】三點水取【水(E)】；字身「寅」取首碼寶蓋【十(J)】、次碼一橫【一(M)】與尾碼底筆【金(C)】。" },
        { rank: "第 11 名", char: "郵", count: "44 人次", hw: "功課4", code: "竹一弓中 (HMNL)", secret: "【左右分體】字首左側「垂」取首撇【竹(H)】與末橫【一(M)】；字身右側耳旁「阝」取【弓中(NL)】。速成碼：竹中 (HL)！" },
        { rank: "第 12 名", char: "潑", count: "43 人次", hw: "功課2", code: "水弓人水 (ENOE)", secret: "【左右分體】三點水取【水(E)】；字身「發」取登字頭【弓(N)】、撇點【戈(I)】及末筆又【水(E)】。" }
      ];

      tbody.innerHTML = typos.map(t => `
        <tr>
          <td style="font-weight: 800; text-align: center; color: #1E3A8A;">${t.rank}</td>
          <td style="font-size: 20px; font-weight: 900; text-align: center; color: #EF4444;">${t.char}</td>
          <td style="text-align: center; font-weight: 700; color: #D97706;">${t.count}</td>
          <td style="text-align: center; color: #64748B;">${t.hw}</td>
          <td style="font-weight: 800; color: #2563EB;">${t.code}</td>
          <td style="font-size: 13px; color: #334155; line-height: 1.4;">${t.secret}</td>
        </tr>
      `).join('');
    }

    // ==========================================
    // 搜尋與 Kiosk 輪播
    // ==========================================
    function handleSearch(keyword) {
      const q = keyword.trim().toLowerCase();
      document.querySelectorAll('.rank-card, .star-card').forEach(card => {
        const info = card.getAttribute('data-student') || '';
        if (!q) {
          card.classList.remove('highlight');
          card.style.display = '';
        } else if (info.toLowerCase().includes(q)) {
          card.classList.add('highlight');
          card.style.display = '';
        } else {
          card.classList.remove('highlight');
          card.style.display = 'none';
        }
      });
    }

    function toggleKioskMode() {
      const btn = document.getElementById('kiosk-btn');
      if (isKiosk) {
        clearInterval(kioskInterval);
        isKiosk = false;
        btn.textContent = '🖥️ 投影輪播';
        btn.style.background = 'white';
        btn.style.color = '#2563EB';
      } else {
        isKiosk = true;
        btn.textContent = '⏸️ 停止輪播';
        btn.style.background = '#2563EB';
        btn.style.color = 'white';
        const tabs = ['top40', 'class', 'perfect'];
        let idx = 0;
        kioskInterval = setInterval(() => {
          idx = (idx + 1) % tabs.length;
          switchTab(tabs[idx]);
        }, 6000);
      }
    }

    function switchTab(tabId) {
      activeTab = tabId;
      document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
        const ids = ['top40', 'class', 'perfect', 'game', 'vocab'];
        btn.classList.toggle('active', ids[idx] === tabId);
      });
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
      const activePanel = document.getElementById(`panel-${tabId}`);
      if (activePanel) activePanel.classList.add('active');

      if (tabId === 'top40') {
        try { renderTop40(); renderClassBarCharts(); } catch(e){}
      } else if (tabId === 'class') {
        try { renderClassCards(); } catch(e){}
      } else if (tabId === 'perfect') {
        try { renderPerfectScorers(); renderClassBarCharts(); } catch(e){}
      } else if (tabId === 'game') {
        if (!currentQuiz) loadRound();
      }
    }

    // ==========================================
    // 學生身份登入 (下拉式選單選擇班別與學號 1-36)
    // ==========================================
    function submitStudentLogin() {
      const cls = document.getElementById('login-class-select').value;
      const numVal = document.getElementById('login-num-select').value;
      const num = Number(numVal);
      if (!isValidStudentIdentity({ cls, num })) {
        alert('請選擇 P5A–P5F 班及你的學號 (1 ~ 36 號)！');
        return;
      }
      const padNum = num < 10 ? '0' + num : num;
      currentStudent = { cls, num, name: `${cls} ${padNum}號` };
      SafeStorage.setItem('p5_last_login', JSON.stringify(currentStudent));
      
      document.getElementById('identity-section').style.display = 'none';
      document.getElementById('battle-section').style.display = 'block';
      loadStudentProfile();
      // 🌐 登入後立刻抓一次雲端榜單：分項分數可能比本機新（換電腦、剛在其他機台練完），
      //    抓回來就併進本機、重刷解鎖；這也是真鎖的權威分數來源（抓不到＝安全網放行）。
      if (typeof fetchCloudLeaderboard === 'function') fetchCloudLeaderboard(true);
      startNewSession();
    }

    function isValidStudentIdentity(student) {
      return !!student && /^P5[A-F]$/.test(student.cls) &&
        Number.isInteger(student.num) && student.num >= 1 && student.num <= 36;
    }

    function switchIdentity() {
      currentStudent = null;
      activeSkills = [];
      SafeStorage.removeItem('p5_last_login');
      document.getElementById('battle-section').style.display = 'none';
      document.getElementById('identity-section').style.display = 'block';
    }

    function loadStudentProfile() {
      // 學生登入時自動檢查並補送離線隊列
      try { flushPendingUploads(); } catch(e) {}
      if (!currentStudent) return;
      const stats = getStudentStats(currentStudent.cls, currentStudent.num);
      const { currentTier, unlockedSkills } = evalTierAndSkills(stats.totalScore);
      activeSkills = unlockedSkills || [];
      // 🔓 分頁的關卡編號與解鎖狀態要看「這位學生」的分數 ⇒ 登入後必須重畫一次
      //   （initAllViews 在登入前就跑過，那時 currentStudent 還是 null）。
      try { renderModeTabs(); } catch (e) { console.error('renderModeTabs error:', e); }

      const nameEl = document.getElementById('trainer-display-name');
      const titleEl = document.getElementById('trainer-display-title');
      const badgeEl = document.getElementById('trainer-current-badge');
      const killsEl = document.getElementById('trainer-display-kills');
      const scoreEl = document.getElementById('trainer-display-score');

      if (nameEl) nameEl.textContent = currentStudent.name;
      if (titleEl) titleEl.textContent = currentTier.title;
      if (badgeEl) badgeEl.textContent = currentTier.badge;
      if (killsEl) killsEl.textContent = stats.kills;
      if (scoreEl) scoreEl.textContent = stats.totalScore.toLocaleString();

      // 🎖️ 同步刷新勳章技能館畫面與進度
      renderSkillsHall();
    }

    // ==========================================
    // 🎮 GAME ENGINE: 方案 B【教學難點攻堅方案】
    // ==========================================
    
    // ==========================================
    // 🎲 Fisher-Yates 標準隨機洗牌演算法
    // ==========================================

    /* 🗺️ 模式分頁按鈕與計分說明一律由註冊表生成（只生成 visible 的模式）。
       加新模式只要在 js/modes.js 加一筆；解鎖狀態即時由分數算出，不存旗標（unlockOf）。

       🔓 解鎖（2026-10-14 使用者定案：**真鎖＋安全網**）：
       - 主線依顯示順序串成解鎖鏈，前一站的累積分達到它的 completeAt ⇒ 本站開啓。
       - **真鎖**：當「雲端分項分數已成功同步」（cloudScoresKnown）且學生已登入時，
         未達標的站真的進不去，點擊只提示「還差 N 分」。
       - **安全網**：離線／同步失敗／未登入時自動退回軟鎖（仍可進入、只提示），
         換電腦、校網斷線、臨時狀況都不會把學生卡死；另備教師全開（?teacher=1）。 */
    function currentModeScores() {
      if (!currentStudent) return {};
      try {
        const stats = getStudentStats(currentStudent.cls, currentStudent.num);
        return (stats && stats.modeScores) ? stats.modeScores : {};
      } catch (e) { return {}; }
    }

    function unlockOf(modeId, scores) {
      if (MODE_REGISTRY.unlockOf) return MODE_REGISTRY.unlockOf(modeId, scores);
      return { staged: false, stageNo: 0, unlocked: true, complete: false, remaining: 0, prevName: '' };
    }

    /* 🔓 教師全開（安全網之一，2026-10-14）：帶班、離線救援、突發狀況用。
       入口：網址加 ?teacher=1 全開、?teacher=0 關閉；開啓狀態存在本機，
       畫面左下角會出現一枚可點擊的徽章（點一下就關掉、恢復正常鎖定顯示）。 */
    const TEACHER_UNLOCK_KEY = 'p5_unlock_all';
    function isTeacherUnlock() {
      try { return SafeStorage.getItem(TEACHER_UNLOCK_KEY) === '1'; } catch (e) { return false; }
    }
    function initTeacherUnlock() {
      try {
        const search = (typeof window !== 'undefined' && window.location && window.location.search)
          ? window.location.search : '';
        if (search && typeof URLSearchParams === 'function') {
          const p = new URLSearchParams(search).get('teacher');
          if (p === '1') SafeStorage.setItem(TEACHER_UNLOCK_KEY, '1');
          else if (p === '0') SafeStorage.removeItem(TEACHER_UNLOCK_KEY);
        }
      } catch (e) {}
      renderTeacherUnlockBadge();
    }
    function renderTeacherUnlockBadge() {
      let badge = document.getElementById('teacher-unlock-badge');
      if (!isTeacherUnlock()) {
        if (badge && badge.remove) badge.remove();
        return;
      }
      if (!badge && document.body && document.body.appendChild) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.id = 'teacher-unlock-badge';
        badge.className = 'teacher-unlock-badge';
        badge.addEventListener('click', () => {
          SafeStorage.removeItem(TEACHER_UNLOCK_KEY);
          renderTeacherUnlockBadge();
          renderModeTabs();
          showPassToast('已關閉教師全開：關卡鎖定恢復正常');
        });
        document.body.appendChild(badge);
      }
      if (badge) badge.textContent = '🔓 教師全開中（點此關閉）';
    }

    function renderModeTabs() {
      const bar = document.querySelector('.mode-tab-bar');
      const noteRow = document.querySelector('.mode-scoring-note-row');
      const tabs = MODE_REGISTRY.forTabs ? MODE_REGISTRY.forTabs() : [];
      const scores = currentModeScores();
      const teacherAll = isTeacherUnlock();
      if (bar) {
        bar.innerHTML = '';
        tabs.forEach(mode => {
          const unlock = unlockOf(mode.id, scores);
          // 🔐 真鎖：雲端分項同步成功（分數權威）＋已登入 ⇒ 未達標真的擋；
          //    離線／同步失敗／未登入一律退回軟鎖（安全網，見 cloudScoresKnown 註解）。
          const locked = !teacherAll && unlock.staged && !unlock.unlocked;
          const hardLocked = locked && cloudScoresKnown && !!currentStudent;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.id = 'mode-tab-' + mode.id;
          btn.className = 'mode-tab-btn' + (mode.id === currentGameMode ? ' active' : '')
            + (locked ? ' locked' : '') + (hardLocked ? ' hard-locked' : '')
            + (unlock.complete ? ' cleared' : '');
          // 關卡編號：主線「第 N 關」（依顯示順序自動生成，不寫死站號）；挑戰線標「挑戰」。
          const chip = document.createElement('span');
          if (unlock.staged) {
            chip.className = 'mode-stage-chip';
            chip.textContent = String(unlock.stageNo);
            btn.title = `主線第 ${unlock.stageNo} 關`;
          } else {
            chip.className = 'mode-stage-chip mode-stage-chip-challenge';
            chip.textContent = '挑戰';
          }
          btn.appendChild(chip);
          if (mode.icon) {
            const icon = document.createElement('span');
            icon.textContent = mode.icon;
            btn.appendChild(icon);
          }
          btn.appendChild(document.createTextNode(' ' + (mode.name || mode.id) + ' '));
          // 狀態膠囊：未開啓顯示還差幾分；已達標顯示完成勾；其餘顯示原有的 badge。
          const pillText = locked
            ? `🔒 還差 ${unlock.remaining} 分`
            : (unlock.complete && unlock.staged ? `✓ ${mode.badge || ''}` : (mode.badge || ''));
          if (pillText) {
            const pill = document.createElement('span');
            pill.className = 'mode-badge-pill'
              + (locked ? ' mode-badge-locked' : (unlock.complete && unlock.staged ? ' mode-badge-done' : ''));
            pill.textContent = pillText;
            btn.appendChild(pill);
          }
          btn.addEventListener('click', () => {
            if (hardLocked) {
              showPassToast(`🔒 先完成【${unlock.prevName}】：還差 ${unlock.remaining} 分（達標後才能進入）`);
              return;
            }
            if (locked) {
              showPassToast(`🔒 先完成【${unlock.prevName}】：還差 ${unlock.remaining} 分（仍可先進來玩）`);
            }
            setGameMode(mode.id);
          });
          bar.appendChild(btn);
        });
      }
      if (noteRow) {
        noteRow.innerHTML = '';
        tabs.forEach(mode => {
          if (!mode.note) return;
          const p = document.createElement('p');
          p.className = 'mode-scoring-note mode-scoring-note-' + mode.id
            + (mode.id === currentGameMode ? ' active' : '');
          // 說明文字由 repo 內的註冊表提供（非使用者輸入），沿用原本的 HTML 標記。
          p.innerHTML = '📖 <strong>怎麼得分？</strong>' + mode.note;
          noteRow.appendChild(p);
        });
      }
    }

    /* 分數變動後重畫分頁，並在「剛好跨過門檻」時放一次開啓儀式。
       前後狀態都在這裡比對 ⇒ 不需要儲存任何解鎖旗標。 */
    function refreshUnlockUI(prevScores) {
      if (!currentStudent) return;
      const now = currentModeScores();
      const tabs = MODE_REGISTRY.forTabs ? MODE_REGISTRY.forTabs() : [];
      const opened = tabs.filter(mode => {
        const before = unlockOf(mode.id, prevScores || {});
        const after = unlockOf(mode.id, now);
        return after.staged && !before.unlocked && after.unlocked;
      });
      renderModeTabs();
      if (opened.length) {
        const names = opened.map(m => `【${m.short || m.name || m.id}】`).join('、');
        showPassToast(`🎉 新關卡開啓：${names}`);
        if (typeof burstConfetti === 'function') burstConfetti();
      }
    }

    function setGameMode(mode) {
      speedActive = false;
      survivalActive = false;
      petActive = false;
      runActive = false;
      siegeActive = false;
      if (window.P5WordBank) window.P5WordBank.applyPending();
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
      if (speedTimerInterval) clearInterval(speedTimerInterval);
      if (speedHintTimer) clearTimeout(speedHintTimer);
      if (survivalTimerInterval) clearInterval(survivalTimerInterval);
      if (survivalHintTimer) clearTimeout(survivalHintTimer);
      if (petHintTimer) clearTimeout(petHintTimer);
      if (runHintTimer) { clearTimeout(runHintTimer); runHintTimer = null; }
      if (runTickTimer) { clearInterval(runTickTimer); runTickTimer = null; }
      if (siegeRafId) { cancelAnimationFrame(siegeRafId); siegeRafId = null; }
      window.removeEventListener('keydown', handleSpeedKeydown, true);
      window.removeEventListener('keydown', handleSurvivalKeydown, true);
      window.removeEventListener('keydown', handlePetKeydown, true);
      window.removeEventListener('keydown', handleRunKeydown, true);
      window.removeEventListener('keydown', siegeHandleKeydown, true);
      // 隱藏寵物區塊（若正顯示中）
      const petSec = document.getElementById('pet-arena-section');
      if (petSec) petSec.style.display = 'none';
      // 隱藏跑酷區塊（若正顯示中）
      const runSec0 = document.getElementById('run-arena-section');
      if (runSec0) runSec0.style.display = 'none';
      // 隱藏法陣區塊（若正顯示中）
      const siegeSec0 = document.getElementById('siege-arena-section');
      if (siegeSec0) siegeSec0.style.display = 'none';

      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }

      currentQuiz = null;
      currentGameMode = mode;

      document.querySelectorAll('.mode-tab-btn').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById(`mode-tab-${mode}`);
      if (activeBtn) activeBtn.classList.add('active');

      // 📖 計分說明：只顯示當前模式那一句。
      document.querySelectorAll('.mode-scoring-note').forEach(n => n.classList.remove('active'));
      const note = document.querySelector(`.mode-scoring-note-${mode}`);
      if (note) note.classList.add('active');

      const speedSection = document.getElementById('speed-arena-section');
      const survivalSection = document.getElementById('survival-arena-section');
      const wildArena = document.getElementById('capture-arena');
      const targetWord = document.getElementById('target-char');
      const monsterIcon = document.getElementById('monster-icon');
      const targetSubHint = document.getElementById('target-sub-hint');
      const standardSlots = document.getElementById('standard-slots-row');
      const splitSlots = document.getElementById('split-slots-row');
      const secretBox = document.getElementById('secret-box');

      // 🗺️ 依「機制」分派畫面，不依模式 id 分派 → 加新模式（5/6/7…）時這裡完全不用改。
      if (MODE_REGISTRY.mechOf(mode) === 'timed') {
        // ⚡ 限時模式（手速賽）：展示備戰大廳，不直接開始計時
        if (speedSection) speedSection.style.display = 'block';
        if (survivalSection) survivalSection.style.display = 'none';
        if (wildArena) wildArena.style.display = 'none';
        if (targetWord) targetWord.style.display = 'none';
        if (monsterIcon) monsterIcon.style.display = 'none';
        if (targetSubHint) targetSubHint.style.display = 'none';
        if (standardSlots) standardSlots.style.display = 'none';
        if (splitSlots) splitSlots.style.display = 'none';
        if (secretBox) secretBox.style.display = 'none';

        document.getElementById('game-prompt').style.display = 'none';
        initSpeedWeekDropdown();
        returnToSpeedReadyStage();

        window.addEventListener('keydown', handleSpeedKeydown, true);
      } else if (MODE_REGISTRY.mechOf(mode) === 'survival') {
        // 💀 生存模式：同樣先展示備戰說明，按開始才倒數
        if (speedSection) speedSection.style.display = 'none';
        if (survivalSection) survivalSection.style.display = 'block';
        if (wildArena) wildArena.style.display = 'none';
        if (targetWord) targetWord.style.display = 'none';
        if (monsterIcon) monsterIcon.style.display = 'none';
        if (targetSubHint) targetSubHint.style.display = 'none';
        if (standardSlots) standardSlots.style.display = 'none';
        if (splitSlots) splitSlots.style.display = 'none';
        if (secretBox) secretBox.style.display = 'none';

        document.getElementById('game-prompt').style.display = 'none';
        returnToSurvivalReadyStage();

        window.addEventListener('keydown', handleSurvivalKeydown, true);
      } else if (MODE_REGISTRY.mechOf(mode) === 'pet') {
        // 🐣 寵物養成：直接進場（沒有備戰頁），載入寵物狀態並開始餵食
        if (speedSection) speedSection.style.display = 'none';
        if (survivalSection) survivalSection.style.display = 'none';
        const petSection = document.getElementById('pet-arena-section');
        if (petSection) petSection.style.display = 'block';
        if (wildArena) wildArena.style.display = 'none';
        if (targetWord) targetWord.style.display = 'none';
        if (monsterIcon) monsterIcon.style.display = 'none';
        if (targetSubHint) targetSubHint.style.display = 'none';
        if (standardSlots) standardSlots.style.display = 'none';
        if (splitSlots) splitSlots.style.display = 'none';
        if (secretBox) secretBox.style.display = 'none';

        document.getElementById('game-prompt').style.display = 'none';
        enterPetArena();

        window.removeEventListener('keydown', handlePetKeydown, true);
        window.addEventListener('keydown', handlePetKeydown, true);
      } else if (MODE_REGISTRY.mechOf(mode) === 'run') {
        // 🏃 倉頡大冒險（橫向跑酷）：直接進場，角色自動開跑
        if (speedSection) speedSection.style.display = 'none';
        if (survivalSection) survivalSection.style.display = 'none';
        const runSection = document.getElementById('run-arena-section');
        if (runSection) runSection.style.display = 'block';
        if (wildArena) wildArena.style.display = 'none';
        if (targetWord) targetWord.style.display = 'none';
        if (monsterIcon) monsterIcon.style.display = 'none';
        if (targetSubHint) targetSubHint.style.display = 'none';
        if (standardSlots) standardSlots.style.display = 'none';
        if (splitSlots) splitSlots.style.display = 'none';
        if (secretBox) secretBox.style.display = 'none';

        document.getElementById('game-prompt').style.display = 'none';
        enterRunArena();

        window.removeEventListener('keydown', handleRunKeydown, true);
        window.addEventListener('keydown', handleRunKeydown, true);
      } else if (MODE_REGISTRY.mechOf(mode) === 'siege') {
        // 🧙 文字突圍：字靈倖存者（法陣守衛戰）：先顯示準備畫面，按開始才出怪
        if (speedSection) speedSection.style.display = 'none';
        if (survivalSection) survivalSection.style.display = 'none';
        const siegeSection = document.getElementById('siege-arena-section');
        if (siegeSection) siegeSection.style.display = 'block';
        if (wildArena) wildArena.style.display = 'none';
        if (targetWord) targetWord.style.display = 'none';
        if (monsterIcon) monsterIcon.style.display = 'none';
        if (targetSubHint) targetSubHint.style.display = 'none';
        if (standardSlots) standardSlots.style.display = 'none';
        if (splitSlots) splitSlots.style.display = 'none';
        if (secretBox) secretBox.style.display = 'none';

        document.getElementById('game-prompt').style.display = 'none';
        enterSiegeArena();

        window.removeEventListener('keydown', siegeHandleKeydown, true);
        window.addEventListener('keydown', siegeHandleKeydown, true);
      } else {
        // 全碼類（code）與分體字類（twoPart）：進入捕捉球戰場
        const twoPart = MODE_REGISTRY.mechOf(mode) === 'twoPart';
        if (speedSection) speedSection.style.display = 'none';
        if (survivalSection) survivalSection.style.display = 'none';
        if (wildArena) wildArena.style.display = 'block';
        if (targetWord) targetWord.style.display = 'block';
        if (monsterIcon) monsterIcon.style.display = 'block';
        if (targetSubHint) targetSubHint.style.display = 'block';
        if (standardSlots) standardSlots.style.display = twoPart ? 'none' : 'flex';
        if (splitSlots) splitSlots.style.display = twoPart ? 'flex' : 'none';
        document.getElementById('game-prompt').style.display = 'block';

        modeQuizQueues[mode] = [];
        startNewSession();
      }
    }

    
    // ==========================================
    // 🔔 速度與通行提示框 (showPassToast)
    // ==========================================
    function setArenaSpeed(speed, activeBtnId) {
      wanderingSpeedMultiplier = speed;
      document.querySelectorAll('.arena-speed-btn').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById(activeBtnId);
      if (activeBtn) activeBtn.classList.add('active');

      let tip = '';
      if (speed > 1.2) {
        tip = '⚡ 切換為【敏捷速度】：精靈球高速遊行，答對享有 1.4x (+40%) 速度積分加成！';
      } else if (speed === 0) {
        tip = '⏸️ 切換為【定點輔助】：精靈球靜止不動，簡易模式得分為 0.6x 折減。';
      } else {
        tip = '🟢 切換為【悠閒模式】：標準遊行速度，答對獲取 1.0x 標準分數。';
      }
      showPassToast(tip);
    }

    function startNewSession() {
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
      gameStage = 1;
      sessionScore = 0;
      sessionCorrectCount = 0;
      comboCount = 0;
      pendingRoundResults = [];
      // 保留未出過的題目繼續出題，實現多輪連續不重複；待完整題庫抽盡後才自動觸發新一輪洗牌
      currentQuiz = null;

      document.getElementById('session-summary-box').style.display = 'none';
      document.getElementById('active-play-area').style.display = 'block';
      loadRound();
    }

    function loadRound() {
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }

      selectedCodes = [];
      selectedPrefix = [];
      selectedBody = [];
      roundMistakeCount = 0;
      roundShieldActive = false;

      document.getElementById('secret-box').style.display = 'none';
      document.getElementById('game-stage-tag').textContent = `關卡 ${gameStage} / 5`;
      document.getElementById('game-combo-tag').textContent = `連擊：${comboCount} Hit 🔥`;
      document.getElementById('game-score-tag').textContent = `本輪得分：${sessionScore} 分`;

      const stdRow = document.getElementById('standard-slots-row');
      const splitRow = document.getElementById('split-slots-row');

      // 🗺️ 依「機制」分派出題與版面，不依模式 id 分派：
      //    全碼類（connected／special／日後站 4~7）共用同一段程式，
      //    各模式的圖示、提示文字與結算分數一律取自 registry 的 view。
      //    限時類（手速賽）有自己的流程，這裡不處理。
      const modeView = MODE_REGISTRY.viewOf(currentGameMode);
      const mech = MODE_REGISTRY.mechOf(currentGameMode);

      if (mech === 'twoPart') {
        // 分體字類：先字首區、再字身區
        stdRow.style.display = 'none';
        splitRow.style.display = 'flex';
        document.getElementById('monster-icon').textContent = modeView.monster || '🧩';

        if (!currentQuiz || !currentQuiz.prefix_codes) {
          currentQuiz = getNextQuiz(currentGameMode);
        }

        document.getElementById('target-char').textContent = currentQuiz.char;
        document.getElementById('target-sub-hint').textContent = `【分體字取碼：字首最多2碼取首尾，字身最多3碼取首二尾】 總碼長度：${currentQuiz.prefix_codes.length + currentQuiz.body_codes.length} 碼！`;
        document.getElementById('game-prompt').textContent = `先捕捉【字首區】(${currentQuiz.prefix_codes.length}碼)，再捕捉【字身區】(${currentQuiz.body_codes.length}碼)！`;
        document.getElementById('game-prompt').style.color = modeView.color || '#7C3AED';

        const pre1 = document.getElementById('slot-pre-1');
        const pre2 = document.getElementById('slot-pre-2');
        pre1.className = 'code-slot'; document.getElementById('val-pre-1').textContent = '？';
        if (currentQuiz.prefix_codes.length > 1) {
          pre2.style.display = 'flex';
          pre2.className = 'code-slot';
          document.getElementById('val-pre-2').textContent = '？';
          document.getElementById('label-pre-1').textContent = '字首首碼';
          document.getElementById('label-pre-2').textContent = '字首尾碼';
        } else {
          pre2.style.display = 'none';
          document.getElementById('label-pre-1').textContent = '字首碼';
        }

        for (let i = 1; i <= 3; i++) {
          const bSlot = document.getElementById(`slot-body-${i}`);
          const bVal = document.getElementById(`val-body-${i}`);
          const bLabel = document.getElementById(`label-body-${i}`);
          if (i <= currentQuiz.body_codes.length) {
            bSlot.style.display = 'flex';
            bSlot.className = 'code-slot';
            bVal.textContent = '？';
            if (currentQuiz.body_codes.length === 1) {
              if (bLabel) bLabel.textContent = '字身碼';
            } else if (currentQuiz.body_codes.length === 2) {
              if (bLabel) bLabel.textContent = i === 1 ? '字身首碼' : '字身尾碼';
            } else if (currentQuiz.body_codes.length === 3) {
              if (bLabel) bLabel.textContent = i === 1 ? '字身首碼' : (i === 2 ? '字身次碼' : '字身尾碼');
            }
          } else {
            bSlot.style.display = 'none';
          }
        }

        let options = [];
        currentQuiz.prefix_codes.forEach((c, idx) => {
          options.push({ code: c, part: 'prefix', partIdx: idx, isCorrect: true, orbId: `pre-${idx}` });
        });
        currentQuiz.body_codes.forEach((c, idx) => {
          options.push({ code: c, part: 'body', partIdx: idx, isCorrect: true, orbId: `body-${idx}` });
        });

        const allTargetCodes = [...currentQuiz.prefix_codes, ...currentQuiz.body_codes];
        const distractors = fisherYatesShuffle(
          DATA.cangjie_clean_letters.filter(l => !allTargetCodes.includes(l.code))
        );

        let distCount = 0;
        while (options.length < 8 && distractors.length > 0) {
          const item = distractors.pop();
          distCount++;
          options.push({ code: item.code, isCorrect: false, orbId: `dist-${distCount}` });
        }
        options = fisherYatesShuffle(options);
        setupWanderingOrbs(options);

      } else if (mech === 'code') {
        // 全碼類：依筆順捕捉完整字根
        stdRow.style.display = 'flex';
        splitRow.style.display = 'none';
        document.getElementById('monster-icon').textContent = modeView.monster || '⚔️';

        if (!currentQuiz || !currentQuiz.codes) {
          currentQuiz = getNextQuiz(currentGameMode);
        }
        // 題庫為空（例如週次字庫尚未發布）時不硬撐，交給上層顯示狀態。
        if (!currentQuiz) return;

        const viewVars = {
          char: currentQuiz.char,
          len: currentQuiz.codes.length,
          type: currentQuiz.type,
          short: (MODE_REGISTRY.find(currentGameMode) || {}).short || currentGameMode
        };
        document.getElementById('target-char').textContent = currentQuiz.char;
        document.getElementById('target-sub-hint').textContent = MODE_REGISTRY.fill(modeView.hint, viewVars);
        document.getElementById('game-prompt').textContent = MODE_REGISTRY.fill(modeView.prompt, viewVars);
        document.getElementById('game-prompt').style.color = modeView.color || '#1E3A8A';

        const labels = modeView.slots || ['① 首碼', '② 次碼', '③ 三碼', '④ 尾碼'];
        // 槽位數＝單碼上限（目前最長 5 碼，留一格餘裕）。不可寫死 4：
        // 站 3 有「睡／豐／慧」等 5 碼字，寫死會讓第 5 碼找不到槽位而整局崩掉。
        for (let i = 1; i <= MAX_CODE_SLOTS; i++) {
          const slot = document.getElementById(`slot-${i}`);
          const val = document.getElementById(`val-${i}`);
          const label = document.getElementById(`label-slot-${i}`);
          if (!slot) continue;
          if (i <= currentQuiz.codes.length) {
            slot.style.display = 'flex';
            slot.className = 'code-slot';
            val.textContent = '？';
            label.textContent = labels[i - 1] || `第 ${i} 碼`;
          } else {
            slot.style.display = 'none';
          }
        }

        let options = [];
        const orbPrefix = modeView.orbPrefix || 'corr';
        currentQuiz.codes.forEach((c, idx) => {
          options.push({ code: c, isCorrect: true, stepIdx: idx, orbId: `${orbPrefix}-${idx}` });
        });

        const distractors = fisherYatesShuffle(
          DATA.cangjie_clean_letters.filter(l => !currentQuiz.codes.includes(l.code))
        );

        let distCount = 0;
        while (options.length < 8 && distractors.length > 0) {
          const item = distractors.pop();
          distCount++;
          options.push({ code: item.code, isCorrect: false, orbId: `dist-${distCount}` });
        }
        options = fisherYatesShuffle(options);
        setupWanderingOrbs(options);
      }

      // 戰鬥隨機技能觸發：精準直覺
      const focusSkill = activeSkills.find(s => s.name.includes('精準直覺'));
      if (focusSkill && Math.random() < focusSkill.rate) {
        activeOrbs.forEach(orb => {
          if (orb.isCorrect) orb.el.classList.add('highlight-focus');
        });
        triggerSkillToast('⚡', '觸發【精準直覺】！感應到正確字根精靈球發出強烈能量光暈！');
      }
    }

    // 精靈球物理遊行引擎 (純粹精靈球，無提示，無灰色殘留)
    function setupWanderingOrbs(options) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      const arena = document.getElementById('capture-arena');
      const orbsContainer = document.getElementById('orbs-container');
      orbsContainer.innerHTML = '';

      const arenaW = arena.clientWidth || 600;
      const arenaH = arena.clientHeight || 250;
      const orbSize = 72;

      const padX = 14;
      const padTop = 44;
      const padBottom = 14;
      const minX = padX;
      const maxX = Math.max(minX + 10, arenaW - orbSize - padX);
      const minY = padTop;
      const maxY = Math.max(minY + 10, arenaH - orbSize - padBottom);

      activeOrbs = [];

      options.forEach((opt, idx) => {
        const el = document.createElement('div');
        el.className = 'poke-orb';
        el.id = `orb-${idx}`;

        el.innerHTML = `
          <div class="poke-orb-center-ring"></div>
          <div class="poke-orb-content">
            <div class="poke-orb-char">${opt.code}</div>
          </div>
        `;

        const cols = 4;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellW = (maxX - minX) / cols;
        const cellH = (maxY - minY) / 2;
        const initX = minX + col * cellW + Math.random() * (cellW * 0.35);
        const initY = minY + row * cellH + Math.random() * (cellH * 0.35);

        const angle = Math.random() * Math.PI * 2;
        const baseSpeed = 0.85 + Math.random() * 0.4;
        const vx = Math.cos(angle) * baseSpeed;
        const vy = Math.sin(angle) * baseSpeed;

        const orbObj = {
          el: el,
          ...opt,
          x: Math.max(minX, Math.min(maxX, initX)),
          y: Math.max(minY, Math.min(maxY, initY)),
          vx: vx,
          vy: vy,
          isHovered: false
        };

        el.addEventListener('mouseenter', () => { orbObj.isHovered = true; });
        el.addEventListener('mouseleave', () => { orbObj.isHovered = false; });
        el.addEventListener('click', () => { catchOrb(orbObj); });

        orbsContainer.appendChild(el);
        activeOrbs.push(orbObj);
      });

      runWanderingPhysics();
    }

    function runWanderingPhysics() {
      const arena = document.getElementById('capture-arena');
      const arenaW = arena.clientWidth || 600;
      const arenaH = arena.clientHeight || 250;
      const orbSize = 72;

      const padX = 14;
      const padTop = 44;
      const padBottom = 14;
      const minX = padX;
      const maxX = Math.max(minX + 10, arenaW - orbSize - padX);
      const minY = padTop;
      const maxY = Math.max(minY + 10, arenaH - orbSize - padBottom);

      activeOrbs.forEach(o => {
        if (!o.isHovered && wanderingSpeedMultiplier > 0) {
          o.x += o.vx * wanderingSpeedMultiplier;
          o.y += o.vy * wanderingSpeedMultiplier;

          if (o.x <= minX) { o.x = minX; o.vx = Math.abs(o.vx); }
          else if (o.x >= maxX) { o.x = maxX; o.vx = -Math.abs(o.vx); }

          if (o.y <= minY) { o.y = minY; o.vy = Math.abs(o.vy); }
          else if (o.y >= maxY) { o.y = maxY; o.vy = -Math.abs(o.vy); }
        }
        o.el.style.transform = `translate3d(${o.x}px, ${o.y}px, 0)`;
      });

      animationFrameId = requestAnimationFrame(runWanderingPhysics);
    }

    // ==========================================
    // 點選捕捉判定 (修復：錯誤時不消失、連續5次失誤提示)
    // ==========================================
    function catchOrb(orbObj) {
      let currentNeededCode = '';

      // 🗺️ 依機制分派：twoPart＝字首／字身兩段；code＝單一字根序列。
      if (MODE_REGISTRY.mechOf(currentGameMode) === 'code') {
        const neededIdx = selectedCodes.length;
        currentNeededCode = currentQuiz.codes[neededIdx];

        if (orbObj.code === currentNeededCode) {
          orbObj.el.classList.add('caught');
          orbObj.el.classList.remove('highlight-hint');
          selectedCodes.push(orbObj.code);
          // 槽位可能不足（例如字庫出現比 MAX_CODE_SLOTS 更長的字）——
          // 這裡絕不可讓 null.className 崩掉整局；找不到就只記警告、照樣算答對。
          const currentSlot = document.getElementById(`slot-${neededIdx + 1}`);
          const currentVal = document.getElementById(`val-${neededIdx + 1}`);
          if (currentSlot && currentVal) {
            currentSlot.className = 'code-slot filled';
            currentVal.textContent = orbObj.code;
          } else {
            console.warn('[slot] 缺少 slot-' + (neededIdx + 1)
              + '，請確認 MAX_CODE_SLOTS 與 index.html 的槽位數量一致');
          }

          if (selectedCodes.length < currentQuiz.codes.length) {
            document.getElementById('game-prompt').innerHTML = `🎯 <span style="color:#2563EB;font-weight:900;">成功捕捉第 ${neededIdx + 1} 碼【${orbObj.code}】！快捕捉下一碼！</span>`;
          } else {
            checkAnswer(true);
          }
        } else {
          triggerMistake(orbObj, `捕捉錯誤！【${orbObj.code}】不是當前所需字碼，請再試！`);
        }

      } else {
        const preLen = currentQuiz.prefix_codes.length;
        const bodyLen = currentQuiz.body_codes.length;

        if (selectedPrefix.length < preLen) {
          currentNeededCode = currentQuiz.prefix_codes[selectedPrefix.length];
          if (orbObj.code === currentNeededCode) {
            orbObj.el.classList.add('caught');
            orbObj.el.classList.remove('highlight-hint');
            selectedPrefix.push(orbObj.code);
            const slot = document.getElementById(`slot-pre-${selectedPrefix.length}`);
            slot.className = 'code-slot filled';
            document.getElementById(`val-pre-${selectedPrefix.length}`).textContent = orbObj.code;

            if (selectedPrefix.length < preLen) {
              document.getElementById('game-prompt').innerHTML = `🔵 <span style="color:#1D4ED8;font-weight:900;">字首首碼命中！接著捕捉字首尾碼！</span>`;
            } else {
              document.getElementById('game-prompt').innerHTML = `🟣 <span style="color:#6D28D9;font-weight:900;">字首完成！接著捕捉【字身區】字碼！</span>`;
            }
          } else {
            triggerMistake(orbObj, `捕捉錯誤！這是字首區，【${orbObj.code}】不屬於字首，請再試！`);
          }

        } else if (selectedBody.length < bodyLen) {
          currentNeededCode = currentQuiz.body_codes[selectedBody.length];
          if (orbObj.code === currentNeededCode) {
            orbObj.el.classList.add('caught');
            orbObj.el.classList.remove('highlight-hint');
            selectedBody.push(orbObj.code);
            const slot = document.getElementById(`slot-body-${selectedBody.length}`);
            slot.className = 'code-slot filled';
            document.getElementById(`val-body-${selectedBody.length}`).textContent = orbObj.code;

            if (selectedBody.length < bodyLen) {
              document.getElementById('game-prompt').innerHTML = `🟣 <span style="color:#6D28D9;font-weight:900;">字身命中 (${selectedBody.length}/${bodyLen})，快找出下一碼！</span>`;
            } else {
              checkAnswer(true);
            }
          } else {
            triggerMistake(orbObj, `捕捉錯誤！【${orbObj.code}】不是當前字身所需碼，請再試！`);
          }
        }
      }
    }

    
    // 🎈 浮動扣分與罰時標籤動畫生成器
    function triggerFloatingNotice(targetEl, text) {
      if (!targetEl) return;
      const rect = targetEl.getBoundingClientRect();
      const tag = document.createElement('div');
      tag.className = 'floating-deduct-tag';
      tag.textContent = text;
      tag.style.left = (rect.left + rect.width / 2) + 'px';
      tag.style.top = rect.top + 'px';
      document.body.appendChild(tag);
      setTimeout(() => tag.remove(), 850);
    }

    function triggerMistake(orbObj, alertMsg) {
      roundMistakeCount++;

      // 錯誤搖晃動效，不隱藏球體
      orbObj.el.classList.add('mistake-shake');
      setTimeout(() => {
        orbObj.el.classList.remove('mistake-shake');
      }, 500);

      const shieldSkill = activeSkills.find(s => s.name.includes('聖盾防護'));
      const timewardSkill = activeSkills.find(s => s.name.includes('時空結界'));
      if (!roundShieldActive && ((shieldSkill && Math.random() < shieldSkill.rate) || (timewardSkill && Math.random() < timewardSkill.rate))) {
        roundShieldActive = true;
        triggerSkillToast('🛡️', '觸發【聖盾防護】！成功格擋失誤，保留連擊！');
        document.getElementById('game-prompt').innerHTML = `🛡️ <span style="color:#2563EB;font-weight:900;">聖盾格擋成功！失誤已免除，連擊保留，請再試！</span>`;
      } else {
        comboCount = 0;
        document.getElementById('game-combo-tag').textContent = `連擊：0 Hit 🔥`;
        
        // 🎯 依使用者需求：按錯選項按比例扣減得分 (-2 分)
        const deductPts = 2;
        sessionScore = Math.max(0, sessionScore - deductPts);
        document.getElementById('game-score-tag').textContent = `本輪得分：${sessionScore} 分 (-${deductPts})`;
        
        // 浮動扣分紅字提示
        if (typeof triggerFloatingNotice === 'function' && orbObj && orbObj.el) {
          triggerFloatingNotice(orbObj.el, `-${deductPts} 分 ⚠️`);
        }
        
        document.getElementById('game-prompt').innerHTML = `⚠️ <span style="color:#DC2626;font-weight:900;">${alertMsg} (扣減 ${deductPts} 分)</span>`;
      }

      // ★ 連續選錯超過 5 次：給予強烈提示與答案展開
      if (roundMistakeCount >= 5) {
        let needed = '';
        if (MODE_REGISTRY.mechOf(currentGameMode) === 'code') {
          needed = currentQuiz.codes[selectedCodes.length];
        } else {
          if (selectedPrefix.length < currentQuiz.prefix_codes.length) {
            needed = currentQuiz.prefix_codes[selectedPrefix.length];
          } else {
            needed = currentQuiz.body_codes[selectedBody.length];
          }
        }

        // 原野中將該正確字碼球高亮金光環繞
        activeOrbs.forEach(o => {
          if (o.code === needed && !o.el.classList.contains('caught')) {
            o.el.classList.add('highlight-hint');
          }
        });

        document.getElementById('game-prompt').innerHTML = `💡 <span style="color:#D97706;font-weight:900;">【提示模式已啟動（已失誤 ${roundMistakeCount} 次）】：目標字根為金光閃爍的【${needed}】球！</span>`;
        
        // 展開拆碼解析秘笈供學生學習
        document.getElementById('secret-box').style.display = 'block';
        document.getElementById('secret-char-badge').textContent = `標準倉頡全碼：${currentQuiz.full}`;
        document.getElementById('secret-desc').textContent = currentQuiz.secret;

        triggerSkillToast('💡', `連續失誤 5 次！雷達已為你感應並鎖定目標字根【${needed}】！`);
      }
    }

    // 通關結算
    function checkAnswer(isCorrect) {
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }

      const secretBox = document.getElementById('secret-box');
      secretBox.style.display = 'block';

      // 🗺️ 結算基礎分與保底分一律取自 registry（加新模式只要在 modes.js 寫數字）。
      const answerView = MODE_REGISTRY.viewOf(currentGameMode);
      let baseScore = answerView.baseScore || 15;

      // 🎯 依失誤次數按比例扣減結算基礎分 (每次失誤扣 2 分，保底分由模式決定)
      const minBase = answerView.minBase || 3;
      const penalty = Math.min(baseScore - minBase, roundMistakeCount * 2);
      baseScore = Math.max(minBase, baseScore - penalty);

      document.getElementById('secret-char-badge').textContent = `標準倉頡全碼：${currentQuiz.full}`;
      document.getElementById('secret-desc').textContent = currentQuiz.secret;

      if (isCorrect) {
        comboCount++;
        sessionCorrectCount++;

        // 🎯 游行速度不同選擇對得分的影響 (定點最容易得分最低，敏捷最高)
        let speedMultiplier = 1.0;
        let speedNotice = '';
        if (wanderingSpeedMultiplier > 1.2) {
          speedMultiplier = 1.4; // 敏捷模式獎勵 +40%
          speedNotice = '⚡敏捷1.4x';
        } else if (wanderingSpeedMultiplier === 0) {
          speedMultiplier = 0.6; // 定點簡易模式扣減至 60%
          speedNotice = '⏸️定點0.6x';
        } else {
          speedMultiplier = 1.0; // 悠閒標準模式 100%
          speedNotice = '🟢悠閒1.0x';
        }

        let roundEarned = Math.max(1, Math.round(baseScore * speedMultiplier));

        let comboBonus = 0;
        if (comboCount === 2) comboBonus = 2;
        else if (comboCount === 3) comboBonus = 4;
        else if (comboCount === 4) comboBonus = 6;
        else if (comboCount >= 5) comboBonus = 10;

        roundEarned += comboBonus;

        let skillBonus = 0;
        const critSkill = activeSkills.find(s => s.name.includes('烈焰爆擊'));
        if (critSkill && Math.random() < critSkill.rate) {
          skillBonus += 5;
          triggerSkillToast('💥', '觸發【烈焰爆擊】！傷害提升，額外獲得 +5 分！');
        }

        const divineSkill = activeSkills.find(s => s.name.includes('神域天罰'));
        if (divineSkill && Math.random() < divineSkill.rate) {
          skillBonus += 6;
          triggerSkillToast('🌌', '觸發【神域天罰】！天雷降臨，額外獲得 +6 分！');
        }

        const chainSkill = activeSkills.find(s => s.name.includes('極限連擊'));
        if (chainSkill && comboCount >= 2 && Math.random() < chainSkill.rate) {
          skillBonus += 3;
          triggerSkillToast('🌊', '觸發【極限連擊】！連擊增益額外獲得 +3 分！');
        }

        const auraSkill = activeSkills.find(s => s.name.includes('波導感知'));
        if (auraSkill && comboCount >= 3 && Math.random() < auraSkill.rate) {
          skillBonus += 2;
          triggerSkillToast('🌀', '觸發【波導感知】！波導同頻，額外獲得 +2 分！');
        }

        const dynamaxSkill = activeSkills.find(s => s.name.includes('極巨衝能'));
        if (dynamaxSkill && Math.random() < dynamaxSkill.rate) {
          skillBonus += 4;
          triggerSkillToast('🌠', '觸發【極巨衝能】！極巨能量爆發，額外獲得 +4 分！');
        }

        const swiftSkill = activeSkills.find(s => s.name.includes('疾風迅雷'));
        if (swiftSkill && Math.random() < swiftSkill.rate) {
          skillBonus += 3;
          triggerSkillToast('⚡', '觸發【疾風迅雷】！疾風神速，額外獲得 +3 分！');
        }

        const starlightSkill = activeSkills.find(s => s.name.includes('星輝庇佑'));
        if (starlightSkill && comboCount >= 4 && Math.random() < starlightSkill.rate) {
          skillBonus += 4;
          triggerSkillToast('💫', '觸發【星輝庇佑】！星輝守護，額外獲得 +4 分！');
        }

        const genesisSkill = activeSkills.find(s => s.name.includes('創世審判'));
        if (genesisSkill && Math.random() < genesisSkill.rate) {
          skillBonus += 6;
          triggerSkillToast('🔱', '觸發【創世審判】！創世神光降臨，額外獲得 +6 分！');
        }

        roundEarned += skillBonus;

        // 🎯 每個字每天最多計分 3 次，第 2、3 次遞減（100% / 50% / 25%）。
        // 次數最終以後端認定為準；前端先依本機快取計算，使畫面即時且與後端一致。
        const { today: todayStr, map: todayMap } = getTodayMastery();
        const usedToday = MasteryCore.countOf(todayMap, masteryKey(currentGameMode, currentQuiz.char), todayStr);
        const decay = MasteryCore.decayFor(usedToday + 1);
        roundEarned = decay > 0 ? Math.max(1, Math.round(roundEarned * decay)) : 0;
        sessionScore += roundEarned;

        // 🎯 模式一／三：不逐題上傳，改為累積本輪結果，5 題結束時集中送出一次（任務 4）。
        // 分數先在畫面即時累加，回答的「今天還算不算分」由後端在結算時判定。
        pendingRoundResults.push({ char: currentQuiz.char, correct: true, earned: roundEarned });

        document.getElementById('game-score-tag').textContent = `本輪得分：${sessionScore} 分 (+${roundEarned} ${speedNotice})`;
        document.getElementById('game-combo-tag').textContent = `連擊：${comboCount} Hit 🔥`;
        document.getElementById('monster-icon').textContent = '💥';

        burstConfetti();

        // 🗺️ 模式名稱取自 registry，新增模式不必再改這一行。
        const modeName = (MODE_REGISTRY.find(currentGameMode) || {}).short || currentGameMode;

        // 🎯 依「今天第幾次計分」給明確回饋（任務 7）。
        const nth = usedToday + 1;
        let clearMsg;
        if (decay === 0) {
          clearMsg = `🎉 <span style="color:#15803D;font-weight:900;">完美通關！全碼擊破【${currentQuiz.char}】！</span> `
            + `<span style="color:#B45309;font-weight:800;">這模式今天已計分 ${MasteryCore.MAX_PER_DAY} 次（上限），繼續練習不加分</span>`;
        } else if (usedToday > 0) {
          const left = MasteryCore.MAX_PER_DAY - nth;
          const tail = left > 0 ? `（分數已遞減，還可再得 ${left} 次）` : '（分數已遞減，已達今日上限）';
          clearMsg = `🎉 <span style="color:#15803D;font-weight:900;">完美通關！全碼擊破【${currentQuiz.char}】！(+${roundEarned}分)</span> `
            + `<span style="color:#B45309;font-weight:800;">今天第 ${nth} 次計分${tail}</span>`;
        } else {
          clearMsg = `🎉 <span style="color:#15803D;font-weight:900;">完美通關！全碼擊破【${currentQuiz.char}】！(+${roundEarned}分)</span>`;
        }

        if (gameStage < 5) {
          document.getElementById('game-prompt').innerHTML = `${clearMsg} <span style="color:#2563EB;font-weight:800;margin-left:8px;">➔ 即將自動進入第 ${gameStage + 1} 關...</span>`;
          triggerStagePassToast(modeName, gameStage, roundEarned, gameStage + 1);
          autoNextTimer = setTimeout(() => nextRound(), 1400);
        } else {
          document.getElementById('game-prompt').innerHTML = `🏆 <span style="color:#D97706;font-weight:900;">太強了！5 關挑戰全數通關！(+${roundEarned}分) ➔ 正在進行總結算...</span>`;
          triggerStagePassToast(modeName, 5, roundEarned, null);
          autoNextTimer = setTimeout(() => nextRound(), 1400);
        }
      }
    }

    function nextRound() {
      currentQuiz = null;
      if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }

      if (gameStage >= 5) {
        document.getElementById('active-play-area').style.display = 'none';
        const summaryBox = document.getElementById('session-summary-box');
        summaryBox.style.display = 'block';

        let clearBonus = 0;
        if (sessionCorrectCount === 5) {
          clearBonus = 20;
          sessionScore += clearBonus;
          // 通關獎勵也計入本輪，與其餘得分一起集中送出。
          if (pendingRoundResults.length > 0) {
            pendingRoundResults[pendingRoundResults.length - 1].earned += clearBonus;
          }
          document.getElementById('summary-congrats-text').innerHTML = `🌟 <strong>大滿貫！5 關全中！</strong> 額外獎勵 <strong>+${clearBonus}</strong> 點通關積分！`;
        } else {
          document.getElementById('summary-congrats-text').textContent = `本輪挑戰完成！答對 ${sessionCorrectCount} 關，繼續挑戰突破極限！`;
        }

        // 🎯 一輪 5 題結束：集中送出一次每日首答判斷（任務 4）。
        submitRoundResults();

        const stats = currentStudent ? getStudentStats(currentStudent.cls, currentStudent.num) : { totalScore: sessionScore };
        const { currentTier } = evalTierAndSkills(stats.totalScore);

        document.getElementById('summary-correct-stat').textContent = `${sessionCorrectCount} / 5 關`;
        document.getElementById('summary-earned-stat').textContent = `+${sessionScore} 分`;
        document.getElementById('summary-total-stat').textContent = `${stats.totalScore.toLocaleString()} 分`;
        document.getElementById('summary-title-stat').textContent = currentTier.title;
        renderMasteryProgress();

        burstConfetti();
      } else {
        gameStage++;
        loadRound();
      }
    }

    /* 一輪結束時集中提交（模式一／三）。
       分數由後端判斷「今天是否首次答對該字」後才確定，前端只負責送出與顯示結果。 */
    function submitRoundResults() {
      if (pendingRoundResults.length === 0) return;
      if (!currentStudent) { pendingRoundResults = []; return; }
      const poolKey = MODE_REGISTRY.poolOf(currentGameMode);
      const pool = (poolKey && DATA[poolKey]) || [];
      const prefix = MODE_REGISTRY.prefixFor(currentGameMode, '');
      const { today, map } = getTodayMastery();
      const round = MasteryCore.buildRound(pendingRoundResults, pool, map, today, prefix);
      pendingRoundResults = [];
      if (round.length === 0) return;

      // 即時更新本機掌握快取，讓下一輪出題與計分立刻知道每個字今天已用掉幾次。
      const scoredNow = round.filter(r => r.earned > 0).map(r => r.char);
      if (scoredNow.length > 0) {
        const merged = Object.assign({}, map);
        scoredNow.forEach(ch => {
          const k = masteryKey(currentGameMode, ch);
          merged[k] = MasteryCore.entryValue(today, MasteryCore.countOf(map, k, today) + 1);
        });
        try {
          SafeStorage.setItem(`p5_mastery_${currentStudent.cls}_${currentStudent.num}`,
            MasteryCore.serializeAll(merged));
        } catch (e) {}
      }

      const requestId = generateRequestId();
      const stats = getStudentStats(currentStudent.cls, currentStudent.num);
      sendReliableWebhook({
        grade: 5, cls: currentStudent.cls, num: currentStudent.num,
        // 分數由後端依 round 判定後回填，這裡先送 0 避免前端自行宣稱得分。
        scoreDelta: 0, killDelta: 0, roundScore: 0,
        gameMode: currentGameMode, mode: currentGameMode,
        wordCount: 10, weekKey: 'w7',
        totalScore: stats.totalScore, kills: stats.kills,
        completedAt: new Date().toISOString(),
        round: round,
        requestId: requestId
      });
    }

    /* 顯示「模式 n：今日 n / m 字」（任務 7）。
       限時模式（手速賽）不顯示（其排行榜為純秒數天梯）。 */
    function renderMasteryProgress() {
      const pill = document.getElementById('summary-mastery-pill');
      const stat = document.getElementById('summary-mastery-stat');
      if (!pill || !stat) return;
      const mode = MODE_REGISTRY.find(currentGameMode);
      if (!mode || MODE_REGISTRY.mechOf(currentGameMode) === 'timed' || !mode.pool) {
        pill.style.display = 'none';
        return;
      }
      const pool = DATA[mode.pool] || [];
      const { today, map } = getTodayMastery();
      const prefix = MODE_REGISTRY.prefixFor(currentGameMode, '');
      const p = MasteryCore.progress(map, today, pool, prefix);
      stat.textContent = `${mode.short}：今日 ${p.scored} / ${p.total} 字`;
      pill.style.display = 'flex';
    }

    /* 手速賽結算卡：顯示本場預估得分（任務 12）。
       今天在該週次已得分的字不再計分，此時顯示「這模式得分已到上限」。 */
    function renderSpeedEarned(totalEarned, round) {
      const pill = document.getElementById('speed-score-pill');
      const value = document.getElementById('speed-stat-earned');
      const desc = document.getElementById('speed-stat-earned-desc');
      if (!pill || !value) return;
      if (typeof totalEarned === 'number') lastSpeedEarned = totalEarned;
      const list = Array.isArray(round) ? round : [];
      const scored = list.filter(r => r.earned > 0).length;
      const ignored = list.length - scored;
      value.textContent = '+' + lastSpeedEarned + ' 分';
      if (desc) {
        if (scored === 0 && ignored > 0) {
          desc.textContent = '今天這些字都已計分 ' + MasteryCore.MAX_PER_DAY + ' 次（上限）';
        } else if (ignored > 0) {
          desc.textContent = scored + ' 字計分　·　' + ignored + ' 字今天已達上限';
        } else {
          desc.textContent = '每字每日最多計分 ' + MasteryCore.MAX_PER_DAY + ' 次（第 2、3 次遞減）';
        }
      }
      pill.style.display = 'block';
    }

    // Leaderboard Modal
    // currentLeaderboardFilter already declared at top
    function openLeaderboardModal(defaultType) {
      if (defaultType === 'speed') {
        switchLeaderboardType('speed');
      } else {
        switchLeaderboardType('score');
      }
      openModal('modal-leaderboard');
      if (typeof fetchCloudLeaderboard === 'function') {
        fetchCloudLeaderboard(true);
      }
    }

    function filterLeaderboard(cls) {
      currentLeaderboardFilter = cls;
      document.querySelectorAll('.lb-filter-btn').forEach(b => {
        const isAll = (cls === 'ALL' && b.textContent.includes('全級總榜'));
        const isClass = (cls !== 'ALL' && b.textContent.includes(cls));
        b.classList.toggle('active', isAll || isClass);
      });
      renderLeaderboardTable();
    }

    
    // =========================================================================
    // 🌐 全級跨電腦即時天梯連動引擎 (Cloud Real-Time Sync)
    // =========================================================================
    let isFetchingCloudLeaderboard = false;
    /* 🔐 真鎖安全網的判斷依據（2026-10-14 使用者定案「真鎖＋安全網」）：
       只有「雲端榜單真的帶著各站分項分數」成功回來過，本機分數才算權威，
       未達門檻的關卡才會真的擋住（hardLocked）。離線、抓取失敗、舊後端不帶分項、
       或還沒登入 ⇒ 一律退回軟鎖，絕不把學生卡死。 */
    let cloudScoresKnown = false;
    let lastCloudSyncTime = null;

    function updateSyncStatus(msg, isError = false) {
      try {
        const text = document.getElementById('lb-cloud-status');
        if (text) {
          text.textContent = msg;
          text.style.background = isError ? '#FEF2F2' : '#F0FDF4';
          text.style.color = isError ? '#DC2626' : '#15803D';
          text.style.borderColor = isError ? '#F87171' : '#86EFAC';
        }
      } catch(e) {}
    }

    async function fetchCloudLeaderboard(silent = false) {
      if (isFetchingCloudLeaderboard) return;
      const url = getGasWebhookUrl();
      if (!url) {
        updateSyncStatus('🟡 離線單機模式', false);
        if (!silent) {
          showPassToast('🟡 本機離線模式：全級榮譽榜已就緒');
        }
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        isFetchingCloudLeaderboard = true;
        if (!silent) updateSyncStatus('⏳ 正在同步 Google 雲端試算表最新題庫與榮譽榜...');

        // 🛡️ 方案 A 錯峰防護：隨機等待 0~300ms (打散電腦室全班併發請求)
        await new Promise(r => setTimeout(r, Math.random() * 300));

        // 🚀 方案 A：向 GAS 請求完整動態題庫與天梯戰況 (支援 CacheService 記憶體秒級回傳)
        const queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_data&t=' + Date.now();
        const res = await fetch(queryUrl, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error('伺服器 HTTP 狀態碼: ' + res.status);

        const data = await res.json();
        if (data && data.status === 'success') {
          // 1. 動態更新名冊與天梯榜單 (雙向欄位正規化，確保相容離線與雲端)
          if (Array.isArray(data.combatLeaderboard) && data.combatLeaderboard.length > 0) {
            // 🔓 這份榜單同時帶著每人的「分項分數」⇒ 覆蓋前先拍一張解鎖快照，
            //    同步完比對；跨過門檻就放一次開啓儀式（與本機結算同一套）。
            const prevScores = currentModeScores();
            // 🔐 真鎖安全網：榜單必須「真的帶著分項分數」才把權威旗標打開——
            //    舊後端或精簡 payload 不帶分項時，寧可維持軟鎖，也不冒卡死學生的風險。
            if (data.combatLeaderboard.some(it => it && it.modeScores && typeof it.modeScores === 'object')) {
              cloudScoresKnown = true;
            }
            DATA.benchmark_leaderboard = data.combatLeaderboard.map(item => {
              const pts = (typeof item.grandTotal === 'number') ? item.grandTotal : 
                          ((typeof item.score === 'number') ? item.score : (parseInt(item.totalScore, 10) || 0));
              const badge = item.badge || item.title || '🥉【新手訓練家】';
              const time = item.lastTime || item.date || '';
              return {
                ...item,
                score: pts,
                grandTotal: pts,
                total: pts,
                title: badge,
                badge: badge,
                kills: (typeof item.kills === 'number') ? item.kills : 0,
                date: time,
                lastTime: time
              };
            });
            // 雲端即時 Top 40 資料同步正規化
            DATA.top40 = DATA.benchmark_leaderboard.slice(0, 40);

            // 🔄 若當前已有學生登入，立即刷新其個人檔案與技能境界
            if (currentStudent) {
              loadStudentProfile();
              // 雲端分項同步可能讓關卡跨過門檻 ⇒ 比對並放開啓儀式。
              refreshUnlockUI(prevScores);
            }
          }
          if (data.speedLeaderboard || data.speedByWeek) {
            DATA.cloud_speed_records = data.speedLeaderboard || data.speedByWeek;
          }
          if (Array.isArray(data.top40)) {
            DATA.top40 = data.top40;
            renderTop40();
            renderClassBarCharts();
          }
          if (data.class_top10) {
            DATA.class_top10 = data.class_top10;
            renderClassCards();
          }
          if (data.perfect_students) {
            DATA.perfect_students = data.perfect_students;
            renderPerfectScorers();
          }
          renderClassBarCharts();

          // 模式二字庫只由獨立帳號 B 接口載入。其他模式維持原有同步。
          if (Array.isArray(data.cangjieWords) && data.cangjieWords.length > 0) {
            DATA.cangjie_words = data.cangjieWords;
          }
          if (Array.isArray(data.connectedWords) && data.connectedWords.length > 0) {
            DATA.connected_words = data.connectedWords;
          }
          if (Array.isArray(data.splitWords) && data.splitWords.length > 0) {
            DATA.split_words = data.splitWords;
          }
          if (Array.isArray(data.specialWords) && data.specialWords.length > 0) {
            DATA.special_words = data.specialWords;
          }

          // 3. 刷新頁面天梯排行榜渲染
          renderLeaderboardTable();
          renderSpeedLeaderboardTable();

          // 4. 更新頂部數據統計條
          {
            const scoreRows = Array.isArray(data.combatLeaderboard) ? data.combatLeaderboard : [];
            const validScores = scoreRows.map(s => Number(s.grandTotal ?? s.total ?? s.score ?? 0)).filter(Number.isFinite);
            const speedRows = (data.speedByWeek && Array.isArray(data.speedByWeek.overall)) ? data.speedByWeek.overall : [];
            const fastest = speedRows.filter(s => Number(s.bestTime) > 0).sort((a, b) => Number(a.bestTime) - Number(b.bestTime))[0];
            const perfectSource = data.perfect_students || DATA.perfect_students || {};
            const perfectGroups = typeof perfectSource === 'object' ? Object.values(perfectSource) : [];
            data.stats = {
              perfectCount: perfectGroups.reduce((sum, group) => sum + (Array.isArray(group) ? group.length : 0), 0),
              avgScore: validScores.length ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length) : 0,
              speedKing: fastest ? `${formatStudentDisplayName(fastest)} · ${Number(fastest.bestTime).toFixed(2)}秒` : '暫未有手速紀錄',
              ...(data.stats || {})
            };
          }
          if (data.stats) {
            const pCountEl = document.querySelector('.stat-pill:nth-child(1)');
            if (pCountEl && data.stats.perfectCount !== undefined) {
              pCountEl.innerHTML = `🎉 滿分訓練家：<strong>${data.stats.perfectCount} 位同學獲得 400 分！</strong>`;
            }
            const avgEl = document.querySelector('.stat-pill:nth-child(2)');
            if (avgEl && data.stats.avgScore !== undefined) {
              avgEl.innerHTML = `⭐ 全級平均分：<strong>${data.stats.avgScore} 分</strong>`;
            }
            const speedKingEl = document.querySelector('.stat-pill:nth-child(3)');
            if (speedKingEl && data.stats.speedKing) {
              speedKingEl.innerHTML = `⚡ 速度神捕：<strong>${data.stats.speedKing}</strong>`;
            }
          }

          lastCloudSyncTime = new Date();
          const timeStr = lastCloudSyncTime.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          updateSyncStatus(`✅ 雲端已同步 (${timeStr})`, false);
          if (!silent) showPassToast('⚡ 雲端試算表最新題庫與榮譽榜已即時同步！');
        } else {
          throw new Error((data && data.message) ? data.message : '後端回傳格式非 success');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('雲端載入提醒 (自動維持本機安全離線模式):', err);
        const errMsg = (err.name === 'AbortError') ? '連線超時(>6s)' : (err.message || '權限或跨域阻擋');
        updateSyncStatus(`🔴 同步失敗: ${errMsg}`, true);
        if (!silent) showPassToast(`⚠️ 雲端連線失敗: ${errMsg} (請點擊狀態標籤查看詳情)`);
      } finally {
        isFetchingCloudLeaderboard = false;
      }
    }

    // 🛡️ 格式化勳章稱號 (防範數字代碼或異常格式，保證 100% 呈現標準圖文勳章)
    function getFormattedBadgeTitle(item) {
      if (!item) return '🥉【新手訓練家】';
      let titleStr = item.badge || item.title;
      // 若為純數字 (例如被誤寫為 5) 或缺少【】括號，依分數動態重新評定
      if (!titleStr || !isNaN(titleStr) || titleStr === '5' || !String(titleStr).includes('【')) {
        const score = (typeof item.score === 'number') ? item.score : (parseInt(item.grandTotal, 10) || 0);
        if (typeof evalTierAndSkills === 'function') {
          const { currentTier } = evalTierAndSkills(score);
          return `${currentTier.badge}【${currentTier.title}】`;
        }
        return '🥉【新手訓練家】';
      }
      return String(titleStr);
    }

    function renderLeaderboardTable() {
      if (currentLeaderboardType === 'speed') {
        renderSpeedLeaderboardTable();
        return;
      }

      // 恢復討伐累積總分榜表頭 (7欄)
      const thead = document.querySelector('#modal-leaderboard thead tr');
      if (thead) {
        thead.innerHTML = `
          <th>排名</th>
          <th>班別</th>
          <th>學號</th>
          <th>訓練家代號</th>
          <th>勳章稱號</th>
          <th>討伐總分</th>
          <th>擊倒魔王</th>
        `;
      }

      const scoreLabel = document.getElementById('lb-my-score-label');
      const rankLabel = document.getElementById('lb-my-rank-label');
      if (scoreLabel) scoreLabel.textContent = '累計討伐總分';
      if (rankLabel) rankLabel.textContent = (currentLeaderboardFilter === 'ALL') ? '全級討伐排名' : '班內討伐排名';

      // 1. 雙軌智能合併：整合 Google 試算表最新真實數據與本地 localStorage
      const allMap = {};

      if (DATA.benchmark_leaderboard && Array.isArray(DATA.benchmark_leaderboard)) {
        DATA.benchmark_leaderboard.forEach(item => {
          const rawScore = (typeof item.grandTotal === 'number') ? item.grandTotal : 
                           ((typeof item.score === 'number') ? item.score : (parseInt(item.totalScore, 10) || 0));
          const rawTitle = item.badge || item.title || '🥉【新手訓練家】';
          const rawKills = (typeof item.kills === 'number') ? item.kills : 0;
          allMap[`${item.cls}_${item.num}`] = {
            cls: item.cls,
            num: item.num,
            name: `${item.cls} ${(item.num < 10 ? '0' : '') + item.num}號`,
            score: rawScore,
            grandTotal: rawScore,
            kills: rawKills,
            title: rawTitle,
            badge: rawTitle
          };
        });
      }

      const allKeys = SafeStorage.getAllKeys ? SafeStorage.getAllKeys() : [];
      allKeys.forEach(key => {
        if (key.startsWith('p5_score_')) {
          const parts = key.replace('p5_score_', '').split('_');
          const cls = parts[0];
          const num = parseInt(parts[1], 10);
          try {
            const parsed = JSON.parse(SafeStorage.getItem(key));
            if (parsed && typeof parsed.totalScore === 'number' && parsed.totalScore > 0) {
              const mapKey = `${cls}_${num}`;
              const cur = allMap[mapKey];
              const localScore = parsed.totalScore;
              const localKills = parsed.kills || 0;
              const { currentTier } = evalTierAndSkills(localScore);
              if (!cur || localScore > cur.score) {
                allMap[mapKey] = {
                  cls, num,
                  name: `${cls} ${(num < 10 ? '0' : '') + num}號`,
                  score: localScore,
                  kills: Math.max(localKills, cur ? cur.kills : 0),
                  title: `${currentTier.badge}【${currentTier.title}】`, badge: `${currentTier.badge}【${currentTier.title}】`
                };
              }
            }
          } catch(e) {}
        }
      });

      const fullList = Object.values(allMap);
      fullList.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.kills !== a.kills) return b.kills - a.kills;
        if (a.cls !== b.cls) return a.cls.localeCompare(b.cls);
        return a.num - b.num;
      });
      fullList.forEach((item, idx) => {
        item.overallRank = idx + 1;
      });

      const classGroups = {};
      ['P5A', 'P5B', 'P5C', 'P5D', 'P5E', 'P5F'].forEach(c => {
        classGroups[c] = fullList.filter(s => s.cls === c);
        classGroups[c].forEach((item, idx) => {
          item.classRank = idx + 1;
        });
      });

      if (currentStudent) {
        const myKey = `${currentStudent.cls}_${currentStudent.num}`;
        const myEntry = allMap[myKey] || {
          cls: currentStudent.cls,
          num: currentStudent.num,
          name: `${currentStudent.cls} ${(currentStudent.num < 10 ? '0' : '') + currentStudent.num}號`,
          score: 0,
          kills: 0,
          overallRank: fullList.length,
          classRank: (classGroups[currentStudent.cls] || []).length
        };
        const { currentTier } = evalTierAndSkills(myEntry.score);

        document.getElementById('lb-my-name').textContent = myEntry.name;
        document.getElementById('lb-my-title').textContent = `當前境界：${currentTier.title}`;
        document.getElementById('lb-my-score').textContent = `${myEntry.score.toLocaleString()} 分`;
        document.getElementById('lb-my-badge').textContent = currentTier.badge;

        if (currentLeaderboardFilter === 'ALL') {
          document.getElementById('lb-my-rank').innerHTML = `<span style="color:#B45309; font-weight:900;">全級第 ${myEntry.overallRank} 名</span> <span style="font-size:12px;color:#64748B;">(全級共 ${fullList.length} 人)</span>`;
        } else {
          if (currentStudent.cls === currentLeaderboardFilter) {
            document.getElementById('lb-my-rank').innerHTML = `<span style="color:#2563EB; font-weight:900;">${currentLeaderboardFilter} 班內第 ${myEntry.classRank} 名</span> <span style="font-size:12px;color:#64748B;">(全級第 ${myEntry.overallRank} 名)</span>`;
          } else {
            document.getElementById('lb-my-rank').innerHTML = `<span style="color:#64748B;">原班 (${currentStudent.cls}) 第 ${myEntry.classRank} 名</span> <span style="font-size:11px;color:#94A3B8;">(正在瀏覽 ${currentLeaderboardFilter})</span>`;
          }
        }
      }

      const tbody = document.getElementById('leaderboard-tbody');
      const isClassFilter = currentLeaderboardFilter !== 'ALL';
      const limit = isClassFilter ? 15 : 20;
      const sourceList = isClassFilter ? (classGroups[currentLeaderboardFilter] || []) : fullList;
      const scoredList = sourceList.filter(s => s.score > 0);
      const displayList = scoredList.slice(0, limit);

      let myInDisplay = false;
      if (currentStudent) {
        if (!isClassFilter || currentStudent.cls === currentLeaderboardFilter) {
          myInDisplay = displayList.some(s => s.cls === currentStudent.cls && s.num === currentStudent.num);
        }
      }

      let rowsHtml = displayList.map(s => {
        const rankNum = isClassFilter ? s.classRank : s.overallRank;
        const medal = rankNum === 1 ? '🥇 1' : rankNum === 2 ? '🥈 2' : rankNum === 3 ? '🥉 3' : `${rankNum}`;
        const isMe = currentStudent && s.cls === currentStudent.cls && s.num === currentStudent.num;
        return `
          <tr style="${isMe ? 'background: #FEF3C7; font-weight: bold; border-left: 4px solid #D97706;' : ''}">
            <td style="padding: 7px; text-align: center; font-weight: 800; color: #1E3A8A;">${medal}</td>
            <td style="padding: 7px; text-align: center;">${s.cls}</td>
            <td style="padding: 7px; text-align: center;">${(s.num < 10 ? '0' : '') + s.num}號</td>
            <td style="padding: 7px; text-align: center; font-weight: 800;">${s.name} ${isMe ? '⭐(我)' : ''}</td>
            <td style="padding: 7px; text-align: center; font-size: 11px;">${getFormattedBadgeTitle(s)}</td>
            <td style="padding: 7px; text-align: center; font-weight: 900; color: #D97706;">${s.score.toLocaleString()}</td>
            <td style="padding: 7px; text-align: center;">${s.kills} 隻</td>
          </tr>
        `;
      }).join('');

      if (displayList.length === 0) {
        rowsHtml = `
          <tr>
            <td colspan="7" style="padding: 24px; text-align: center; color: #64748B; font-weight: 800; font-size: 13.5px;">
              🎮 該班尚無同學完成討伐破關，快登入挑戰成為第一位班級先鋒！
            </td>
          </tr>
        `;
      }

      if (currentStudent && !myInDisplay) {
        const myKey = `${currentStudent.cls}_${currentStudent.num}`;
        const myEntry = allMap[myKey];
        if (myEntry && myEntry.score > 0 && (!isClassFilter || currentStudent.cls === currentLeaderboardFilter)) {
          const myRank = isClassFilter ? myEntry.classRank : myEntry.overallRank;
          const cutoffRank = isClassFilter ? 15 : 20;
          const targetStudent = sourceList[cutoffRank - 1];
          const gap = targetStudent ? Math.max(0, targetStudent.score - myEntry.score + 10) : 0;
          rowsHtml += `
            <tr style="background: #FFFBEB; border-top: 2px dashed #D97706; font-weight: bold;">
              <td style="padding: 9px; text-align: center; font-weight: 900; color: #B45309;">第 ${myRank} 名</td>
              <td style="padding: 9px; text-align: center;">${myEntry.cls}</td>
              <td style="padding: 9px; text-align: center;">${(myEntry.num < 10 ? '0' : '') + myEntry.num}號</td>
              <td style="padding: 9px; text-align: center; color: #B45309; font-weight: 900;">
                ${myEntry.name} ⭐ (我的目前排名)
                <div style="font-size: 11px; font-weight: 600; color: #D97706; margin-top: 2px;">
                  ⚡ 距離進榜 (第${cutoffRank}名) 還差 ${gap.toLocaleString()} 分，立即開戰追趕！
                </div>
              </td>
              <td style="padding: 9px; text-align: center; font-size: 11px;">${myEntry.title}</td>
              <td style="padding: 9px; text-align: center; font-weight: 900; color: #D97706;">${myEntry.score.toLocaleString()}</td>
              <td style="padding: 9px; text-align: center;">${myEntry.kills} 隻</td>
            </tr>
          `;
        }
      }

      tbody.innerHTML = rowsHtml;
    }

    // Skills Hall Modal
    function openSkillsModal() {
      renderSkillsHall();
      openModal('modal-skills');
    }

    function renderSkillsHall() {
      let score = 0;
      let studentName = '未登入訓練家';
      if (currentStudent) {
        const stats = getStudentStats(currentStudent.cls, currentStudent.num);
        score = stats.totalScore || 0;
        studentName = currentStudent.name;
      } else {
        const lastLogin = SafeStorage.getItem('p5_last_login');
        if (lastLogin) {
          try {
            const st = JSON.parse(lastLogin);
            if (isValidStudentIdentity(st)) {
              const stats = getStudentStats(st.cls, st.num);
              score = stats.totalScore || 0;
              studentName = st.name;
            }
          } catch(e) {}
        }
      }

      const { currentTier, nextTier, unlockedSkills } = evalTierAndSkills(score);

      // 1. 動態更新頂部當前境界標題與勳章
      const titleEl = document.getElementById('hall-current-title');
      if (titleEl) {
        titleEl.innerHTML = `當前境界：<span style="color: ${currentTier.color}; font-size: 16px; font-weight: 900;">${currentTier.badge}【${currentTier.title}】</span>`;
      }

      // 2. 動態計算晉升下一階進度與文字說明
      let pct = 100;
      const ptsEl = document.getElementById('hall-current-pts');
      const fillEl = document.getElementById('hall-progress-fill');
      if (nextTier) {
        const span = nextTier.min - currentTier.min;
        const currentProgress = score - currentTier.min;
        pct = Math.min(100, Math.max(0, Math.round((currentProgress / Math.max(1, span)) * 100)));
        const needPts = nextTier.min - score;
        if (ptsEl) {
          ptsEl.innerHTML = `累積積分：<strong>${score.toLocaleString()}</strong> / 晉升【${nextTier.title}】需 ${nextTier.min.toLocaleString()} 分 (<span style="color: #2563EB; font-weight: 800;">還差 ${needPts.toLocaleString()} 分 · ${pct}%</span>)`;
        }
      } else {
        if (ptsEl) {
          ptsEl.innerHTML = `累積積分：<strong>${score.toLocaleString()}</strong> 分 (🏆 已榮登最高創世神皇殿堂！)`;
        }
      }
      if (fillEl) {
        fillEl.style.width = `${pct}%`;
      }

      // 3. 渲染 8 大境界卡片 (動態標註已達成、當前段位與未解鎖)
      const tiersContainer = document.getElementById('tiers-grid-container');
      if (tiersContainer) {
        tiersContainer.innerHTML = TIERS.map(t => {
          const isReached = score >= t.min;
          const isCurrent = (t.title === currentTier.title);
          let borderStyle = isCurrent 
            ? `border: 2.5px solid ${t.color}; box-shadow: 0 0 14px ${t.color}55; transform: scale(1.03);` 
            : (isReached ? `border: 2px solid ${t.color}80;` : `border: 2px solid #E2E8F0; opacity: 0.55;`);
          let bgStyle = isReached ? t.bg : '#F8FAFC';
          let statusBadge = isCurrent 
            ? `<span style="font-size:10px; font-weight:900; background:${t.color}; color:#fff; padding:2px 8px; border-radius:10px; display:inline-block; margin-top:4px;">🌟 當前段位</span>`
            : (isReached 
                ? `<span style="font-size:10px; font-weight:800; color:#16A34A; background:#DCFCE7; padding:1px 6px; border-radius:6px; display:inline-block; margin-top:4px;">✓ 已達成</span>`
                : `<span style="font-size:10px; font-weight:700; color:#94A3B8; display:inline-block; margin-top:4px;">🔒 差 ${(t.min - score).toLocaleString()} 分</span>`);
          
          return `
            <div class="tier-card ${isReached ? 'unlocked' : 'locked'}" style="${borderStyle} background: ${bgStyle};">
              <div class="tier-card-badge">${isReached ? t.badge : '🔒'}</div>
              <div class="tier-card-title" style="color: ${isReached ? t.color : '#64748B'}; font-weight: 900; font-size: 14px;">${t.title}</div>
              <div class="tier-card-score" style="color: ${isReached ? '#B45309' : '#94A3B8'}; font-size: 11px;">${t.min.toLocaleString()} 分解鎖</div>
              ${statusBadge}
            </div>
          `;
        }).join('');
      }

      // 4. 渲染 5 大技能殿堂 (動態高亮已解鎖技能)
      const skillsContainer = document.getElementById('skills-grid-container');
      if (skillsContainer) {
        const closeBtnHtml = `
          <div style="margin-top: 24px; text-align: center; grid-column: 1 / -1;">
            <button class="btn-primary-action" onclick="closeModal('modal-skills')" style="padding: 10px 36px; font-size: 15px; font-weight: 900; background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%); border-radius: 30px; box-shadow: 0 4px 14px rgba(37,99,235,0.35); cursor: pointer;">
              關閉技能館
            </button>
          </div>
        `;
        const cardsHtml = SKILLS.map(s => {
          const isUnlocked = score >= s.reqPts;
          return `
            <div class="skill-card ${isUnlocked ? 'unlocked' : 'locked'}">
              <div class="skill-name-row">
                <span class="skill-name">${isUnlocked ? ('⚡ ' + s.name) : ('🔒 ' + s.name)}</span>
                <span class="skill-rate">${isUnlocked ? `發動率 ${Math.round(s.rate * 100)}%` : `需 ${s.reqPts.toLocaleString()} 分`}</span>
              </div>
              <div class="skill-desc">${s.desc}</div>
              <div style="font-size: 10px; color: ${isUnlocked ? '#16A34A' : '#94A3B8'}; margin-top: 4px; font-weight: 700;">
                ${isUnlocked ? '✅ 戰鬥已實裝發動' : `🔒 還差 ${(s.reqPts - score).toLocaleString()} 分自動解鎖`}
              </div>
            </div>
          `;
        }).join('');
        skillsContainer.innerHTML = cardsHtml + closeBtnHtml;
      }
    }

    function openModal(id) { document.getElementById(id).style.display = 'flex'; }
    function closeModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

    // 快捷鍵：按下 Escape 鍵隨時關閉所有彈窗
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeModal('modal-skills');
        closeModal('modal-leaderboard');
        const confirmModal = document.getElementById('modal-confirm');
        if (confirmModal) confirmModal.style.display = 'none';
      }
    });


    // Window Load Initialization
    function initAllViews() {
      // 🔓 先解析 ?teacher 參數再畫分頁（教師全開要第一時間生效）。
      try { initTeacherUnlock(); } catch(e) { console.error('initTeacherUnlock error:', e); }
      try { renderModeTabs(); } catch(e) { console.error('renderModeTabs error:', e); }
      try { renderTop40(); } catch(e) { console.error('renderTop40 error:', e); }
      try { renderClassBarCharts(); } catch(e) { console.error('renderClassBarCharts error:', e); }
      try { renderClassCards(); } catch(e) { console.error('renderClassCards error:', e); }
      try { renderPerfectScorers(); } catch(e) { console.error('renderPerfectScorers error:', e); }
      try { renderVocabTable(); } catch(e) { console.error('renderVocabTable error:', e); }
      try { renderSkillsHall(); } catch(e) { console.error('renderSkillsHall error:', e); }
      try { initSpeedWeekDropdown(); } catch(e) { console.error('initSpeedWeekDropdown error:', e); }

      const lastLogin = SafeStorage.getItem('p5_last_login');
      if (lastLogin) {
        try {
          const savedStudent = JSON.parse(lastLogin);
          if (!isValidStudentIdentity(savedStudent)) {
            SafeStorage.removeItem('p5_last_login');
            return;
          }
          currentStudent = savedStudent;
          const idSec = document.getElementById('identity-section');
          if (idSec) idSec.style.display = 'none';
          const batSec = document.getElementById('battle-section');
          if (batSec) batSec.style.display = 'block';
          loadStudentProfile();
        } catch(e) {}
      }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      try { initAllViews(); } catch(e) {}
    } else {
      window.addEventListener('DOMContentLoaded', initAllViews);
    }
  
    // =========================================================================
    // ⚡ 倉頡 10 字極速鍵盤手速賽核心引擎 (完全忽略作業系統輸入法)
    // =========================================================================

    // 每周固定 10 個核心字庫 (每周更換，開局全隨機洗牌)
    ;

    
    // =========================================================================
    // 🔤 倉頡字碼來源單一化：由字根陣列自動動態生成按鍵字母串 (防止人為轉寫錯漏)
    // =========================================================================
    

    

    function escapeMode2Text(value) {
      return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    }

    function getActiveSpeedWeek() {
      const banks = window.MODE2_WEEKLY_BANKS || {};
      const schedules = window.SPEED_WEEK_SCHEDULES || [];
      try {
        const q = new URLSearchParams(window.location.search).get('week');
        if (q && Object.values(banks).some(b => b.week === q.toLowerCase())) return q.toLowerCase();
      } catch(e) {}
      const now = new Date();
      const active = schedules.find(s => now >= s.start && now <= s.end);
      if (active) return active.week;
      return schedules.length ? schedules[schedules.length - 1].week : '';
    }

    function initSpeedWeekDropdown() {
      const banks = window.MODE2_WEEKLY_BANKS || {};
      const activeWk = getActiveSpeedWeek();
      const select = document.getElementById('speed-ready-week-select');
      const lbSelect = document.getElementById('speed-lb-week-select');
      const previous = select ? select.value : '';
      const weekOrder = [...new Set(Object.values(banks).map(b => b.week))].sort((a,b) => Number(b.slice(1))-Number(a.slice(1)));
      function populate(target, leaderboard) {
        if (!target) return;
        target.replaceChildren();
        if (leaderboard) { const all = document.createElement('option'); all.value = 'ALL'; all.textContent = '全部周次最佳紀錄'; target.appendChild(all); }
        weekOrder.forEach(wk => {
          const group = document.createElement('optgroup');
          group.label = (wk === activeWk ? '目前周次・' : '歷史周次・') + (banks[wk+'_hw1'].weekName || wk);
          [1,2,3,4].forEach(i => { const key = wk+'_hw'+i; const option = document.createElement('option'); option.value = key; option.textContent = banks[key].title; group.appendChild(option); });
          target.appendChild(group);
        });
        if (!weekOrder.length && !leaderboard) { const empty = document.createElement('option'); empty.value = ''; empty.textContent = '字庫尚未發布'; target.appendChild(empty); }
        target.disabled = !weekOrder.length && !leaderboard;
      }
      populate(select, false); populate(lbSelect, true);
      currentSpeedWeek = banks[previous] ? previous : (banks[activeWk+'_hw1'] ? activeWk+'_hw1' : '');
      if (select) select.value = currentSpeedWeek;
      if (speedLeaderboardWeek !== 'ALL' && !banks[speedLeaderboardWeek]) speedLeaderboardWeek = currentSpeedWeek || 'ALL';
      if (lbSelect) lbSelect.value = speedLeaderboardWeek;
      updateSpeedLeaderboardButtons(activeWk);
    }

    window.isMode2Running = function () { return speedActive; };

    function updateSpeedLeaderboardButtons(activeWk) {
      const container = document.getElementById('speed-lb-week-buttons');
      if (!container) return;
      container.innerHTML = '';

      const allBanks = (typeof MODE2_WEEKLY_BANKS === 'object' && MODE2_WEEKLY_BANKS) ? MODE2_WEEKLY_BANKS : {};
      let hwKeys = [1, 2, 3, 4].map(idx => `${activeWk}_hw${idx}`);
      // 若當前週次無題庫，展示所有可用題庫按鈕
      if (!hwKeys.some(k => allBanks[k])) {
        hwKeys = Object.keys(allBanks);
      }

      if (speedLeaderboardWeek !== 'ALL' && !allBanks[speedLeaderboardWeek]) {
        speedLeaderboardWeek = hwKeys[0] || 'ALL';
      }

      // 優先加入「全部周次」按鈕以瀏覽全級生涯手速紀錄
      const allBtn = document.createElement('button');
      allBtn.className = 'lb-sub-pill' + (speedLeaderboardWeek === 'ALL' ? ' active' : '');
      allBtn.id = 'lb-week-ALL';
      allBtn.textContent = '🏆 全部周次 (生涯最佳)';
      allBtn.onclick = () => filterSpeedLeaderboardWeek('ALL');
      container.appendChild(allBtn);

      hwKeys.forEach(k => {
        const bank = allBanks[k];
        const btn = document.createElement('button');
        btn.className = 'lb-sub-pill' + (k === speedLeaderboardWeek ? ' active' : '');
        btn.id = `lb-week-${k}`;
        btn.textContent = bank ? bank.title : k;
        btn.onclick = () => filterSpeedLeaderboardWeek(k);
        container.appendChild(btn);
      });
    }

    
    // =========================================================================
    // 🖼️ 圖片載入容錯降級處理 (Image Fallback Handlers)
    // =========================================================================
    function handlePodiumImgError(el, icon) {
      el.outerHTML = `<div class="podium-pokemon-icon">${icon}</div>`;
    }
    function handleRankImgError(el, icon) {
      el.outerHTML = icon || '⚡';
    }

    // =========================================================================
    // ⚡ 手速賽等效競賽耗時演算法與控制輔助函式
    // =========================================================================
    function calculateEffectiveSpeedTime(rawTime, mistakes, accuracy, wordCount) {
      const keyPenalty = mistakes * 0.3;
      const baseFactor = (wordCount === 20) ? 30.0 : 15.0;
      const accRatio = Math.max(0, Math.min(100, accuracy)) / 100;
      const accPenalty = Math.round(baseFactor * (1 - Math.pow(accRatio, 2)) * 100) / 100;
      const bonus = (accuracy >= 100) ? ((wordCount === 20) ? 2.0 : 1.0) : 0.0;
      const effectiveTime = parseFloat((rawTime + keyPenalty + accPenalty - bonus).toFixed(2));
      return {
        keyPenalty: parseFloat(keyPenalty.toFixed(2)),
        accPenalty: parseFloat(accPenalty.toFixed(2)),
        bonus: parseFloat(bonus.toFixed(2)),
        effectiveTime: Math.max(1.0, effectiveTime)
      };
    }

    function onSpeedSettingChange() {
      const wcSelect = document.getElementById('speed-word-count-select');
      const wkSelect = document.getElementById('speed-ready-week-select');
      if (wcSelect) currentSpeedWordCount = parseInt(wcSelect.value, 10) || 10;
      if (wkSelect) currentSpeedWeek = wkSelect.value || '';
    }

    function toggleSpeedPracticeMode() {
      isSpeedPracticeMode = !isSpeedPracticeMode;
      const btn = document.getElementById('speed-mode-toggle-btn');
      if (btn) {
        if (isSpeedPracticeMode) {
          btn.innerHTML = '💡 練習模式 (全程字根可見)';
          btn.style.color = '#34D399';
          btn.style.borderColor = '#10B981';
          btn.style.background = '#0F172A';
        } else {
          btn.innerHTML = '⚔️ 競技排位賽 (停頓3秒提燈)';
          btn.style.color = '#FDE047';
          btn.style.borderColor = '#FACC15';
          btn.style.background = '#0F172A';
        }
      }
      if (typeof speedActive !== 'undefined' && speedActive) {
        renderSpeedTargetWord();
      }
    }

    function returnToSpeedReadyStage() {
      if (window.P5WordBank) window.P5WordBank.applyPending();
      const mainStage = document.getElementById('speed-main-stage');
      const finishBox = document.getElementById('speed-finish-box');
      const readyStage = document.getElementById('speed-ready-stage');
      if (mainStage) mainStage.style.display = 'none';
      if (finishBox) finishBox.style.display = 'none';
      if (readyStage) readyStage.style.display = 'block';
    }

    // 🚀 核心入口：按下開始按鈕才真正啟動比賽與碼表計時
    function launchSpeedMatch() {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }

      onSpeedSettingChange();

      if (speedTimerInterval) clearInterval(speedTimerInterval);
      if (speedHintTimer) clearTimeout(speedHintTimer);

      const bank = window.MODE2_WEEKLY_BANKS[currentSpeedWeek];
      if (!bank || !Array.isArray(bank.words) || bank.words.length < currentSpeedWordCount) {
        showPassToast(bank ? '本組字數不足，請選較少題量或另一組字庫。' : '字庫尚未發布或載入，請先更新字庫。');
        return;
      }
      const rawWords = [...bank.words];
      const shuffled = fisherYatesShuffle(rawWords);
      speedWordList = shuffled.slice(0, currentSpeedWordCount);

      speedWordIdx = 0;
      speedInputCodes = [];
      speedMistakes = 0;
      speedPenaltySeconds = 0.0;
      speedTotalKeys = 0;
      speedCorrectKeys = 0;
      speedActive = true;
      speedWordReadyForSpace = false;

      // 切換舞台：隱藏備戰大廳與結算卡，展示輸入主舞台
      document.getElementById('speed-ready-stage').style.display = 'none';
      document.getElementById('speed-finish-box').style.display = 'none';
      document.getElementById('speed-main-stage').style.display = 'block';

      // 更新頂部標籤與計時器
      document.getElementById('speed-total-count-text').textContent = speedWordList.length;
      document.getElementById('speed-timer-val').textContent = '00.00s';
      document.getElementById('speed-penalty-display').innerHTML = `⚠️ 失誤 0 次 (+0.0s 罰時)`;
      
      const badgeTag = document.getElementById('speed-active-badge-tag');
      if (badgeTag) {
        const bankObj = MODE2_WEEKLY_BANKS[currentSpeedWeek] || Object.values(MODE2_WEEKLY_BANKS)[0];
        badgeTag.textContent = `⚡ ${currentSpeedWordCount} 字賽 · ${bankObj.title}`;
      }

      const spacePrompt = document.getElementById('speed-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      renderSpeedProgressDots();
      renderSpeedTargetWord();

      // 真正啟動高精度即時碼表
      speedStartTime = performance.now();
      speedTimerInterval = setInterval(updateSpeedClock, 30);

      // 監聽鍵盤原生事件
      window.removeEventListener('keydown', handleSpeedKeydown, true);
      window.addEventListener('keydown', handleSpeedKeydown, true);
    }

    // 放棄比賽返回備戰大廳
    function abortSpeedMatchToReady() {
      if (speedTimerInterval) clearInterval(speedTimerInterval);
      if (speedHintTimer) clearTimeout(speedHintTimer);
      speedActive = false;
      speedWordReadyForSpace = false;
      window.removeEventListener('keydown', handleSpeedKeydown, true);

      initSpeedWeekDropdown();
        returnToSpeedReadyStage();
    }

    // 更新即時碼表
    function updateSpeedClock() {
      if (!speedStartTime || !speedActive) return;
      const now = performance.now();
      const elapsed = ((now - speedStartTime) / 1000) + speedPenaltySeconds;
      document.getElementById('speed-timer-val').textContent = elapsed.toFixed(2) + 's';
    }

    // 渲染進度圓點
    function renderSpeedProgressDots() {
      const container = document.getElementById('speed-progress-dots');
      if (!container) return;
      container.innerHTML = '';
      const total = speedWordList.length;
      for (let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = 'speed-dot' + (i === speedWordIdx ? ' active' : (i < speedWordIdx ? ' done' : ''));
        container.appendChild(dot);
      }
    }

    // 渲染當前目標中文字與字碼卡槽
    function renderSpeedTargetWord() {
      if (speedWordIdx >= speedWordList.length) return;
      const currentWord = speedWordList[speedWordIdx];

      speedWordReadyForSpace = false;
      const spacePrompt = document.getElementById('speed-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      document.getElementById('speed-target-char').textContent = currentWord.char;
      document.getElementById('speed-current-idx-text').textContent = speedWordIdx + 1;
      document.getElementById('speed-bottom-tip').innerHTML = `💡 規則：按錯鍵每次加計 <strong>+0.3 秒罰時</strong> · 停頓 <strong>3 秒</strong> 未按鍵自動亮起字碼提示 · <strong>打完字碼請按【空白鍵 Space】送出</strong>`;

      renderSpeedProgressDots();

      const slotsContainer = document.getElementById('speed-slots-row');
      slotsContainer.innerHTML = '';

      const neededIdx = speedInputCodes.length;

      currentWord.codes.forEach((code, idx) => {
        const slot = document.createElement('div');
        slot.id = `speed-slot-${idx}`;
        slot.className = 'speed-key-slot';

        if (idx < speedInputCodes.length) {
          slot.classList.add('filled');
          slot.innerHTML = `
            <div class="speed-slot-code" style="color: #34D399;">${speedInputCodes[idx].code}</div>
            <div class="speed-slot-sub" style="color: #A7F3D0;">${speedInputCodes[idx].key}</div>
          `;
        } else if (idx === neededIdx) {
          slot.classList.add('current');
          if (isSpeedPracticeMode) {
            slot.innerHTML = `
              <div class="speed-slot-hint-text">${code}</div>
              <div class="speed-slot-sub" style="color: #FACC15; font-weight: 900;">${currentWord.keys[idx]}</div>
            `;
          } else {
            slot.innerHTML = `
              <div class="speed-slot-code" style="color: #94A3B8;">？</div>
              <div class="speed-slot-sub">第${idx + 1}碼</div>
            `;
          }
        } else {
          slot.innerHTML = `
            <div class="speed-slot-code" style="color: #475569;">·</div>
            <div class="speed-slot-sub">第${idx + 1}碼</div>
          `;
        }
        slotsContainer.appendChild(slot);
      });

      startSpeedHintTimer();
    }

    // 3 秒未輸入自動提燈提示
    function startSpeedHintTimer() {
      if (speedHintTimer) clearTimeout(speedHintTimer);
      if (isSpeedPracticeMode || !speedActive || speedWordReadyForSpace) return;

      const currentWord = speedWordList[speedWordIdx];
      const neededIdx = speedInputCodes.length;
      if (!currentWord || neededIdx >= currentWord.codes.length) return;

      speedHintTimer = setTimeout(() => {
        const targetSlot = document.getElementById(`speed-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('hint-glow');
          targetSlot.innerHTML = `
            <div class="speed-slot-hint-text">${currentWord.codes[neededIdx]}</div>
            <div class="speed-slot-sub" style="color: #FACC15; font-weight: 900;">${currentWord.keys[neededIdx]}</div>
          `;
          document.getElementById('speed-bottom-tip').innerHTML = `💡 <span style="color:#FACC15;font-weight:900;">【提燈指引啟動】：目標字根為【${currentWord.codes[neededIdx]}】(按鍵 ${currentWord.keys[neededIdx]})！</span>`;
        }
      }, 3000);
    }

    // ⌨️ 鍵盤原生事件監聽 (徹底解決按空白鍵重開問題，完全忽略輸入法)
    function handleSpeedKeydown(e) {
      // 🗺️ 看機制不看模式 id：日後任何 timed 模式都能沿用同一組鍵盤處理。
      if (MODE_REGISTRY.mechOf(currentGameMode) !== 'timed') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // 🛑 情況 1：在備戰大廳，按下 Space 或 Enter 允許快速啟動
      const readyStage = document.getElementById('speed-ready-stage');
      if (readyStage && readyStage.style.display !== 'none') {
        if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          launchSpeedMatch();
        }
        return;
      }

      if (!speedActive) return;

      // 🛑 情況 2：比賽進行中按下了空白鍵 (Space) —— 全局嚴格攔截，絕不允許觸發瀏覽器預設按鈕點擊！
      if (e.key === ' ' || e.code === 'Space' || e.keyCode === 32) {
        e.preventDefault();
        e.stopPropagation();

        if (speedWordReadyForSpace) {
          // 正確狀態：字碼已完成，按下空白鍵確認送出並進入下一題
          confirmSpeedWordSpace();
        } else {
          // 學生在尚未敲完全部字碼時誤按空白鍵 —— 溫和提醒，絕不重開題目！
          const stage = document.getElementById('speed-main-stage');
          triggerFloatingNotice(stage, '請先敲完字碼再按空白鍵！⚠️');
          const currentWord = speedWordList[speedWordIdx];
          if (currentWord) {
            const neededIdx = speedInputCodes.length;
            const targetSlot = document.getElementById(`speed-slot-${neededIdx}`);
            if (targetSlot) {
              targetSlot.classList.add('shake-error');
              setTimeout(() => targetSlot.classList.remove('shake-error'), 400);
            }
          }
        }
        return;
      }

      // 情況 3：支援 Backspace 退回上一碼
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (speedWordReadyForSpace) {
          speedWordReadyForSpace = false;
          speedInputCodes.pop();
          renderSpeedTargetWord();
        } else if (speedInputCodes.length > 0) {
          speedInputCodes.pop();
          renderSpeedTargetWord();
        }
        return;
      }

      // 情況 4：已打完字碼等待按空白鍵時，若按其他英文字母，提醒按下空白鍵
      if (speedWordReadyForSpace) {
        e.preventDefault();
        e.stopPropagation();
        const spacePrompt = document.getElementById('speed-space-prompt');
        if (spacePrompt) {
          spacePrompt.classList.add('shake-error');
          setTimeout(() => spacePrompt.classList.remove('shake-error'), 400);
        }
        return;
      }

      // 情況 5：攔截英文字母鍵 A ~ Z (完全忽略輸入法)
      const keyUpper = e.key.toUpperCase();
      if (keyUpper.length === 1 && keyUpper >= 'A' && keyUpper <= 'Z') {
        e.preventDefault(); // 阻止瀏覽器組字上屏
        e.stopPropagation();
        processSpeedKeyInput(keyUpper);
      }
    }

    // 處理手速賽按鍵
    function processSpeedKeyInput(pressedKey) {
      if (speedWordReadyForSpace) return;
      const currentWord = speedWordList[speedWordIdx];
      if (!currentWord) return;

      const neededIdx = speedInputCodes.length;
      const targetKey = currentWord.keys[neededIdx];
      const targetCode = currentWord.codes[neededIdx];

      speedTotalKeys++;

      if (pressedKey === targetKey) {
        // 正確按鍵
        speedCorrectKeys++;
        speedInputCodes.push({ key: pressedKey, code: targetCode });

        // 檢查該字是否全部碼位完成
        if (speedInputCodes.length === currentWord.keys.length) {
          speedWordReadyForSpace = true;
          if (speedHintTimer) clearTimeout(speedHintTimer);

          // 更新卡槽為全綠成功狀態
          const slotsContainer = document.getElementById('speed-slots-row');
          if (slotsContainer) {
            slotsContainer.innerHTML = '';
            currentWord.codes.forEach((code, idx) => {
              const slot = document.createElement('div');
              slot.className = 'speed-key-slot filled';
              slot.style.borderColor = '#10B981';
              slot.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.5)';
              slot.innerHTML = `
                <div class="speed-slot-code" style="color: #34D399;">${code}</div>
                <div class="speed-slot-sub" style="color: #A7F3D0;">${currentWord.keys[idx]} ✓</div>
              `;
              slotsContainer.appendChild(slot);
            });
          }

          // 浮現空白鍵確認送出提示列
          const spacePrompt = document.getElementById('speed-space-prompt');
          if (spacePrompt) {
            spacePrompt.style.display = 'flex';
          }
          document.getElementById('speed-bottom-tip').innerHTML = `✨ <strong style="color:#34D399;">【${currentWord.char}】字碼全對！</strong>請按下鍵盤<strong>【Space 空白鍵】</strong>送出並進入下一題 ➔`;
        } else {
          renderSpeedTargetWord();
        }
      } else {
        // 按錯鍵：按要求嚴格加計 +0.3 秒罰時
        speedMistakes++;
        speedPenaltySeconds += 0.3;

        // 畫面抖動與泛紅
        const targetSlot = document.getElementById(`speed-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('shake-error');
          setTimeout(() => targetSlot.classList.remove('shake-error'), 400);
        }

        // 浮動紅字標籤
        const stage = document.getElementById('speed-main-stage');
        triggerFloatingNotice(stage, '+0.3s 罰時 ⚠️');

        document.getElementById('speed-penalty-display').innerHTML = `⚠️ 失誤 <strong style="color:#EF4444;">${speedMistakes}</strong> 次 (+<strong style="color:#EF4444;">${speedPenaltySeconds.toFixed(1)}s</strong> 罰時)`;
      }
    }

    // 學生按下空白鍵送出此字並進入下一關
    function confirmSpeedWordSpace() {
      if (!speedWordReadyForSpace || !speedActive) return;
      speedWordReadyForSpace = false;

      const spacePrompt = document.getElementById('speed-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      burstConfetti();
      speedWordIdx++;
      speedInputCodes = [];

      if (speedWordIdx < speedWordList.length) {
        renderSpeedTargetWord();
      } else {
        // 全部題目完成！進入結算
        onSpeedMatchComplete();
      }
    }

    /* 組出手速賽整場的逐字結果（任務 9／12）。
       獎勵分攤到每個字：後端只採計「該週次今天首次答對」的字，
       整場都首答時總和精確等於 speedRoundScore，避免整場重刷領滿分。

       傳入 todayMap／weekKey 時，本機先按「今天已得分」預估（今天已得分的字給 0），
       令結算卡顯示的分數與後端判定一致；雲端回應會再覆寫本機掌握快取。
       mode 指出是哪個限時模式（決定進度鍵前綴）；未傳時取當前模式。
       純函式：不碰 DOM／狀態，方便測試。 */
    function buildSpeedRound(wordList, effectiveFinalTime, wordCount, todayMap, today, weekKey, mode) {
      const list = Array.isArray(wordList) ? wordList : [];
      const roundMode = mode || currentGameMode;
      const split = MasteryCore.speedRoundEarned(effectiveFinalTime, wordCount);
      // 沒有掌握資料時（未登入、無快取）整場全給，行為與從前一致。
      if (!todayMap || !today) {
        return list.map((w, i) => ({ char: w && w.char, correct: true, earned: (split[i] || 0) }))
          .filter(r => !!r.char);
      }
      // 每個字的權重＝「這是今天第幾次計分」對應的遞減倍率（已用完 3 次的字權重為 0）。
      // 整場可得分＝總分 ×（權重和 ÷ 字數），再依權重比例分攤，總和精確等於可得分。
      const weightOf = ch => MasteryCore.decayFor(
        MasteryCore.countOf(todayMap, masteryKey(roundMode, ch, weekKey), today) + 1);
      const rows = list.map(w => {
        const char = w && w.char;
        return char ? { char: char, weight: weightOf(char), earned: 0 } : null;
      }).filter(r => !!r);
      const wsum = rows.reduce((a, r) => a + r.weight, 0);
      const total = MasteryCore.speedRoundScore(effectiveFinalTime, wordCount);
      const usable = rows.length > 0 ? Math.round(total * wsum / rows.length) : 0;
      let assigned = 0;
      rows.forEach(r => {
        r.earned = wsum > 0 ? Math.floor(usable * r.weight / wsum) : 0;
        assigned += r.earned;
      });
      // 餘數補到前面的字，令總和精確等於 usable。
      let leftover = usable - assigned;
      for (let i = 0; i < rows.length && leftover > 0; i++) {
        if (rows[i].weight > 0) { rows[i].earned += 1; leftover -= 1; }
      }
      return rows.map(r => ({ char: r.char, correct: true, earned: r.earned }));
    }

    // 手速賽圓滿結算 (秒數制 · 擊鍵準確率二次方加權罰時)
    function onSpeedMatchComplete() {
      speedActive = false;
      speedWordReadyForSpace = false;
      if (speedTimerInterval) clearInterval(speedTimerInterval);
      if (speedHintTimer) clearTimeout(speedHintTimer);
      window.removeEventListener('keydown', handleSpeedKeydown, true);

      const endTime = performance.now();
      const rawElapsed = parseFloat(((endTime - speedStartTime) / 1000).toFixed(2));
      const accuracy = Math.max(10, Math.round((speedCorrectKeys / Math.max(1, speedTotalKeys)) * 100));

      // 計算等效競賽總耗時 (秒)
      const penaltyObj = calculateEffectiveSpeedTime(rawElapsed, speedMistakes, accuracy, currentSpeedWordCount);
      const effectiveFinalTime = penaltyObj.effectiveTime;

      const cpm = Math.round(currentSpeedWordCount / (effectiveFinalTime / 60)); // 等效中文字速
      const speedTier = getSpeedTier(effectiveFinalTime, currentSpeedWordCount);

      // 展示結算卡
      document.getElementById('speed-main-stage').style.display = 'none';
      document.getElementById('speed-finish-box').style.display = 'block';

      document.getElementById('speed-finish-title').textContent = `${currentSpeedWordCount} 字極速刷分鍵盤手速賽完成！`;
      document.getElementById('speed-stat-final-time').textContent = effectiveFinalTime.toFixed(2) + 's';
      document.getElementById('speed-stat-raw-time').textContent = rawElapsed.toFixed(2) + 's';
      document.getElementById('speed-stat-acc').textContent = accuracy + '%';
      document.getElementById('speed-stat-acc-penalty').textContent = (penaltyObj.accPenalty >= 0 ? '+' : '') + penaltyObj.accPenalty.toFixed(2) + 's';
      document.getElementById('speed-stat-cpm').textContent = cpm + ' 字/分';
      document.getElementById('speed-stat-tier').textContent = speedTier;

      // 儲存至本地 SafeStorage (依周次與題量獨立儲存個人最佳秒數紀錄)
      if (currentStudent) {
        const speedKey = `p5_speed_${currentStudent.cls}_${currentStudent.num}_${currentSpeedWordCount}_${currentSpeedWeek}`;
        const prev = SafeStorage.getItem(speedKey);
        let bestRecord = {
          cls: currentStudent.cls,
          num: currentStudent.num,
          wordCount: currentSpeedWordCount,
          weekKey: currentSpeedWeek,
          bestTime: effectiveFinalTime, // 核心天梯排名依據 (秒數越小越前)
          rawTime: rawElapsed,
          accuracy: accuracy,
          cpm: cpm,
          accPenalty: penaltyObj.accPenalty,
          tier: speedTier,
          date: new Date().toISOString()
        };

        if (prev) {
          try {
            const parsed = JSON.parse(prev);
            if (parsed && typeof parsed.bestTime === 'number' && parsed.bestTime < effectiveFinalTime) {
              bestRecord = parsed; // 保留歷史最快紀錄
            }
          } catch(e) {}
        }
        SafeStorage.setItem(speedKey, JSON.stringify(bestRecord));

        // 向下相容舊鍵 (10字 w3)
        if (currentSpeedWordCount === 10) {
          const prevOverall = SafeStorage.getItem(`p5_speed_${currentStudent.cls}_${currentStudent.num}`);
          let shouldUpdateOverall = true;
          if (prevOverall) {
            try {
              const parsedPrev = JSON.parse(prevOverall);
              if (parsedPrev && parsedPrev.bestTime <= effectiveFinalTime) {
                shouldUpdateOverall = false;
              }
            } catch (e) {}
          }
          if (shouldUpdateOverall) {
            SafeStorage.setItem(`p5_speed_${currentStudent.cls}_${currentStudent.num}`, JSON.stringify(bestRecord));
          }
        }

        // 模式二加分（任務 9／12）：獎勵分攤到每個字，由後端判斷「該週次今天是否首次答對」。
        // 秒數天梯不受影響：bestTime／wordCount／weekKey 照舊上傳。
        lastSpeedRoundScore = MasteryCore.speedRoundScore(effectiveFinalTime, currentSpeedWordCount);
        const { today: speedToday, map: speedMap } = getTodayMastery();
        const speedRound = buildSpeedRound(speedWordList, effectiveFinalTime, currentSpeedWordCount,
          speedMap, speedToday, currentSpeedWeek, currentGameMode);
        const estimatedEarned = speedRound.reduce((a, r) => a + r.earned, 0);
        lastSpeedEarned = estimatedEarned;
        // 分數由後端依「該週次今天是否首答」判定後回填，前端先送 0 避免自行宣稱得分。
        saveStudentStats(currentStudent.cls, currentStudent.num, 0, false, currentGameMode,
          effectiveFinalTime, currentSpeedWordCount, currentSpeedWeek, speedRound);
        renderSpeedEarned(estimatedEarned, speedRound);
        loadStudentProfile();
      }

              // 同步手速榜篩選器與按鈕狀態至當前挑戰項目
        speedLeaderboardWordCount = currentSpeedWordCount;
        speedLeaderboardWeek = currentSpeedWeek;
        document.querySelectorAll('#speed-lb-sub-filters .lb-sub-pill[id^="lb-wc-"]').forEach(p => {
          p.classList.toggle('active', p.id === `lb-wc-${speedLeaderboardWordCount}`);
        });
        document.querySelectorAll('#speed-lb-week-buttons .lb-sub-pill').forEach(p => {
          p.classList.toggle('active', p.id === `lb-week-${speedLeaderboardWeek}`);
        });

      burstConfetti();
    }

    // 重玩手速賽 (同配置全新亂序)
    function restartSpeedMatch() {
      launchSpeedMatch();
    }

    // =========================================================================
    // 💀 生存模式引擎（survival 機制）
    //    與手速賽共用「限時跑字」骨架，時間規則相反：倒數計時、答對加秒、答錯扣秒、
    //    歸零即結束。出題為連續流（跑完全部字庫就重新洗牌續上），不固定題數。
    //    結算走 code 機制的 MasteryCore.buildRound，與站 1/3/4/7 同一套每日遞減規則。
    // =========================================================================
    function returnToSurvivalReadyStage() {
      if (window.P5WordBank) window.P5WordBank.applyPending();
      const mainStage = document.getElementById('survival-main-stage');
      const finishBox = document.getElementById('survival-finish-box');
      const readyStage = document.getElementById('survival-ready-stage');
      if (mainStage) mainStage.style.display = 'none';
      if (finishBox) finishBox.style.display = 'none';
      if (readyStage) readyStage.style.display = 'block';
    }

    // 取出生存模式的題庫（registry 的 pool）。
    function survivalPool() {
      const poolKey = MODE_REGISTRY.poolOf(currentGameMode);
      const pool = (poolKey && DATA[poolKey]) ? DATA[poolKey] : [];
      return Array.isArray(pool) ? pool : [];
    }

    /* 補題：佇列空了就用整份字庫重新洗牌續上（生存模式是連續流，沒有固定題數）。
       每次補題都優先抽「今天尚未得分」的字，讓學生在第 1、2、3 次陸續拿到分。 */
    function nextSurvivalWord() {
      if (survivalQueue.length === 0) {
        const pool = survivalPool();
        if (pool.length === 0) return null;
        survivalQueue = fisherYatesShuffle(prioritizeTodayChars(currentGameMode, pool.slice()));
      }
      return survivalQueue.pop() || null;
    }

    // 🚀 按下開始按鈕才真正啟動生命值與出題
    function launchSurvivalMatch() {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      if (survivalTimerInterval) clearInterval(survivalTimerInterval);
      if (survivalHintTimer) clearTimeout(survivalHintTimer);
      if (survivalComboTimer) clearTimeout(survivalComboTimer);

      const pool = survivalPool();
      if (pool.length === 0) {
        showPassToast('本模式的字庫尚未載入，請先更新字庫或稍後再試。');
        return;
      }

      survivalQueue = fisherYatesShuffle(pool.slice());
      survivalWordList = [];
      survivalIdx = 0;
      survivalInputCodes = [];
      survivalLives = SURVIVAL_MAX_LIVES;
      survivalCombo = 0;
      survivalMaxCombo = 0;
      survivalElapsedMs = 0;
      survivalCorrectCount = 0;
      survivalMistakeCount = 0;
      survivalTotalKeys = 0;
      survivalCorrectKeys = 0;
      survivalRoundResults = [];
      survivalActive = true;
      survivalWordReadyForSpace = false;

      document.getElementById('survival-ready-stage').style.display = 'none';
      document.getElementById('survival-finish-box').style.display = 'none';
      document.getElementById('survival-main-stage').style.display = 'block';

      const badgeTag = document.getElementById('survival-active-badge-tag');
      if (badgeTag) badgeTag.textContent = `💀 生存模式 · ${SURVIVAL_MAX_LIVES} 條命`;

      const spacePrompt = document.getElementById('survival-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      renderSurvivalLives();
      renderSurvivalCombo();
      renderSurvivalStats();
      loadSurvivalWord();

      survivalLastTick = performance.now();
      survivalTimerInterval = setInterval(tickSurvivalClock, 100);

      window.removeEventListener('keydown', handleSurvivalKeydown, true);
      window.addEventListener('keydown', handleSurvivalKeydown, true);
    }

    // 放棄比賽返回備戰大廳
    function abortSurvivalToReady() {
      if (survivalTimerInterval) clearInterval(survivalTimerInterval);
      if (survivalHintTimer) clearTimeout(survivalHintTimer);
      if (survivalComboTimer) clearTimeout(survivalComboTimer);
      survivalActive = false;
      survivalWordReadyForSpace = false;
      window.removeEventListener('keydown', handleSurvivalKeydown, true);
      returnToSurvivalReadyStage();
    }

    /* 存活心跳：每 100ms 累加存活時間（僅供顯示，不影響勝負）。
       勝負完全由生命值決定：命用完才結束。 */
    function tickSurvivalClock() {
      if (!survivalActive) return;
      const now = performance.now();
      const delta = now - survivalLastTick;
      survivalLastTick = now;
      survivalElapsedMs += delta;
      renderSurvivalClock();
    }

    function renderSurvivalClock() {
      const el = document.getElementById('survival-timer-val');
      if (!el) return;
      const secs = survivalElapsedMs / 1000;
      el.textContent = secs.toFixed(1) + 's';
      el.style.color = '#38BDF8';
      el.style.textShadow = '0 0 12px rgba(56, 189, 248, 0.6)';
    }

    // ❤️ 生命值 HUD：滿命用亮紅心、已扣的命用暗心
    function renderSurvivalLives() {
      const el = document.getElementById('survival-lives-row');
      if (el) {
        let html = '';
        for (let i = 0; i < SURVIVAL_MAX_LIVES; i++) {
          const alive = i < survivalLives;
          html += `<span class="survival-heart${alive ? ' alive' : ' lost'}">${alive ? '❤️' : '🖤'}</span>`;
        }
        el.innerHTML = html;
      }
      const stage = document.getElementById('survival-main-stage');
      if (stage) {
        // 剩 1 命時整個舞台加脈動紅光（視覺壓力）
        if (survivalLives <= 1) stage.classList.add('survival-critical');
        else stage.classList.remove('survival-critical');
      }
    }

    // 🔥 連擊 HUD：顯示目前連擊與倍率
    function renderSurvivalCombo() {
      const el = document.getElementById('survival-combo-val');
      if (el) {
        const mult = survivalComboMultiplier();
        if (survivalCombo > 0) {
          el.innerHTML = `🔥 連擊 <strong>${survivalCombo}</strong>`
            + (mult > 1 ? ` <span class="survival-combo-mult">×${mult}</span>` : '');
          el.style.display = 'inline-block';
        } else {
          el.innerHTML = '—';
          el.style.display = 'inline-block';
        }
      }
      const comboBox = document.getElementById('survival-combo-box');
      if (comboBox) {
        const tier = survivalComboTier();
        comboBox.classList.toggle('hot', tier.mult >= 2);
      }
    }

    // 依目前連擊取倍率（未達任何門檻＝×1）
    function survivalComboMultiplier() {
      return survivalComboTier().mult;
    }

    function survivalComboTier() {
      for (const t of SURVIVAL_COMBO_TIERS) {
        if (survivalCombo >= t.min) return t;
      }
      return { min: 0, mult: 1 };
    }

    // 重設連擊超時計時器：SURVIVAL_COMBO_WINDOW_MS 內沒答對一字就斷連擊
    function resetSurvivalComboTimer() {
      if (survivalComboTimer) clearTimeout(survivalComboTimer);
      if (!survivalActive) return;
      survivalComboTimer = setTimeout(() => {
        if (!survivalActive) return;
        if (survivalCombo > 0) {
          survivalCombo = 0;
          renderSurvivalCombo();
          const stage = document.getElementById('survival-main-stage');
          triggerFloatingNotice(stage, '連擊中斷 💤');
        }
      }, SURVIVAL_COMBO_WINDOW_MS);
    }

    function renderSurvivalStats() {
      const el = document.getElementById('survival-stat-bar');
      if (el) {
        el.innerHTML = `✅ 已答對 <strong style="color:#34D399;">${survivalCorrectCount}</strong> 字　·　`
          + `⚠️ 失誤 <strong style="color:#EF4444;">${survivalMistakeCount}</strong> 次`;
      }
      const idxEl = document.getElementById('survival-current-idx-text');
      if (idxEl) idxEl.textContent = survivalIdx + 1;
    }

    // 取下一題並渲染（生存模式沒有固定題數，邊玩邊補）
    function loadSurvivalWord() {
      const word = nextSurvivalWord();
      if (!word) { onSurvivalMatchComplete(); return; }
      survivalWordList.push(word);
      survivalIdx = survivalWordList.length - 1;
      survivalInputCodes = [];
      survivalWordReadyForSpace = false;

      const spacePrompt = document.getElementById('survival-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      document.getElementById('survival-target-char').textContent = word.char;
      document.getElementById('survival-bottom-tip').innerHTML =
        `💡 規則：答錯 <strong style="color:#EF4444;">−1 條命</strong>　·　`
        + `答對累積<strong style="color:#F59E0B;">連擊</strong>提高得分倍率　·　`
        + `生命歸零結束　·　<strong>打完字碼請按【空白鍵 Space】送出</strong>`;

      renderSurvivalStats();
      renderSurvivalSlots();
      startSurvivalHintTimer();
    }

    function renderSurvivalSlots() {
      const slotsContainer = document.getElementById('survival-slots-row');
      if (!slotsContainer) return;
      const word = survivalWordList[survivalIdx];
      if (!word) return;
      slotsContainer.innerHTML = '';
      const neededIdx = survivalInputCodes.length;

      word.codes.forEach((code, idx) => {
        const slot = document.createElement('div');
        slot.id = `survival-slot-${idx}`;
        slot.className = 'speed-key-slot';

        if (idx < survivalInputCodes.length) {
          slot.classList.add('filled');
          slot.innerHTML = `
            <div class="speed-slot-code" style="color: #34D399;">${survivalInputCodes[idx].code}</div>
            <div class="speed-slot-sub" style="color: #A7F3D0;">${survivalInputCodes[idx].key}</div>
          `;
        } else if (idx === neededIdx) {
          slot.classList.add('current');
          slot.innerHTML = `
            <div class="speed-slot-code" style="color: #94A3B8;">？</div>
            <div class="speed-slot-sub">第${idx + 1}碼</div>
          `;
        } else {
          slot.innerHTML = `
            <div class="speed-slot-code" style="color: #475569;">·</div>
            <div class="speed-slot-sub">第${idx + 1}碼</div>
          `;
        }
        slotsContainer.appendChild(slot);
      });
    }

    // 3 秒未輸入自動提燈提示
    function startSurvivalHintTimer() {
      if (survivalHintTimer) clearTimeout(survivalHintTimer);
      if (!survivalActive || survivalWordReadyForSpace) return;
      const word = survivalWordList[survivalIdx];
      const neededIdx = survivalInputCodes.length;
      if (!word || neededIdx >= word.codes.length) return;

      survivalHintTimer = setTimeout(() => {
        if (!survivalActive) return;
        const targetSlot = document.getElementById(`survival-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('hint-glow');
          targetSlot.innerHTML = `
            <div class="speed-slot-hint-text">${word.codes[neededIdx]}</div>
            <div class="speed-slot-sub" style="color: #FACC15; font-weight: 900;">${word.keys[neededIdx]}</div>
          `;
          document.getElementById('survival-bottom-tip').innerHTML =
            `💡 <span style="color:#FACC15;font-weight:900;">【提燈指引啟動】：目標字根為【${word.codes[neededIdx]}】(按鍵 ${word.keys[neededIdx]})！</span>`;
        }
      }, 3000);
    }

    // ⌨️ 生存模式鍵盤處理（原生攔截 A~Z，完全忽略輸入法）
    function handleSurvivalKeydown(e) {
      if (MODE_REGISTRY.mechOf(currentGameMode) !== 'survival') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // 情況 1：備戰說明頁按下 Space / Enter 直接開始
      const readyStage = document.getElementById('survival-ready-stage');
      if (readyStage && readyStage.style.display !== 'none') {
        if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          launchSurvivalMatch();
        }
        return;
      }

      if (!survivalActive) return;

      // 情況 2：按空白鍵送出（未完成時溫和提醒）
      if (e.key === ' ' || e.code === 'Space' || e.keyCode === 32) {
        e.preventDefault();
        e.stopPropagation();
        if (survivalWordReadyForSpace) {
          confirmSurvivalWordSpace();
        } else {
          const stage = document.getElementById('survival-main-stage');
          triggerFloatingNotice(stage, '請先敲完字碼再按空白鍵！⚠️');
        }
        return;
      }

      // 情況 3：Backspace 退碼
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (survivalWordReadyForSpace) {
          survivalWordReadyForSpace = false;
          survivalInputCodes.pop();
          renderSurvivalSlots();
          startSurvivalHintTimer();
        } else if (survivalInputCodes.length > 0) {
          survivalInputCodes.pop();
          renderSurvivalSlots();
          startSurvivalHintTimer();
        }
        return;
      }

      // 情況 4：已打完等待空白鍵時按其他字母 → 提醒
      if (survivalWordReadyForSpace) {
        e.preventDefault();
        e.stopPropagation();
        const spacePrompt = document.getElementById('survival-space-prompt');
        if (spacePrompt) {
          spacePrompt.classList.add('shake-error');
          setTimeout(() => spacePrompt.classList.remove('shake-error'), 400);
        }
        return;
      }

      // 情況 5：攔截英文字母 A ~ Z
      const keyUpper = e.key.toUpperCase();
      if (keyUpper.length === 1 && keyUpper >= 'A' && keyUpper <= 'Z') {
        e.preventDefault();
        e.stopPropagation();
        processSurvivalKeyInput(keyUpper);
      }
    }

    // 處理生存模式按鍵：答對照常推進；答錯扣秒（而非罰時累加）
    function processSurvivalKeyInput(pressedKey) {
      if (survivalWordReadyForSpace) return;
      const word = survivalWordList[survivalIdx];
      if (!word) return;

      const neededIdx = survivalInputCodes.length;
      const targetKey = word.keys[neededIdx];
      const targetCode = word.codes[neededIdx];

      survivalTotalKeys++;

      if (pressedKey === targetKey) {
        survivalCorrectKeys++;
        survivalInputCodes.push({ key: pressedKey, code: targetCode });

        if (survivalInputCodes.length === word.keys.length) {
          survivalWordReadyForSpace = true;
          if (survivalHintTimer) clearTimeout(survivalHintTimer);

          const slotsContainer = document.getElementById('survival-slots-row');
          if (slotsContainer) {
            slotsContainer.innerHTML = '';
            word.codes.forEach((code, idx) => {
              const slot = document.createElement('div');
              slot.className = 'speed-key-slot filled';
              slot.style.borderColor = '#10B981';
              slot.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.5)';
              slot.innerHTML = `
                <div class="speed-slot-code" style="color: #34D399;">${code}</div>
                <div class="speed-slot-sub" style="color: #A7F3D0;">${word.keys[idx]} ✓</div>
              `;
              slotsContainer.appendChild(slot);
            });
          }

          const spacePrompt = document.getElementById('survival-space-prompt');
          if (spacePrompt) spacePrompt.style.display = 'flex';
          const mult = survivalComboMultiplier();
          const nextCombo = survivalCombo + 1;
          document.getElementById('survival-bottom-tip').innerHTML =
            `✨ <strong style="color:#34D399;">【${word.char}】字碼全對！</strong>按下<strong>【Space 空白鍵】</strong>送出，`
            + `連擊將達 <strong style="color:#F59E0B;">${nextCombo}</strong>`
            + (mult > 1 ? ` <span style="color:#FBBF24;">(本字 ×${mult})</span>` : '')
            + ` ➔`;
        } else {
          renderSurvivalSlots();
        }
      } else {
        // 按錯鍵：扣 1 條命（生命值才是生存模式的張力來源），並打斷連擊
        survivalMistakeCount++;
        survivalLives = Math.max(0, survivalLives - SURVIVAL_LIFE_LOSS);
        survivalCombo = 0;
        if (survivalComboTimer) clearTimeout(survivalComboTimer);
        renderSurvivalLives();
        renderSurvivalCombo();
        renderSurvivalStats();

        const targetSlot = document.getElementById(`survival-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('shake-error');
          setTimeout(() => targetSlot.classList.remove('shake-error'), 400);
        }

        const stage = document.getElementById('survival-main-stage');
        triggerFloatingNotice(stage, `−1 條命 💔`);
        const livesRow = document.getElementById('survival-lives-row');
        if (livesRow) {
          livesRow.classList.add('shake-error');
          setTimeout(() => livesRow.classList.remove('shake-error'), 400);
        }

        if (survivalLives <= 0) {
          onSurvivalMatchComplete();
        }
      }
    }

    // 按下空白鍵：送出此字、累積連擊、續下一題
    function confirmSurvivalWordSpace() {
      if (!survivalWordReadyForSpace || !survivalActive) return;
      const word = survivalWordList[survivalIdx];
      survivalWordReadyForSpace = false;

      const spacePrompt = document.getElementById('survival-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      survivalCorrectCount++;
      survivalCombo++;
      if (survivalCombo > survivalMaxCombo) survivalMaxCombo = survivalCombo;
      renderSurvivalCombo();
      resetSurvivalComboTimer();

      if (word) {
        // 逐字結果先收著，結束時一次走 buildRound（與站 1/3/4/7 同一套每日遞減規則）。
        // 連擊倍率由前端算好存在 earned 的「倍率註記」上，結算時套用。
        survivalRoundResults.push({
          char: word.char,
          correct: true,
          earned: 0,
          combo: survivalCombo,
          multiplier: survivalComboMultiplier()
        });
      }

      burstConfetti();
      loadSurvivalWord();
    }

    /* 結束結算：逐字走 code 機制的 buildRound（後端據此判斷今天還算不算分），
       分數先在前端依本機快取＋連擊倍率預估，實際以後端回傳為準。 */
    function onSurvivalMatchComplete() {
      if (!survivalActive) return;
      survivalActive = false;
      survivalWordReadyForSpace = false;
      if (survivalTimerInterval) clearInterval(survivalTimerInterval);
      if (survivalHintTimer) clearTimeout(survivalHintTimer);
      if (survivalComboTimer) clearTimeout(survivalComboTimer);
      window.removeEventListener('keydown', handleSurvivalKeydown, true);

      document.getElementById('survival-main-stage').style.display = 'none';
      document.getElementById('survival-finish-box').style.display = 'block';
      const mainStage = document.getElementById('survival-main-stage');
      if (mainStage) mainStage.classList.remove('survival-critical');

      const accuracy = Math.max(0, Math.round((survivalCorrectKeys / Math.max(1, survivalTotalKeys)) * 100));
      const elapsedSecs = Math.round(survivalElapsedMs / 1000);
      document.getElementById('survival-finish-title').textContent =
        survivalLives <= 0
          ? `生命耗盡！生存 ${survivalCorrectCount} 字`
          : `生存 ${survivalCorrectCount} 字 · 挑戰結束！`;
      document.getElementById('survival-stat-correct').textContent = survivalCorrectCount + ' 字';
      document.getElementById('survival-stat-mistakes').textContent = survivalMistakeCount + ' 次';
      document.getElementById('survival-stat-acc').textContent = accuracy + '%';
      const timeEl = document.getElementById('survival-stat-time');
      if (timeEl) timeEl.textContent = elapsedSecs + 's';
      const comboEl = document.getElementById('survival-stat-combo');
      if (comboEl) comboEl.textContent = survivalMaxCombo + ' 連';

      // 結算得分：走共用的 buildEarnedRound（同一套每日遞減規則）。
      // 連擊倍率屬前端玩法加成：先算進每筆的基準分，再交給它套每日遞減。
      const pool = survivalPool();
      const prefix = MODE_REGISTRY.prefixFor(currentGameMode, '');
      const view = MODE_REGISTRY.viewOf(currentGameMode);
      const baseScore = view.baseScore || 15;
      const { round, estimated } = buildEarnedRound(
        survivalRoundResults, pool, prefix, baseScore,
        (r) => baseScore * (r && r.multiplier ? r.multiplier : 1));
      const estimatedEarned = estimated;
      lastSurvivalScore = estimatedEarned;

      renderSurvivalEarned(estimatedEarned, round);

      if (currentStudent) {
        // 分數由後端依 round 判定後回填，前端先送 0 避免自行宣稱得分。
        // 連擊倍率屬前端玩法加成，後端每日遞減規則不變（送出的是去過重的字表）。
        saveStudentStats(currentStudent.cls, currentStudent.num, 0, false, currentGameMode,
          Math.round(survivalCorrectCount > 0
            ? (survivalCorrectCount / Math.max(1, survivalCorrectCount + survivalMistakeCount)) * 100 : 0),
          10, '', round);
        loadStudentProfile();
      }

      burstConfetti();
    }

    /* 生存模式結算卡：顯示本場預估得分（已含連擊倍率）。
       沿用與手速賽相同的「該模式前綴」判定，加新模式不必改前端。 */
    function renderSurvivalEarned(totalEarned, round) {
      const value = document.getElementById('survival-stat-earned');
      const desc = document.getElementById('survival-stat-earned-desc');
      const list = Array.isArray(round) ? round : [];
      const scored = list.filter(r => r.earned > 0).length;
      const ignored = list.length - scored;
      if (value) value.textContent = '+' + totalEarned + ' 分';
      if (desc) {
        const comboNote = survivalMaxCombo >= 5
          ? `最高連擊 ${survivalMaxCombo}（×${survivalComboComboMultFor(survivalMaxCombo)}）　·　`
          : '';
        if (list.length === 0) {
          desc.textContent = '尚未答對任何字，下場再努力！';
        } else if (scored === 0 && ignored > 0) {
          desc.textContent = '今天這些字都已計分 ' + MasteryCore.MAX_PER_DAY + ' 次（上限）';
        } else if (ignored > 0) {
          desc.textContent = comboNote + scored + ' 字計分　·　' + ignored + ' 字今天已達上限';
        } else {
          desc.textContent = comboNote + '每字每日最多計分 ' + MasteryCore.MAX_PER_DAY + ' 次（第 2、3 次遞減）';
        }
      }
    }

    // 依「連擊數」回推倍率（給結算文案顯示用）
    function survivalComboComboMultFor(combo) {
      for (const t of SURVIVAL_COMBO_TIERS) {
        if (combo >= t.min) return t.mult;
      }
      return 1;
    }

    // 重玩生存模式
    function restartSurvivalMatch() {
      launchSurvivalMatch();
    }

    // =========================================================================
    // 🐣 寵物養成引擎（pet 機制）
    //    玩法：打對字＝餵寵物一口，累積經驗讓牠進化（神秘蛋→幼龍→小飛龍→巨龍→傳說龍王）。
    //    計分：與站 1/3/4/7 完全相同 —— 把答對的字用 round 送出，後端零改動。
    //    寵物狀態存本機快取（不經後端），所以不必新增任何後端欄位。
    // =========================================================================

    // 寵物進度存本機（每個學生一份）
    function petStorageKey() {
      if (!currentStudent) return '';
      return `p5_pet_${currentStudent.cls}_${currentStudent.num}`;
    }

    function loadPetProgress() {
      const key = petStorageKey();
      const fallback = { exp: 0, satiety: 80, mood: 'happy', lastFed: '' };
      if (!key) return fallback;
      try {
        const raw = SafeStorage.getItem(key);
        if (!raw) return fallback;
        const obj = JSON.parse(raw);
        return {
          exp: Math.max(0, Number(obj.exp) || 0),
          satiety: Math.max(0, Math.min(100, Number(obj.satiety) != null ? obj.satiety : 80)),
          mood: obj.mood || 'happy',
          lastFed: obj.lastFed || ''
        };
      } catch (e) {
        return fallback;
      }
    }

    function savePetProgress() {
      const key = petStorageKey();
      if (!key || !petProgress) return;
      try {
        SafeStorage.setItem(key, JSON.stringify(petProgress));
      } catch (e) { /* 忽略儲存失敗，不影響遊戲 */ }
    }

    /* 依經驗取當前階段（回傳索引與階段物件）。
       同時回傳「距下一階段還差多少」，供經驗條使用。 */
    function petStageFor(exp) {
      let idx = 0;
      for (let i = 0; i < PET_STAGES.length; i++) {
        if (exp >= PET_STAGES[i].minExp) idx = i;
      }
      const stage = PET_STAGES[idx];
      const next = PET_STAGES[idx + 1] || null;
      const spanStart = stage.minExp;
      const spanEnd = next ? next.minExp : stage.minExp;
      const into = exp - spanStart;
      const span = next ? (spanEnd - spanStart) : 1;
      return {
        idx: idx,
        stage: stage,
        next: next,
        into: into,
        span: span,
        pct: next ? Math.min(100, Math.round((into / span) * 100)) : 100
      };
    }

    // 進入寵物競技場：載入狀態、渲染、出第一題
    function enterPetArena() {
      petProgress = loadPetProgress();
      petWordList = [];
      petQueue = [];
      petIdx = 0;
      petInputCodes = [];
      petCorrectCount = 0;
      petMistakeCount = 0;
      petStreak = 0;
      petTotalKeys = 0;
      petCorrectKeys = 0;
      petRoundResults = [];
      petWordReadyForSpace = false;
      petActive = true;

      const flash = document.getElementById('pet-evolve-flash');
      if (flash) flash.style.display = 'none';

      renderPetStage();
      loadPetWord();
    }

    // 離開寵物競技場（只切換顯示，不結算）
    function returnToPetIntro() {
      petActive = false;
      petWordReadyForSpace = false;
      if (petHintTimer) clearTimeout(petHintTimer);
      window.removeEventListener('keydown', handlePetKeydown, true);
      setGameMode('connected');
    }

    // 渲染寵物本體、階段徽章、經驗條、進化小圖、飽足度心情
    function renderPetStage() {
      if (!petProgress) petProgress = loadPetProgress();
      const info = petStageFor(petProgress.exp);

      const figure = document.getElementById('pet-figure');
      if (figure) figure.textContent = info.stage.emoji;

      const badge = document.getElementById('pet-stage-badge');
      if (badge) badge.textContent = info.stage.emoji + ' ' + info.stage.name;

      const expText = document.getElementById('pet-exp-text');
      if (expText) {
        expText.textContent = info.next
          ? `經驗 ${petProgress.exp} / ${info.next.minExp}`
          : `經驗 ${petProgress.exp}（已達最終階段）`;
      }

      const bar = document.getElementById('pet-exp-bar');
      if (bar) bar.style.width = info.pct + '%';

      // 進化小圖：已達的節點亮起、當前節點加光環
      const nodes = document.querySelectorAll('#pet-evolution-row .pet-evo-node');
      nodes.forEach(node => {
        const s = node.getAttribute('data-stage');
        const sIdx = PET_STAGES.findIndex(x => x.id === s);
        node.classList.toggle('reached', sIdx <= info.idx);
        node.classList.toggle('current', sIdx === info.idx);
      });

      const satVal = document.getElementById('pet-satiety-val');
      if (satVal) satVal.textContent = Math.round(petProgress.satiety) + '%';

      const moodVal = document.getElementById('pet-mood-val');
      if (moodVal) moodVal.textContent = petMoodLabel(petProgress.satiety);

      const fed = document.getElementById('pet-fed-count');
      if (fed) fed.textContent = petCorrectCount;
      const streakEl = document.getElementById('pet-streak-count');
      if (streakEl) streakEl.textContent = petStreak;
    }

    function petMoodLabel(satiety) {
      if (satiety >= 80) return '超開心';
      if (satiety >= 55) return '很開心';
      if (satiety >= 30) return '有點餓';
      return '餓扁了';
    }

    function petSpeech(text) {
      const el = document.getElementById('pet-speech');
      if (el) el.textContent = text;
    }

    // 取出寵物模式的題庫
    function petPool() {
      const poolKey = MODE_REGISTRY.poolOf(currentGameMode);
      const pool = (poolKey && DATA[poolKey]) ? DATA[poolKey] : [];
      return Array.isArray(pool) ? pool : [];
    }

    // 補題：佇列空了就重洗續上（連續流）
    function nextPetWord() {
      if (petQueue.length === 0) {
        const pool = petPool();
        if (pool.length === 0) return null;
        petQueue = fisherYatesShuffle(prioritizeTodayChars(currentGameMode, pool.slice()));
      }
      return petQueue.pop() || null;
    }

    function loadPetWord() {
      const word = nextPetWord();
      if (!word) { petSpeech('字庫空了…下次再來餵我！'); return; }
      petWordList.push(word);
      petIdx = petWordList.length - 1;
      petInputCodes = [];
      petWordReadyForSpace = false;

      const spacePrompt = document.getElementById('pet-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      document.getElementById('pet-target-char').textContent = word.char;
      document.getElementById('pet-feed-hint').innerHTML =
        `鍵入【 ${word.char} 】的 ${word.codes.length} 碼倉頡字根，餵牠一口！`;
      renderPetStats();
      renderPetSlots();
      startPetHintTimer();
    }

    function renderPetStats() {
      const fed = document.getElementById('pet-fed-count');
      if (fed) fed.textContent = petCorrectCount;
      const streakEl = document.getElementById('pet-streak-count');
      if (streakEl) streakEl.textContent = petStreak;
    }

    function renderPetSlots() {
      const container = document.getElementById('pet-slots-row');
      if (!container) return;
      const word = petWordList[petIdx];
      if (!word) return;
      container.innerHTML = '';
      const neededIdx = petInputCodes.length;

      word.codes.forEach((code, idx) => {
        const slot = document.createElement('div');
        slot.id = `pet-slot-${idx}`;
        slot.className = 'pet-slot';

        if (idx < petInputCodes.length) {
          slot.classList.add('filled');
          slot.innerHTML = `
            <div class="pet-slot-code">${petInputCodes[idx].code}</div>
            <div class="pet-slot-sub">${petInputCodes[idx].key}</div>
          `;
        } else if (idx === neededIdx) {
          slot.classList.add('current');
          slot.innerHTML = `
            <div class="pet-slot-code">？</div>
            <div class="pet-slot-sub">第${idx + 1}碼</div>
          `;
        } else {
          slot.innerHTML = `
            <div class="pet-slot-code" style="color:#E2E8F0;">·</div>
            <div class="pet-slot-sub">第${idx + 1}碼</div>
          `;
        }
        container.appendChild(slot);
      });
    }

    function startPetHintTimer() {
      if (petHintTimer) clearTimeout(petHintTimer);
      if (!petActive || petWordReadyForSpace) return;
      const word = petWordList[petIdx];
      const neededIdx = petInputCodes.length;
      if (!word || neededIdx >= word.codes.length) return;

      // 先清掉上一碼殘留的提示文字（回到題目說明），否則換碼後仍會顯示舊提示
      const hintEl = document.getElementById('pet-feed-hint');
      if (hintEl) {
        hintEl.innerHTML =
          `鍵入【 ${word.char} 】的 ${word.codes.length} 碼倉頡字根，餵牠一口！`;
      }

      petHintTimer = setTimeout(() => {
        if (!petActive) return;
        const targetSlot = document.getElementById(`pet-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('hint-glow');
          targetSlot.innerHTML = `
            <div class="pet-slot-code" style="color:#CA8A04;">${word.codes[neededIdx]}</div>
            <div class="pet-slot-sub" style="color:#CA8A04;">${word.keys[neededIdx]}</div>
          `;
          document.getElementById('pet-feed-hint').innerHTML =
            `💡 <strong style="color:#CA8A04;">提示：這個碼是【${word.codes[neededIdx]}】，按鍵 ${word.keys[neededIdx]}</strong>`;
        }
      }, 3000);
    }

    // ⌨️ 寵物模式鍵盤處理（原生攔截 A~Z）
    function handlePetKeydown(e) {
      if (MODE_REGISTRY.mechOf(currentGameMode) !== 'pet') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (!petActive) return;

      // 空白鍵送出
      if (e.key === ' ' || e.code === 'Space' || e.keyCode === 32) {
        e.preventDefault();
        e.stopPropagation();
        if (petWordReadyForSpace) confirmPetWordSpace();
        return;
      }

      // Backspace 退碼
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (petWordReadyForSpace) {
          petWordReadyForSpace = false;
          petInputCodes.pop();
          renderPetSlots();
          startPetHintTimer();
        } else if (petInputCodes.length > 0) {
          petInputCodes.pop();
          renderPetSlots();
          startPetHintTimer();
        }
        return;
      }

      // 已打完等空白鍵時按其他鍵 → 忽略
      if (petWordReadyForSpace) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const keyUpper = e.key.toUpperCase();
      if (keyUpper.length === 1 && keyUpper >= 'A' && keyUpper <= 'Z') {
        e.preventDefault();
        e.stopPropagation();
        processPetKeyInput(keyUpper);
      }
    }

    function processPetKeyInput(pressedKey) {
      if (petWordReadyForSpace) return;
      const word = petWordList[petIdx];
      if (!word) return;

      const neededIdx = petInputCodes.length;
      const targetKey = word.keys[neededIdx];
      const targetCode = word.codes[neededIdx];

      petTotalKeys++;

      if (pressedKey === targetKey) {
        petCorrectKeys++;
        petInputCodes.push({ key: pressedKey, code: targetCode });

        if (petInputCodes.length === word.keys.length) {
          petWordReadyForSpace = true;
          if (petHintTimer) clearTimeout(petHintTimer);

          renderPetSlots();
          const container = document.getElementById('pet-slots-row');
          if (container) {
            container.querySelectorAll('.pet-slot').forEach(s => {
              s.classList.remove('current');
              s.classList.add('filled');
            });
          }

          const spacePrompt = document.getElementById('pet-space-prompt');
          if (spacePrompt) spacePrompt.style.display = 'flex';
          document.getElementById('pet-feed-hint').innerHTML =
            `✨ <strong style="color:#059669;">【${word.char}】字碼全對！</strong>按【空白鍵】餵牠吃 ➔`;
        } else {
          renderPetSlots();
          startPetHintTimer();   // 答對一碼後重新計時，否則提示會卡在上一碼
        }
      } else {
        // 按錯：不扣命也不扣時，只是連擊歸零、寵物失望一下
        petMistakeCount++;
        petStreak = 0;
        renderPetStats();

        renderPetSlots();      // 先重畫（清掉上一碼殘留的 hint-glow），再套抖動
        startPetHintTimer();   // 答錯後重新計時，讓提示有機會再出現
        const targetSlot = document.getElementById(`pet-slot-${neededIdx}`);
        if (targetSlot) {
          targetSlot.classList.add('shake-error');
          setTimeout(() => targetSlot.classList.remove('shake-error'), 400);
        }
        const figure = document.getElementById('pet-figure');
        if (figure) {
          figure.classList.remove('pet-sad');
          void figure.offsetWidth;
          figure.classList.add('pet-sad');
        }
        petSpeech('咦？這個碼不太對喔…再試一次！');
      }
    }

    // 空白鍵送出：餵食、加經驗、檢查是否進化
    function confirmPetWordSpace() {
      if (!petWordReadyForSpace || !petActive) return;
      const word = petWordList[petIdx];
      petWordReadyForSpace = false;

      const spacePrompt = document.getElementById('pet-space-prompt');
      if (spacePrompt) spacePrompt.style.display = 'none';

      petCorrectCount++;
      petStreak++;
      if (petStreak > 0) petStreak = petStreak; // 保持

      // 加經驗（碼數越多給越多）與飽足度
      const gain = PET_EXP_PER_WORD + Math.max(0, (word ? word.codes.length - 3 : 0)) * 2;
      const beforeInfo = petStageFor(petProgress.exp);
      petProgress.exp += gain;
      petProgress.satiety = Math.min(100, petProgress.satiety + 6);
      petProgress.lastFed = MasteryCore.hkDate(new Date());
      const afterInfo = petStageFor(petProgress.exp);
      savePetProgress();

      if (word) {
        petRoundResults.push({ char: word.char, correct: true, earned: 0 });
      }

      // 進化判定
      if (afterInfo.idx > beforeInfo.idx) {
        playPetEvolution(afterInfo.stage);
      } else {
        const figure = document.getElementById('pet-figure');
        if (figure) {
          figure.classList.remove('pet-happy');
          void figure.offsetWidth;
          figure.classList.add('pet-happy');
        }
        petSpeech(`好好吃！經驗 +${gain}，再餵我一個～`);
      }

      renderPetStage();
      burstConfetti();
      loadPetWord();
    }

    // 進化特效：全螢幕閃光 + 變身動畫
    function playPetEvolution(stage) {
      const flash = document.getElementById('pet-evolve-flash');
      const who = document.getElementById('pet-evolve-who');
      const name = document.getElementById('pet-evolve-name');
      const what = document.getElementById('pet-evolve-what');
      if (who) who.textContent = stage.emoji;
      if (name) name.textContent = stage.name;
      if (what) what.textContent = '進化！';
      if (!flash) return;
      flash.style.display = 'flex';
      petSpeech(`哇！我進化成【${stage.name}】了！謝謝你～`);
      burstConfetti();
      setTimeout(() => {
        if (flash) flash.style.display = 'none';
        renderPetStage();
      }, 1900);
    }

    // 休息一下：把本場答對的字送出計分（走共用的 buildEarnedRound）
    function petRestAndSettle() {
      if (!petActive) return;
      const pool = petPool();
      const prefix = MODE_REGISTRY.prefixFor(currentGameMode, '');
      const view = MODE_REGISTRY.viewOf(currentGameMode);
      const { round, estimated } = buildEarnedRound(
        petRoundResults, pool, prefix, view.baseScore || 15);
      lastPetEarned = estimated;

      if (currentStudent && round.length > 0) {
        saveStudentStats(currentStudent.cls, currentStudent.num, 0, false, currentGameMode,
          Math.round(petCorrectCount > 0
            ? (petCorrectCount / Math.max(1, petCorrectCount + petMistakeCount)) * 100 : 0),
          10, '', round);
        loadStudentProfile();
      }
    }

    /* 公開給頁面按鈕用：休息一下（先結算再回主畫面） */
    function petRestHere() {
      petRestAndSettle();
      const preview = document.getElementById('pet-earned-preview');
      if (preview) preview.textContent = '+' + lastPetEarned;
      returnToPetIntro();
    }

    // =========================================================================
    // 🏃 倉頡大冒險引擎（run 機制）——站 3 的橫向跑酷玩法
    //
    //    玩法：角色自動向前跑（跑道捲動）。遇到寫著字根的障礙時，
    //          按下該字根對應的鍵就跳過去；按錯或撞上只是「減速」（不扣分、不扣命）。
    //          打完一個字的全部碼 = 過關一次，進入下一個字。
    //    計分：與站 1/4/7 完全相同 —— 把答對的字用 round 送出，後端零改動。
    //    狀態全部自成一組變數，不與其他機制共用。
    // =========================================================================

    // 障礙物「跑向角色」的節奏（毫秒／每像素單位）
    const RUN_OBSTACLE_STEP_MS = 16;         // 每格時間
    const RUN_OBSTACLE_SPEED = 1.15;         // 每格移動的像素（乘上速度倍率）
    const RUN_HERO_X = 76;                   // 角色固定位置（與 CSS 一致）
    const RUN_OBSTACLE_STOP_X = RUN_HERO_X + 46;   // 障礙停在角色前多遠
    const RUN_CRASH_SLOW_FACTOR = 0.45;      // 撞到後速度降到幾成
    const RUN_SPEED_RECOVER_PER_WORD = 0.18; // 每過一關回復多少速度
    const RUN_MAX_SPEED = 2.2;

    let runActive = false;
    let runWordList = [];        // 本場出題（連續流）
    let runQueue = [];           // 尚未出現的字
    let runIdx = 0;
    let runInputCodes = [];      // 已按對的碼
    let runWordReadyForSpace = false;
    let runHintTimer = null;
    let runTickTimer = null;     // 障礙推進的計時器
    let runSpeed = 1.0;          // 當前速度倍率（撞到會降、過關會回復）
    let runCorrectCount = 0;     // 過關字數
    let runCrashCount = 0;       // 撞到次數
    let runDistance = 0;         // 累積距離（米）
    let runRoundResults = [];    // 本場逐字結果，休息時集中送出
    let runObstacles = [];       // 畫面上的障礙 {el, x, code, key, cleared}
    let lastRunEarned = 0;
    let runAnimating = false;    // 動畫期間鎖住輸入，避免連按

    function runStorageKey() {
      if (!currentStudent) return '';
      return `p5_run_${currentStudent.cls}_${currentStudent.num}`;
    }

    // 取出跑酷模式的題庫
    function runPool() {
      const poolKey = MODE_REGISTRY.poolOf(currentGameMode);
      const pool = (poolKey && DATA[poolKey]) ? DATA[poolKey] : [];
      return Array.isArray(pool) ? pool : [];
    }

    // 補題：佇列空了就重洗續上（連續流）
    function nextRunWord() {
      if (runQueue.length === 0) {
        const pool = runPool();
        if (pool.length === 0) return null;
        runQueue = fisherYatesShuffle(prioritizeTodayChars(currentGameMode, pool.slice()));
      }
      return runQueue.pop() || null;
    }

    // 進入跑酷競技場
    function enterRunArena() {
      runWordList = [];
      runQueue = [];
      runIdx = 0;
      runInputCodes = [];
      runWordReadyForSpace = false;
      runActive = true;
      runSpeed = 1.0;
      runCorrectCount = 0;
      runCrashCount = 0;
      runDistance = 0;
      runRoundResults = [];
      runObstacles = [];
      runAnimating = false;

      const layer = document.getElementById('run-obstacle-layer');
      if (layer) layer.innerHTML = '';
      const flash = document.getElementById('run-round-flash');
      if (flash) flash.style.display = 'none';
      const stage = document.getElementById('run-stage');
      if (stage) stage.dataset.speed = 'normal';

      renderRunStats();
      loadRunWord();
    }

    // 離開跑酷競技場（只切換顯示，不結算）
    function returnToRunIntro() {
      runActive = false;
      runWordReadyForSpace = false;
      if (runHintTimer) { clearTimeout(runHintTimer); runHintTimer = null; }
      if (runTickTimer) { clearInterval(runTickTimer); runTickTimer = null; }
      window.removeEventListener('keydown', handleRunKeydown, true);
      setGameMode('connected');
    }

    // 載入一個新字：生成對應數量的障礙物
    function loadRunWord() {
      const word = nextRunWord();
      if (!word) {
        runSpeech('字庫空了…下次再來跑！');
        return;
      }
      runWordList.push(word);
      runIdx = runWordList.length - 1;
      runInputCodes = [];
      runWordReadyForSpace = false;
      runAnimating = false;

      // 清掉舊障礙，建立這一輪的障礙（每個碼一個）
      const layer = document.getElementById('run-obstacle-layer');
      if (layer) layer.innerHTML = '';
      runObstacles = [];

      const stage = document.getElementById('run-stage');
      const stageW = stage ? stage.clientWidth || 900 : 900;

      word.codes.forEach((code, idx) => {
        const el = document.createElement('div');
        el.className = 'run-obstacle';
        el.id = `run-obstacle-${idx}`;
        el.innerHTML = `
          <div class="run-obstacle-code">？</div>
          <div class="run-obstacle-key">第${idx + 1}碼</div>
        `;
        // 初始位置：依序排在畫面右側之外，第一個最靠近角色
        const startX = stageW + 40 + idx * 150;
        el.style.left = startX + 'px';
        if (layer) layer.appendChild(el);
        runObstacles.push({ el: el, x: startX, code: code, key: word.keys[idx], cleared: false, idx: idx });
      });

      // 只顯示第一個障礙的字根（其餘是「？」，製造逐步揭曉的節奏）
      refreshRunObstacleLabels();
      highlightRunObstacle(0);

      document.getElementById('run-target-char').textContent = word.char;
      document.getElementById('run-command-hint').innerHTML =
        `按對字根鍵，讓角色跳過【 ${word.char} 】的 ${word.codes.length} 個障礙！`;
      renderRunSlots();
      renderRunNextObstacle();
      renderRunStats();
      startRunHintTimer();
      startRunTick();
    }

    // 障礙只顯示「當前」那一個的答案，其餘顯示「？」
    function refreshRunObstacleLabels() {
      runObstacles.forEach((o, i) => {
        const codeEl = o.el.querySelector('.run-obstacle-code');
        const keyEl = o.el.querySelector('.run-obstacle-key');
        if (!codeEl || !keyEl) return;
        if (o.cleared) return;
        if (i === runInputCodes.length) {
          codeEl.textContent = o.code;
          keyEl.textContent = o.key;
        } else if (i > runInputCodes.length) {
          codeEl.textContent = '？';
          keyEl.textContent = `第${i + 1}碼`;
        }
      });
    }

    function highlightRunObstacle(idx) {
      runObstacles.forEach((o, i) => {
        if (!o.el) return;
        o.el.classList.toggle('active', i === idx && !o.cleared);
      });
    }

    function renderRunSlots() {
      const container = document.getElementById('run-obstacle-slots');
      if (!container) return;
      const word = runWordList[runIdx];
      if (!word) return;
      container.innerHTML = '';
      const neededIdx = runInputCodes.length;

      word.codes.forEach((code, idx) => {
        const slot = document.createElement('div');
        slot.id = `run-slot-${idx}`;
        slot.className = 'run-slot';

        if (idx < runInputCodes.length) {
          slot.classList.add('filled');
          slot.innerHTML = `
            <div class="run-slot-code">${runInputCodes[idx].code}</div>
            <div class="run-slot-sub">${runInputCodes[idx].key}</div>
          `;
        } else if (idx === neededIdx) {
          slot.classList.add('current');
          slot.innerHTML = `
            <div class="run-slot-code">？</div>
            <div class="run-slot-sub">第${idx + 1}碼</div>
          `;
        } else {
          slot.innerHTML = `
            <div class="run-slot-code">·</div>
            <div class="run-slot-sub">第${idx + 1}碼</div>
          `;
        }
        container.appendChild(slot);
      });
    }

    function renderRunNextObstacle() {
      const el = document.getElementById('run-next-key');
      if (!el) return;
      const word = runWordList[runIdx];
      if (!word) { el.textContent = '?'; return; }
      const neededIdx = runInputCodes.length;
      el.textContent = neededIdx < word.keys.length ? word.keys[neededIdx] : '—';
      el.style.background = neededIdx < word.keys.length ? '#166534' : '#16A34A';
    }

    function renderRunStats() {
      const dist = document.getElementById('run-distance-val');
      if (dist) dist.textContent = Math.round(runDistance);
      const wc = document.getElementById('run-word-count');
      if (wc) wc.textContent = runCorrectCount;
      const sp = document.getElementById('run-speed-val');
      if (sp) sp.textContent = runSpeed.toFixed(1);
      const cl = document.getElementById('run-cleared-count');
      if (cl) cl.textContent = runObstacles.filter(o => o.cleared).length;
      const cc = document.getElementById('run-correct-count');
      if (cc) cc.textContent = runCorrectCount;
      const cr = document.getElementById('run-crash-count');
      if (cr) cr.textContent = runCrashCount;

      // 跑道捲動速度隨 runSpeed 變化
      const stage = document.getElementById('run-stage');
      if (stage) {
        stage.dataset.speed = runSpeed > 1.4 ? 'fast' : (runSpeed < 0.8 ? 'slow' : 'normal');
      }
    }

    function runSpeech(text) {
      const el = document.getElementById('run-command-hint');
      if (el) el.textContent = text;
    }

    // 障礙推進：等速朝角色移動
    function startRunTick() {
      if (runTickTimer) clearInterval(runTickTimer);
      runTickTimer = setInterval(() => {
        if (!runActive) return;
        // 只有「當前」那個障礙會前進（其餘在畫面外等）
        const activeIdx = runInputCodes.length;
        const o = runObstacles[activeIdx];
        if (!o || o.cleared) return;

        o.x -= RUN_OBSTACLE_SPEED * runSpeed;
        if (o.x < RUN_OBSTACLE_STOP_X) o.x = RUN_OBSTACLE_STOP_X;   // 停在角色前
        o.el.style.left = o.x + 'px';

        if (!runAnimating) runDistance += 0.012 * runSpeed;
      }, RUN_OBSTACLE_STEP_MS);
    }

    function startRunHintTimer() {
      if (runHintTimer) { clearTimeout(runHintTimer); runHintTimer = null; }
      if (!runActive || runWordReadyForSpace) return;
      const word = runWordList[runIdx];
      const neededIdx = runInputCodes.length;
      if (!word || neededIdx >= word.codes.length) return;

      const hintEl = document.getElementById('run-command-hint');
      if (hintEl) {
        hintEl.innerHTML =
          `按對字根鍵，讓角色跳過【 ${word.char} 】的 ${word.codes.length} 個障礙！`;
      }

      runHintTimer = setTimeout(() => {
        if (!runActive || runAnimating) return;
        if (runInputCodes.length !== neededIdx) return;   // 已前進，提示作廢
        const slot = document.getElementById(`run-slot-${neededIdx}`);
        if (slot) {
          slot.classList.add('hint-glow');
          slot.innerHTML = `
            <div class="run-slot-code" style="color:#CA8A04;">${word.codes[neededIdx]}</div>
            <div class="run-slot-sub" style="color:#CA8A04;">${word.keys[neededIdx]}</div>
          `;
          if (hintEl) {
            hintEl.innerHTML =
              `💡 <strong style="color:#CA8A04;">提示：這個碼是【${word.codes[neededIdx]}】，按鍵 ${word.keys[neededIdx]}</strong>`;
          }
        }
      }, 3000);
    }

    // ⌨️ 跑酷鍵盤處理
    function handleRunKeydown(e) {
      if (MODE_REGISTRY.mechOf(currentGameMode) !== 'run') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (!runActive) return;
      if (runAnimating) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === ' ' || e.code === 'Space' || e.keyCode === 32) {
        e.preventDefault();
        e.stopPropagation();
        if (runWordReadyForSpace) confirmRunWordSpace();
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (runInputCodes.length > 0) {
          runInputCodes.pop();
          renderRunSlots();
          refreshRunObstacleLabels();
          highlightRunObstacle(runInputCodes.length);
          renderRunNextObstacle();
          startRunHintTimer();
        }
        return;
      }

      const keyUpper = e.key.toUpperCase();
      if (keyUpper.length === 1 && keyUpper >= 'A' && keyUpper <= 'Z') {
        e.preventDefault();
        e.stopPropagation();
        processRunKeyInput(keyUpper);
      }
    }

    function processRunKeyInput(pressedKey) {
      if (runAnimating || runWordReadyForSpace) return;
      const word = runWordList[runIdx];
      if (!word) return;

      const neededIdx = runInputCodes.length;
      const targetKey = word.keys[neededIdx];
      const targetCode = word.codes[neededIdx];

      if (pressedKey === targetKey) {
        runInputCodes.push({ key: pressedKey, code: targetCode });
        // 該障礙被「跳過」
        const o = runObstacles[neededIdx];
        if (o) {
          o.cleared = true;
          o.el.classList.remove('active');
          o.el.classList.add('cleared');
        }
        renderRunSlots();
        refreshRunObstacleLabels();
        renderRunStats();

        if (runInputCodes.length === word.keys.length) {
          // 全部跳過 → 過關
          runWordReadyForSpace = true;
          if (runHintTimer) { clearTimeout(runHintTimer); runHintTimer = null; }
          renderRunNextObstacle();
          runSpeech(`🎉 全部跳過！按【空白鍵】完成這一關 ➔`);
        } else {
          highlightRunObstacle(runInputCodes.length);
          renderRunNextObstacle();
          startRunHintTimer();
        }
      } else {
        // 按錯：撞到障礙，只是減速（不扣分、不扣命）
        runCrashCount++;
        runSpeed = Math.max(0.5, runSpeed * RUN_CRASH_SLOW_FACTOR);
        renderRunStats();

        const o = runObstacles[neededIdx];
        if (o) {
          o.el.classList.remove('hit');
          void o.el.offsetWidth;
          o.el.classList.add('hit');
        }
        const stage = document.getElementById('run-stage');
        if (stage) {
          stage.classList.remove('crash-flash');
          void stage.offsetWidth;
          stage.classList.add('crash-flash');
        }
        const hero = document.getElementById('run-hero');
        if (hero) {
          hero.classList.remove('crashed');
          void hero.offsetWidth;
          hero.classList.add('crashed');
        }
        const slot = document.getElementById(`run-slot-${neededIdx}`);
        if (slot) {
          slot.classList.add('shake-error');
          setTimeout(() => slot.classList.remove('shake-error'), 360);
        }
        runSpeech(`💥 撞到了！按【${targetCode}】的鍵 ${targetKey} 再試一次（只是變慢，不會扣分）`);
        startRunHintTimer();
      }
    }

    // 空白鍵：完成這一關（跳過所有障礙）
    function confirmRunWordSpace() {
      if (!runWordReadyForSpace || !runActive || runAnimating) return;
      const word = runWordList[runIdx];
      runWordReadyForSpace = false;
      runAnimating = true;

      runCorrectCount++;
      runDistance += 24;                                    // 過一關推進 24 米
      runSpeed = Math.min(RUN_MAX_SPEED, runSpeed + RUN_SPEED_RECOVER_PER_WORD);

      if (word) {
        runRoundResults.push({ char: word.char, correct: true, earned: 0 });
      }

      // 主角衝刺跳躍動畫
      const hero = document.getElementById('run-hero');
      if (hero) {
        hero.classList.add('jumping');
        setTimeout(() => hero.classList.remove('jumping'), 420);
      }

      // 過關提示
      const flash = document.getElementById('run-round-flash');
      const flashChar = document.getElementById('run-round-flash-char');
      const flashSub = document.getElementById('run-round-flash-sub');
      if (flashChar) flashChar.textContent = word ? word.char : '';
      if (flashSub) flashSub.textContent = '過關！繼續跑！';
      if (flash) flash.style.display = 'flex';

      renderRunStats();
      burstConfetti();

      setTimeout(() => {
        if (flash) flash.style.display = 'none';
        runAnimating = false;
        if (!runActive) return;
        loadRunWord();                                    // 下一關
      }, 900);
    }

    // 休息一下：把本場過關的字送出計分（走共用的 buildEarnedRound）
    function runRestAndSettle() {
      if (!runActive) return;
      const pool = runPool();
      const prefix = MODE_REGISTRY.prefixFor(currentGameMode, '');
      const view = MODE_REGISTRY.viewOf(currentGameMode);
      const { round, estimated } = buildEarnedRound(
        runRoundResults, pool, prefix, view.baseScore || 15);
      lastRunEarned = estimated;

      if (currentStudent && round.length > 0) {
        saveStudentStats(currentStudent.cls, currentStudent.num, 0, false, currentGameMode,
          Math.round(runCorrectCount), 10, '', round);
        loadStudentProfile();
      }
    }

    /* 公開給頁面按鈕用：休息一下（先結算再回主畫面） */
    function runRestHere() {
      runRestAndSettle();
      const preview = document.getElementById('run-earned-preview');
      if (preview) preview.textContent = '+' + lastRunEarned;
      returnToRunIntro();
    }

    // =========================================================================
    // 🧙 文字突圍：字靈倖存者引擎（siege 機制）——站 3 的法陣守衛戰
    //
    //    玩法：字靈從四面八方湧向中央符文法陣（canvas 戰場）。
    //          依序輸入該字的倉頡碼即可鎖定並攻擊；一個字必須「完整打完」
    //          才會擊破，中途按錯就中斷鎖定、該字重新拆解（完整打對才計分）。
    //    計分：與其他模式完全相同 —— 把擊破的字用 buildEarnedRound 送出，
    //          後端零改動。大招「天火破界」清場的字靈不計分（不是自己拆的碼）。
    //    狀態全部自成一組變數（siege 開頭），不與其他機制共用。
    // =========================================================================

    /* 倉頡 24 字母與代表字根：僅供底部速查欄顯示與按鍵回饋，不參與判定。 */
    const SIEGE_ALPHABET = [
      { key: 'A', root: '日' }, { key: 'B', root: '月' }, { key: 'C', root: '金' },
      { key: 'D', root: '木' }, { key: 'E', root: '水' }, { key: 'F', root: '火' },
      { key: 'G', root: '土' }, { key: 'H', root: '竹' }, { key: 'I', root: '戈' },
      { key: 'J', root: '十' }, { key: 'K', root: '大' }, { key: 'L', root: '中' },
      { key: 'M', root: '一' }, { key: 'N', root: '弓' }, { key: 'O', root: '人' },
      { key: 'P', root: '心' }, { key: 'Q', root: '手' }, { key: 'R', root: '口' },
      { key: 'S', root: '尸' }, { key: 'T', root: '廿' }, { key: 'U', root: '山' },
      { key: 'V', root: '女' }, { key: 'W', root: '田' }, { key: 'Y', root: '卜' }
    ];
    const SIEGE_MAX_HP = 100;
    const SIEGE_MAX_ENEMIES = 6;         // 同時最多幾隻，避免一次湧太多
    const SIEGE_BASE_SPAWN_MS = 3400;    // 起始出怪間隔
    const SIEGE_MIN_SPAWN_MS = 1300;     // 最快出怪間隔
    const SIEGE_WAVE_MS = 26000;         // 每一波的持續時間
    const SIEGE_HIT_DAMAGE = 12;         // 字靈撞到法陣的基礎傷害
    const SIEGE_ULT_PER_KILL = 10;       // 每次擊破累積的大招充能（％）
    /* 移動速度基準：原型的數值偏慢（實測要 20 秒以上才走到法陣），
       這裡乘上節奏係數，讓第一波約 12 秒抵達、後續波次逐步加快，
       對小學生才有「來得及拆碼、但也不能拖」的張力。 */
    const SIEGE_SPEED_PACE = 1.4;
    const SIEGE_CANVAS_BG = '#090D16';
    const SIEGE_GRID_COLOR = 'rgba(30, 41, 59, 0.45)';

    let siegeActive = false;
    let siegeState = 'READY';            // READY｜PLAYING｜UPGRADE｜OVER
    let siegeCtx = null;
    let siegeRafId = null;
    let siegeSize = { w: 0, h: 0 };
    let siegePlayer = null;
    let siegeEnemies = [], siegeParticles = [], siegeFloats = [], siegeBolts = [];
    let siegeWave = 1, siegeKills = 0, siegeElapsedMs = 0;
    let siegeTotalKeys = 0, siegeCorrectKeys = 0, siegeMissCount = 0;
    let siegeLastSpawnAt = 0, siegeSpawnInterval = SIEGE_BASE_SPAWN_MS, siegeWaveStartedAt = 0;
    let siegeActiveTarget = null;
    let siegePendingUpgrades = 0;
    let siegeRoundResults = [];
    let siegeLastEarned = 0;
    let siegeQueue = [];                 // 尚未出現的字（依波次過濾）
    let siegeAudioCtx = null;

    /* 音效：純 Web Audio 合成，無任何外部檔案（與其他模式一樣可離線用）。 */
    function siegeInitAudio() {
      try {
        if (!siegeAudioCtx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return;
          siegeAudioCtx = new Ctx();
        }
        if (siegeAudioCtx.state === 'suspended') siegeAudioCtx.resume();
      } catch (e) { /* 無音效環境照常可玩 */ }
    }

    function siegePlaySound(type) {
      if (!siegeAudioCtx) return;
      try {
        const t = siegeAudioCtx.currentTime;
        const osc = siegeAudioCtx.createOscillator();
        const gain = siegeAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(siegeAudioCtx.destination);
        if (type === 'hit') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(540, t);
          osc.frequency.exponentialRampToValueAtTime(880, t + 0.08);
          gain.gain.setValueAtTime(0.14, t);
          gain.gain.linearRampToValueAtTime(0.01, t + 0.08);
          osc.start(t); osc.stop(t + 0.08);
        } else if (type === 'kill') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(659, t);
          osc.frequency.exponentialRampToValueAtTime(1174, t + 0.16);
          gain.gain.setValueAtTime(0.18, t);
          gain.gain.linearRampToValueAtTime(0.001, t + 0.18);
          osc.start(t); osc.stop(t + 0.18);
        } else if (type === 'miss') {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(160, t);
          osc.frequency.linearRampToValueAtTime(110, t + 0.12);
          gain.gain.setValueAtTime(0.1, t);
          gain.gain.linearRampToValueAtTime(0.01, t + 0.12);
          osc.start(t); osc.stop(t + 0.12);
        } else if (type === 'ultimate') {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, t);
          osc.frequency.exponentialRampToValueAtTime(55, t + 0.5);
          gain.gain.setValueAtTime(0.28, t);
          gain.gain.linearRampToValueAtTime(0.001, t + 0.5);
          osc.start(t); osc.stop(t + 0.5);
        } else if (type === 'levelup') {
          [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
            const o = siegeAudioCtx.createOscillator();
            const g = siegeAudioCtx.createGain();
            o.connect(g); g.connect(siegeAudioCtx.destination);
            o.type = 'sine';
            o.frequency.setValueAtTime(freq, t + i * 0.06);
            g.gain.setValueAtTime(0.12, t + i * 0.06);
            g.gain.linearRampToValueAtTime(0.001, t + i * 0.06 + 0.25);
            o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.25);
          });
        }
      } catch (e) { /* 忽略音效錯誤 */ }
    }

    /* 題庫：站 3 的 abbrev_words（精簡／先繁後簡，45 字）。
       依碼數分三階，每階都夠多，佇列重洗才不會一直看到同幾個字。 */
    function siegePool() {
      const poolKey = MODE_REGISTRY.poolOf(currentGameMode);
      const pool = (poolKey && DATA[poolKey]) ? DATA[poolKey] : [];
      return Array.isArray(pool) ? pool : [];
    }

    /* 依碼數分三階：≤3 碼（入門）／4 碼（進階）／5 碼以上（菁英）。
       波次愈高，愈長的字才會出現（與原型的 tier 機制相同概念）。 */
    function siegeWordTier(word) {
      const len = (word && word.codes ? word.codes.length : 0);
      if (len >= 5) return 3;
      if (len === 4) return 2;
      return 1;
    }

    function siegeTierAllowed(tier) {
      if (siegeWave <= 1) return tier === 1;
      if (siegeWave === 2) return tier <= 2;
      return true;
    }

    /* 下一個要生成的字：佇列空了就重洗（今日未得分的字優先）。 */
    function nextSiegeWord() {
      if (siegeQueue.length === 0) {
        const pool = siegePool().filter(w => siegeTierAllowed(siegeWordTier(w)));
        if (pool.length === 0) {
          const all = siegePool();
          if (all.length === 0) return null;
          siegeQueue = fisherYatesShuffle(prioritizeTodayChars(currentGameMode, all.slice()));
        } else {
          siegeQueue = fisherYatesShuffle(prioritizeTodayChars(currentGameMode, pool));
        }
      }
      return siegeQueue.pop() || null;
    }

    /* 字靈：每隻身上帶著一個字的完整拆碼（keys 為英文字母，畫面上不顯示）。 */
    function siegeSpawnEnemy(now) {
      if (siegeEnemies.length >= SIEGE_MAX_ENEMIES) return;
      const word = nextSiegeWord();
      if (!word) return;

      const tier = siegeWordTier(word);
      const cx = siegeSize.w / 2, cy = siegeSize.h / 2;
      const angle = Math.random() * Math.PI * 2;
      const spawnDist = Math.hypot(siegeSize.w, siegeSize.h) / 2 + 70;
      const scale = Math.min(1.5, Math.max(0.9, Math.min(siegeSize.w, siegeSize.h) / 780));

      siegeEnemies.push({
        char: word.char,
        codes: word.codes.slice(),
        keys: word.keys.slice(),
        typedIndex: 0,
        tier: tier,
        x: cx + Math.cos(angle) * spawnDist,
        y: cy + Math.sin(angle) * spawnDist,
        speed: (0.55 + Math.min(siegeWave * 0.08, 0.65)) * SIEGE_SPEED_PACE
          * (tier === 3 ? 0.78 : 1) * scale,
        radius: 24 + tier * 6,
        hue: (word.keys[0].charCodeAt(0) * 47) % 360,
        floatOffset: Math.random() * Math.PI * 2,
        markedForDeath: false
      });
      siegeLastSpawnAt = now;
    }

    /* ── 進場／離場 ───────────────────────────────────────── */

    function renderSiegeRootsGrid() {
      const grid = document.getElementById('siege-roots-grid');
      if (!grid || grid.childElementCount > 0) return;
      SIEGE_ALPHABET.forEach(item => {
        const cap = document.createElement('div');
        cap.className = 'siege-keycap';
        cap.id = `siege-keycap-${item.key}`;
        cap.innerHTML =
          `<span class="siege-keycap-letter">${item.key}</span>`
          + `<span class="siege-keycap-root">${item.root}</span>`;
        // 點擊也能輸入（行動裝置／沒有實體鍵盤時可用），輸入後立刻交還焦點。
        cap.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          siegeInputKey(item.key);
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        });
        grid.appendChild(cap);
      });
    }

    function siegeFlashKeycap(keyChar, isCorrect) {
      const el = document.getElementById(`siege-keycap-${String(keyChar).toUpperCase()}`);
      if (!el) return;
      const cls = isCorrect ? 'siege-key-hit' : 'siege-key-miss';
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), 150);
    }

    /* 畫布尺寸：以容器實際大小為準（進場時容器才從 display:none 變可見，必須重算）。 */
    function siegeResize() {
      const canvas = document.getElementById('siege-canvas');
      const stage = document.getElementById('siege-stage');
      if (!canvas || !stage) return;
      const rect = stage.getBoundingClientRect();
      const w = Math.max(240, Math.round(rect.width));
      const h = Math.max(200, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      siegeSize = { w: w, h: h };
      siegeCtx = canvas.getContext('2d');
      if (siegeCtx) siegeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (siegePlayer) { siegePlayer.x = w / 2; siegePlayer.y = h / 2; }
    }

    function siegeSetOverlay(id, show) {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? 'flex' : 'none';
    }

    function enterSiegeArena() {
      siegeActive = true;
      siegeState = 'READY';
      siegeEnemies = []; siegeParticles = []; siegeFloats = []; siegeBolts = [];
      siegeActiveTarget = null;
      siegePendingUpgrades = 0;
      siegeRoundResults = [];
      siegeLastEarned = 0;
      siegeWave = 1; siegeKills = 0; siegeElapsedMs = 0;
      siegeTotalKeys = 0; siegeCorrectKeys = 0; siegeMissCount = 0;
      siegeSpawnInterval = SIEGE_BASE_SPAWN_MS;
      siegeQueue = [];
      siegePlayer = {
        x: 0, y: 0, radius: 30, hp: SIEGE_MAX_HP, maxHp: SIEGE_MAX_HP,
        angle: 0, ultimate: 0, level: 1, exp: 0, expToNext: 120,
        freezeAura: false, shieldActive: false, chainZap: false, ultBonus: 1
      };

      renderSiegeRootsGrid();
      siegeSetOverlay('siege-ready-overlay', true);
      siegeSetOverlay('siege-upgrade-overlay', false);
      siegeSetOverlay('siege-over-overlay', false);
      siegeResize();
      siegeRenderHud();

      // 準備畫面也把戰場畫出來（靜態星陣），進場就有畫面而不是黑板
      if (siegeRafId) cancelAnimationFrame(siegeRafId);
      siegeLoop.lastAt = 0;
      siegeRafId = requestAnimationFrame(siegeLoop);
    }

    /* 正式開戰：重置本場數據、隱藏準備畫面、開始出怪。 */
    function siegeStartGame() {
      if (!siegeActive) return;
      siegeInitAudio();
      siegePlaySound('levelup');

      siegeState = 'PLAYING';
      siegeEnemies = []; siegeParticles = []; siegeFloats = []; siegeBolts = [];
      siegeActiveTarget = null;
      siegePendingUpgrades = 0;
      siegeRoundResults = [];
      siegeLastEarned = 0;
      siegeWave = 1; siegeKills = 0; siegeElapsedMs = 0;
      siegeTotalKeys = 0; siegeCorrectKeys = 0; siegeMissCount = 0;
      siegeSpawnInterval = SIEGE_BASE_SPAWN_MS;
      siegeQueue = [];
      const now = performance.now();
      siegeWaveStartedAt = now;
      siegeLastSpawnAt = now;
      if (siegePlayer) {
        siegePlayer.hp = siegePlayer.maxHp;
        siegePlayer.ultimate = 0;
        siegePlayer.level = 1;
        siegePlayer.exp = 0;
        siegePlayer.expToNext = 120;
        siegePlayer.freezeAura = false;
        siegePlayer.shieldActive = false;
        siegePlayer.chainZap = false;
        siegePlayer.ultBonus = 1;
        siegePlayer.angle = 0;
      }

      siegeSetOverlay('siege-ready-overlay', false);
      siegeSetOverlay('siege-upgrade-overlay', false);
      siegeSetOverlay('siege-over-overlay', false);
      siegeRenderHud();
    }

    /* 離開法陣（只切換顯示，不結算）——公開給按鈕以外的流程用。 */
    function returnToSiegeIntro() {
      siegeState = 'READY';
      setGameMode('connected');
    }

    /* ── 鍵盤輸入 ─────────────────────────────────────────── */

    function siegeHandleKeydown(e) {
      if (!siegeActive) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (siegeState === 'READY') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          siegeStartGame();
        }
        return;
      }
      if (siegeState === 'OVER') {
        if (e.key === 'Enter') {
          e.preventDefault();
          siegeSettleAndReturn();
        }
        return;
      }
      if (siegeState === 'UPGRADE') {
        // 升級中：可用 1／2 直接選祝福（也能用滑鼠點卡片）
        if (e.key === '1' || e.key === '2') {
          const cards = document.querySelectorAll('#siege-upgrade-options .siege-upgrade-card');
          const card = cards[Number(e.key) - 1];
          if (card) { e.preventDefault(); card.click(); }
        }
        return;
      }

      // PLAYING
      if (e.key === ' ') {
        e.preventDefault();
        siegeCastUltimate();
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        siegeInputKey(e.key.toUpperCase());
      }
    }

    /* 一次按鍵的完整判定：
       1) 有鎖定目標 → 核對下一碼；按錯就中斷鎖定並重置該字。
       2) 沒有鎖定 → 找「首碼相符且離法陣最近」的字靈咬上去。
       3) 都沒中 → 記一次失誤（不扣血，只影響精準度）。 */
    function siegeInputKey(key) {
      if (!siegeActive || siegeState !== 'PLAYING') return;
      const upper = String(key || '').toUpperCase();
      if (!/^[A-Z]$/.test(upper)) return;

      siegeTotalKeys++;
      let matched = false;

      if (siegeActiveTarget && !siegeActiveTarget.markedForDeath) {
        const expected = siegeActiveTarget.keys[siegeActiveTarget.typedIndex];
        if (expected === upper) {
          matched = true;
          siegeApplyHit(siegeActiveTarget);
        } else {
          const failed = siegeActiveTarget;
          failed.typedIndex = 0;
          siegeActiveTarget = null;
          siegeMissCount++;
          siegeFlashKeycap(upper, false);
          siegePlaySound('miss');
          siegeAddFloat('拆碼錯誤，重來！', failed.x, failed.y - 30, '#F43F5E');
          siegeBurst(failed.x, failed.y, '#F43F5E', 10);
          siegeRenderHud();
          return;
        }
      }

      if (!matched) {
        let candidate = null, minDist = Infinity;
        siegeEnemies.forEach(enemy => {
          if (enemy.markedForDeath) return;
          if (enemy.typedIndex !== 0) return;
          if (enemy.keys[0] !== upper) return;
          const d = Math.hypot(enemy.x - siegeSize.w / 2, enemy.y - siegeSize.h / 2);
          if (d < minDist) { minDist = d; candidate = enemy; }
        });
        if (candidate) {
          matched = true;
          siegeActiveTarget = candidate;
          siegeApplyHit(candidate);
        }
      }

      if (matched) {
        siegeCorrectKeys++;
        siegeFlashKeycap(upper, true);
        siegePlaySound('hit');
      } else {
        siegeMissCount++;
        siegeFlashKeycap(upper, false);
        siegePlaySound('miss');
        siegeAddFloat('無此首碼', siegeSize.w / 2, siegeSize.h / 2 - 45, '#F43F5E');
      }
      siegeRenderHud();
    }

    /* 命中一碼：發射法球、推進拆碼進度；打完最後一碼就擊破。 */
    function siegeApplyHit(enemy) {
      siegeBolts.push({ x: siegeSize.w / 2, y: siegeSize.h / 2, target: enemy, reached: false });
      if (siegePlayer) siegePlayer.angle = Math.atan2(enemy.y - siegeSize.h / 2, enemy.x - siegeSize.w / 2);
      enemy.typedIndex++;
      if (enemy.typedIndex >= enemy.keys.length) {
        siegeDefeatEnemy(enemy);
      }
    }

    /* 擊破：記入本場計分名單（完整打對才計分）、充能大招、給經驗。 */
    function siegeDefeatEnemy(enemy) {
      enemy.markedForDeath = true;
      siegeKills++;
      siegeBurst(enemy.x, enemy.y, '#38BDF8', 26);
      siegePlaySound('kill');
      if (siegeActiveTarget === enemy) siegeActiveTarget = null;
      // 立即從場上移除（動畫由粒子負責；留在陣列會讓「同時幾隻」的判斷慢一拍）
      const at = siegeEnemies.indexOf(enemy);
      if (at >= 0) siegeEnemies.splice(at, 1);

      if (siegePlayer) {
        siegePlayer.ultimate = Math.min(100, siegePlayer.ultimate + SIEGE_ULT_PER_KILL * siegePlayer.ultBonus);
        if (siegePlayer.chainZap) {
          siegeEnemies.forEach(other => {
            if (other === enemy || other.markedForDeath) return;
            if (Math.hypot(other.x - enemy.x, other.y - enemy.y) < 180) {
              other.typedIndex = Math.min(other.keys.length, other.typedIndex + 1);
              siegeBurst(other.x, other.y, '#A855F7', 8);
              if (other.typedIndex >= other.keys.length) { other.markedForDeath = true; siegeKills++; siegeBurst(other.x, other.y, '#38BDF8', 20); }
            }
          });
        }
      }

      siegeRoundResults.push({ char: enemy.char });
      const preview = siegePreviewEarned();
      siegeLastEarned = preview.estimated;
      const latest = preview.round.find(r => r.char === enemy.char);
      const got = latest ? Number(latest.earned) || 0 : 0;
      siegeAddFloat(got > 0 ? `擊破！+${got} 分` : '擊破！（今天已練滿，不計分）', enemy.x, enemy.y - 24, got > 0 ? '#34D399' : '#94A3B8');

      siegeGainExp((enemy.tier || 1) * 10);
      siegeRenderHud();
    }

    /* 這一批逐字結果的即時預估（與結算完全同一套規則，所見即所得）。 */
    function siegePreviewEarned() {
      const pool = siegePool();
      const prefix = MODE_REGISTRY.prefixFor(currentGameMode, '');
      const view = MODE_REGISTRY.viewOf(currentGameMode);
      return buildEarnedRound(siegeRoundResults, pool, prefix, view.baseScore || 15);
    }

    function siegeDamagePlayer(dmg) {
      if (!siegePlayer) return;
      if (siegePlayer.shieldActive) {
        siegePlayer.shieldActive = false;
        siegeAddFloat('護盾抵擋！', siegeSize.w / 2, siegeSize.h / 2 - 30, '#38BDF8');
        siegeRenderHud();
        return;
      }
      siegePlayer.hp = Math.max(0, siegePlayer.hp - dmg);
      siegeRenderHud();
      if (siegePlayer.hp <= 0) siegeGameOver();
    }

    /* ── 修為（等級）與祝福（升級選項） ─────────────────── */

    function siegeGainExp(amount) {
      if (!siegePlayer || siegeState !== 'PLAYING') return;
      siegePlayer.exp += amount;
      while (siegePlayer.exp >= siegePlayer.expToNext) {
        siegePlayer.exp -= siegePlayer.expToNext;
        siegePlayer.level++;
        siegePlayer.expToNext = Math.round(siegePlayer.expToNext * 1.35 + 25);
        siegePendingUpgrades++;
      }
      if (siegePendingUpgrades > 0 && siegeState === 'PLAYING') siegeShowUpgrade();
    }

    const SIEGE_UPGRADE_POOL = [
      {
        icon: '❄️', title: '雪魄冰霜靈氣',
        desc: '靠近中央法陣的字靈移動速度減緩 45%，爭取更多拆碼時間。',
        apply: () => { if (siegePlayer) siegePlayer.freezeAura = true; }
      },
      {
        icon: '🛡️', title: '天玄神念護盾',
        desc: '立刻獲得一面守護盾，可免疫下一次字靈衝擊！',
        apply: () => { if (siegePlayer) siegePlayer.shieldActive = true; }
      },
      {
        icon: '⚡', title: '倉頡筆墨連環',
        desc: '擊破字靈時釋放雷電震波，助攻周圍字靈一碼。',
        apply: () => { if (siegePlayer) siegePlayer.chainZap = true; }
      },
      {
        icon: '💖', title: '靈泉補給祝禱',
        desc: '立刻恢復 45 點生命值，並提高生命上限 20 點。',
        apply: () => {
          if (!siegePlayer) return;
          siegePlayer.maxHp += 20;
          siegePlayer.hp = Math.min(siegePlayer.maxHp, siegePlayer.hp + 45);
        }
      },
      {
        icon: '🔥', title: '乾坤聚靈符印',
        desc: '天火破界（大招）的充能速度提高 50%！',
        apply: () => { if (siegePlayer) siegePlayer.ultBonus = 1.5; }
      }
    ];

    function siegeShowUpgrade() {
      siegeState = 'UPGRADE';
      siegePlaySound('levelup');
      const title = document.getElementById('siege-upgrade-title');
      if (title) title.textContent = `修為晉升至 Lv.${siegePlayer ? siegePlayer.level : 1}！請選擇古籍祝福：`;
      const box = document.getElementById('siege-upgrade-options');
      if (box) {
        box.innerHTML = '';
        const picks = SIEGE_UPGRADE_POOL.slice().sort(() => 0.5 - Math.random()).slice(0, 2);
        picks.forEach(card => {
          const el = document.createElement('div');
          el.className = 'siege-upgrade-card';
          el.innerHTML =
            `<div class="siege-upgrade-icon">${card.icon}</div>`
            + `<div><div class="siege-upgrade-name">${card.title}</div>`
            + `<div class="siege-upgrade-desc">${card.desc}</div></div>`;
          el.addEventListener('click', () => {
            card.apply();
            siegePendingUpgrades--;
            if (siegePendingUpgrades > 0) {
              siegeShowUpgrade();
            } else {
              siegeSetOverlay('siege-upgrade-overlay', false);
              siegeState = 'PLAYING';
              siegeRenderHud();
            }
          });
          box.appendChild(el);
        });
      }
      siegeSetOverlay('siege-upgrade-overlay', true);
    }

    /* ── 大招：天火破界（清場，但清掉的不列入計分） ──────── */

    function siegeCastUltimate() {
      if (!siegeActive || siegeState !== 'PLAYING' || !siegePlayer) return;
      if (siegePlayer.ultimate < 100) return;
      siegePlayer.ultimate = 0;
      siegePlaySound('ultimate');
      siegeEnemies.forEach(enemy => {
        siegeBurst(enemy.x, enemy.y, '#FBBF24', 30);
        enemy.markedForDeath = true;
        siegeKills++;
      });
      siegeActiveTarget = null;
      siegeAddFloat('天火焚盡！全屏破陣！', siegeSize.w / 2, siegeSize.h / 2 - 60, '#F59E0B');
      siegeRenderHud();
    }

    /* ── 特效小工具 ──────────────────────────────────────── */

    function siegeBurst(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, sp = Math.random() * 4 + 1;
        siegeParticles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          radius: Math.random() * 3 + 2, color, alpha: 1,
          decay: Math.random() * 0.03 + 0.02
        });
      }
    }

    function siegeAddFloat(text, x, y, color) {
      siegeFloats.push({ text, x, y, vy: -1.2, alpha: 1, color: color || '#38BDF8' });
    }

    /* ── 主循環與繪圖 ────────────────────────────────────── */

    function siegeDrawFrame(dt, playing) {
      const ctx = siegeCtx;
      if (!ctx) return;
      const w = siegeSize.w, h = siegeSize.h;
      const cx = w / 2, cy = h / 2;
      const t = performance.now();
      const scale60 = Math.min(2.5, dt * 60);   // 以 60fps 為基準的倍率

      // 背景：夜空＋星陣網格
      ctx.fillStyle = SIEGE_CANVAS_BG;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = SIEGE_GRID_COLOR;
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      // 中央符文法陣（兩圈，內圈虛線緩慢旋轉）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.arc(0, 0, 75, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -(t / 40) % 14;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(0, 0, 128, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.18)';
      ctx.stroke();
      ctx.restore();

      // 玩家（法師）：護盾光環＋朝向指針
      const p = siegePlayer;
      if (p) {
        ctx.save();
        ctx.translate(cx, cy);
        if (p.shieldActive) {
          ctx.beginPath();
          ctx.arc(0, 0, p.radius + 14, 0, Math.PI * 2);
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#38BDF8';
          ctx.shadowBlur = 15;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#1E1B4B';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#818CF8';
        ctx.stroke();

        ctx.rotate(p.angle);
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(p.radius + 10, 0);
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.rotate(-p.angle);

        ctx.font = '22px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🧙', 0, 2);
        ctx.restore();
      }

      // 魔法法球
      for (let i = siegeBolts.length - 1; i >= 0; i--) {
        const bolt = siegeBolts[i];
        if (!bolt.target || bolt.target.markedForDeath && bolt.target.typedIndex >= bolt.target.keys.length) {
          bolt.reached = true;
        }
        if (bolt.target) {
          const dx = bolt.target.x - bolt.x, dy = bolt.target.y - bolt.y;
          const dist = Math.hypot(dx, dy);
          const step = 18 * scale60;
          if (dist < step + 10) { bolt.x = bolt.target.x; bolt.y = bolt.target.y; bolt.reached = true; }
          else { bolt.x += (dx / dist) * step; bolt.y += (dy / dist) * step; }
        }
        ctx.save();
        ctx.beginPath();
        ctx.arc(bolt.x, bolt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#38BDF8';
        ctx.shadowColor = '#00F2FE';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bolt.x, bolt.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.restore();
        if (bolt.reached) siegeBolts.splice(i, 1);
      }

      // 字靈：更新＋繪製
      for (let i = siegeEnemies.length - 1; i >= 0; i--) {
        const enemy = siegeEnemies[i];
        if (playing && !enemy.markedForDeath) {
          const dx = cx - enemy.x, dy = cy - enemy.y;
          const dist = Math.hypot(dx, dy) || 1;
          let sp = enemy.speed;
          if (p && p.freezeAura && dist < 260) sp *= 0.55;
          if (dist > (p ? p.radius : 30) + 10) {
            enemy.x += (dx / dist) * sp * scale60;
            enemy.y += (dy / dist) * sp * scale60;
          } else {
            siegeBurst(enemy.x, enemy.y, '#F43F5E', 24);
            siegePlaySound('miss');
            enemy.markedForDeath = true;
            siegeDamagePlayer(SIEGE_HIT_DAMAGE + siegeWave * 2);
          }
          enemy.floatOffset += 0.06 * scale60;
        }
        if (!enemy.markedForDeath) {
          ctx.save();
          ctx.translate(enemy.x, enemy.y + Math.sin(enemy.floatOffset) * 4);
          const targeted = siegeActiveTarget === enemy;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius + (targeted ? 8 : 2), 0, Math.PI * 2);
          ctx.fillStyle = targeted ? 'rgba(56, 189, 248, 0.35)' : `hsla(${enemy.hue}, 80%, 50%, 0.18)`;
          ctx.fill();
          ctx.lineWidth = targeted ? 3 : 1.5;
          ctx.strokeStyle = targeted ? '#38BDF8' : `hsla(${enemy.hue}, 90%, 65%, 0.8)`;
          ctx.stroke();

          ctx.font = `bold ${Math.round(enemy.radius * 1.1)}px "PingFang TC","Microsoft JhengHei","微軟正黑體",sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#FFFFFF';
          ctx.shadowColor = `hsla(${enemy.hue}, 100%, 70%, 0.8)`;
          ctx.shadowBlur = 10;
          ctx.fillText(enemy.char, 0, -2);
          ctx.shadowBlur = 0;

          // 拆碼進度：菱形符文晶石（不顯示英文字母，只顯示碼數與進度）
          const slotY = enemy.radius + 13;
          const slotSize = 10, gap = 6;
          const totalW = enemy.keys.length * slotSize + (enemy.keys.length - 1) * gap;
          let sx = -totalW / 2 + slotSize / 2;
          for (let k = 0; k < enemy.keys.length; k++) {
            ctx.save();
            ctx.translate(sx, slotY);
            ctx.rotate(Math.PI / 4);
            if (k < enemy.typedIndex) {
              ctx.fillStyle = '#10B981';
              ctx.shadowColor = '#34D399';
              ctx.shadowBlur = 8;
              ctx.fillRect(-slotSize / 2, -slotSize / 2, slotSize, slotSize);
            } else if (k === enemy.typedIndex) {
              ctx.fillStyle = '#38BDF8';
              ctx.shadowColor = '#00F2FE';
              ctx.shadowBlur = 10;
              ctx.fillRect(-slotSize / 2, -slotSize / 2, slotSize, slotSize);
            } else {
              ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
              ctx.strokeStyle = '#475569';
              ctx.lineWidth = 1.5;
              ctx.fillRect(-slotSize / 2, -slotSize / 2, slotSize, slotSize);
              ctx.strokeRect(-slotSize / 2, -slotSize / 2, slotSize, slotSize);
            }
            ctx.restore();
            sx += slotSize + gap;
          }
          ctx.restore();
        }
        if (enemy.markedForDeath) siegeEnemies.splice(i, 1);
      }

      // 粒子
      for (let i = siegeParticles.length - 1; i >= 0; i--) {
        const par = siegeParticles[i];
        par.x += par.vx * scale60;
        par.y += par.vy * scale60;
        par.alpha -= par.decay * scale60;
        if (par.alpha <= 0) { siegeParticles.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(par.x, par.y, par.radius, 0, Math.PI * 2);
        ctx.fillStyle = par.color;
        ctx.globalAlpha = par.alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 漂浮文字
      for (let i = siegeFloats.length - 1; i >= 0; i--) {
        const ft = siegeFloats[i];
        ft.y += ft.vy * scale60;
        ft.alpha -= 0.02 * scale60;
        if (ft.alpha <= 0) { siegeFloats.splice(i, 1); continue; }
        ctx.save();
        ctx.font = 'bold 15px "PingFang TC","Microsoft JhengHei","微軟正黑體",sans-serif';
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = ft.alpha;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }
    }

    function siegeLoop() {
      if (!siegeActive) return;
      const now = performance.now();
      if (!siegeLoop.lastAt) siegeLoop.lastAt = now;
      const dt = Math.min(0.05, Math.max(0, (now - siegeLoop.lastAt) / 1000));
      siegeLoop.lastAt = now;

      if (siegeState === 'PLAYING') {
        siegeElapsedMs += dt * 1000;
        // 波次推進
        if (now - siegeWaveStartedAt > SIEGE_WAVE_MS) {
          siegeWave++;
          siegeWaveStartedAt = now;
          siegeSpawnInterval = Math.max(SIEGE_MIN_SPAWN_MS, siegeSpawnInterval - 220);
          siegeQueue = [];   // 讓新波次解鎖的長碼字盡快出現
          siegeAddFloat(`第 ${siegeWave} 波強勢字靈降臨！`, siegeSize.w / 2, siegeSize.h / 2 - 90, '#FACC15');
        }
        if (now - siegeLastSpawnAt > siegeSpawnInterval) siegeSpawnEnemy(now);
      }

      siegeDrawFrame(dt, siegeState === 'PLAYING');
      if (siegeState === 'PLAYING' || siegeEnemies.length || siegeParticles.length || siegeFloats.length) {
        siegeRenderHud();
      }
      siegeRafId = requestAnimationFrame(siegeLoop);
    }

    function siegeRenderHud() {
      const p = siegePlayer;
      const hpText = document.getElementById('siege-hp-text');
      const hpFill = document.getElementById('siege-hp-fill');
      if (p) {
        if (hpText) hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
        if (hpFill) {
          const pct = Math.max(0, (p.hp / p.maxHp) * 100);
          hpFill.style.width = pct + '%';
          hpFill.classList.toggle('siege-hp-low', pct <= 40);
        }
      }
      const waveEl = document.getElementById('siege-wave-val');
      if (waveEl) waveEl.textContent = siegeWave;
      const timeEl = document.getElementById('siege-time-val');
      if (timeEl) {
        const secs = Math.floor(siegeElapsedMs / 1000);
        timeEl.textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
      }
      const levelEl = document.getElementById('siege-level-val');
      if (levelEl && p) levelEl.textContent = 'Lv.' + p.level;
      const expFill = document.getElementById('siege-exp-fill');
      if (expFill && p) expFill.style.width = Math.min(100, Math.max(0, (p.exp / p.expToNext) * 100)) + '%';

      const scoreEl = document.getElementById('siege-score-val');
      if (scoreEl) scoreEl.textContent = '+' + siegeLastEarned;

      const chargeEl = document.getElementById('siege-ult-charge');
      const ultBtn = document.getElementById('siege-ult-btn');
      if (p) {
        if (chargeEl) chargeEl.textContent = `(${Math.floor(p.ultimate)}%)`;
        if (ultBtn) ultBtn.disabled = p.ultimate < 100 || siegeState !== 'PLAYING';
      }

      const killEl = document.getElementById('siege-kill-count');
      if (killEl) killEl.textContent = siegeKills;
      const accEl = document.getElementById('siege-accuracy-val');
      const acc = siegeTotalKeys > 0 ? Math.round((siegeCorrectKeys / siegeTotalKeys) * 100) : 100;
      if (accEl) accEl.textContent = acc + '%';
      const missEl = document.getElementById('siege-miss-count');
      if (missEl) missEl.textContent = siegeMissCount;
    }

    /* ── 結束與結算 ──────────────────────────────────────── */

    function siegeGameOver() {
      if (siegeState === 'OVER') return;
      siegeState = 'OVER';
      siegeActiveTarget = null;
      siegePlaySound('miss');

      // 立即結算：把本場擊破的字送出計分（死亡不會沒收已學到的成果）。
      siegeSubmitResults();

      const title = document.getElementById('siege-over-title');
      if (title) {
        title.textContent = `法陣失守！共守住 ${siegeWave} 波、擊破 ${siegeKills} 隻字靈`;
      }
      const waveEl = document.getElementById('siege-final-wave');
      if (waveEl) waveEl.textContent = siegeWave;
      const killsEl = document.getElementById('siege-final-kills');
      if (killsEl) killsEl.textContent = siegeKills;
      const earnedEl = document.getElementById('siege-final-earned');
      if (earnedEl) earnedEl.textContent = '+' + siegeLastEarned;
      const acc = siegeTotalKeys > 0 ? Math.round((siegeCorrectKeys / siegeTotalKeys) * 100) : 100;
      const accEl = document.getElementById('siege-final-accuracy');
      if (accEl) accEl.textContent = acc + '%';

      siegeSetOverlay('siege-over-overlay', true);
      siegeRenderHud();
      burstConfetti();
    }

    /* 送出一批擊破結果（走共用的 buildEarnedRound）。
       回傳本次預估得分；重複呼叫不會重複送出（送完就清空）。 */
    function siegeSubmitResults() {
      if (!siegeActive && siegeRoundResults.length === 0) return siegeLastEarned;
      if (siegeRoundResults.length === 0) return siegeLastEarned;
      const pool = siegePool();
      const prefix = MODE_REGISTRY.prefixFor(currentGameMode, '');
      const view = MODE_REGISTRY.viewOf(currentGameMode);
      const { round, estimated } = buildEarnedRound(
        siegeRoundResults, pool, prefix, view.baseScore || 15);
      siegeRoundResults = [];
      siegeLastEarned = estimated;

      if (currentStudent && round.length > 0) {
        const acc = siegeTotalKeys > 0 ? Math.round((siegeCorrectKeys / siegeTotalKeys) * 100) : 0;
        saveStudentStats(currentStudent.cls, currentStudent.num, 0, false, currentGameMode,
          acc, 10, '', round);
        loadStudentProfile();
      }
      return estimated;
    }

    /* 結算畫面按鈕：回主畫面（結算已在陣破時完成）。 */
    function siegeSettleAndReturn() {
      siegeSubmitResults();
      returnToSiegeIntro();
    }

    /* 公開給頁面按鈕用：先休息一下（先結算再回主畫面）。 */
    function siegeRestHere() {
      siegeSubmitResults();
      const preview = document.getElementById('siege-earned-preview');
      if (preview) preview.textContent = '+' + siegeLastEarned;
      returnToSiegeIntro();
    }

    // =========================================================================
    // 🏆 排行榜雙軌切換：討伐累積總分榜 vs 獨立手速天梯榜 (題量/周次/秒數升序)
    // =========================================================================
    function switchLeaderboardType(type) {
      currentLeaderboardType = type;
      document.querySelectorAll('.lb-sub-nav-btn').forEach(b => {
        b.classList.toggle('active', (type === 'score' && b.id === 'lb-type-score') || (type === 'speed' && b.id === 'lb-type-speed'));
      });
      
      const subFilters = document.getElementById('speed-lb-sub-filters');
      if (subFilters) {
        subFilters.style.display = (type === 'speed') ? 'block' : 'none';
        const select = document.getElementById('speed-lb-week-select');
        if (select && speedLeaderboardWeek) {
          select.value = speedLeaderboardWeek;
        }
      }

      const modalTitle = document.getElementById('lb-modal-main-title');
      if (modalTitle) {
        modalTitle.textContent = (type === 'speed') ? '⚡ 五年級寶可夢倉頡手速天梯榜' : '🏆 五年級寶可夢倉頡討伐龍虎榜';
      }

      renderLeaderboardTable();
    }

    // 周次子篩選器 (支援切換全部周次或指定周次功課)
    function filterSpeedLeaderboardWeek(weekKey) {
      speedLeaderboardWeek = weekKey;
      const select = document.getElementById('speed-lb-week-select');
      if (select && select.value !== weekKey) {
        select.value = weekKey;
      }
      renderSpeedLeaderboardTable();
    }

    // 獨立手速天梯榜渲染函數 (秒數升序 ASC · 擊鍵準確率二次加權罰時已計入)
    function renderSpeedLeaderboardTable() {
      // 1. 替換表頭為純10字秒數制各項指標 (11欄)
      const thead = document.querySelector('#modal-leaderboard thead tr');
      if (thead) {
        thead.innerHTML = `
          <th>排名</th>
          <th>班別</th>
          <th>學號</th>
          <th>訓練家代號</th>
          <th>周次功課</th>
          <th style="color:#0284C7;">⏱️ 10字等效耗時 (秒)</th>
          <th>原始碼表耗時</th>
          <th>擊鍵準確率</th>
          <th>準確率加權罰時</th>
          <th>等效中文字速</th>
          <th>手速段位</th>
        `;
      }

      const scoreLabel = document.getElementById('lb-my-score-label');
      const rankLabel = document.getElementById('lb-my-rank-label');
      if (scoreLabel) scoreLabel.textContent = '10字等效總耗時';
      if (rankLabel) rankLabel.textContent = (currentLeaderboardFilter === 'ALL') ? '全級手速名次' : '班內手速名次';

      const bankObj = (typeof MODE2_WEEKLY_BANKS === 'object' && MODE2_WEEKLY_BANKS) ? MODE2_WEEKLY_BANKS[speedLeaderboardWeek] : null;
      const wkTitle = bankObj ? bankObj.title : (speedLeaderboardWeek === 'ALL' ? '全部周次 (生涯最佳)' : speedLeaderboardWeek);

      const allSpeedMap = {};

      // 1. 初始化全級名冊 (預設全部未參賽，不入榜)
      if (DATA.benchmark_leaderboard && Array.isArray(DATA.benchmark_leaderboard)) {
        DATA.benchmark_leaderboard.forEach(item => {
          let hasRec = false;
          let timeVal = 9999.0;

          if (item.weekly_speed && typeof item.weekly_speed[speedLeaderboardWeek] === 'number' && item.weekly_speed[speedLeaderboardWeek] > 0) {
            timeVal = Number(item.weekly_speed[speedLeaderboardWeek]);
            hasRec = true;
          } else if (speedLeaderboardWeek === 'ALL') {
            let best = 9999.0;
            if (typeof item.best10 === 'number' && item.best10 > 0 && item.best10 < 900) {
              best = item.best10;
            }
            if (item.weekly_speed && typeof item.weekly_speed === 'object') {
              Object.values(item.weekly_speed).forEach(v => {
                const numV = Number(v);
                if (!isNaN(numV) && numV > 0 && numV < best) {
                  best = numV;
                }
              });
            }
            if (best < 900) {
              timeVal = best;
              hasRec = true;
            }
          }

          const cpmVal = (hasRec && timeVal > 0) ? Math.round(10 / (timeVal / 60)) : 0;
          const tierVal = hasRec ? getSpeedTier(timeVal, 10) : '--';

          allSpeedMap[`${item.cls}_${item.num}`] = {
            cls: item.cls,
            num: item.num,
            name: item.name || `${item.cls} ${(item.num < 10 ? '0' : '') + item.num}號`,
            bestTime: timeVal,
            rawTime: timeVal,
            cpm: cpmVal,
            accuracy: 100,
            accPenalty: 0,
            tier: tierVal,
            weekKey: speedLeaderboardWeek,
            hasRecord: hasRec
          };
        });
      }

      // 2. 從本地 SafeStorage 讀取該周次功課之真實手速紀錄 (優先採用本機最新最佳)
      const allKeys = SafeStorage.getAllKeys ? SafeStorage.getAllKeys() : [];
      allKeys.forEach(key => {
        if (key.startsWith('p5_speed_')) {
          const parts = key.replace('p5_speed_', '').split('_');
          const cls = String(parts[0] || '').trim().toUpperCase();
          const num = parseInt(parts[1], 10);
          if (!cls || isNaN(num) || num < 1 || num > 36) return;
          const recWc = parts[2] ? parseInt(parts[2], 10) : 10;
          const recWk = parts.slice(3).join('_') || 'w6_hw1';

          if (recWc !== 10) return; // 五年級鎖定純10字
          if (speedLeaderboardWeek !== 'ALL' && recWk !== speedLeaderboardWeek) return;

          try {
            const parsed = JSON.parse(SafeStorage.getItem(key));
            if (parsed && typeof parsed.bestTime === 'number' && parsed.bestTime > 0 && parsed.bestTime < 900) {
              const mapKey = `${cls}_${num}`;
              const time = parsed.bestTime;
              const raw = (typeof parsed.rawTime === 'number') ? parsed.rawTime : time;
              const acc = (typeof parsed.accuracy === 'number') ? parsed.accuracy : 100;
              const cpm = parsed.cpm || Math.round(10 / (time / 60));
              const penalty = parsed.accPenalty || 0;
              const tier = parsed.tier || getSpeedTier(time, 10);

              if (!allSpeedMap[mapKey] || !allSpeedMap[mapKey].hasRecord || allSpeedMap[mapKey].bestTime > time) {
                allSpeedMap[mapKey] = {
                  cls, num,
                  name: `${cls} ${(num < 10 ? '0' : '') + num}號`,
                  bestTime: time,
                  rawTime: raw,
                  cpm: cpm,
                  accuracy: acc,
                  accPenalty: penalty,
                  tier: tier,
                  weekKey: recWk,
                  hasRecord: true
                };
              }
            }
          } catch(e) {}
        }
      });

      // 3. 從雲端即時手速榜合併跨電腦成績
      if (DATA.cloud_speed_records) {
        let cloudList = [];
        if (Array.isArray(DATA.cloud_speed_records)) {
          cloudList = DATA.cloud_speed_records;
        } else if (DATA.cloud_speed_records[speedLeaderboardWeek]) {
          cloudList = DATA.cloud_speed_records[speedLeaderboardWeek];
        } else if (speedLeaderboardWeek === 'ALL' && DATA.cloud_speed_records['overall']) {
          cloudList = DATA.cloud_speed_records['overall'];
        }

        cloudList.forEach(cs => {
          const mapKey = `${cs.cls}_${cs.num}`;
          const time = cs.bestTime || cs.best10;
          if (time && typeof time === 'number' && time > 0 && time < 900) {
            const curEntry = allSpeedMap[mapKey];
            if (!curEntry || !curEntry.hasRecord || curEntry.bestTime > time) {
              const cpm = cs.cpm || Math.round(10 / (time / 60));
              allSpeedMap[mapKey] = {
                cls: cs.cls,
                num: cs.num,
                name: cs.name || `${cs.cls} ${(cs.num < 10 ? '0' : '') + cs.num}號`,
                bestTime: time,
                rawTime: cs.rawTime || time,
                cpm: cpm,
                accuracy: cs.accuracy || 100,
                accPenalty: cs.accPenalty || 0,
                tier: cs.tier || getSpeedTier(time, 10),
                weekKey: speedLeaderboardWeek,
                hasRecord: true
              };
            }
          }
        });
      }

      // 4. 嚴格過濾：未參與本項手速遊戲者直接不入榜！
      const speedList = Object.values(allSpeedMap).filter(s => s.hasRecord && typeof s.bestTime === 'number' && s.bestTime < 900);
      speedList.sort((a, b) => {
        if (a.bestTime !== b.bestTime) return a.bestTime - b.bestTime;
        return b.accuracy - a.accuracy;
      });
      speedList.forEach((item, idx) => item.overallRank = idx + 1);

      // 分班計算班內名次 (僅限有成績者)
      const classGroups = {};
      ['P5A', 'P5B', 'P5C', 'P5D', 'P5E', 'P5F'].forEach(c => {
        classGroups[c] = speedList.filter(s => s.cls === c);
        classGroups[c].forEach((item, idx) => item.classRank = idx + 1);
      });

      // 5. 更新頂部我的個人戰報 (防呆容錯，杜絕 NaN 與 toFixed TypeError)
      if (currentStudent) {
        const myKey = `${currentStudent.cls}_${currentStudent.num}`;
        const myEntry = allSpeedMap[myKey];
        const myNameEl = document.getElementById('lb-my-name');
        if (myNameEl) myNameEl.textContent = `${currentStudent.cls} ${(currentStudent.num < 10 ? '0' : '') + currentStudent.num}號`;

        const myTitleEl = document.getElementById('lb-my-title');
        const myScoreEl = document.getElementById('lb-my-score');
        const myBadgeEl = document.getElementById('lb-my-badge');
        const myRankEl = document.getElementById('lb-my-rank');

        if (myEntry && myEntry.hasRecord && typeof myEntry.bestTime === 'number' && myEntry.bestTime < 900) {
          const displayCpm = myEntry.cpm || Math.round(10 / (myEntry.bestTime / 60));
          if (myTitleEl) myTitleEl.textContent = `分類：10字賽 · ${wkTitle} ｜ 字速：${displayCpm} 字/分`;
          if (myScoreEl) myScoreEl.textContent = `${myEntry.bestTime.toFixed(2)} 秒 (準確率 ${myEntry.accuracy || 100}%)`;
          if (myBadgeEl) myBadgeEl.textContent = '⚡';
          if (myRankEl) {
            if (currentLeaderboardFilter === "ALL") {
              myRankEl.innerHTML = `<span style="color:#B45309;font-weight:900;">全級手速第 ${myEntry.overallRank} 名 (共 ${speedList.length} 人上榜)</span>`;
            } else {
              const classTotal = (classGroups[currentLeaderboardFilter] || []).length;
              myRankEl.innerHTML = `<span style="color:#2563EB;font-weight:900;">${currentLeaderboardFilter} 班內手速第 ${myEntry.classRank} 名 (共 ${classTotal} 人上榜)</span>`;
            }
          }
        } else {
          if (myTitleEl) myTitleEl.textContent = `分類：10字賽 · ${wkTitle}`;
          if (myScoreEl) myScoreEl.textContent = '-- 秒';
          if (myBadgeEl) myBadgeEl.textContent = '⏱️';
          if (myRankEl) myRankEl.innerHTML = '<span style="color:#64748B;">未參加本周次手速挑戰 (未入榜)</span>';
        }
      }

      // 6. 渲染表格 (11欄)
      const isClassFilter = currentLeaderboardFilter !== 'ALL';
      const displayList = isClassFilter ? (classGroups[currentLeaderboardFilter] || []) : speedList;

      const tbody = document.getElementById('leaderboard-tbody');
      if (!tbody) return;

      if (displayList.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="11" style="padding: 26px; text-align: center; color: #64748B; font-weight: 800; font-size: 13.5px;">
              ⚡ 該組分類 (10字賽 · ${escapeMode2Text(wkTitle)}) 尚無同學完成，快成為第一位手速神手！
            </td>
          </tr>
        `;
        return;
      }

      let rowsHtml = displayList.map(s => {
        const rankNum = isClassFilter ? s.classRank : s.overallRank;
        let medal = `${rankNum}`;
        if (rankNum === 1) medal = '🥇 1';
        else if (rankNum === 2) medal = '🥈 2';
        else if (rankNum === 3) medal = '🥉 3';

        const isMe = currentStudent && s.cls === currentStudent.cls && s.num === currentStudent.num;
        const rowBank = (typeof MODE2_WEEKLY_BANKS === 'object' && MODE2_WEEKLY_BANKS) ? MODE2_WEEKLY_BANKS[s.weekKey || speedLeaderboardWeek] : null;
        const rowWkTitle = rowBank ? rowBank.title : (s.weekKey === 'ALL' || speedLeaderboardWeek === 'ALL' ? '生涯最佳' : (s.weekKey || speedLeaderboardWeek));
        const tierName = (typeof s.tier === 'object' && s.tier) ? (s.tier.name || s.tier.badge || '--') : String(s.tier || '--');

        return `
          <tr style="${isMe ? 'background: #EFF6FF; font-weight: bold; border-left: 4px solid #2563EB;' : ''}">
            <td style="padding: 8px 6px; text-align: center; font-weight: 900; color: ${rankNum <= 3 ? '#B45309' : '#1E293B'};"><span class="emoji-icon">${medal}</span></td>
            <td style="padding: 8px 6px; text-align: center;"><span class="st-poke-tag" style="background:#DBEAFE;color:#1E40AF;font-weight:800;">${s.cls}</span></td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 700;">${(s.num < 10 ? '0' : '') + s.num}號</td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 800;">${s.name} ${isMe ? '⭐(我)' : ''}</td>
            <td style="padding: 8px 6px; text-align: center;"><span style="color:#2563EB;font-weight:800;font-size:12px;">${escapeMode2Text(rowWkTitle)}</span></td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 900; color: #0284C7; font-size: 14.5px;">⏱️ ${typeof s.bestTime === 'number' ? s.bestTime.toFixed(2) : s.bestTime}s</td>
            <td style="padding: 8px 6px; text-align: center; color: #64748B; font-size: 12px;">${typeof s.rawTime === 'number' ? s.rawTime.toFixed(2) : s.rawTime}s</td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 800; color: ${s.accuracy >= 95 ? '#059669' : '#DC2626'};"><span class="emoji-icon">${s.accuracy}%</span></td>
            <td style="padding: 8px 6px; text-align: center; color: #DC2626; font-size: 11.5px;">+${(s.accPenalty || 0).toFixed(2)}s</td>
            <td style="padding: 8px 6px; text-align: center; font-weight: 800; color: #D97706;">${s.cpm} 字/分</td>
            <td style="padding: 8px 6px; text-align: center;"><span class="speed-tier-badge">${tierName}</span></td>
          </tr>
        `;
      }).join('');
      tbody.innerHTML = rowsHtml;
    }

    // 頁面載入時依日期自動初始化手速字庫下拉選單與排行榜篩選器，並檢查離線補送隊列
    window.addEventListener('DOMContentLoaded', () => {
      try { renderModeTabs(); } catch(e) { console.error('renderModeTabs error:', e); }
      initSpeedWeekDropdown();
      flushPendingUploads();
      fetchCloudLeaderboard(true);
    });

    // 📡 監聽網路連線恢復事件 (當校園網路重新連通時自動補送成績)
    window.addEventListener('online', () => {
      console.log('📡 偵測到網路已重新連通，自動補發離線成績...');
      flushPendingUploads();
    });
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      try { renderModeTabs(); } catch(e) {}
      try { initSpeedWeekDropdown(); } catch(e) {}
    }
