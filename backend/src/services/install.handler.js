const { callMethod } = require('./bitrix.client');

const RECORDS_CODE = 'TARDINESS_APP_RECORDS';
const SETTINGS_CODE = 'TARDINESS_APP_SETTINGS';

const RECORDS_FIELDS = [
  { CODE: 'USER_ID',       TYPE: 'N',          NAME: 'ID сотрудника',               MULTIPLE: 'N', IS_REQUIRED: 'Y', SORT: 10 },
  { CODE: 'DATE',          TYPE: 'S:Date',      NAME: 'Дата рабочего дня',           MULTIPLE: 'N', IS_REQUIRED: 'Y', SORT: 20 },
  { CODE: 'ACTUAL_START',  TYPE: 'S:DateTime',  NAME: 'Фактическое время начала',    MULTIPLE: 'N', IS_REQUIRED: 'Y', SORT: 30 },
  { CODE: 'PLAN_START',    TYPE: 'S:DateTime',  NAME: 'Плановое время начала',       MULTIPLE: 'N', IS_REQUIRED: 'Y', SORT: 40 },
  { CODE: 'LATE_MINUTES',  TYPE: 'N',           NAME: 'Минут опоздания',             MULTIPLE: 'N', IS_REQUIRED: 'Y', SORT: 50 },
  { CODE: 'REASON',        TYPE: 'S',           NAME: 'Причина',                     MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 60 },
  { CODE: 'REASON_STATUS', TYPE: 'S',           NAME: 'Статус причины',              MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 70 },
  { CODE: 'MANAGER_ID',   TYPE: 'N',           NAME: 'ID руководителя',             MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 80 },
  { CODE: 'RESOLVED_AT',  TYPE: 'S:DateTime',  NAME: 'Дата принятия/отклонения',    MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 90 },
];

const SETTINGS_FIELDS = [
  { CODE: 'TRACKED_USERS',  TYPE: 'S', NAME: 'Отслеживаемые сотрудники (JSON)', MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 10 },
  { CODE: 'MANAGERS',       TYPE: 'S', NAME: 'Руководители (JSON)',             MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 20 },
  { CODE: 'LATE_THRESHOLD', TYPE: 'N', NAME: 'Порог опоздания (мин)',           MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 30 },
  { CODE: 'SCHEDULE',       TYPE: 'S', NAME: 'Расписание (JSON)',               MULTIPLE: 'N', IS_REQUIRED: 'N', SORT: 40 },
];

const DEFAULT_SCHEDULE = JSON.stringify({
  '1': { enabled: true,  start: '09:00', end: '18:00' },
  '2': { enabled: true,  start: '09:00', end: '18:00' },
  '3': { enabled: true,  start: '09:00', end: '18:00' },
  '4': { enabled: true,  start: '09:00', end: '18:00' },
  '5': { enabled: true,  start: '09:00', end: '18:00' },
  '6': { enabled: false, start: '09:00', end: '18:00' },
  '7': { enabled: false, start: '09:00', end: '18:00' },
});

async function handleInstall(domain, tokens) {
  console.log(`[install] Starting installation for portal: ${domain}`);

  const recordsListId = await ensureList(domain, RECORDS_CODE, 'Опоздания сотрудников', RECORDS_FIELDS);
  const settingsListId = await ensureList(domain, SETTINGS_CODE, 'Настройки приложения', SETTINGS_FIELDS);

  await ensureSettingsSingleton(domain, settingsListId);

  await callMethod(domain, 'app.option.set', {
    options: {
      records_list_id: String(recordsListId),
      settings_list_id: String(settingsListId),
    },
  });

  console.log(`[install] Done. records_list_id=${recordsListId}, settings_list_id=${settingsListId}`);
}

async function ensureList(domain, code, name, fields) {
  // lists.get: IBLOCK_CODE — верхний уровень
  const existing = await callMethod(domain, 'lists.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_CODE: code,
  });

  if (existing && existing.length > 0) {
    console.log(`[install] List ${code} already exists, id=${existing[0].ID}`);
    return existing[0].ID;
  }

  // lists.add: IBLOCK_CODE — верхний уровень, NAME — внутри FIELDS
  const listId = await callMethod(domain, 'lists.add', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_CODE: code,
    FIELDS: {
      NAME: name,
    },
  });

  console.log(`[install] Created list ${code}, id=${listId}`);

  // lists.field.add: TYPE и CODE внутри FIELDS (не FIELD_TYPE / FIELD_NAME)
  for (const field of fields) {
    await callMethod(domain, 'lists.field.add', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId,
      FIELDS: {
        NAME:        field.NAME,
        CODE:        field.CODE,
        TYPE:        field.TYPE,
        MULTIPLE:    field.MULTIPLE,
        IS_REQUIRED: field.IS_REQUIRED,
        SORT:        field.SORT,
      },
    });
    console.log(`[install] Added field ${field.CODE} to list ${code}`);
  }

  return listId;
}

async function ensureSettingsSingleton(domain, settingsListId) {
  const existing = await callMethod(domain, 'lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
    FILTER: { NAME: 'settings' },
  });

  if (existing && existing.length > 0) {
    console.log('[install] Settings singleton already exists');
    return;
  }

  // lists.element.add: ELEMENT_CODE обязателен на верхнем уровне
  // Значения PROPERTY — plain string (не { n0: value })
  await callMethod(domain, 'lists.element.add', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
    ELEMENT_CODE: 'app_settings',
    FIELDS: {
      NAME:                    'settings',
      PROPERTY_TRACKED_USERS:  '[]',
      PROPERTY_MANAGERS:       '[]',
      PROPERTY_LATE_THRESHOLD: '5',
      PROPERTY_SCHEDULE:       DEFAULT_SCHEDULE,
    },
  });

  console.log('[install] Created default settings singleton');
}

module.exports = { handleInstall };
