/* ② 階段後端複驗工具（唯讀 ＋ 一筆可清理的測試寫入）。
 *
 * 目的：在部署完新後端後，獨立確認「以後加模式不必改後端」是真的。
 *
 * 用法：
 *   node docs/verify-phase2-backend.cjs              # 只讀（安全，不寫任何資料）
 *   node docs/verify-phase2-backend.cjs --probe      # 送一筆帶新模式代號的測試成績
 *   node docs/verify-phase2-backend.cjs --probe --mode demo2
 *
 * ⚠️ --probe 會真的寫入一列「遊戲紀錄」並加分。跑完請照輸出的清理步驟移除。
 *
 * 關於 Apps Script 的重定向（踩過兩次坑，切記）：
 *   POST /exec 會先回 302 轉到 script.googleusercontent.com/macros/echo?user_content_key=...
 *   - 第一跳（script.google.com）才是真正觸發 doPost 的地方，帶 Content-Length 送出後即已執行。
 *   - 第二跳（googleusercontent 的 echo）只接受 GET；若沿用 POST 去要，會回 405 Method Not Allowed。
 *   因此：POST 收到 3xx 後，必須「改用 GET 取回結果」，不能原樣重送 POST。
 *   （curl -L -X POST 也會踩到這個坑，看到 405 誤以為寫入失敗，其實早已寫入。）
 */
const https = require('node:https');

const EXEC_URL = process.env.P5_EXEC_URL
  || 'https://script.google.com/macros/s/AKfycbzrZs7bCsS4o-DwObhMOZyfdOVMfw1FgKIlL5tS6Z0I6AEKlzfGh9GvKJaes-netD6ebw/exec';

const PROBE = process.argv.includes('--probe');
const MODE = (() => {
  const i = process.argv.indexOf('--mode');
  return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : 'phase2probe';
})();
const PROBE_ID = 'verify-phase2-' + Date.now();
// 刻意挑選後端白名單從未見過的代號，作為通用化的活體證明。
// 每次從一組罕用漢字裡輪替，避免同一天重跑時被「每字每天 N 次」擋掉而誤判失敗。
const PROBE_CHARS = ['龘', '靐', '齾', '爩', '鱻', '麤', '龖', '灪'];
const PROBE_CHAR = PROBE_CHARS[Math.floor(Date.now() / 1000) % PROBE_CHARS.length];
const PROBE_EARNED = 12;

/* Apps Script 的 /exec 幾乎一定會先回 302（轉到 googleusercontent 的 echo），
   node 的 https 不會自動跟，必須自己跟。
   關鍵：重定向後一律改用 GET 取回結果 —— 第二跳的 echo 端點只接受 GET，
   沿用 POST 會被回 405（且 POST 早已在第一跳被執行，405 只是「讀不到結果」而非「沒寫入」）。 */
function request(url, { method = 'GET', body = null, depth = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = https.request(url, {
      method,
      headers: payload
        ? { 'Content-Type': 'text/plain;charset=utf-8', 'Content-Length': payload.length }
        : {}
    }, res => {
      const code = res.statusCode;
      const loc = res.headers.location;
      // 任何 3xx 都改用 GET 跟隨：302 指向的 echo 端點只收 GET；
      // 303 本來就規定改 GET。原樣重送 POST 會得到 405。
      if (code >= 300 && code < 400 && loc && depth < 5) {
        res.resume();
        const next = new URL(loc, url).toString();
        return resolve(request(next, { method: 'GET', body: null, depth: depth + 1 }));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: code, text: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const pass = [];
const fail = [];
function check(ok, label, detail) {
  (ok ? pass : fail).push(label + (detail ? '  ／ ' + detail : ''));
  console.log((ok ? '  ✅ ' : '  ❌ ') + label + (detail ? '  ／ ' + detail : ''));
}

(async () => {
  console.log('端點：' + EXEC_URL);
  console.log('模式：' + (PROBE ? '唯讀 ＋ 一筆測試寫入（代號 ' + MODE + '）' : '唯讀') + '\n');

  // ── 1. 讀取與結構 ──
  console.log('【1】讀取與結構');
  const read = await request(EXEC_URL);
  let d = null;
  try { d = JSON.parse(read.text); } catch (e) {
    check(false, 'GET /exec 回傳可解析的 JSON', 'HTTP ' + read.status
      + '，前 120 字：' + read.text.slice(0, 120).replace(/\s+/g, ' '));
  }
  if (!d) { summary(); return; }
  check(d.status === 'success', 'status 為 success', 'HTTP ' + read.status);
  const lb = Array.isArray(d.combatLeaderboard) ? d.combatLeaderboard : [];
  check(lb.length === 216, 'combatLeaderboard 為 216 人', '實得 ' + lb.length);
  const scored = lb.filter(s => (s.grandTotal || 0) !== 0);
  // 這項不列為失敗項：探測本身就會寫入測試資料，且正式上線後榜上本來就會有分。
  // 只作為提示，讓你知道目前榜上有幾人帶分（第一次部署後應為 0）。
  check(true, '目前榜上有分人數（僅供參考）', scored.length + ' 人'
    + (scored.length === 0 ? '（乾淨）' : '（含先前測試資料，請照文末清理）'));
  check('speedByWeek' in d, 'speedByWeek 存在');
  check('top40' in d && 'class_top10' in d, 'top40 與 class_top10 存在');

  if (!PROBE) { summary(); return; }

  // ── 2. 通用化活體證明：送一個後端從未見過的模式代號 ──
  console.log('\n【2】通用化活體證明（模式代號 ' + MODE + '）');
  const payload = {
    requestId: PROBE_ID,
    grade: 5, cls: 'P5A', num: 36,
    mode: MODE,
    scoreDelta: 0,            // 分數一律由後端依 round 判定，前端不自行宣稱
    killDelta: 0,
    wordCount: 10, weekKey: '',
    round: [{ char: PROBE_CHAR, correct: true, earned: PROBE_EARNED }],
    completedAt: new Date().toISOString()
  };
  const post = await request(EXEC_URL, { method: 'POST', body: payload });
  let r = null;
  try { r = JSON.parse(post.text); } catch (e) {
    check(false, 'POST 回傳可解析的 JSON', 'HTTP ' + post.status
      + '，前 160 字：' + post.text.slice(0, 160).replace(/\s+/g, ' '));
  }
  if (r) {
    check(r.status === 'success', 'POST 被接受', JSON.stringify(r).slice(0, 160));
    if (r.status !== 'success') {
      console.log('\n  ⚠️ 若訊息是「遊戲模式不正確。」→ 部署沒有生效：');
      console.log('     要「管理部署作業 → 編輯 → 版本：新版本 → 部署」，只按儲存不算。');
      console.log('     （但注意：這條檢查只證明「代號被接受」。若回 earned:0 且 ignored 含該字，');
      console.log('      代表該字今天已無計分次數，請換一天或清理後重跑。）');
    } else {
      check(r.earned === PROBE_EARNED, 'earned 等於送出的 ' + PROBE_EARNED, '實得 ' + r.earned);
      check(Array.isArray(r.newlyScored) && r.newlyScored.includes(PROBE_CHAR),
        'newlyScored 含 ' + PROBE_CHAR, JSON.stringify(r.newlyScored));
    }
  }

  // ── 3. 去重 ──
  console.log('\n【3】同一 requestId 重送應被去重');
  const again = await request(EXEC_URL, { method: 'POST', body: payload });
  try {
    const r2 = JSON.parse(again.text);
    check(r2.duplicate === true || r2.earned === 0,
      '重送回 duplicate 或 earned: 0', JSON.stringify(r2).slice(0, 160));
  } catch (e) {
    check(false, '重送回應可解析', again.text.slice(0, 120));
  }

  // ── 4. 非法代號仍被擋（放寬驗證後的安全底線）──
  console.log('\n【4】非法模式代號仍被拒絕（放寬驗證後的安全底線）');
  for (const bad of ['Bad Mode', 'AB', '模式']) {
    const res = await request(EXEC_URL, {
      method: 'POST',
      body: Object.assign({}, payload, { requestId: PROBE_ID + '-bad', mode: bad })
    });
    let msg = res.text;
    try { msg = JSON.parse(res.text).message || res.text; } catch (e) { }
    check(String(msg).indexOf('模式') >= 0, '拒絕「' + bad + '」', String(msg).slice(0, 80));
  }

  summary();
})().catch(e => { console.error('執行失敗：', e); process.exitCode = 1; });

function summary() {
  console.log('\n─────────────────────────────');
  console.log('通過 ' + pass.length + ' 項' + (fail.length ? '，失敗 ' + fail.length + ' 項' : '，全部通過。'));
  if (fail.length) {
    console.log('\n失敗項目：');
    fail.forEach(f => console.log('  ✗ ' + f));
  }
  if (PROBE) {
    console.log('\n清理測試資料（請照做，否則榜上會留一筆 12 分）：');
    console.log('  1. 試算表「遊戲紀錄」刪除「請求編號」為 ' + PROBE_ID + ' 的那一列。');
    console.log('  2. 選單「打字遊戲 → 更新成績總覽」。');
    console.log('  3. 選單「打字遊戲 → 更新掌握進度」，再「重建進度抽屜」。');
    console.log('  4. 「成績總覽」若多出「得分:' + MODE + '」欄，可留著（③ 開站直接用）或整欄刪除後再重建。');
  }
  process.exitCode = fail.length ? 1 : 0;
}
