# 防刷分掌握進度實作計畫（第 5 版）

執行：本機逐項完成，不提交、不部署。
規格：docs/ANTI_FARM_DESIGN.md（**第 4 版**，含壓力控制、同步問題、更新與修復機制）。
技術：原生 JavaScript、Apps Script、Node 內建測試，無新增套件。
TDD：每個任務先寫失敗測試，再實作，看它轉綠。

**分兩階段：先模式一／三，完成後再做模式二。壓力控制措施貫穿兩階段。**

**已查證的 Apps Script 硬限制**：單次執行 6 分鐘、每使用者同時執行 30 個、
Properties 讀寫 50,000/天、觸發器總執行時間 90 分鐘/天、每指令碼觸發器上限 20 個、
總容量按 500 KB 保守設計。

**更新與修復策略（第 4 版）**：交卷即時寫入為常態；另加**每天清晨 06:00 定時重建**兜底；
保留教師手動選單。定時刻意排在清晨，避開與學生交卷搶同一把指令碼鎖。

## 進度（2026-10-12）

| 任務 | 狀態 | 產出 |
|---|---|---|
| 0A 每日掌握核心模組 | ✅ 完成 | `js/mastery-core.js`、`apps-script/MasteryCore.gs`、`tests/mastery-core.test.cjs`（20 項） |
| 0B 去重子集化 | ✅ 完成 | `hasRequestId_` 只掃最近 500 筆 |
| 0H 排行榜快取策略 | ✅ 完成 | `DATA_CACHE_SECONDS` 60；`doPost` 不再清除快取 |
| 0I 鎖定專案時區 | ✅ 完成 | `apps-script/appsscript.json` |
| 0J 紀錄新增得分字欄 | ✅ 完成 | `LOG_HEADERS` 13 欄（含第 13 欄「完成時間」）；`ensureSheet_` 自動補欄；`tests/score-backend.test.cjs`（12 項） |
| 0C 排行榜改讀彙總表 | ✅ 完成 | `readData_` 只讀總覽；新增總覽第 11 欄「週次最佳秒數」；`tests/leaderboard-summary.test.cjs`（12 項，含新舊逐欄比對） |
| 0F 雙層儲存與容量監控 | ✅ 完成 | 抽屜壓縮格式定案（283 字元／生，210 生約 60 KB）；`apps-script/MasteryStore.gs`；`tests/mastery-drawer.test.cjs`＋`tests/mastery-store.test.cjs`（16 項） |
| 0D 鎖範圍縮小 | ✅ 完成 | `handleSubmit_` 拆三步：紀錄＋去重（鎖外）→ 抽屜讀寫（鎖內）→ 總覽寫入（鎖外）；`tests/lock-scope.test.cjs`（5 項） |
| 0G 補寫機制與時間戳驗證 | ✅ 完成 | `writeMasterySheet_`、`rebuildMasteryDrawers`、`reconcileMastery`、`parseCompletedAt_`（24 小時／未來時戳）；`tests/mastery-backfill.test.cjs`（9 項） |
| 0K 每天 06:00 定時重建 | ✅ 完成 | `nightlyRebuild`（冪等）、`setupTriggers`（先清後建）；`ScriptApp` mock；`tests/nightly-rebuild.test.cjs`（6 項） |
| 0L 教師選單擴充 | ✅ 完成 | 選單五項（更新成績總覽／掌握進度／比對補寫／重建抽屜／顯示系統狀態）；`tests/teacher-menu.test.cjs`（7 項） |
| 0E 前端退避重試＋佇列 | ✅ 完成 | 新增 `js/upload-queue.js`（純邏輯）；`sendReliableWebhook` 改指數退避 1/2/4/8/16s 最多 5 次；佇列上限 200 並回報丟棄筆數；`completedAt` 完成時間戳；`tests/upload-queue.test.cjs`（10 項） |
| 1–14 功能實作 | ✅ 完成 | 兩階段全部完成（見下表） |

**第一階段（模式一／三）完成**：
| 任務 | 狀態 | 產出 |
|---|---|---|
| 1 每日掌握邏輯模組 | ✅ 完成 | `buildRound`、`summarizeRound` 加入 `mastery-core.js`＋`MasteryCore.gs` |
| 2 掌握邏輯失敗測試 | ✅ 完成 | `tests/mastery-core.test.cjs` 由 20 → 28 項 |
| 3 出題改今日未得分優先 | ✅ 完成 | `getNextQuiz` 呼叫 `prioritizeTodayChars`；模式二不受影響 |
| 4 一輪集中提交 | ✅ 完成 | `pendingRoundResults` 累積，`nextRound` 呼叫 `submitRoundResults` 一次送出 |
| 5 後端每日掌握判斷 | ✅ 完成 | `handleSubmit_` 改三步：去重（鎖外）→ 抽屜判斷（鎖內）→ 寫紀錄與總覽（鎖外）；`finalScore` 由後端決定 |
| 6 後端邏輯測試 | ✅ 完成 | `tests/mastery-backend.test.cjs`（11 → 22 項） |
| 7 進度顯示與 +0 提示 | ✅ 完成 | 結算卡新增「今日掌握 n / N 字」；已得分字顯示「這模式得分已到上限」 |

**第二階段（模式二）完成**：
| 任務 | 狀態 | 產出 |
|---|---|---|
| 8 模式二加分核心邏輯 | ✅ 完成 | `speedRoundScore`（沿用現行公式）、`speedRoundEarned`（逐字分攤，防整場重刷）；掌握鍵 `w7_hw1:字` |
| 9 模式二結算加計分數 | ✅ 完成 | `buildSpeedRound`（純函式）＋ `saveStudentStats` 新增 `round` 參數；秒數天梯欄位原樣上傳 |
| 10 後端模式二每日首答判斷 | ✅ 完成 | `aggregateLog_`／`updateSummaryStudent_` 的 `modeField` 補上 `speed → mode2Score` |
| 11 模式二後端測試 | ✅ 完成 | `tests/mastery-backend.test.cjs` 新增 11 項（週次隔離、超過一跳、部分首答） |
| 12 模式二畫面顯示 | ✅ 完成 | 結算卡新增「本場討伐得分」欄；`tests/speed-scoring.test.cjs`（19 項） |
| 13 更新既有測試與文件 | ✅ 完成 | 更新 `score-backend.test.cjs` 為 13 欄；`IMPLEMENTATION_CHECKLIST.md`；`docs/ANTI_FARM_VERIFICATION.md` |
| 14 重建驗證（冪等性） | ✅ 完成 | `tests/nightly-rebuild.test.cjs` 由 6 → 13 項（含模式二、跨午夜、舊格式列） |

測試基線：`node --test tests/*.test.cjs` → **197 項全數通過**

**兩階段全部完成。** 後端三檔已在正式部署驗證通過（匿名 POST 回 200、寫入成功）；
第二階段之後的 `Code.gs` 變更（模式二計分、13 欄紀錄、週次鍵修正）**尚未重新部署**。

---

# 第零階段：壓力控制基礎（先行）

## 任務 0A：唯一時間來源與香港日期工具

- 新增 `js/mastery-core.js` 的 `hkDate(now)`，統一香港時區日期。
- 避免前後端各自實作時區而分歧。
- 驗證：`node --test`；含 UTC 邊界（香港 00:00）測試。

## 任務 0B：請求去重子集化（P3）

- 修改 `apps-script/Code.gs` 的 `hasRequestId_()`：
  只掃最近 500 筆，不掃全表。
- 驗證：`node --check`；邏輯測試。

## 任務 0C：排行榜改讀彙總表（P4）✅ 已完成

- 修改 `apps-script/Code.gs`：`readData_()` 改為只讀「成績總覽」每生一行，不掃「遊戲紀錄」。
- 重構為四段，令新舊兩條路徑共用同一段輸出邏輯（這是可逐欄比對的前提）：
  - `aggregateLog_()`：掃描原始紀錄彙總（只供重建及退化回退使用）。
  - `buildLeaderboard_()`：由學生＋手速紀錄組成排行榜輸出。
  - `readDataFromLog_()`：舊演算法路徑（退化回退及比對基準）。
  - `readData_()`：一般路徑，只讀總覽；總覽為空時退回 `readDataFromLog_()`。
- **實作時發現的必要前置**：「成績總覽」原本沒有手速週榜所需的每週最佳秒數，
  若直接改讀總覽，`speedByWeek` 及前端 `weekly_speed` 會全部失效。
  → 總覽新增第 11 欄**「週次最佳秒數」**（格式 `w7:35.5;w9:40`），
  由 `updateSummaryStudent_` 增量維護、由 `writeSummary_` 重建，`ensureSheet_` 為既有表自動補欄。
- **一併修掉既有缺陷**：`updateSummaryStudent_` 失敗改為標記 `SUMMARY_DIRTY` 後仍回成功。
  排行榜改以總覽為來源後，這個偏差必須被發現，不能讓學生重試卻永遠拿不到補寫。
- 驗證：`tests/leaderboard-summary.test.cjs`（12 項），
  含「重建後」及「交卷增量後」兩種情境下的**新舊逐欄完全一致**比對，
  另斷言 `readData_()` 執行期間 `aggregateLog_()` 呼叫次數為 0（確實不再掃全表）。
- **取捨（必須留意）**：排行榜的正確性由「即時掃描」改為「依賴總覽完整性」。
  總覽偏差不再自動消失，須靠 `nightlyRebuild()`（0K）及教師選單（0L）修正。
  已用 `SUMMARY_DIRTY` 標記使偏差顯性化。

## 任務 0D：鎖範圍縮小（P1）

- 修改 `doPost()`：LockService **只包「讀抽屜 → 判斷 → 寫抽屜」**，
  Sheet 寫入、驗證、快取失效移出鎖外（解法 3）。
- 驗證：`node --check`；以 mock 確認持鎖時間約 50ms。

## 任務 0E：前端退避重試 + 佇列 + 完成時間戳（P6 / S3）

- 修改 `js/app.js` 的 `sendReliableWebhook()`：
  - 失敗自動退避重試（1s、2s、4s…上限），資料存本機佇列。
  - **記錄遊戲完成時間戳**，隨佇列保留，供離線補送判斷歸屬日期。
- 驗證：`node --check`；單元測試模擬失敗重試及時間戳保留。

## 任務 0F：雙層儲存與容量監控（P2 / S1）✅ 已完成

- 抽屜壓縮格式定案：`v1|YYYY-MM-DD|模式一字|模式三字|週次:字,週次:字`
  （日期只存一次；模式二按週分組共用前綴）。編解碼在 `js/mastery-core.js`
  的 `serializeDrawer`／`parseDrawer`，後端副本 `apps-script/MasteryCore.gs` 同步。
- **容量實測**：最壞情況（模式一 31＋模式三 37＋模式二四組各 42 字）
  壓縮後每生 283 字元、210 生約 60 KB；未壓縮則約 921 KB 超標 → 壓縮是必要條件。
- 新增 `apps-script/MasteryStore.gs`：
  - `read`（鎖內用）、`writeDrawer`（鎖內，容量錯誤只回報不拋錯）、
    `writeSheet`（鎖外盡力，失敗只回報）、`usage()`（教師選單用）。
  - Sheet 行定位與成績總覽一致（每生固定一行，P5A1=第 2 行 … P5F36=第 217 行）。
  - `validKey` 收緊：含 `|` `,` `;` `:` 的字元一律非法，杜絕撐破儲存格式。
- 驗證：`tests/mastery-drawer.test.cjs`（9 項，含容量實測與分隔符拒絕）、
  `tests/mastery-store.test.cjs`（7 項，含容量錯誤及 Sheet 故障路徑）。

## 任務 0G：補寫機制與時間戳驗證（S1 / S3 / S6）

- 修改 `apps-script/Code.gs`：
  - `onOpen` 選單新增「比對並補寫掌握進度」：比對抽屜與 Sheet，補齊差異。
  - `validate_()` 驗證前端完成時間戳：不得為未來、不得超過 24 小時；
    逾期記錄為「逾期」供教師處理，不靜默丟棄。
- 驗證：`node --check`；mock 測試補寫與時間戳邊界。

## 任務 0H：排行榜快取策略（S4）

- 修改 `apps-script/Code.gs`：排行榜快取 60 秒（現行 `DATA_CACHE_SECONDS = 30`，一併調整），
  **交卷不強制清快取**（移除 `doPost` 內的 `clearDataCache_()` 呼叫）。
- 快取 key 含學年。
- 驗證：`node --check`；確認交卷路徑不再呼叫 `clearDataCache_()`。

## 任務 0I：鎖定專案時區（前置必要）

- 新增 `apps-script/appsscript.json`：
  ```json
  { "timeZone": "Asia/Hong_Kong", "runtimeVersion": "V8", "exceptionLogging": "STACKDRIVER" }
  ```
- 現時專案內無此檔，時區未鎖定；「每天午夜重置」必須依此檔才可靠。
- 同時確認 Apps Script 專案設定頁的時區為 (GMT+08:00) 香港時間。
- 驗證：檔案存在且 JSON 合法（`node -e "JSON.parse(...)"`）。

## 任務 0J：「遊戲紀錄」新增「本次得分字」欄位

- 修改 `apps-script/Code.gs` 的 `LOG_HEADERS`：由 11 欄增為 12 欄，
  新增「本次得分字」（該次提交中實際計分的字，模式二含週次前綴）。
- `appendRow` 同步補上該欄；`readData_()` 讀取範圍隨 `LOG_HEADERS.length` 自動調整。
- **舊資料列該欄為空**：重建時視為「無資料」而非「未得分」，
  以 `docs/ANTI_FARM_DESIGN.md` 的相容規則處理，不得因此改動歷史分數。
- 驗證：`node --check`；mock 測試新舊格式並存。

## 任務 0K：每天 06:00 定時重建（兜底）

- 新增 `apps-script/Code.gs` 的 `nightlyRebuild()`：
  由「遊戲紀錄」重建「成績總覽」及「掌握進度」，並重建 Script Properties 抽屜。
  **函式必須冪等**：重複執行結果一致。
- 以 `ScriptApp.newTrigger('nightlyRebuild').timeBased().atHour(6).everyDays(1)` 建立觸發器；
  另提供 `setupTriggers()` 作單一來源，避免重複建立。
- **本機階段不建立實際觸發器**：只實作及測試 `nightlyRebuild()` 可獨立執行且冪等。
- 失敗時 Google 會電郵通知擁有者；函式內另加 try/catch 記錄錯誤。
- 驗證：mock 測試冪等性；`node --check`。

## 任務 0L：教師選單擴充

- 修改 `apps-script/Code.gs` 的 `onOpen`：新增
  「更新掌握進度」→ 重建「掌握進度」表、
  「重建進度抽屜」→ 由「掌握進度」重建 Script Properties 抽屜。
- 保留既有「更新成績總覽」。
- 驗證：`node --check`；確認函式名與選單對應正確。

---

# 第一階段：模式一及模式三

## 任務 1：每日掌握邏輯模組（純函式）

- 擴充 `js/mastery-core.js`，匯出：
  - `parseDaily(str)` → Map<字, 日期>
  - `serializeDaily(map, today)` → 只保留今天的字
  - `pickNextChars(pool, dailyMap, today, need)` → 今日未得分優先
  - `applyRound(results, dailyMap, today)` → { earned, newlyScored, ignored, map }
- 驗證：`node --test tests/mastery-core.test.cjs` 全綠。

## 任務 2：掌握邏輯失敗測試

- 新增 `tests/mastery-core.test.cjs`：
  - 同日首次答對計分；同日第二次同字加 0
  - 跨日後同字可再得分（日期變更即失效）
  - 一輪內同字重複答對只算一次
  - 未得分字優先出題；不足時以已得分字補足
  - 當天全部字已得分後回傳全部字（複習模式）
  - 空字串、空題庫、字串含重複字、香港 00:00 時區邊界
  - **序列化只保留今天，舊日期不累積（容量安全）**
- 驗證：先紅 → 任務 1 後轉綠。

## 任務 3：模式一／三出題改為今日未得分優先

- 修改 `js/app.js` 的 `getNextQuiz()`：抽出題目前先過濾「今日未得分」的字。
- **不動模式二（split / speed）出題路徑。**
- 驗證：`node --check js/app.js`；新增出題測試。

## 任務 4：模式一／三一輪集中提交（P5）

- 修改 `js/app.js`：模式一／三移除逐題 `saveStudentStats()` 加分；
  一輪 5 題結束時組 `round` 陣列送出一次。
- 保留 `requestId` 不變。
- **模式二提交路徑不動。**
- 驗證：`node --check`；模擬一輪 5 題的單元測試。

## 任務 5：後端每日掌握判斷（含雙層寫入）

- 修改 `apps-script/Code.gs`：
  - `validate_()` 接受 `round` 陣列（向後相容：未帶時走舊路徑）
  - `doPost` 加入每日掌握判斷、requestId 去重（配合任務 0B）
  - 掌握判斷走 Script Properties，Sheet 同步寫
- 驗證：`node --check`；邏輯以任務 6 測試。

## 任務 6：後端邏輯測試（mock）

- 新增 `tests/mastery-backend.test.cjs`：假 Sheet + 假 Properties。
  - 同日重複 requestId 不重複計分
  - 同日已得分字不加分
  - 跨日可再得分
  - 抽屜遺失時可由 Sheet 重建
  - 容量異常時只寫 Sheet 不阻斷
  - 舊格式請求相容
- 驗證：`node --test` 全綠。

## 任務 7：進度顯示與 +0 提示

- 修改 `index.html`、`js/app.js`：
  - 「模式一：今日 n / 31」、「模式三：今日 n / 37」
  - 今日已得分字答對顯示「這模式得分已到上限」
- 驗證：`node --check`；Playwright 測試。

---

# 第二階段：模式二加分（保留秒數天梯）

## 任務 8：模式二加分核心邏輯

- 擴充 `js/mastery-core.js`：
  - `speedRoundScore(effectiveFinalTime, wordCount)` → 沿用現成公式（`Math.max(20, Math.round(150 - t*2))`，20 字 ×1.8）
  - 掌握鍵加入週次／功課：`speed:{weekKey}:{char}`
- 驗證：`node --test tests/mastery-core.test.cjs`；含公式邊界測試。

## 任務 9：模式二結算時加計分數

- 修改 `js/app.js` 的 `onSpeedMatchComplete()`：
  - 現行第 2731 行 `saveStudentStats(..., 0, false, 'speed', ...)` 改為帶實際分數
  - 同時保留 `bestTime` 上傳（秒數天梯不受影響）
  - 逐字組 `round` 陣列送出每日首答判斷
- **秒數天梯顯示、週次隔離、CPM、段位全部不動。**
- 驗證：`node --check js/app.js`；單元測試確認秒數欄位與計分欄位同時正確。

## 任務 10：後端模式二每日首答判斷

- 修改 `apps-script/Code.gs`：
  - `mode === 'speed'` 支援 `round` 與每日首答
  - `readData_()` 將模式二分數計入 `grandTotal` 及 `mode2Score`
  - 秒數彙總（`speedByWeek`、`overall`、`best`）**維持不變**
- 驗證：`node --check`；任務 11 測試。

## 任務 11：模式二後端測試（mock）

- 擴充 `tests/mastery-backend.test.cjs`：
  - 模式二同日重複答對同字加 0
  - 不同週次同字各自可得分
  - 秒數天梯資料仍正確寫入且彙總不變
  - 模式二分數正確計入總分
- 驗證：`node --test` 全綠。

## 任務 12：模式二畫面顯示

- 修改 `index.html`、`js/app.js`：結算卡顯示本場獲得的分數；已得分字提示。
- 驗證：`node --check`；Playwright。

---

# 收尾（兩階段共用）

## 任務 13：更新既有測試與文件

- 更新 `tests/word-bank*.test.cjs` 若受影響。
- 更新 `IMPLEMENTATION_CHECKLIST.md` 標明第 4 版修訂。
- 新增 `docs/ANTI_FARM_VERIFICATION.md` 記錄實測結果。
- 驗證：完整 `node --test` 全綠；`git diff --check` 乾淨。

## 任務 14：重建驗證（冪等性）

- 以虛構紀錄集重建「成績總覽」及「掌握進度」，與增量更新結果比對，須一致。
- 重複執行重建，結果須相同。
- 涵蓋「遊戲紀錄」含舊格式列（無「本次得分字」欄）的情境。
- 驗證：`node --test` 全綠。

## 完成條件

- 全部 Node 測試通過，瀏覽器測試通過。
- 秒數天梯與現行完全一致；模式一至三皆有每日首答加分。
- **壓力控制有效**：36 人同時交卷不撞 30 併發上限；排行榜不掃原始紀錄；
  抽屜容量按 500 KB 設計且有監控；退避重試不丟分。
- **更新與修復有效**：交卷即時更新；`nightlyRebuild()` 冪等且與增量結果一致；
  教師選單函式可獨立執行；`appsscript.json` 已鎖定 `Asia/Hong_Kong`。
- 虛構資料；未寫入正式接口；**本機階段未建立實際定時觸發器**。
- 未 Commit、未 Push、未部署。
