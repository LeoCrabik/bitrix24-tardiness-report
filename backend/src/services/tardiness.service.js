const { callMethod, callBatch, callWithUserToken } = require('./bitrix.client');

async function getListIds(domain) {
  const opts = await callMethod(domain, 'app.option.get', {
    options: ['records_list_id', 'settings_list_id'],
  });
  return {
    recordsListId: opts.records_list_id,
    settingsListId: opts.settings_list_id,
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

// Возвращает маппинг CODE → FIELD_ID для свойств списка настроек.
// Б24 хранит свойства под числовым FIELD_ID (PROPERTY_328), а не по CODE (PROPERTY_TRACKED_USERS).
async function getSettingsFieldMap(domain, settingsListId) {
  const fields = await callMethod(domain, 'lists.field.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
  });
  const map = {};
  for (const [fieldId, field] of Object.entries(fields || {})) {
    if (field.CODE) map[field.CODE] = fieldId; // { TRACKED_USERS: 'PROPERTY_328', ... }
  }
  return map;
}

async function getSettings(domain) {
  const { settingsListId } = await getListIds(domain);
  const fm = await getSettingsFieldMap(domain, settingsListId);

  const items = await callMethod(domain, 'lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
    FILTER: { NAME: 'settings' },
    SELECT: ['ID', 'NAME', ...Object.values(fm)],
  });

  if (!items || items.length === 0) return null;
  const el = items[0];

  return {
    id: el.ID,
    trackedUsers: JSON.parse(propVal(el[fm.TRACKED_USERS])  || '[]'),
    managers:     JSON.parse(propVal(el[fm.MANAGERS])       || '[]'),
    lateThreshold: parseInt(propVal(el[fm.LATE_THRESHOLD])  || '5', 10),
    schedule:     JSON.parse(propVal(el[fm.SCHEDULE])       || '{}'),
  };
}

async function saveSettings(domain, { trackedUsers, managers, lateThreshold, schedule }) {
  const { settingsListId } = await getListIds(domain);
  const fm = await getSettingsFieldMap(domain, settingsListId);
  const current = await getSettings(domain);

  console.log('[saveSettings] settingsListId=', settingsListId);
  console.log('[saveSettings] fieldMap=', JSON.stringify(fm));
  console.log('[saveSettings] ELEMENT_ID=', current?.id);

  const fields = {
    NAME: 'settings',
    [fm.TRACKED_USERS]:  JSON.stringify(trackedUsers),
    [fm.MANAGERS]:       JSON.stringify(managers),
    [fm.LATE_THRESHOLD]: String(lateThreshold),
    [fm.SCHEDULE]:       JSON.stringify(schedule),
  };

  console.log('[saveSettings] FIELDS to send:', JSON.stringify(fields));

  const result = await callMethod(domain, 'lists.element.update', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
    ELEMENT_ID: current.id,
    FIELDS: fields,
  });

  console.log('[saveSettings] update result:', result);

  // Верификация: перечитываем и логируем
  const saved = await getSettings(domain);
  console.log('[saveSettings] re-read after update:', JSON.stringify(saved));
}

// ─── Records ─────────────────────────────────────────────────────────────────

// Маппинг CODE → FIELD_ID для списка записей об опозданиях
async function getRecordsFieldMap(domain, recordsListId) {
  const fields = await callMethod(domain, 'lists.field.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: recordsListId,
  });
  const map = {};
  for (const [fieldId, field] of Object.entries(fields || {})) {
    if (field.CODE) map[field.CODE] = fieldId;
  }
  return map;
}

async function getRecords(domain, { dateFrom, dateTo, userIds } = {}) {
  const { recordsListId } = await getListIds(domain);
  const fm = await getRecordsFieldMap(domain, recordsListId);

  // Б24 хранит дату в русском формате (DD.MM.YYYY) — сравнение по ISO не работает.
  // Массив userId в фильтре lists.element.get тоже не поддерживается.
  // Поэтому тянем ВСЕ записи и фильтруем на JS-стороне.
  const items = await callMethod(domain, 'lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: recordsListId,
    FILTER: {},
    SELECT: ['ID', 'NAME', ...Object.values(fm)],
  });

  let records = (items || []).map((el) => normalizeRecord(el, fm));

  // JS-фильтрация: userId
  if (userIds && userIds.length > 0) {
    const ids = userIds.map(String);
    records = records.filter((r) => ids.includes(String(r.userId)));
  }

  // JS-фильтрация: дата. Запись хранит дату в ISO (мы сохраняем как date=todayISO).
  // Если Б24 вернул русский формат — парсим оба варианта.
  if (dateFrom || dateTo) {
    records = records.filter((r) => {
      const d = parseRecordDate(r.date);
      if (!d) return true;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      return true;
    });
  }

  return records;
}

async function getMyRecords(domain, userId, { dateFrom, dateTo } = {}) {
  return getRecords(domain, { dateFrom, dateTo, userIds: [userId] });
}

// FILTER: { NAME: ... } в lists.element.get не работает в Б24 — игнорирует фильтр и возвращает все записи.
// Поэтому recordExists больше не используется для API-вызовов.
// Вместо этого используем getExistingRecordNames() для разовой загрузки всех имён.
async function getExistingRecordNames(domain) {
  const { recordsListId } = await getListIds(domain);
  const items = await callMethod(domain, 'lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: recordsListId,
    FILTER: {},
    SELECT: ['ID', 'NAME'],
  });
  const names = new Set((items || []).map((el) => el.NAME));
  console.log(`[tardiness] existing records: ${names.size} (${[...names].slice(0, 5).join(', ')}${names.size > 5 ? '...' : ''})`);
  return names;
}

async function createRecord(domain, { userId, date, actualStart, planStart, lateMinutes, managerId }) {
  const { recordsListId } = await getListIds(domain);
  const fm = await getRecordsFieldMap(domain, recordsListId);

  await callMethod(domain, 'lists.element.add', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: recordsListId,
    ELEMENT_CODE: `${date}_user_${userId}`,
    FIELDS: {
      NAME: `${date}_user_${userId}`,
      [fm.USER_ID]:       String(userId),
      [fm.DATE]:          date,
      [fm.ACTUAL_START]:  actualStart,
      [fm.PLAN_START]:    planStart,
      [fm.LATE_MINUTES]:  String(lateMinutes),
      [fm.REASON_STATUS]: 'NONE',
      [fm.MANAGER_ID]:    managerId ? String(managerId) : '',
    },
  });
}

// Читает запись по ID и возвращает её вместе с field map и recordsListId.
// lists.element.get с FILTER: { ID } может не фильтровать — ищем в JS.
async function getRecordById(domain, recordId) {
  const { recordsListId } = await getListIds(domain);
  const fm = await getRecordsFieldMap(domain, recordsListId);
  const items = await callMethod(domain, 'lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: recordsListId,
    FILTER: { ID: recordId },
    SELECT: ['ID', 'NAME', ...Object.values(fm)],
  });
  const found = (items || []).find((el) => String(el.ID) === String(recordId));
  if (!found) throw new Error(`Record ${recordId} not found`);
  return { el: found, fm, recordsListId };
}

async function updateReasonStatus(domain, recordId, status, managerId) {
  const { el, fm, recordsListId } = await getRecordById(domain, recordId);

  await callMethod(domain, 'lists.element.update', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: recordsListId,
    ELEMENT_ID: recordId,
    FIELDS: {
      NAME:               el.NAME,
      [fm.USER_ID]:       propVal(el[fm.USER_ID]),
      [fm.DATE]:          propVal(el[fm.DATE]),
      [fm.ACTUAL_START]:  propVal(el[fm.ACTUAL_START]),
      [fm.PLAN_START]:    propVal(el[fm.PLAN_START]),
      [fm.LATE_MINUTES]:  propVal(el[fm.LATE_MINUTES]),
      [fm.REASON]:        propVal(el[fm.REASON]),
      [fm.REASON_STATUS]: status,
      [fm.MANAGER_ID]:    String(managerId),
      [fm.RESOLVED_AT]:   new Date().toISOString(),
    },
  });
}

async function updateReason(domain, recordId, reason) {
  const { el, fm, recordsListId } = await getRecordById(domain, recordId);
  console.log(`[updateReason] id=${recordId} name=${el.NAME} fm.REASON=${fm.REASON}`);

  await callMethod(domain, 'lists.element.update', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: recordsListId,
    ELEMENT_ID: recordId,
    FIELDS: {
      NAME:               el.NAME,
      [fm.USER_ID]:       propVal(el[fm.USER_ID]),
      [fm.DATE]:          propVal(el[fm.DATE]),
      [fm.ACTUAL_START]:  propVal(el[fm.ACTUAL_START]),
      [fm.PLAN_START]:    propVal(el[fm.PLAN_START]),
      [fm.LATE_MINUTES]:  propVal(el[fm.LATE_MINUTES]),
      [fm.REASON]:        reason,
      [fm.REASON_STATUS]: 'PENDING',
    },
  });
}

// ─── Users ───────────────────────────────────────────────────────────────────

async function getUsers(domain) {
  const users = await callMethod(domain, 'user.get', {
    ACTIVE: true,
    USER_TYPE: 'employee', // только штатные сотрудники, без гостей и экстранет
    SELECT: ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'WORK_POSITION', 'PERSONAL_PHOTO', 'ADMIN'],
  });
  return (users || []).map((u) => ({
    id: u.ID,
    name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' '),
    position: u.WORK_POSITION || '',
    photo: u.PERSONAL_PHOTO || null,
    isAdmin: u.ADMIN === 'Y',
  }));
}

// userAccessToken — access_token текущего пользователя (из x-bitrix-access-token заголовка).
// user.admin возвращает true/false — проверяет, является ли владелец токена администратором портала.
async function getUserRole(domain, userId, userAccessToken) {
  // Проверяем права администратора через user.admin (требует токен пользователя)
  if (userAccessToken) {
    try {
      const isAdmin = await callWithUserToken(domain, 'user.admin', {}, userAccessToken);
      console.log(`[getUserRole] domain=${domain} userId=${userId} user.admin result:`, isAdmin);
      if (isAdmin) return 'admin';
    } catch (err) {
      console.warn(`[getUserRole] user.admin failed for userId=${userId}:`, err.message);
    }
  }

  const settings = await getSettings(domain);
  if (settings && settings.managers.includes(String(userId))) return 'manager';

  return 'employee';
}

// ─── Tardiness import via timeman.timecontrol.reports.get ────────────────────
//
// timeman.timecontrol.reports.get возвращает все рабочие дни за месяц с
// полем workday_date_start (ATOM) — фактическое время начала рабочего дня.
// Это позволяет импортировать историю за любой период, а не только сегодня.

// userAccessToken — токен текущего пользователя (из x-bitrix-access-token).
// timeman.timecontrol.reports.get работает только с пользовательским токеном, не с app-токеном.
async function importTardinessForPeriod(domain, userIds, dateFrom, dateTo, settings, userAccessToken) {
  if (!settings || !userIds || userIds.length === 0) return;

  const today = new Date().toISOString().split('T')[0];
  const to = dateTo && dateTo < today ? dateTo : today;
  const months = getMonthsInRange(dateFrom, to);

  // Загружаем все существующие записи один раз — FILTER: { NAME } в Б24 не работает
  const existingNames = await getExistingRecordNames(domain);

  await Promise.allSettled(
    userIds.map(async (userId) => {
      // Проверяем включён ли timeman для пользователя
      try {
        const tmSettings = await callMethod(domain, 'timeman.settings', { USER_ID: parseInt(userId) });
        if (tmSettings?.UF_TIMEMAN === false) {
          console.log(`[tardiness] userId=${userId} timeman disabled, skipping`);
          return;
        }
      } catch (err) {
        console.warn(`[tardiness] timeman.settings failed user=${userId}:`, err.message);
      }

      for (const { month, year } of months) {
        try {
          await importMonthTardiness(domain, userId, month, year, dateFrom, to, settings, userAccessToken, existingNames);
        } catch (err) {
          console.error(`[tardiness] importMonth failed user=${userId} ${year}-${month}:`, err.message);
        }
      }
    })
  );
}

async function importMonthTardiness(domain, userId, month, year, dateFrom, dateTo, settings, userAccessToken, existingNames) {
  // timeman.timecontrol.reports.get требует пользовательский токен (не app-токен)
  const report = userAccessToken
    ? await callWithUserToken(domain, 'timeman.timecontrol.reports.get', { USER_ID: parseInt(userId), MONTH: month, YEAR: year }, userAccessToken)
    : await callMethod(domain, 'timeman.timecontrol.reports.get', { USER_ID: parseInt(userId), MONTH: month, YEAR: year });

  const days = report?.report?.days || {};
  console.log(`[tardiness] reports.get user=${userId} ${year}-${String(month).padStart(2,'0')}: ${Object.keys(days).length} days`);
  // Логируем первые 3 дня для диагностики структуры ответа
  Object.entries(days).slice(0, 3).forEach(([di, d]) => {
    console.log(`[tardiness] sample day ${di}:`, JSON.stringify({ workday_date_start: d.workday_date_start, workday_complete: d.workday_complete }));
  });

  // days — массив (не объект с YYYYMMDD ключами).
  // Дата берётся из workday_date_start, а не из ключа массива.
  for (const dayData of Object.values(days)) {
    if (!dayData.workday_date_start) continue;

    // Дата из ATOM: "2026-04-13T08:59:52+03:00" → "2026-04-13"
    const date = dayData.workday_date_start.substring(0, 10);

    if (date < dateFrom || date > dateTo) continue;

    const recordName = `${date}_user_${userId}`;
    if (existingNames.has(recordName)) continue;

    const planStart = getPlanStartFromSchedule(date, settings);
    if (!planStart) { console.log(`[tardiness] user=${userId} date=${date} — weekend by schedule, skip`); continue; }

    const actualStart = dayData.workday_date_start; // ATOM: "2026-04-15T09:13:55+03:00"

    // Берём TZ из actualStart и применяем к planStart — иначе Node.js парсит planStart как UTC,
    // и все выглядят "пришедшими на 3 часа раньше" (Moscow +03:00 vs UTC).
    const tzMatch = actualStart.match(/([+-]\d{2}:\d{2})$/);
    const tz = tzMatch ? tzMatch[1] : '+00:00';
    const planStartWithTz = planStart + tz; // "2026-04-15T09:00:00+03:00"
    const lateMinutes = Math.round((new Date(actualStart) - new Date(planStartWithTz)) / 60000);
    console.log(`[tardiness] user=${userId} date=${date} plan=${planStartWithTz} actual=${actualStart} late=${lateMinutes}min`);

    if (lateMinutes <= settings.lateThreshold) continue;

    const managerId = settings.managers[0] || null;
    await createRecord(domain, { userId, date, actualStart, planStart, lateMinutes, managerId });
    existingNames.add(recordName); // предотвращаем дубли внутри одного запуска
    console.log(`[tardiness] RECORDED user=${userId} date=${date} late=${lateMinutes}min`);
  }
}

// Плановое время начала из расписания приложения (без обращения в Б24).
// date = "2025-05-26"
function getPlanStartFromSchedule(date, settings) {
  // getDay() возвращает 0=вс...6=сб, нам нужно 1=пн...7=вс (ISO)
  const jsDay = new Date(date + 'T12:00:00').getDay();
  const isoDay = String(jsDay === 0 ? 7 : jsDay);
  const daySchedule = settings.schedule?.[isoDay];
  if (!daySchedule || !daySchedule.enabled || !daySchedule.start) return null;
  return `${date}T${daySchedule.start}:00`;
}

// Возвращает список { month, year } для всех месяцев от dateFrom до dateTo включительно.
function getMonthsInRange(dateFrom, dateTo) {
  const months = [];
  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T00:00:00');
  let cur = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cur <= to) {
    months.push({ month: cur.getMonth() + 1, year: cur.getFullYear() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

// Оставляем для обратной совместимости — используется в /api/my-tardiness для одного пользователя
async function checkAndRecordTardiness(domain, userId, dateFrom, dateTo, settings, userAccessToken) {
  return importTardinessForPeriod(domain, [userId], dateFrom, dateTo, settings, userAccessToken);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Б24 возвращает свойства списка в формате { "1572": "value" } — числовой ключ, значение напрямую.
// НЕ { n0: { VALUE: "..." } } как можно было бы ожидать.
function propVal(prop) {
  if (!prop || typeof prop !== 'object') return '';
  return Object.values(prop)[0] || '';
}

// Нормализует дату из записи в ISO YYYY-MM-DD.
// Б24 может вернуть русский формат DD.MM.YYYY или ISO YYYY-MM-DD.
function parseRecordDate(raw) {
  if (!raw) return null;
  // Русский формат: DD.MM.YYYY
  const ruMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ruMatch) return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
  // ISO или datetime: берём первые 10 символов
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  return null;
}

// Нормализует дату-время из Б24 в ISO 8601.
// Б24 хранит DateTime поля в формате "DD.MM.YYYY HH:MM:SS".
// ATOM-строки с TZ (из timeman) оставляем как есть.
function parseRecordDateTime(raw) {
  if (!raw) return '';
  // Русский формат: "04.05.2026 09:10:59"
  const ruMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (ruMatch) return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}T${ruMatch[4]}`;
  // Уже ISO или ATOM — возвращаем как есть
  return raw;
}

function normalizeRecord(el, fm) {
  const rawDate        = propVal(el[fm.DATE]);
  const rawActualStart = propVal(el[fm.ACTUAL_START]);
  const rawPlanStart   = propVal(el[fm.PLAN_START]);
  const rawResolvedAt  = propVal(el[fm.RESOLVED_AT]);
  return {
    id: el.ID,
    name: el.NAME,
    userId:      propVal(el[fm.USER_ID]),
    date:        parseRecordDate(rawDate) || rawDate,
    actualStart: parseRecordDateTime(rawActualStart),
    planStart:   parseRecordDateTime(rawPlanStart),
    lateMinutes: parseInt(propVal(el[fm.LATE_MINUTES]) || '0', 10),
    reason:      propVal(el[fm.REASON]) || '',
    reasonStatus: propVal(el[fm.REASON_STATUS]) || 'NONE',
    managerId:   propVal(el[fm.MANAGER_ID]) || null,
    resolvedAt:  rawResolvedAt ? parseRecordDateTime(rawResolvedAt) : null,
  };
}

module.exports = {
  getSettings,
  saveSettings,
  getRecords,
  getMyRecords,
  createRecord,
  updateReasonStatus,
  updateReason,
  getUsers,
  getUserRole,
  importTardinessForPeriod,
  checkAndRecordTardiness,
};
