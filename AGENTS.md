# Codex 專案開發規範

## 適用範圍與優先原則

本檔適用於 P5 倉頡打字遊戲（現行 Repository：`ekeong2026/P5-cangjie-master`；舊 `ekeong2026/P5_typing-game` 只作保留）的開發、Debug、測試及 GitHub 同步。以程式品質、功能穩定、學生資料安全及合理節省用量為優先。使用者當次明確指示優先；同時參閱 `README.md`、`SOP.md` 及相關子目錄規則。不要把臨時任務狀態寫入本檔。

## 專案實際架構

- 原生靜態 HTML／CSS／JavaScript，沒有框架建構流程。
- `index.html`：頁面、登入選單及腳本載入版本。
- `js/config.js`：Apps Script 接口、隱私模式、遊戲設定及排程。
- `js/app.js`：登入、遊戲、計分、排行榜、統計及雲端同步。
- `js/data.js`、`js/cangjie.js`：初始化資料、字庫及倉頡碼。
- `js/word-bank-core.js`、`js/word-bank.js`：模式二雲端字庫的驗證與載入邏輯。
- `css/style.css`：樣式。
- `apps-script/Code.gs`：帳號 A 的成績 Apps Script 後端；實際部署版本須另行核對。
- `apps-script/word-bank/Code.gs`、`WordBankCore.gs`：帳號 B 的唯讀字庫 Apps Script 後端。
- `migration/mode2/`：模式二舊字庫匯出 CSV 及筆數核對清單。
- `tests/*.test.cjs`：Node 內建測試；`tests/browser-word-bank.cjs`：Playwright 瀏覽器測試。
- `docs/`：字庫設計、安裝操作及本機驗證記錄；`docs/superpowers/plans/`：實作計畫。
- `.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/weekly-word-bank.md`：沿用現有範本。
- 班別為 P5A–P5F，學號為 1–36；保留現有登入、計分、排行榜、學習進度及 `p5_*` 本機儲存相容性。
- 模式二每周四組字庫已改由帳號 B Google Sheets 管理，成績及其他模式維持原有後端；兩者使用不同接口，不互相取代。

## 開始工作與最小修改

1. 先確認專案根目錄、目前分支及工作區修改：`git status --short --branch`、`git branch --show-current`。必要時查看 `git remote -v`。
2. 不覆蓋或提交使用者未完成的工作；如有重疊，先釐清。若分支落後，不擅自 pull、merge 或 rebase。
3. 優先用 `rg` 搜尋與任務相關的程式，再閱讀必要片段。只有涉及多模組才擴大範圍。
4. 採最小可靠修改；重用現有函式、樣式及依賴。不順便重構、不加入不必要套件、不擅改無關 UI、功能、資料結構或業務邏輯。
5. 保留既有換行格式，避免整份檔案重新格式化造成巨大 diff。

## Debug 流程

1. **定位**：閱讀錯誤描述、相關程式及現有日誌／測試結果；必要時重現，先確認根本原因再修正。
2. **修正**：選最小且可靠、符合現有架構的方案，不因局部錯誤重新設計系統。
3. **驗證**：先測相關模組，依影響範圍擴大回歸檢查。不能測試時說明原因，不聲稱通過。
4. **回報**：簡短交代原因、修改檔案、修正內容、測試與未解決問題。
5. 同一方案連續失敗兩次，停止重複操作，重新分析證據；缺少關鍵資訊時詢問使用者。

## 新功能流程

- 確認需求及驗收條件，檢查可重用功能，找出必要檔案。
- 簡單明確的修改直接實作；大型或高風險任務先提出簡短計劃。
- 重大架構變更、資料遷移或可能破壞相容性的修改，先取得同意。
- 只改必要程式，執行相關測試及必要回歸檢查後回報。

## 控制上下文與用量

- 不無目的掃描整個專案；不重讀未變且已掌握的檔案。
- 工具輸出保留必要片段，避免大量原始碼、完整資料或重複分析報告。
- 長任務按目標分階段；不擴張無關工作。範圍不明時只問最關鍵問題；無關新任務可建議另開對話。
- 使用直接 Git 指令查看狀態及 diff。只安裝確實需要且尚未存在的依賴。
- 優先針對性測試；只有影響範圍或失敗證據需要才完整建構／測試或重跑。
- 不無故啟動多個代理。不能為省額度省略必要驗證與安全檢查。
- 依 App 實際可用模型提出建議：文字／CSS／小修正可用低成本模型；一般 Debug／小功能用中等能力模型；跨模組與複雜邏輯可用 GPT-5.6 Sol 或合適的高能力模型；疑難問題才提高推理強度。
- 不聲稱已自動切換模型或保證額度節省比例；模型能力不足時調整策略，不反覆低效重試。

## Git、分支與發布授權

- `main` 為正式穩定分支。沿用 SOP：每次修改使用獨立分支及 PR，不直接修改正式分支。
- 沿用既有命名，例如 `fix/…`、`fix-ranking-chart`、`week-06-words`、`update-login-screen`、`docs-update-sop`；新功能可用 `feature/…`。
- **未經使用者明確授權，不執行 Commit、Push、Merge 或正式部署。**既有授權限於該任務、分支及行動，不自動延伸到其他工作。
- 禁止擅自使用 `git reset --hard`、`git clean -fd`、強制 Push、刪除資料或程式碼。
- 完成後檢查 `git diff --stat`、`git diff`、`git diff --check` 及未追蹤檔案；確認只有預期檔案、無敏感資料，提供簡短 commit 訊息建議。
- 獲准提交時，逐一指定本次檔案，不用 `git add .`。較大型功能準備 PR，沿用範本，只勾選實際完成的檢查；說明修改、測試及實質風險，經確認才合併。

## 部署與快取

- 現行 `origin`＝**新 Repository**：`https://github.com/ekeong2026/P5-cangjie-master`，正式網站：`https://ekeong2026.github.io/P5-cangjie-master/`（2026-10-15 遷移完成）。
- 舊 Repository `https://github.com/ekeong2026/P5_typing-game` 及舊網站（<https://ekeong2026.github.io/P5_typing-game/>）**只作保留，不再修改**；本機舊遠端已改名 `legacy-origin`。
- 新 Repository 的 Pages 由 `.github/workflows/pages.yml` 自動部署：Push 至 `main` 即自動發布，發布後至 Actions 確認部署成功並實測網站。
- README／SOP／AGENTS 內的網站網址已於遷移時同步更新；`js/config.js` 的 `WORD_BANK_URL` 為帳號 B 字庫接口，與網站網址無關，不因搬遷而變更。
- Pages 部署由 `.github/workflows/pages.yml`（`configure-pages`／`upload-pages-artifact`／`deploy-pages`）執行；部署狀態以 Actions 與正式網站實際回應為準，不單憑設定推測。
- 不假設其他分支 Push 安全；先確認觸發條件。未完成必要測試不得主動部署。
- 不擅改 Actions、Pages、正式網址、API endpoint、Apps Script URL 或雲端儲存設定；調整部署流程先提方案並取得同意。
- `index.html` 使用腳本版本參數（現為 `?v=p5-20261012-wordbank1`）。已授權發布 JS 修改時，檢查是否需要同步更新參數以避免舊快取；額外版本修改須包含於該次授權及 diff。
- GitHub Push 不會自動部署 `apps-script/`。Apps Script 更新需另行授權部署，並核對實際使用版本及接口相容性。
- 發布後確認部署對應的提交，再實際驗證公開網站；檔案更新、部署成功及畫面驗收是不同檢查，不混為一談。

## 學生資料與同步安全

- 不清除學習紀錄、不重置成績或排行榜、不擅改學生識別資料。
- 保持班別／學號顯示及隱私模式，不加入姓名；班別及學號不是可靠身分驗證。
- 不將真實學生資料、完整試算表、私人日誌、密碼、API key 或 token 放進程式、測試、commit、PR 或公開輸出。測試使用虛構資料。
- 不擅改雲端資料格式；同步修改須檢查逾時、失敗、重試／待上傳佇列、本機與雲端一致性及向後相容。
- 不對正式接口送出測試成績，也不以真實學生登入進行會寫入的驗證；使用隔離測試環境或 mock。確需正式寫入測試時，先確認測試身份、影響及授權。
- 刪除、覆蓋或遷移資料前，提出風險、備份及還原方案並取得同意。Git revert 不會還原試算表或瀏覽器資料。

## 實際可用的驗證方式

目前沒有 `package.json`、npm test 或建構工具；但有 Node 內建測試及 Playwright 瀏覽器測試。不要假造指令。以下指令從專案根目錄執行：

```sh
node --check js/app.js
node --check js/config.js
node --check js/data.js
node --check js/cangjie.js
node --check js/word-bank-core.js
node --check js/word-bank.js
node --test tests/word-bank.test.cjs tests/word-bank-loader.test.cjs tests/word-bank-backend.test.cjs
node tests/browser-word-bank.cjs   # 需本機已有 Playwright；預設用 Edge
git diff --check
```

- 只執行涉及檔案的語法檢查及針對性測試；語法通過不等於功能通過。
- 文件修改只驗證內容與 diff，不要求全套功能測試。
- 瀏覽器測試會啟動臨時本機服務並阻擋所有外部請求、置空成績接口，不使用正式學生資料。需要手動檢視畫面時，可用 `python -m http.server 8000`（某些環境用 `python3`）開啟 `http://localhost:8000/`；這不是建構或部署。不得因本地頁面仍連正式接口而提交測試成績。
- 相關修改檢查登入選項 P5A–P5F／1–36、遊戲、周次字庫、排行榜名次（無 `undefined`）、統計、雲端失敗處理及必要的電腦／平板／手機畫面。
- 計分或同步邏輯採虛構資料測試重要邊界；不要寫只重複實作的測試。Apps Script 的服務 API 無法以 Node 語法檢查證明正常，需隔離環境驗證。
- 若未取得部署授權，停在本地修改及驗證，清楚說明尚未發布。

## 統一完成報告（繁體中文、簡短）

- **任務結果：** 完成／部分完成／未完成。
- **修改檔案：** 實際檔案。
- **主要修改：** 修正原因或新增內容。
- **測試結果：** 已執行項目、結果及無法驗證原因。
- **Git 狀態：** 目前分支、是否 Commit／Push；必要時列出待提交修改。
- **部署狀態：** 是否發布、正式網站是否實際驗證；未檢查不得聲稱部署成功。
- **注意事項：** 只列需使用者處理的事項；無則寫「無」。
