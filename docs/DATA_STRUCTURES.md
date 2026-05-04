# Структуры данных — Универсальные списки Битрикс24

Все данные хранятся на стороне портала в двух универсальных списках типа `lists` (IBLOCK_TYPE_ID = `"lists"`).  
Оба списка создаются при установке приложения.

---

## Список 1: Записи об опозданиях

**Символьный код (CODE):** `TARDINESS_APP_RECORDS`  
**Название:** `Опоздания сотрудников`

### Поля

| CODE | Тип Б24 | IS_REQUIRED | Описание |
|---|---|---|---|
| `USER_ID` | `N` | Y | ID сотрудника в Битрикс24 |
| `DATE` | `S:Date` | Y | Дата рабочего дня |
| `ACTUAL_START` | `S:DateTime` | Y | Фактическое время начала рабочего дня |
| `PLAN_START` | `S:DateTime` | Y | Плановое время начала рабочего дня |
| `LATE_MINUTES` | `N` | Y | Количество минут опоздания |
| `REASON` | `S` | N | Причина опоздания (текст от сотрудника) |
| `REASON_STATUS` | `S` | N | Статус причины: `NONE` / `PENDING` / `ACCEPTED` / `REJECTED` |
| `MANAGER_ID` | `N` | N | ID руководителя, изменившего статус |
| `RESOLVED_AT` | `S:DateTime` | N | Когда руководитель принял/отклонил |

> **Важно:** поля с `IS_REQUIRED: Y` обязательны не только при создании, но и при **любом обновлении** через `lists.element.update`. Иначе Б24 вернёт 400.

### Значения `REASON_STATUS`

| Значение | Описание |
|---|---|
| `NONE` | Причина не указана (по умолчанию) |
| `PENDING` | Сотрудник указал причину, ожидает рассмотрения |
| `ACCEPTED` | Руководитель принял причину |
| `REJECTED` | Руководитель отклонил причину |

### Именование элементов

- `NAME` = `ELEMENT_CODE` = `{date}_user_{userId}`, например `2026-04-28_user_42`
- Уникальность: одна запись на пару (userId, date) — гарантируется через Set имён в памяти

---

## Список 2: Настройки приложения

**Символьный код (CODE):** `TARDINESS_APP_SETTINGS`  
**Название:** `Настройки приложения`  
**Хранит одну запись** (singleton) с `NAME='settings'`, `ELEMENT_CODE='app_settings'`.

### Поля

| CODE | Тип Б24 | Описание |
|---|---|---|
| `TRACKED_USERS` | `S` | JSON-массив ID отслеживаемых сотрудников |
| `MANAGERS` | `S` | JSON-массив ID руководителей |
| `LATE_THRESHOLD` | `N` | Порог опоздания в минутах (по умолчанию 5) |
| `SCHEDULE` | `S` | JSON-объект расписания по дням недели |

### Формат `SCHEDULE`

```json
{
  "1": { "enabled": true,  "start": "09:00", "end": "18:00" },
  "2": { "enabled": true,  "start": "09:00", "end": "18:00" },
  "3": { "enabled": true,  "start": "09:00", "end": "18:00" },
  "4": { "enabled": true,  "start": "09:00", "end": "18:00" },
  "5": { "enabled": true,  "start": "09:00", "end": "18:00" },
  "6": { "enabled": false, "start": "09:00", "end": "18:00" },
  "7": { "enabled": false, "start": "09:00", "end": "18:00" }
}
```

Ключи: `"1"` = понедельник, `"7"` = воскресенье (ISO 8601).  
`enabled: false` — выходной день, опоздания не фиксируются.

---

## Как Б24 возвращает данные из lists.element.get

### Свойства — числовой ключ, значение напрямую

Б24 присваивает полям числовые ID при создании (например `PROPERTY_310`). При чтении:

```js
// Б24 возвращает:
el = {
  "ID": "752",
  "NAME": "2026-04-15_user_258",
  "PROPERTY_310": { "1588": "258" },   // USER_ID
  "PROPERTY_312": { "1590": "15.04.2026" },   // DATE
  "PROPERTY_314": { "1592": "15.04.2026 09:00:00" },  // PLAN_START
  "PROPERTY_316": { "1594": "15.04.2026 09:13:55" },  // ACTUAL_START
  "PROPERTY_318": { "1596": "13" }    // LATE_MINUTES
}

// Чтение значения:
function propVal(prop) { return Object.values(prop || {})[0] || ''; }
propVal(el['PROPERTY_310']) // → "258"
```

### DateTime хранится в российском формате

`S:Date` → `"15.04.2026"` (DD.MM.YYYY)  
`S:DateTime` → `"15.04.2026 09:13:55"` (DD.MM.YYYY HH:MM:SS)

Backend конвертирует в ISO перед отправкой на фронт:
```js
// "15.04.2026 09:13:55" → "2026-04-15T09:13:55"
function parseRecordDateTime(raw) {
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
  return raw;
}
```

### Маппинг полей через lists.field.get

Числовые ID полей (`PROPERTY_310`, `PROPERTY_312`, ...) определяются динамически:

```js
const fields = await callMethod(domain, 'lists.field.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: listId });
// → { "PROPERTY_310": { CODE: "USER_ID", TYPE: "N", ... }, ... }

const map = {};
for (const [fieldId, field] of Object.entries(fields)) {
  if (field.CODE) map[field.CODE] = fieldId;
}
// map = { USER_ID: "PROPERTY_310", DATE: "PROPERTY_312", ... }
```

---

## Пример нормализованной записи (после обработки бэкендом)

```json
{
  "id": "752",
  "name": "2026-04-15_user_258",
  "userId": "258",
  "date": "2026-04-15",
  "actualStart": "2026-04-15T09:13:55",
  "planStart": "2026-04-15T09:00:00",
  "lateMinutes": 13,
  "reason": "Задержка из-за пробок",
  "reasonStatus": "ACCEPTED",
  "managerId": "1",
  "resolvedAt": "2026-04-16T10:00:00"
}
```
