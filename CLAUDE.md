# CLAUDE.md — инструкции для ИИ-ассистента

Это тиражное приложение для маркетплейса Битрикс24. Всегда читай этот файл первым при начале работы над проектом.

---

## Что за проект

**Отчёт по опозданиям** — приложение, которое:
- Фиксирует опоздания сотрудников из модуля timeman Б24
- Даёт руководителю отчёт-таблицу с деталями по каждому опозданию
- Позволяет сотруднику написать причину опоздания, руководителю — принять/отклонить
- Экспортирует отчёт в Excel
- Хранит ВСЕ данные в универсальных списках Б24 (без внешней БД)

**Репозиторий:** https://github.com/LeoCrabik/bitrix24-tardiness-report  
**Документация:** папка `docs/` — читай её перед реализацией любой фичи

---

## Архитектура (коротко)

**Стек:** React + TypeScript (frontend, Vite) / Node.js Express (backend) / Redis (токены)

**Запуск в dev:**
1. `C:\Temp\redis\redis-server.exe` — Redis
2. `node proxy.js` — маршрутизатор на :80
3. `cd backend && node src/index.js` — backend на :3001
4. `cloudflared tunnel --url http://localhost:80` — HTTPS-туннель

**Frontend:** собирается через `cd frontend && npm run build`. Backend раздаёт `frontend/dist/` напрямую — Vite dev server в работе НЕ используется.

**Маршруты proxy.js:**
- POST на не-backend маршруты → `302 redirect` с `bx_auth` в query (Б24 открывает iframe через POST)
- `/api/*` и `/bitrix/*` → backend `:3001`
- `/*` → backend `:3001` (который раздаёт `frontend/dist/`)

**Хранилище данных портала — два универсальных списка:**
| Список | CODE | Назначение |
|---|---|---|
| Опоздания | `TARDINESS_APP_RECORDS` | Каждая запись = один факт опоздания |
| Настройки | `TARDINESS_APP_SETTINGS` | Singleton-запись с конфигом |

Полная схема полей: `docs/DATA_STRUCTURES.md`

---

## Роли пользователей

| Роль | Как определяется | Что видит |
|---|---|---|
| Администратор | `user.admin` возвращает `true` (пользовательский токен) | `SettingsPage` |
| Руководитель | USER_ID в `managers` в настройках | `ReportPage` + экспорт |
| Сотрудник | Все остальные | `MyTardinessPage` |

Один пользователь может быть одновременно руководителем и администратором.

---

## Ключевые Битрикс24 API методы

| Метод | Зачем |
|---|---|
| `timeman.timecontrol.reports.get` | Получить историю рабочих дней за месяц (MONTH, YEAR, USER_ID). Возвращает массив `days` с `workday_date_start` (ATOM). **Требует пользовательский токен** (`callWithUserToken`), с app-токеном возвращает `wrong_client` |
| `timeman.settings` | Проверить включён ли timeman (`UF_TIMEMAN`) для пользователя |
| `user.get` | Список сотрудников |
| `user.admin` | Проверить, является ли владелец токена администратором портала. **Требует пользовательский токен** |
| `lists.get` | Проверить существование списков при установке |
| `lists.element.add/get/update` | CRUD записей об опозданиях и настроек |
| `app.option.get/set` | Хранить ID созданных списков |

**Scopes приложения:** `timeman`, `lists`, `user`, `department`

---

## Логика фиксации опоздания (on-demand, без cron)

```
Пользователь открывает отчёт или страницу своих опозданий:
  → GET /api/report или GET /api/my-tardiness
  → backend вызывает importTardinessForPeriod(userIds, dateFrom, dateTo, settings):

  1. getExistingRecordNames(domain) → Set всех существующих имён записей (ONE API call)
  2. timeman.settings(userId) → UF_TIMEMAN=false? → пропустить пользователя
  3. Для каждого месяца в диапазоне:
     timeman.timecontrol.reports.get(USER_ID, MONTH, YEAR) [пользовательский токен]
     → days[] с workday_date_start (ATOM: "2026-04-15T09:13:55+03:00")
  4. Для каждого дня:
     a. date = workday_date_start.substring(0, 10)
     b. recordName = "${date}_user_${userId}" → если в Set → пропустить
     c. planStart = расписание из настроек для этого дня недели
     d. Взять TZ из actualStart → planStartWithTz = planStart + tz
     e. lateMinutes = (actualStart - planStartWithTz) / 60 000
     f. lateMinutes > lateThreshold? → createRecord() + добавить в Set
```

**Почему не cron:** on-demand достаточно — когда руководитель смотрит отчёт, все сотрудники уже открыли (или не открыли) рабочий день.

**Важно:** `timeman.open` больше НЕ используется. Исторические данные берутся из `timeman.timecontrol.reports.get`.

---

## Формат расписания в настройках

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
Ключи: `1` = понедельник, `7` = воскресенье (ISO 8601).

---

## Особенности работы с API списков Б24

Выявлено опытным путём — строго следовать:

```js
// lists.get — IBLOCK_CODE на верхнем уровне
callMethod(domain, 'lists.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_CODE: code })

// lists.add — NAME внутри FIELDS, IBLOCK_CODE на верхнем уровне
callMethod(domain, 'lists.add', { IBLOCK_TYPE_ID: 'lists', IBLOCK_CODE: code, FIELDS: { NAME: name } })

// lists.field.add — TYPE и CODE внутри FIELDS (не FIELD_TYPE / FIELD_NAME)
callMethod(domain, 'lists.field.add', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, FIELDS: { NAME, CODE, TYPE, ... } })

// lists.element.add — ELEMENT_CODE обязателен на верхнем уровне, значения PROPERTY plain string
callMethod(domain, 'lists.element.add', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, ELEMENT_CODE: '...', FIELDS: { NAME, PROPERTY_FOO: 'value' } })

// lists.element.update — NAME обязателен, ВСЕ IS_REQUIRED поля тоже обязательны, plain string
callMethod(domain, 'lists.element.update', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, ELEMENT_ID: id, FIELDS: { NAME, PROPERTY_FOO: 'value' } })

// lists.element.get — SELECT обязателен, иначе свойства не возвращаются
// FILTER: { NAME: '...' } НЕ РАБОТАЕТ (игнорирует фильтр, возвращает все записи)!
// Поэтому recordExists реализован через Set имён, загруженный один раз.
callMethod(domain, 'lists.element.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, FILTER: {}, SELECT: ['ID', 'NAME', 'PROPERTY_328', ...] })

// Чтение значения из ответа (числовой ключ, значение напрямую):
function propVal(prop) { return Object.values(prop || {})[0] || ''; }
// B24 возвращает: { "1572": "value" } — НЕ { n0: { VALUE: "..." } }

// B24 хранит DateTime в формате "DD.MM.YYYY HH:MM:SS" — нужна конвертация в ISO на бэкенде
```

---

## Часовой пояс — важная деталь

`timeman.timecontrol.reports.get` возвращает `workday_date_start` в формате ATOM с TZ пользователя:
```
"2026-04-15T09:13:55+03:00"
```

При сравнении с плановым временем (`"2026-04-15T09:00:00"`) Node.js парсит строку без TZ как UTC, что даёт ошибку на 3 часа. **Решение:** извлекаем TZ из actualStart и добавляем к planStart:

```js
const tzMatch = actualStart.match(/([+-]\d{2}:\d{2})$/);
const tz = tzMatch ? tzMatch[1] : '+00:00';
const planStartWithTz = planStart + tz; // "2026-04-15T09:00:00+03:00"
```

---

## Установка приложения (ONAPPINSTALL)

1. POST `/bitrix/install` от Б24 с `AUTH_ID`, `REFRESH_ID`, `SERVER_ENDPOINT`
2. Вызвать `app.info` через `SERVER_ENDPOINT` → получить `client_endpoint` и домен
3. Сохранить токены в Redis
4. `handleInstall`: создать списки + поля + singleton настроек (если не существуют)
5. Ответить HTML с `BX24.installFinish()` — **обязательно**, иначе Б24 считает установку незавершённой

---

## Структура папок

```
bitrix24-tardiness-report/
├── backend/
│   └── src/
│       ├── index.js              # Express app, /bitrix/install handler
│       ├── routes/api.js         # API routes для фронтенда
│       └── services/
│           ├── bitrix.client.js  # REST-клиент (callMethod, callWithUserToken, callBatch)
│           ├── oauth.service.js  # OAuth2 flow + авторефреш
│           ├── install.handler.js
│           ├── tardiness.service.js  # Вся бизнес-логика
│           └── export.service.js     # ExcelJS
├── frontend/
│   └── src/
│       ├── App.tsx               # Роутинг + определение роли
│       ├── pages/
│       │   ├── SettingsPage.tsx
│       │   ├── ReportPage.tsx
│       │   └── MyTardinessPage.tsx
│       └── api/client.ts         # fetch-обёртки к backend
├── proxy.js                      # Dev-прокси на :80
├── docs/                         # Документация
├── STATUS.md                     # Текущее состояние проекта
├── .env
└── CLAUDE.md
```

---

## Соглашения по коду

- Backend: CommonJS (`require`/`module.exports`)
- Frontend: ESM, TypeScript strict mode
- Никаких ORM — прямые вызовы Б24 REST API через `bitrix.client.js`
- Токены порталов в Redis с ключом `portal:{domain}`
- Даты в ISO 8601 на уровне API бэкенда (конвертация из Б24-формата в `normalizeRecord`)

---

## Что работает / что нет

Актуальный статус — в `STATUS.md`.
