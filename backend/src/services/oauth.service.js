const axios = require('axios');
const { savePortalTokens, getPortalTokens } = require('../storage/redis');

const OAUTH_URL = 'https://oauth.bitrix.info/oauth/token/';

async function exchangeCode(code, domain) {
  const { data } = await axios.get(OAUTH_URL, {
    params: {
      grant_type: 'authorization_code',
      client_id: process.env.BITRIX_CLIENT_ID,
      client_secret: process.env.BITRIX_CLIENT_SECRET,
      code,
    },
  });

  if (data.error) throw new Error(data.error_description || data.error);

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    domain: data.domain || domain,
  };

  await savePortalTokens(tokens.domain, tokens);
  return tokens;
}

async function refreshTokens(domain, refreshToken) {
  const { data } = await axios.get(OAUTH_URL, {
    params: {
      grant_type: 'refresh_token',
      client_id: process.env.BITRIX_CLIENT_ID,
      client_secret: process.env.BITRIX_CLIENT_SECRET,
      refresh_token: refreshToken,
    },
  });

  if (data.error) throw new Error(data.error_description || data.error);

  // Сохраняем server_endpoint из старых токенов — без него callMethod упадёт на неправильный URL
  const existing = await getPortalTokens(domain);

  const tokens = {
    access_token:    data.access_token,
    refresh_token:   data.refresh_token,
    expires_in:      data.expires_in,
    domain,
    server_endpoint: existing?.server_endpoint || null,
    member_id:       existing?.member_id || null,
  };

  await savePortalTokens(domain, tokens);
  return tokens;
}

module.exports = { exchangeCode, refreshTokens };
