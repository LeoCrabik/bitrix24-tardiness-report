const { createClient } = require('redis');

let client;

async function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('[Redis] error:', err));
    await client.connect();
  }
  return client;
}

async function savePortalTokens(domain, tokens) {
  const c = await getClient();
  await c.set(`portal:${domain}`, JSON.stringify(tokens));
}

async function getPortalTokens(domain) {
  const c = await getClient();
  const raw = await c.get(`portal:${domain}`);
  return raw ? JSON.parse(raw) : null;
}

async function getAllPortalDomains() {
  const c = await getClient();
  const keys = await c.keys('portal:*');
  return keys.map((k) => k.replace('portal:', ''));
}

async function deletePortalTokens(domain) {
  const c = await getClient();
  await c.del(`portal:${domain}`);
}

module.exports = { savePortalTokens, getPortalTokens, getAllPortalDomains, deletePortalTokens };
