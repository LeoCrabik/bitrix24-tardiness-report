const cron = require('node-cron');
const { getAllPortalDomains } = require('../storage/redis');
const { getSettings, recordExists, createRecord } = require('./tardiness.service');
const { callMethod } = require('./bitrix.client');

function startCron() {
  const hour = process.env.TARDINESS_CHECK_HOUR || '10';
  const minute = process.env.TARDINESS_CHECK_MINUTE || '0';

  const schedule = `${minute} ${hour} * * *`;
  console.log(`[cron] Tardiness check scheduled: ${schedule} UTC`);

  cron.schedule(schedule, async () => {
    console.log('[cron] Running tardiness check...');
    const domains = await getAllPortalDomains();

    for (const domain of domains) {
      try {
        await checkPortalTardiness(domain);
      } catch (err) {
        console.error(`[cron] Error for portal ${domain}:`, err.message);
      }
    }
  });
}

async function checkPortalTardiness(domain) {
  const settings = await getSettings(domain);
  if (!settings || settings.trackedUsers.length === 0) {
    console.log(`[cron] ${domain}: no tracked users, skipping`);
    return;
  }

  const today = getTodayDate();
  const isoDay = String(new Date().getDay() || 7); // 1=Mon, 7=Sun

  const daySchedule = settings.schedule[isoDay];
  if (!daySchedule || !daySchedule.enabled) {
    console.log(`[cron] ${domain}: day ${isoDay} is not a workday, skipping`);
    return;
  }

  console.log(`[cron] ${domain}: checking ${settings.trackedUsers.length} users for ${today}`);

  for (const userId of settings.trackedUsers) {
    try {
      await checkUserTardiness(domain, userId, today, settings);
    } catch (err) {
      console.error(`[cron] ${domain} user ${userId}:`, err.message);
    }
  }
}

async function checkUserTardiness(domain, userId, today, settings) {
  const alreadyExists = await recordExists(domain, userId, today);
  if (alreadyExists) return;

  // Получаем плановое время начала из настроек пользователя в timeman
  // UF_TM_MAX_START — максимальное разрешённое время начала, это и есть плановый порог
  const planStart = await getPlannedStartTime(domain, userId, today, settings);
  if (!planStart) {
    console.log(`[cron] ${domain} user ${userId}: no planned start time, skipping`);
    return;
  }

  // timeman.open — единственный доступный метод, возвращающий TIME_START.
  // Если день уже открыт — возвращает текущее состояние без изменений.
  // Если день не открыт к обеду — открывает его (сотрудник очень опоздал / отсутствует).
  const actualStart = await getActualStartTime(domain, userId, today);
  if (!actualStart) return;

  const planMs = new Date(planStart).getTime();
  const actualMs = new Date(actualStart).getTime();
  const lateMinutes = Math.round((actualMs - planMs) / 60000);

  if (lateMinutes <= settings.lateThreshold) return;

  const managerId = settings.managers[0] || null;

  await createRecord(domain, {
    userId,
    date: today,
    actualStart,
    planStart,
    lateMinutes,
    managerId,
  });

  console.log(`[cron] Recorded tardiness: domain=${domain} user=${userId} date=${today} late=${lateMinutes}min`);
}

// Плановое время начала: берём из timeman.settings пользователя (UF_TM_MAX_START),
// с фолбэком на расписание из настроек приложения.
async function getPlannedStartTime(domain, userId, date, settings) {
  try {
    const tmSettings = await callMethod(domain, 'timeman.settings', {
      USER_ID: parseInt(userId),
    });
    if (tmSettings && tmSettings.UF_TM_MAX_START) {
      // UF_TM_MAX_START в формате "HH:MM:SS"
      return `${date}T${tmSettings.UF_TM_MAX_START}`;
    }
  } catch (err) {
    console.warn(`[cron] timeman.settings failed for user ${userId}:`, err.message);
  }

  // Фолбэк: плановое время из расписания приложения
  const isoDay = String(new Date().getDay() || 7);
  const daySchedule = settings.schedule[isoDay];
  if (daySchedule && daySchedule.enabled && daySchedule.start) {
    return `${date}T${daySchedule.start}:00`;
  }

  return null;
}

// Фактическое время начала через timeman.open.
// В Bitrix24 REST API нет read-only метода для получения времени открытия рабочего дня.
// timeman.open возвращает TIME_START:
//   - день уже открыт → возвращает существующий TIME_START без изменений
//   - день не открыт → открывает рабочий день (сотрудник опоздал/отсутствует)
async function getActualStartTime(domain, userId, date) {
  try {
    const result = await callMethod(domain, 'timeman.open', {
      USER_ID: parseInt(userId),
    });

    if (!result || !result.TIME_START) return null;

    // Приводим TIME_START к дате без учёта часового пояса
    const startDate = result.TIME_START.substring(0, 10);
    if (startDate !== date) return null;

    return result.TIME_START;
  } catch (err) {
    console.error(`[cron] getActualStartTime user ${userId}:`, err.message);
    return null;
  }
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

module.exports = { startCron, checkPortalTardiness };
