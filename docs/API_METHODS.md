# Методы Битрикс24 REST API

Scope: `timeman`, `lists`, `user`, `department`

---

## Учёт рабочего времени (timeman)

### `timeman.timecontrol.reports.get` ⭐ основной метод

Получить историю рабочих дней конкретного пользователя за месяц.

> **Важно:** требует **пользовательский токен** (`callWithUserToken`). С app-токеном возвращает `{"error":"wrong_client"}`.

**Параметры:**
| Поле | Тип | Описание |
|---|---|---|
| `USER_ID` | int | ID пользователя |
| `MONTH` | int | Месяц (1–12) |
| `YEAR` | int | Год |

**Возвращает:** `{ report: { days: [...] } }`

Поле `days` — **массив** (не объект с YYYYMMDD-ключами!), ключи `"0"`, `"1"`, `"2"`, ...

Каждый элемент массива:
| Поле | Тип | Описание |
|---|---|---|
| `workday_date_start` | string | Фактическое время начала дня в формате ATOM: `"2026-04-15T09:13:55+03:00"` |
| `workday_complete` | bool | Завершён ли рабочий день |

**Пример обработки:**
```js
const days = report?.report?.days || {};
for (const dayData of Object.values(days)) {
  if (!dayData.workday_date_start) continue;
  const date = dayData.workday_date_start.substring(0, 10); // "2026-04-15"
  const actualStart = dayData.workday_date_start; // "2026-04-15T09:13:55+03:00"
  // ...
}
```

**Часовой пояс:** `workday_date_start` содержит TZ пользователя (+03:00 для Москвы).  
При расчёте опоздания нужно добавить тот же TZ к плановому времени, иначе Node.js парсит его как UTC и даёт ошибку в 3 часа:
```js
const tzMatch = actualStart.match(/([+-]\d{2}:\d{2})$/);
const tz = tzMatch ? tzMatch[1] : '+00:00';
const planStartWithTz = `${date}T${scheduleStart}:00${tz}`;
const lateMinutes = Math.round((new Date(actualStart) - new Date(planStartWithTz)) / 60000);
```

---

### `timeman.settings`

Получить настройки учёта рабочего времени для пользователя.

**Параметры:**
- `USER_ID` — ID пользователя

**Ключевые поля ответа:**
| Поле | Тип | Описание |
|---|---|---|
| `UF_TIMEMAN` | bool | Включён ли учёт РВ для пользователя |
| `UF_TM_MAX_START` | string | Максимальное время начала `HH:MM:SS` |

**Использование:** Проверка `UF_TIMEMAN` перед импортом — если `false`, пользователь пропускается.

---

### `timeman.schedule.get`

Получить рабочий график по ID. Зарезервирован для будущей интеграции (в текущей версии не используется — плановое время берётся из настроек приложения).

---

## Пользователи

### `user.get`

Получить список пользователей.

**Параметры (фильтры):**
- `ACTIVE: true` — только активные
- `USER_TYPE: 'employee'` — только штатные (без гостей и экстранет)

**Ключевые поля ответа:**
| Поле | Описание |
|---|---|
| `ID` | ID пользователя |
| `NAME`, `LAST_NAME` | Имя и фамилия |
| `PERSONAL_PHOTO` | Фото |
| `WORK_POSITION` | Должность |
| `ADMIN` | `"Y"` если администратор портала |

---

### `user.admin`

Проверить, является ли владелец токена администратором портала.

> **Важно:** требует **пользовательский токен** (`callWithUserToken`). С app-токеном не отражает реальные права.

**Возвращает:** `true` / `false`

**Использование:**
```js
const isAdmin = await callWithUserToken(domain, 'user.admin', {}, userAccessToken);
```

---

### `user.current`

Получить данные текущего пользователя по его токену.

**Использование:** В middleware `extractContext` для определения `userId` из `x-bitrix-access-token`.

---

## Универсальные списки (lists)

### Критические особенности (выявлены опытным путём)

**1. `FILTER: { NAME: '...' }` не работает**  
`lists.element.get` с фильтром по NAME возвращает все элементы, игнорируя фильтр.  
Решение: загружать все записи один раз и фильтровать в JS.

**2. Чтение свойств — числовой ключ, значение напрямую**  
```js
// Б24 возвращает: { "1572": "value" }
// НЕ { n0: { VALUE: "..." } }
function propVal(prop) { return Object.values(prop || {})[0] || ''; }
```

**3. `lists.element.update` требует все IS_REQUIRED поля**  
Если поле помечено `IS_REQUIRED: 'Y'` при создании, оно обязательно в каждом update. Иначе — 400.

**4. Значения при add — plain string, при update — тоже plain string**  
```js
// Правильно:
PROPERTY_FOO: 'value'
// Неправильно (вызывает 400):
PROPERTY_FOO: { n0: 'value' }
```

**5. DateTime в Б24 хранится в российском формате**  
При чтении: `"04.05.2026 09:10:59"` → конвертировать в `"2026-05-04T09:10:59"` для JS/фронта.

**6. `SELECT` обязателен**  
Без `SELECT` свойства не возвращаются.

---

### `lists.get`

Проверить существование списка по коду.

```js
callMethod(domain, 'lists.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_CODE: 'TARDINESS_APP_RECORDS' })
```

### `lists.add`

Создать новый универсальный список.

```js
callMethod(domain, 'lists.add', {
  IBLOCK_TYPE_ID: 'lists',
  IBLOCK_CODE: 'TARDINESS_APP_RECORDS',
  FIELDS: { NAME: 'Опоздания сотрудников' }
})
```

### `lists.field.add`

Создать поле списка. `TYPE` и `CODE` — внутри `FIELDS` (не `FIELD_TYPE` / `FIELD_NAME`).

```js
callMethod(domain, 'lists.field.add', {
  IBLOCK_TYPE_ID: 'lists',
  IBLOCK_ID: listId,
  FIELDS: { NAME: 'ID сотрудника', CODE: 'USER_ID', TYPE: 'N', MULTIPLE: 'N', IS_REQUIRED: 'Y', SORT: 10 }
})
```

**Типы полей:**
| Код | Описание |
|---|---|
| `S` | Строка |
| `N` | Число |
| `S:DateTime` | Дата и время (хранится как `"DD.MM.YYYY HH:MM:SS"`) |
| `S:Date` | Только дата (хранится как `"DD.MM.YYYY"`) |

### `lists.field.get`

Получить поля списка. Используется для маппинга `CODE → PROPERTY_ID`:

```js
const fields = await callMethod(domain, 'lists.field.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: listId });
// fields = { "PROPERTY_310": { CODE: "USER_ID", ... }, "PROPERTY_312": { CODE: "DATE", ... } }
const map = {};
for (const [fieldId, field] of Object.entries(fields || {})) {
  if (field.CODE) map[field.CODE] = fieldId; // { USER_ID: 'PROPERTY_310', ... }
}
```

### `lists.element.add`

Добавить элемент. `ELEMENT_CODE` — обязателен на верхнем уровне. Значения — plain string.

```js
callMethod(domain, 'lists.element.add', {
  IBLOCK_TYPE_ID: 'lists',
  IBLOCK_ID: listId,
  ELEMENT_CODE: '2026-04-15_user_258',
  FIELDS: {
    NAME: '2026-04-15_user_258',
    PROPERTY_310: '258',   // USER_ID
    PROPERTY_312: '2026-04-15',
    // ...
  }
})
```

### `lists.element.get`

Получить элементы. `SELECT` обязателен. `FILTER` по NAME не работает — использовать `{}` и фильтровать в JS.

```js
callMethod(domain, 'lists.element.get', {
  IBLOCK_TYPE_ID: 'lists',
  IBLOCK_ID: listId,
  FILTER: {},
  SELECT: ['ID', 'NAME', 'PROPERTY_310', 'PROPERTY_312', ...]
})
// Чтение: propVal(el['PROPERTY_310']) → "258"
```

### `lists.element.update`

Обновить элемент. `NAME` обязателен. Все `IS_REQUIRED: 'Y'` поля обязательны. Plain string.

```js
callMethod(domain, 'lists.element.update', {
  IBLOCK_TYPE_ID: 'lists',
  IBLOCK_ID: listId,
  ELEMENT_ID: elementId,
  FIELDS: {
    NAME: '2026-04-15_user_258',  // обязательно
    PROPERTY_310: '258',           // USER_ID — IS_REQUIRED, обязательно
    PROPERTY_312: '2026-04-15',   // DATE — IS_REQUIRED, обязательно
    // ... все IS_REQUIRED поля ...
    PROPERTY_320: 'Пробки',        // REASON — обновляемое поле
  }
})
```

---

## Настройки приложения

### `app.option.get` / `app.option.set`

Хранение глобальных опций приложения (ключ-значение, не привязаны к порталу).

**Использование:** Хранить ID созданных при установке списков:
```js
await callMethod(domain, 'app.option.set', {
  options: { records_list_id: '84', settings_list_id: '86' }
})
const opts = await callMethod(domain, 'app.option.get', { options: ['records_list_id', 'settings_list_id'] })
```

---

## Установка приложения (ONAPPINSTALL)

POST-запрос от Битрикс24 на `/bitrix/install` при установке.

**Тело запроса:**
| Поле | Описание |
|---|---|
| `AUTH_ID` | access_token |
| `REFRESH_ID` | refresh_token |
| `SERVER_ENDPOINT` | OAuth-эндпоинт (`https://oauth.bitrix24.tech/rest/`) |
| `APPLICATION_TOKEN` | Токен приложения |
| `member_id` | Уникальный ID портала |

**Алгоритм обработчика:**
1. Вызвать `app.info` через `SERVER_ENDPOINT` → получить `client_endpoint` и домен портала
2. Сохранить токены в Redis (`portal:{domain}`)
3. Создать универсальные списки (если не существуют) + все поля
4. Создать singleton-запись настроек с дефолтами (если не существует)
5. Сохранить ID списков через `app.option.set`
6. Ответить HTML с `BX24.installFinish()` — без этого Б24 считает установку незавершённой
