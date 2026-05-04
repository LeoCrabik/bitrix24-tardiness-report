/**
 * Локальный dev-прокси (замена nginx)
 * Слушает :80, роутит:
 *   /api/*    → backend :3001
 *   /bitrix/* → backend :3001
 *   /*        → frontend :5173
 *
 * Особенность: Битрикс24 открывает приложение POST-запросом с AUTH_ID в теле.
 * Vite не обрабатывает POST. Поэтому парсим тело, извлекаем AUTH_ID,
 * и делаем 302 redirect на GET с bx_auth в query string — фронтенд его читает.
 */
const http = require('http');
const { URLSearchParams } = require('url');

// Всё идёт на backend — он раздаёт и API, и статику фронтенда
const BACKEND  = { host: '127.0.0.1', port: 3001 };

function pipe(req, res, target) {
  const opts = {
    host:    target.host,
    port:    target.port,
    path:    req.url,
    method:  req.method,
    headers: { ...req.headers, host: `${target.host}:${target.port}` },
  };

  const proxy = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on('error', (err) => {
    console.error(`[proxy] Error → :${target.port}${req.url}:`, err.message);
    if (!res.headersSent) { res.writeHead(502); res.end('Bad Gateway'); }
  });

  req.pipe(proxy, { end: true });
}

http.createServer((req, res) => {
  const url = req.url || '/';
  const isBackend = url.startsWith('/api/') || url.startsWith('/bitrix/');

  // POST на frontend-маршруты — Битрикс24 открывает iframe так.
  // Парсим тело, вытаскиваем AUTH_ID и делаем 302 redirect на GET с bx_auth в URL.
  if (req.method === 'POST' && !isBackend) {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      const params  = new URLSearchParams(body);
      const authId  = params.get('AUTH_ID') || '';
      const sep     = url.includes('?') ? '&' : '?';
      const location = authId
        ? `${url}${sep}bx_auth=${encodeURIComponent(authId)}`
        : url;
      console.log(`[proxy] POST ${url} → 302 GET with bx_auth=${authId ? 'set' : 'empty'}`);
      res.writeHead(302, { Location: location });
      res.end();
    });
    return;
  }

  pipe(req, res, BACKEND);
}).listen(80, '0.0.0.0', () => {
  console.log('[proxy] Listening on :80');
  console.log('[proxy] /api/* /bitrix/* → :3001');
  console.log('[proxy] /*             → :5173 (POST → 302 with bx_auth)');
});
