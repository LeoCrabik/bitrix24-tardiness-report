require('dotenv').config();

const express = require('express');
const path = require('path');
const { savePortalTokens } = require('./storage/redis');
const { handleInstall } = require('./services/install.handler');

const apiRouter = require('./routes/api');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздаём production build фронтенда — минифицированные файлы,
// не зависим от Vite и его огромных dev-чанков через туннель
const distPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(distPath));

// Логируем все запросы, которые не обработал express.static
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api') && !req.url.startsWith('/bitrix') && !req.url.startsWith('/health')) {
    console.log(`[req] ${req.method} ${req.url}`);
  }
  next();
});

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// Обработчик установки приложения (вызывается Битрикс24 при установке)
app.post('/bitrix/install', async (req, res) => {
  try {
    console.log('[install] Body:', JSON.stringify(req.body, null, 2));

    const accessToken    = req.body.AUTH_ID;
    const refreshToken   = req.body.REFRESH_ID;
    const expiresIn      = req.body.AUTH_EXPIRES;
    const appToken       = req.body.APPLICATION_TOKEN;
    const memberId       = req.body.member_id;
    const serverEndpoint = req.body.SERVER_ENDPOINT;

    if (!accessToken || !serverEndpoint) {
      console.error('[install] Missing AUTH_ID or SERVER_ENDPOINT');
      return res.status(400).send('Missing required fields');
    }

    // Получаем домен портала через app.info
    const axios = require('axios');
    const infoRes = await axios.get(`${serverEndpoint}app.info`, {
      params: { auth: accessToken },
    });
    console.log('[install] app.info response:', JSON.stringify(infoRes.data, null, 2));

    const result = infoRes.data?.result || {};
    const domain = result.install?.domain
      || (result.install?.client_endpoint ? new URL(result.install.client_endpoint).hostname : null)
      || memberId;

    const clientEndpoint = result.install?.client_endpoint || serverEndpoint;

    console.log(`[install] Resolved domain: ${domain}`);

    const tokens = {
      access_token:      accessToken,
      refresh_token:     refreshToken,
      expires_in:        expiresIn,
      application_token: appToken,
      member_id:         memberId,
      server_endpoint:   clientEndpoint,
      domain,
    };

    await savePortalTokens(domain, tokens);
    await handleInstall(domain, tokens);

    // BX24.installFinish() сигнализирует Битрикс24 об успешном завершении установки
    res.send(`<!DOCTYPE html>
<html>
<head>
  <script src="//api.bitrix24.com/api/v1/"></script>
</head>
<body>
  <script>
    BX24.init(function() {
      BX24.installFinish();
    });
  </script>
</body>
</html>`);
  } catch (err) {
    console.error('[install] Error:', err.message, err.stack);
    res.status(500).send('Installation failed');
  }
});

// Все API роуты для фронтенда
app.use('/api', apiRouter);

// SPA fallback — все не-API маршруты отдают index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server] Backend running on port ${PORT}`);
});
