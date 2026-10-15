# P5_typing-game

五年級倉頡打字遊戲，供 P5A–P5F、學號 1–36 使用。

網站：<https://ekeong2026.github.io/P5-cangjie-master/>

## 使用方式

開啟網站，進入遊戲頁，選擇班別及學號。完成遊戲後，成績傳送至自用 Google Apps Script，並保留本機瀏覽器紀錄。

## GitHub 管理

本專案採用分支及 Pull Request 管理：

1. 每次修改先從 `main` 建立獨立分支。
2. 完成修改及測試後建立 Pull Request。
3. 檢查內容及資料安全後才合併至 `main`。
4. GitHub Pages 會從 `main` 自動發布正式網站。

詳細程序請參閱 [P5 打字遊戲 GitHub 管理 SOP](SOP.md)。

每星期由教師提供周次及第1至第4組字庫，再依照 SOP 更新、測試及發布。

## 維護

- `index.html`：頁面及登入選單。
- `js/config.js`：Google Apps Script 接口與遊戲設定。
- `js/app.js`：遊戲及成績同步。
- `js/data.js`、`js/cangjie.js`：題庫及倉頡資料。
- `css/style.css`：樣式。

首頁、登入、排行榜與本機成績儲存均已改為五年級版本。初始名冊包含 P5A–P5F、每班學號 1–36，歷史排行榜示例已清除。

登入未使用密碼，班別及學號不能用作可靠的身分驗證。成績試算表應保持私人。

## 原始專案

改編自：<https://github.com/lam013088/P6_typing-game>

P6_typing game

## 模式二雲端字庫（字庫後端已部署）

模式二全部周次字庫改由帳號 B 的 Google Sheets 提供，其他模式保持原有資料。首次安裝及每周／年度操作請參閱 [字庫操作說明](docs/WORD_BANK_SETUP.md)。原有 16 組共 640 題已整理成每組一行的雙清單格式並匯入 Google Sheets；Apps Script 字庫接口第 1 版已部署及通過跨域讀取驗證。本機已加入「學年＋草稿／已發布／已封存」篩選，可保留歷年字庫並重用周次名稱；網站已於 2026-10-15 遷至新 Repository（P5-cangjie-master）並發布。學年顯示讀取字庫平台設定，不會自動重設成績。
