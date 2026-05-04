require('dotenv').config();
const { getPortalTokens } = require('./src/storage/redis');
const { callMethod } = require('./src/services/bitrix.client');

const DOMAIN = 'systemcrm.bitrix24.ru';

const TRACKED_USERS = ['258'];
const MANAGERS      = [];
const LATE_THRESHOLD = 5;
const SCHEDULE = {
  '1': { enabled: true,  start: '09:00', end: '18:00' },
  '2': { enabled: true,  start: '09:00', end: '18:00' },
  '3': { enabled: true,  start: '09:00', end: '18:00' },
  '4': { enabled: true,  start: '09:00', end: '18:00' },
  '5': { enabled: true,  start: '09:00', end: '18:00' },
  '6': { enabled: false, start: '09:00', end: '18:00' },
  '7': { enabled: false, start: '09:00', end: '18:00' },
};

(async () => {
  // Получаем ID списка настроек
  const opts = await callMethod(DOMAIN, 'app.option.get', {
    options: ['settings_list_id'],
  });
  const settingsListId = opts.settings_list_id;
  console.log('settingsListId:', settingsListId);

  // Получаем маппинг CODE → FIELD_ID
  const fields = await callMethod(DOMAIN, 'lists.field.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
  });
  const fm = {};
  for (const [fieldId, field] of Object.entries(fields || {})) {
    if (field.CODE) fm[field.CODE] = fieldId;
  }
  console.log('field map:', fm);

  // Получаем ID элемента настроек
  const items = await callMethod(DOMAIN, 'lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
    FILTER: { NAME: 'settings' },
    SELECT: ['ID'],
  });
  const elementId = items[0].ID;
  console.log('elementId:', elementId);

  // Обновляем
  const result = await callMethod(DOMAIN, 'lists.element.update', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
    ELEMENT_ID: elementId,
    FIELDS: {
      NAME: 'settings',
      [fm.TRACKED_USERS]:  JSON.stringify(TRACKED_USERS),
      [fm.MANAGERS]:       JSON.stringify(MANAGERS),
      [fm.LATE_THRESHOLD]: String(LATE_THRESHOLD),
      [fm.SCHEDULE]:       JSON.stringify(SCHEDULE),
    },
  });
  console.log('update result:', result);

  // Читаем обратно для проверки
  const check = await callMethod(DOMAIN, 'lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: settingsListId,
    FILTER: { NAME: 'settings' },
    SELECT: ['ID', 'NAME', ...Object.values(fm)],
  });
  const el = check[0];
  console.log('trackedUsers after:', el[fm.TRACKED_USERS]?.n0?.VALUE);
  console.log('schedule after:', el[fm.SCHEDULE]?.n0?.VALUE);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
