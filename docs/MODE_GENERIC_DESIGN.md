# 模式通用化設計（第 ② 階段）— 實作規格書

> 目的：把「模式」從寫死在程式碼裡，改成資料驅動。完成後，**加模式 5／6／7／8 只改前端，後端零改動、不重新部署**。
>
> 本文件只是規格，**尚未動任何程式碼**。經你過目同意後才開工。
>
> 撰寫日期：2026-10-13　｜　狀態：待批

---

## 0. 一句話總結

現在「模式」這個概念散落在 **後端 6 處寫死的對照表 + 前端 12 處 if/else**。本階段把這些全部收斂成
**一份模式註冊表（前端）＋ 一條通用規則（後端）**。

② 是**唯一一次**後端資料格式改動；之後新增模式（站 4～8）純粹是加一筆資料 + 一個字庫。

---

## 1. 驗收標準（Definition of Done）

| # | 驗收項 | 判定方式 |
|---|---|---|
| V1 | 現有 3 個模式的**行為完全不變**（介面、玩法、計分、每日 3 次遞減、上限） | 212 項測試全綠；人工比對一輪計分 |
| V2 | 在註冊表加一個新模式（id／名稱／字庫）後，前端可玩、可計分、總覽自動多一欄 | 測試用的假模式 `demo` 走完整條路徑 |
| V3 | 上述新增過程 **後端未改任何一行、未重新部署** | 以當下的 `validate_`／`handleSubmit_` 直接斷言 |
| V4 | 每日 06:00 重建後，「當天已計分次數」不被抹平 | 重建測試（長格式 → 抽屜） |
| V5 | `js/mastery-core.js` 與 `apps-script/MasteryCore.gs` 位元組完全相同 | 既有守門測試（`mastery-core.test.cjs:213`） |

> **② 不做的事**：不改任何顯示名稱、不去掉編號、不新增站、不換字庫。
> 那些屬於 ③。② 是**純重構**，只把「怎麼加模式」這件事變成資料驅動。

---

## 2. 現況盤點（問題在哪）

### 2.1 後端：6 處寫死的模式對照表

| # | 檔案：行 | 現在的寫法 | 加一個模式的代價 |
|---|---|---|---|
| B1 | `Code.gs:166` | `['connected','split','special','speed'].includes(mode)` | 改白名單 |
| B2 | `Code.gs:185` | `modeIndex: { connected:1, special:3, split:3, speed:2 }` | 加一筆 |
| B3 | `Code.gs:83` | `const modeField = 'd' + payload.modeIndex` | 取決於 B2 |
| B4 | `Code.gs:257` | `{ connected:'mode1Score', split:'mode2Score', special:'mode3Score', speed:'mode2Score' }` | 加一筆，但**欄位只有 3 個**，第 4 個模式無欄可放 |
| B5 | `Code.gs:636` | `{ connected:5, split:6, special:7, speed:6 }`（總覽欄號，寫死） | 同上，無欄可放 |
| B6 | `Code.gs:506` | `mode === 'connected' ? 'd1' : (special\|\|split) ? 'd3' : speed ? 'd2' : null` | 新模式 → `field = null` → **靜默丟棄，不計分** |
| B7 | `MasteryStore.gs:7` | `HEADERS` 固定 9 欄（模式一／三／二 各兩欄） | **schema 變更** |
| B8 | `MasteryCore.gs:12` | `KEY_PATTERN` 只認「週次:字」或「單字」 | 格式變更 |

**B6 是致命的**：新模式若沒被加進那串三元運算，後端會**默不作聲地不計分**。

### 2.2 前端：12 處 if/else 綁死在模式 id 上

| # | 檔案：行 | 內容 |
|---|---|---|
| F1 | `js/app.js:116` | `currentGameMode` 預設值與註解 |
| F2 | `js/app.js:130-139` | `modeQuizQueues` / `modeQuizHistory` 只有 3 個固定鍵 |
| F3 | `js/app.js:144-146` | `getNextQuiz` 用 if/else 取 `DATA.connected_words` … |
| F4 | `js/app.js:150` | `if (mode==='connected' \|\| mode==='special')` 才做今日優先 |
| F5 | `js/app.js:465-467` | `stats.mode1Score/mode2Score/mode3Score` 三分支 |
| F6 | `js/app.js:964-1026` | `setGameMode` 的 `speed` ／ 其他 兩分支 |
| F7 | `js/app.js:1082` / `1130` | `loadRound` 的 `connected` ／ `split` ／ 其餘 |
| F8 | `js/app.js:1365` / `1386` | `catchOrb` 的 `connected\|\|special` ／ `split` |
| F9 | `js/app.js:1480-1488` | 提示路徑的模式分支 |
| F10 | `js/app.js:1623` | `modeName` 三元運算式 |
| F11 | `js/app.js:1698-1699`、`1739-1747` | `submitRoundResults`／`renderMasteryProgress` 取 pool 與標籤 |
| F12 | `index.html:283-306` | 3 個分頁按鈕 + 3 句計分說明，**全部手寫** |

### 2.3 附帶發現（本次盤點新發現，需先修）

**`js/data.js` 有重複的頂層鍵 `"omit_words"`**（第 4951 行與第 6250 行各一份完整 25 字）。
原因是 `docs/_build_wordbank_draft.py` 的去重正則只刪「結尾帶逗號」的區塊，最後一塊（結尾是 `]` 無逗號）刪不掉，於是每跑一次就多疊一份。

- Node 載入後 `Object.keys(DATA).length === 14`，`DATA.omit_words.length === 25` → **執行期結果正確**（後者覆蓋前者）。
- 但檔案裡有 **440 行死資料**，且**再跑一次產字庫腳本會再疊一份**。
- 建議：列為 ② 的 T0，刪掉前面那一份死區塊，並修正腳本的正則（改成 `\]\s*,?`）。

> 順帶確認：`DATA` 目前共 6 池 —— `connected_words` 31／`split_words` 12／`special_words` 37／
> `abbrev_words` 29／`feature_words` 28／`omit_words` 25。

---

## 3. 目標設計

### 3.1 核心概念：把「玩法機制」與「模式身分」分開

現在 `currentGameMode` 同時代表兩件事：**用哪個玩法** 與 **玩哪一批字**。這就是為什麼多加一站就要改 12 處。

拆成兩層：

| 層 | 名稱 | 數量 | 特性 | 例 |
|---|---|---|---|---|
| **機制 mechanism** | 玩法引擎 | 少（約 5 個）且**很少變** | 程式分支的依據 | `code`（全碼依序捕球）、`twoPart`（字首＋字身）、`timed`（限時跑字）、`survival`、`versus` |
| **模式 mode** | 站／關 | 可任意增減 | **資料**，不含程式邏輯 | `connected`、`split`、`abbrev`、`feature`、`omit`、`pierce`、`special`、`speed`… |

之後「站 5 字形特徵」和「站 3 精簡」用的是**同一個機制 `code`**，程式完全不用碰 —— 只是換一筆資料。

### 3.2 新增檔案：`js/modes.js`（模式註冊表＝前端唯一真相）

載入順序：`config.js` → **`modes.js`** → `cangjie.js` → `mastery-core.js` → `data.js` → `app.js`。

```js
window.P5_MODES = [
  // 主線（有解鎖順序）
  { id:'connected', line:'main', order:1, mech:'code',
    icon:'⚔️', name:'連體字全碼突破', short:'連體字',
    pool:'connected_words', badge:'1~4碼連擊',
    note:'每個字每天最多計 3 次：第 1 次全額，第 2 次一半，第 3 次四分之一。' },

  { id:'split', line:'main', order:2, mech:'twoPart',
    icon:'🧩', name:'分體字結構挑戰', short:'分體字',
    pool:'split_words', badge:'字首＋字身',
    visible:false,                     // ② 先不上分頁，保留現有休眠程式碼
    note:'…' },

  { id:'special', line:'main', order:7, mech:'code',
    icon:'🔮', name:'難字與複合字特訓', short:'難字',
    pool:'special_words', badge:'X難字/複合',
    note:'…' },

  // 挑戰線（獨立入口，不佔主線進度）
  { id:'speed', line:'challenge', order:1, mech:'timed',
    icon:'⚡', name:'倉頡極速刷分手速賽', short:'手速賽',
    pool:'speed_words', weekly:true,   // 週次字庫，來自帳號 B
    badge:'10字 極速秒數天梯',
    note:'排名只看完成秒數…' }
];
```

欄位定義：`id`（模式身分，同時是進度鍵前綴）／`mech`（機制）／`line`＋`order`（主線順序、解鎖判定）／
`pool`（`DATA` 的鍵名）／`weekly`（是否用週次字庫）／`visible`（是否出分頁按鈕）／`note`（計分說明）／
`icon`／`name`／`short`／`badge`。

> ② 階段此表只放**上面 4 筆**，顯示名稱與編號**照舊**（分頁仍是「模式 1／2／3」三顆）。
> ③ 才加站 4～7、把 `split.visible` 打開、並統一改成去編號的名稱。

**為什麼是獨立檔案而不是塞進 `config.js`**：這份表之後還要驅動地圖／導航（階段⑤），
且需要被測試單獨載入。若你希望少一個檔案，改放 `config.js` 也可以，功能完全相同。

### 3.3 進度鍵：加「模式前綴」（MasteryCore v2）

**現在**（v1）：進度鍵是「單一漢字」或「`w7_hw1:更`」；抽屜固定切成 3 段 `d1|d3|d2`。

**改成**（v2）：**單一地圖，鍵 = `模式前綴 : 漢字`**。

```
key    = <prefix> ':' <漢字>
prefix = /^[a-z][a-z0-9_]{0,23}(?:\.[a-z0-9_]{1,24})?$/
```

| 模式 | 鍵的樣式 |
|---|---|
| `connected` | `connected:更` |
| `abbrev` | `abbrev:五` |
| `speed`（週次字庫） | `speed.w7_hw1:更` |
| `survival`（日後） | `survival:更` |

**抽屜格式 v2（按前綴分組，前綴只寫一次）**：

```
v2|<date>|<prefix>:<字串>,<prefix>:<字串>,...
字串 = 逐字串接，字後可接次數數字（1 省略）    例：更2人天
```

範例：

```
v2|2026-10-13|connected:更2人天,abbrev:五方,speed.w7_hw1:更
```

> **為什麼要按前綴分組**：抽屜（Script Properties）總容量按 500 KB 保守設計。
> 若每個字都寫一次前綴，一天 90 字／生 × 216 生 ≈ 540 KB，**會爆**。
> 分組後前綴只出現一次，實測與現行 v1 幾乎同級（甚至更小）。這是必要的容量設計，不是美觀。

**舊資料**：`parseDrawer` 遇到 `v1|…` 回傳空抽屜 → 由「掌握進度表」重讀（`readFromSheet`）或每日重建補回。
**目前新後端 0 筆真實資料，所以實際上不需要任何遷移**（見第 5 節）。

MasteryCore 對應的函式簽名改動（`js/mastery-core.js` 與 `apps-script/MasteryCore.gs` 同步改）：

| 函式 | 現在 | 改成 |
|---|---|---|
| `keyOf(char, weekKey)` | 週次字庫用 | `keyOf(char, prefix)` — 前綴可為空 |
| `parseProgress` / `serializeDaily` / `serializeAll` | 已通用 | 不變（只是鍵換了） |
| `pickNextChars(pool, map, today, need, random)` | 無前綴 | 尾端加 `prefix` |
| `progress(map, today, pool)` | 無前綴 | 尾端加 `prefix` |
| `buildRound(results, pool, map, today)` | 無前綴 | 尾端加 `prefix` |
| `applyRound(results, map, today, weekKey)` | 週次 | `applyRound(results, map, today, prefix)` |
| `serializeDrawer(d1, d3, d2, today)` | 3 段 | `serializeDrawer(map, today)` |
| `parseDrawer(value)` | 回 `{d1,d3,d2}` | 回 `{version, date, map}` |
| `MAX_PER_DAY` / `DECAY` / `decayFor` / `countOf` | — | **完全不動**（計分規則本階段不變） |

### 3.4 掌握進度表：改長格式

**現在**（`MasteryStore.gs:7`）：每生一列，9 欄固定 —— `班別｜學號｜模式一當日已得分｜模式一最後更新日｜模式三…｜模式二…｜更新時間`。

**改成**（長格式，每生每前綴一列）：

```
班別 | 學號 | 模式 | 當日進度 | 最後更新日 | 更新時間
```

- `模式` = 前綴（`connected`、`abbrev`、`speed.w7_hw1`）
- `當日進度` = 該前綴今天的進度字串，例：`更2人天`
- 只寫「今天有進度」的組合（稀疏長格式），所以列數不會無限膨脹

**好處**：新增模式只是多幾列，**schema 零改動**；教師也能直接用篩選／樞紐分析。

### 3.5 成績總覽：動態加欄

```
年級 | 班別 | 學號 | 累計得分 | 累計擊倒數 | 最佳10字秒數 | 最後接收時間 | 週次最佳秒數 | 得分:<modeId> | 得分:<modeId> | …
        └────────── 固定 8 欄 ──────────┘   └──────── 動態追加，順序＝首次出現順序 ────────┘
```

**關鍵約束：動態欄一律追加在尾端。** 理由：`ensureSheet_`（`Code.gs:684`）對表頭的檢查是
「前綴必須完全相符、允許尾端缺少並自動補上」。若把動態欄插在中間，之後再加模式時會**表頭不符而拋錯**。
追加在尾端則現有邏輯**完全不用改**，天然支援。

同時 `readData_`（`Code.gs:338-340`）與 `updateSummaryStudent_`（`Code.gs:636`）不再寫死欄號，
改為「讀第 1 列標題 → 建立 `得分:<modeId>` → 欄號」的對照；找不到就追加一欄。

### 3.6 本機儲存通用化

| 鍵 | 現在 | 改成 |
|---|---|---|
| `p5_score_<cls>_<num>` | `{totalScore, kills, mode1Score, mode2Score, mode3Score}` | `{totalScore, kills, modeScores:{connected:120, abbrev:30, …}}`（讀舊檔時就地轉換一次） |
| `p5_mastery_<cls>_<num>` | 同上（已是通用字串） | 不變（改用 v2 前綴鍵） |

`stats.mode1/2/3Score` **前端從不讀取**（已確認只有 `app.js:305` 初始化、`465-467` 寫入；
顯示一律走雲端排行榜），所以這次可以放心換掉。舊欄位讀到時併入 `modeScores`。

### 3.7 後端通用化：逐處改動表

| 位置 | 改成 |
|---|---|
| `Code.gs:166` 白名單 | `const MODE_PATTERN = /^[a-z][a-z0-9_]{0,23}$/`，不符才拋錯 |
| `Code.gs:185` `modeIndex` | **刪除**（不再需要 d1/d3/d2） |
| `Code.gs:83` `modeField` | **刪除**；改算 `prefix = prefixFor(mode, weekKey)` |
| `Code.gs:170` `weekKey` 必填 | 只有 `mech === 'timed'` 必填，其餘可為空 |
| `Code.gs:173-179` timed 驗證 | 條件由 `mode === 'speed'` 改為 `MECHANISMS[mode] === 'timed'` |
| `Code.gs:104-109` 抽屜 | `drawer[modeField]` → `drawer.map`（單一地圖） |
| `Code.gs:257` `modeField` | `st.modeScores[mode] = (st.modeScores[mode]\|\|0) + delta` |
| `Code.gs:338-340` 讀總覽 | 依表頭動態對照 `得分:<mode>` |
| `Code.gs:636` 寫總覽 | 動態欄位定位／尾端追加 |
| `Code.gs:506` `field` 三元式 | **刪除**；由 `mode` 直接組前綴，寫入長格式 |
| `Code.gs:558-579` 重建抽屜 | 依長格式（模式欄）分組，合併成單一地圖 |
| `MasteryStore.gs:7` `HEADERS` | 長格式 6 欄 |
| `MasteryStore.gs:22-78` | 讀／寫改長格式（批次 `setValues`） |
| `MasteryCore.gs` | 見 3.3 簽名表 |

後端只保留**一張極小的機制表**（新增主線模式永遠不用碰）：

```js
const MECHANISMS = { speed: 'timed', survival: 'survival', versus: 'versus' };  // 未列出者一律 'code'
```

### 3.8 前端改成 registry 驅動

| 位置 | 改法 |
|---|---|
| F2 `modeQuizQueues` | 改用 `{}` + 動態 key（`queues[mode] = queues[mode] \|\| []`） |
| F3 `getNextQuiz` | `pool = DATA[registry[id].pool]` |
| F4 今日優先 | 條件改 `mech === 'code'` |
| F5 `stats.mode*Score` | `stats.modeScores[mode]` |
| F6 `setGameMode` | 依 `mech` 分派（`timed` ／ `twoPart` ／ `code`） |
| F7 `loadRound` | 依 `mech` 分派 |
| F8/F9 `catchOrb`／提示 | `connected\|\|special` → `mech === 'code'` |
| F10 `modeName` | `registry[id].short` |
| F11 pool／標籤 | `registry[id].pool` ／ `registry[id].short` |
| F12 分頁／計分說明 | **由 registry 生成 DOM**（只生成 `visible!==false` 的），沿用現有 class 名 → **CSS 不用改** |

> **對先前決定的修訂說明**：模式 1～3 的計分說明原本刻意寫成靜態 HTML（你當時的指示）。
> 這次因為要「加模式時不用手寫 HTML」，改為由 registry 生成 —— 文字內容仍集中在一處，改文案一樣簡單。

---

## 4. 安全與容量（放寬驗證後必須守住的底線）

放寬模式 id 之後，公開端點（本來就無需密碼）可以送任意 id，必須設下限：

| 風險 | 對策 |
|---|---|
| 送 `mode:'zzz'` 讓總覽無限長出欄位 | 動態分項欄上限 `MAX_MODE_COLUMNS = 24`；超出只計入總分、不建欄 |
| 超長／含分隔符的 id 撐破儲存格式 | `MODE_PATTERN` 限制 `[a-z][a-z0-9_]{0,23}`（≤24 字元，不含 `:;|,`） |
| 抽屜容量爆掉 | 抽屜按前綴分組（3.3）；保留既有 `usage()` 監控與「逼近上限」告警 |
| 進度表列數膨脹 | 只寫「今天有進度」的 (學生, 前綴) 組合；上限 216 × 模式數，可接受 |

容量估算（抽屜，最壞一天玩 3 站 × 30 字 = 90 字）：
`3 個前綴（約 30 字元）＋ 90 個漢字 ＋ 部分次數數字 ≈ 150 字元／生`
→ 216 生 ≈ 32 KB，**遠低於 500 KB 上限**（現行 v1 實測約 283 字元／生）。

---

## 5. 一次性重置步驟（因為目前 0 筆資料）

**前提已確認**：新成績後端（`AKfycbzrZs7...`）的「遊戲紀錄」目前 **0 列**、216 位學生全 0 分、
測試資料已清除。所以這次格式改動**沒有真實資料需要遷移**，可以用「重置」而不是「遷移」。

1. 備份：試算表「檔案 → 建立副本」留一份（保險，成本極低）。
2. 刪除「成績總覽」「掌握進度」兩個工作表（下次 `setup` / 首次寫入會自動重建，表頭即為新格式）。
3. 清除 Script Properties 的殘留抽屜：`mb:*` 全部，以及 `SUMMARY_DIRTY`。
4. 重新部署 `Code.gs` / `MasteryCore.gs` / `MasteryStore.gs`（同一個部署 ID，維持網址不變）。
5. 在編輯器執行 `setup()` → 應重建出 216 列、0 分的總覽。
6. 用測試班別交一筆假成績驗證新模式路徑，完成後清除該筆（沿用先前 `docs/cleanup-test-data.gs` 的做法）。

> 若你希望**保留舊的 v1 資料**（例如之後想接回舊站的 155 人），可以在第 3 步之後跑一次
> 「更新掌握進度」＋「重建進度抽屜」—— 紀錄裡同時有「模式」與「得分字」，
> 足以用新格式完整重建。**但依你先前決定「舊資料不搬遷」，此步不需要。**

---

## 6. 測試計畫

| 類別 | 內容 |
|---|---|
| 基線 | `node --test tests/*.test.cjs` 現有 **212 項**（改完後等價更新，不得減少覆蓋） |
| 新增 T-A | `mastery-core` v2：前綴鍵解析／序列化 round-trip；`v1` 抽屜 → 空；非法前綴（含分隔符、超長、空）被拒；`MAX_PER_DAY` 行為與 v1 一致 |
| 新增 T-B | 註冊表健全性：id 唯一且符合 `MODE_PATTERN`、`pool` 在 `DATA` 中存在且非空、`mech` 合法、`line`／`order` 不重複 |
| 新增 T-C | **零後端改動驗收**：注冊假模式 `demo`（`mech:'code'`）→ `validate_` 接受、`handleSubmit_` 寫入 `demo:字`、總覽自動出現 `得分:demo` 欄 |
| 新增 T-D | 長格式重建：掌握進度長格式 → `rebuildMasteryDrawers` → 次數不抹平（沿用並擴充 `nightly-rebuild.test.cjs`） |
| 新增 T-E | 欄位上限：第 25 個新模式不建欄、但總分仍計 |
| 守門 | `js/mastery-core.js` 與 `apps-script/MasteryCore.gs` 位元組相同 |
| 前端 | `node --check` 各檔；`tests/browser-word-bank.cjs`（**需本機 Playwright**，它會實際呼叫 `setGameMode('connected')`／`setGameMode('speed')`，T3 改動後必須仍通過） |

---

## 7. 實作任務順序（建議）

| 任務 | 內容 | 產出／驗收 |
|---|---|---|
| **T0** | 清掉 `js/data.js` 重複的 `omit_words` 死區塊；修 `_build_wordbank_draft.py` 去重正則 | `node -e` 載入後 6 池字數不變；重跑腳本不再疊 |
| **T1** | 建立 `js/modes.js` 註冊表（4 筆）＋ `index.html` 載入 | 頁面正常、無 console 錯誤 |
| **T2** | MasteryCore 改 v2（前綴鍵＋單一地圖抽屜），同步兩檔 | T-A 綠、位元組守門綠 |
| **T3** | 前端改 registry 驅動（F2～F11） | V1：現有 3 模式行為不變 |
| **T4** | 前端分頁／計分說明改由 registry 生成（F12） | 畫面與現狀一致 |
| **T5** | 後端 `validate_`／`handleSubmit_` 通用化（B1～B3、B6） | T-C 綠 |
| **T6** | `MasteryStore` 長格式（B7）＋ `writeMasterySheet_`／`rebuildMasteryDrawers` | T-D 綠 |
| **T7** | 總覽動態加欄（B4、B5、`readData_`）＋欄位上限 | T-E 綠 |
| **T8** | 本機儲存通用化（`modeScores`） | 手動驗證本機快取遷移 |
| **T9** | 全套回歸 + 一次性重置 + 部署驗證 | V1～V5 全過 |

> 不 Commit／不 Push／不部署，除非你當次明確授權（沿用 AGENTS.md 規範）。

---

## 8. 附錄：需要你確認的三件事

1. **`js/modes.js` 新檔案** —— 可接受嗎？或希望併入 `js/config.js`？
2. **重置而非遷移** —— 確認新後端確實可以清掉「成績總覽／掌握進度／`mb:*` 抽屜」重來（現時 0 筆資料）。
3. **T0 的 `data.js` 重複區塊** —— 現在就清掉，還是留到 ③ 一起處理？

只要這三點確認，我就依 T0→T9 開工。
