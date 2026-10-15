/* 本機預覽用靜態伺服器（只給開發者自己試玩，不是專案產物）。
   用法：node docs/_preview-server.cjs [port]
   特性：預設把 config.js 的雲端上傳關掉，避免試玩時誤寫真實後端。
        加 --live 則保留真實 config.js（要連雲端時用）。 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const port = parseInt(process.argv[2], 10) || 8080;
const live = process.argv.includes('--live');

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.resolve(__dirname, '..', '.' + rel);
  // 只允許專案目錄內的檔案
  if (!file.startsWith(path.resolve(__dirname, '..'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + rel); return; }
    if (!live && rel === '/js/config.js') {
      data = Buffer.from(data.toString('utf8')
        .replace(/window\.CONFIG\.DATA_URL = '[^']*';/, "window.CONFIG.DATA_URL = '';")
        .replace(/window\.CONFIG\.GAS_WEBHOOK_URL = '[^']*';/, "window.CONFIG.GAS_WEBHOOK_URL = '';"));
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('P5 preview server → http://127.0.0.1:' + port + '/');
  console.log(live ? '模式：--live（保留真實 config.js，會連雲端）'
    : '模式：離線（雲端上傳已關閉，安全試玩）');
});
