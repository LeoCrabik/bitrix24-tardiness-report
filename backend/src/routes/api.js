const express = require('express');
const router = express.Router();

const {
  getSettings,
  saveSettings,
  getRecords,
  getMyRecords,
  updateReasonStatus,
  updateReason,
  getUsers,
  getUserRole,
  importTardinessForPeriod,
  checkAndRecordTardiness,
} = require('../services/tardiness.service');
const { generateExcel } = require('../services/export.service');

const axios = require('axios');

// Получить текущего пользователя через access_token пользовательской сессии.
// BX24.getAuth().access_token — это токен текущего пользователя (не app token),
// поэтому user.current вернёт именно его данные.
async function resolveCurrentUser(domain, accessToken) {
  const endpoint = `https://${domain}/rest/`;
  const res = await axios.post(`${endpoint}user.current`, { auth: accessToken });
  if (res.data.error) throw new Error(res.data.error_description || res.data.error);
  return res.data.result; // { ID, NAME, ... } — без поля ADMIN
}

// Middleware: определяем domain из заголовка, userId — через user.current с access_token
async function extractContext(req, res, next) {
  const domain = req.headers['x-bitrix-domain'] || req.query.DOMAIN || req.query.domain;
  const accessToken = req.headers['x-bitrix-access-token'] || req.query.token;

  if (!domain || !accessToken) {
    return res.status(400).json({ error: 'Missing domain or access token' });
  }

  try {
    const user = await resolveCurrentUser(domain, accessToken);
    req.domain = domain;
    req.userId = String(user.ID);
    console.log(`[ctx] domain=${domain} userId=${req.userId}`);
    next();
  } catch (err) {
    console.error('[ctx] resolveCurrentUser failed:', err.message);
    res.status(401).json({ error: 'Failed to resolve current user: ' + err.message });
  }
}

router.use(extractContext);

// Сегодняшняя дата в формате YYYY-MM-DD
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// GET /api/me — роль текущего пользователя
// getUserRole вызывает user.admin с токеном пользователя → честная проверка прав администратора
router.get('/me', async (req, res) => {
  try {
    const accessToken = req.headers['x-bitrix-access-token'];
    const role = await getUserRole(req.domain, req.userId, accessToken);
    res.json({ userId: req.userId, role });
  } catch (err) {
    console.error('[/me]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users — список всех сотрудников
router.get('/users', async (req, res) => {
  try {
    const users = await getUsers(req.domain);
    res.json(users);
  } catch (err) {
    console.error('[/users]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await getSettings(req.domain);
    res.json(settings);
  } catch (err) {
    console.error('[/settings GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings
router.post('/settings', async (req, res) => {
  try {
    const { trackedUsers, managers, lateThreshold, schedule } = req.body;
    await saveSettings(req.domain, { trackedUsers, managers, lateThreshold, schedule });
    res.json({ ok: true });
  } catch (err) {
    console.error('[/settings POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/report?dateFrom=&dateTo=&userIds=1,2,3
// Перед выдачей данных импортирует опоздания из timeman за запрошенный период.
router.get('/report', async (req, res) => {
  try {
    const { dateFrom, dateTo, userIds } = req.query;
    const userIdsArr = userIds ? userIds.split(',').filter(Boolean) : [];
    const today = todayISO();
    const from = dateFrom || '2020-01-01';
    const to   = dateTo   || today;

    const settings = await getSettings(req.domain);
    if (settings && settings.trackedUsers.length > 0) {
      const usersToCheck = userIdsArr.length > 0
        ? userIdsArr.filter((id) => settings.trackedUsers.includes(id))
        : settings.trackedUsers;

      // importTardinessForPeriod использует timeman.timecontrol.reports.get —
      // работает для любого исторического периода, не только сегодня
      const accessToken = req.headers['x-bitrix-access-token'];
      await importTardinessForPeriod(req.domain, usersToCheck, from, to, settings, accessToken);
    }

    const records = await getRecords(req.domain, { dateFrom, dateTo, userIds: userIdsArr });
    res.json(records);
  } catch (err) {
    console.error('[/report]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/report/export?dateFrom=&dateTo=&userIds=
router.get('/report/export', async (req, res) => {
  try {
    const { dateFrom, dateTo, userIds } = req.query;
    const userIdsArr = userIds ? userIds.split(',').filter(Boolean) : [];
    const records = await getRecords(req.domain, { dateFrom, dateTo, userIds: userIdsArr });
    const users = await getUsers(req.domain);

    const buffer = await generateExcel(records, users);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=tardiness-report.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('[/report/export]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tardiness/:id/reason-status — руководитель принимает/отклоняет причину
router.post('/tardiness/:id/reason-status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await updateReasonStatus(req.domain, req.params.id, status, req.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[/tardiness reason-status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/my-tardiness — опоздания текущего сотрудника
// Перед выдачей данных проверяет опоздание за сегодня для этого сотрудника.
router.get('/my-tardiness', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const today = todayISO();
    const from = dateFrom || '2020-01-01';
    const to   = dateTo   || today;

    const settings = await getSettings(req.domain);
    if (settings) {
      const accessToken = req.headers['x-bitrix-access-token'];
      await checkAndRecordTardiness(req.domain, req.userId, from, to, settings, accessToken).catch((err) =>
        console.error('[/my-tardiness] import failed:', err.message)
      );
    }

    const records = await getMyRecords(req.domain, req.userId, { dateFrom, dateTo });
    res.json(records);
  } catch (err) {
    console.error('[/my-tardiness]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/my-tardiness/:id/reason — сотрудник указывает причину
router.post('/my-tardiness/:id/reason', async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required' });
    }
    await updateReason(req.domain, req.params.id, reason.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error('[/my-tardiness reason]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
