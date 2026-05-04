const axios = require('axios');
const { getPortalTokens } = require('../storage/redis');
const { refreshTokens } = require('./oauth.service');

async function callMethod(domain, method, params = {}) {
  let tokens = await getPortalTokens(domain);
  if (!tokens) throw new Error(`No tokens for portal: ${domain}`);

  try {
    return await _call(tokens, method, params);
  } catch (err) {
    if (err.response?.data?.error === 'expired_token') {
      tokens = await refreshTokens(domain, tokens.refresh_token);
      return await _call(tokens, method, params);
    }
    throw err;
  }
}

async function _call(tokens, method, params) {
  // Используем server_endpoint если есть, иначе строим URL из domain
  const base = tokens.server_endpoint
    ? tokens.server_endpoint.replace(/\/?$/, '/')
    : `https://${tokens.domain}/rest/`;
  const url = `${base}${method}`;

  let data;
  try {
    const res = await axios.post(url, { ...params, auth: tokens.access_token });
    data = res.data;
  } catch (axiosErr) {
    const body = axiosErr.response?.data;
    console.error(`[bitrix] HTTP ${axiosErr.response?.status} on ${method}:`, JSON.stringify(body));
    throw axiosErr;
  }

  // Логируем полный ответ для методов update — нужно для диагностики
  if (method.includes('update') || method.includes('element')) {
    console.log(`[bitrix] ${method} raw response:`, JSON.stringify(data));
  }

  if (data.error) {
    const err = new Error(data.error_description || data.error);
    err.response = { data };
    throw err;
  }

  return data.result;
}

async function callBatch(domain, commands) {
  const tokens = await getPortalTokens(domain);
  if (!tokens) throw new Error(`No tokens for portal: ${domain}`);

  const base = tokens.server_endpoint
    ? tokens.server_endpoint.replace(/\/?$/, '/')
    : `https://${tokens.domain}/rest/`;
  const url = `${base}batch`;

  const { data } = await axios.post(url, {
    halt: 0,
    cmd: commands,
    auth: tokens.access_token,
  });

  if (data.error) throw new Error(data.error_description || data.error);
  return data.result;
}

// Вызов метода от имени конкретного пользователя (с его access_token, не app-токеном).
// Используется для методов, которые проверяют права текущего пользователя (например, user.admin).
async function callWithUserToken(domain, method, params, userAccessToken) {
  const tokens = await getPortalTokens(domain);
  const base = tokens?.server_endpoint
    ? tokens.server_endpoint.replace(/\/?$/, '/')
    : `https://${domain}/rest/`;
  const url = `${base}${method}`;

  let data;
  try {
    const res = await axios.post(url, { ...params, auth: userAccessToken });
    data = res.data;
  } catch (axiosErr) {
    const body = axiosErr.response?.data;
    console.error(`[bitrix] HTTP ${axiosErr.response?.status} on ${method} (user token):`, JSON.stringify(body));
    throw axiosErr;
  }

  if (data.error) {
    const err = new Error(data.error_description || data.error);
    err.response = { data };
    throw err;
  }

  return data.result;
}

module.exports = { callMethod, callBatch, callWithUserToken };
