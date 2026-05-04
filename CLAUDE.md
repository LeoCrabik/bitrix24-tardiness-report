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
1. `node proxy.js` — маршрутизатор на :80
2. `cd backend && node src/index.js` — backend на :3001
3. `cd frontend && npm run dev` — Vite на :5173
4. `cloudflared tunnel --url http://localhost:80` — HTTPS-туннель

**Маршруты proxy.js:**
- POST на не-backend маршруты → `303 redirect` (Б24 открывает iframe через POST)
- `/api/*` и `/bitrix/*` → backend `:3001`
- `/*` → frontend (Vite `:5173`)

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
| Администратор | `ADMIN=Y` в `user.get` (портальный админ) | `SettingsPage` |
| Руководитель | USER_ID в `PROPERTY_MANAGERS` в настройках | `ReportPage` + экспорт |
| Сотрудник | Все остальные | `MyTardinessPage` |

Один пользователь может быть одновременно руководителем и администратором.

---

## Ключевые Битрикс24 API методы

| Метод | Зачем |
|---|---|
| `timeman.settings` | Проверить включён ли timeman (`UF_TIMEMAN`), получить плановый порог начала дня (`UF_TM_MAX_START`) |
| `timeman.open` | **Единственный способ** получить фактическое время открытия рабочего дня (`TIME_START`). Если день уже открыт — возвращает без изменений. Если не открыт — открывает |
| `user.get` | Список сотрудников, проверка `ADMIN=Y` |
| `lists.get` | Проверить существование списков при установке |
| `lists.element.add/get/update` | CRUD записей об опозданиях и настроек |
| `app.option.get/set` | Хранить ID созданных списков |

**Scopes приложения:** `timeman`, `lists`, `user`, `department`

**⚠️ Подтверждённое ограничение REST API Б24:**
- `timeman.timecontrol.reports.get` — **не существует**
- `timeman.status` — **не существует**
- События типа `OnTimManOpen` — **недоступны через REST**
- Read-only метода для чтения времени начала рабочего дня нет

---

## Логика фиксации опоздания (on-demand, без cron)

```
Пользователь открывает отчёт или страницу своих опозданий:
  → GET /api/report или GET /api/my-tardiness
  → backend вызывает checkAndRecordTardiness(userId, today, settings):

  1. recordExists(userId, today)? → если да, выйти
  2. timeman.settings(userId) → UF_TIMEMAN=false? → выйти
  3. T_plan = UF_TM_MAX_START ?? расписание из PROPERTY_SCHEDULE
  4. timeman.open(userId) → TIME_START
     → дата не сегодня? → выйти (день не открыт)
  5. delta = TIME_START - T_plan (минуты)
  6. delta > lateThreshold? → создать запись в TARDINESS_APP_RECORDS
```

**Почему не cron:** нет смысла гонять фоновый процесс, когда единственный доступный метод (`timeman.open`) имеет побочные эффекты и должен вызываться тогда, когда руководитель реально смотрит отчёт — к этому моменту все сотрудники уже открыли (или не открыли) рабочий день.

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

// lists.element.update — NAME обязателен в FIELDS, значения PROPERTY в формате { n0: value }
callMethod(domain, 'lists.element.update', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, ELEMENT_ID: id, FIELDS: { NAME, PROPERTY_FOO: { n0: 'value' } } })

// lists.element.get — SELECT: ['ID', 'NAME', 'PROPERTY_*'] обязателен, иначе свойства не возвращаются
//                    свойства читаются через Object.values(el.PROPERTY_328)[0]
//                    формат ответа: { "1572": "value" } — числовой ключ, значение напрямую
//                    НЕ { n0: { VALUE: "..." } } — это неверно!
callMethod(domain, 'lists.element.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, FILTER: {}, SELECT: ['ID', 'NAME', 'PROPERTY_328', ...] })
// Хелпер для чтения:
// function propVal(prop) { return Object.values(prop || {})[0] || ''; }
```

---

## Установка приложения (ONAPPINSTALL)

1. POST `/bitrix/install` от Б24 с `AUTH_ID`, `REFRESH_ID`, `SERVER_ENDPOINT`
2. Вызвать `app.info` через `SERVER_ENDPOINT` → получить `client_endpoint` и домен
3. Сохранить токены в Redis
4. `handleInstall`: создать списки + поля + singleton настроек
5. Ответить HTML с `BX24.installFinish()` — **обязательно**, иначе Б24 считает установку незавершённой

---

## Структура папок

```
bitrix24-tardiness-report/
├── backend/
│   └── src/
│       ├── index.js              # Express app, /bitrix/install handler
│       ├── routes/api.js         # API routes для фронтенда
│       ├── services/
│       │   ├── bitrix.client.js  # REST-клиент с авторефрешем токена
│       │   ├── oauth.service.js  # OAuth2 flow
│       │   ├── install.handler.js
│       │   ├── tardiness.service.js  # Вся бизнес-логика + checkAndRecordTardiness
│       │   └── export.service.js     # ExcelJS
│       └── storage/redis.js
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
├── .env
└── CLAUDE.md
```

---

## Соглашения по коду

- Backend: CommonJS (`require`/`module.exports`)
- Frontend: ESM, TypeScript strict mode
- Никаких ORM — прямые вызовы Б24 REST API через `bitrix.client.js`
- Токены порталов в Redis с ключом `portal:{domain}`
- Даты в ISO 8601; часовой пояс из `TIME_START` timeman.open содержит смещение пользователя

---

## Статус реализации

### Готово ✅
- OAuth flow + обработчик установки (`/bitrix/install`)
- Создание универсальных списков при установке
- `bitrix.client.js` с авторефрешем токена
- Вся бизнес-логика опозданий (`tardiness.service.js`) включая on-demand проверку
- API routes (`/api/me`, `/api/report`, `/api/my-tardiness`, `/api/settings`, `/api/report/export`)
- Frontend: `App.tsx`, `SettingsPage.tsx`, `ReportPage.tsx`, `MyTardinessPage.tsx`
- Dev proxy с 303-redirect для POST-запросов от Б24

### Не проверено / требует тестирования 🔧
- Реальная работа `timeman.open` на чужом пользователе (нужны права администратора)
- Корректность расчёта опозданий с учётом часового пояса (`TIME_START` содержит TZ offset)
- Экспорт в Excel (`export.service.js`)
- Сохранение настроек через `SettingsPage`

### Планируется (v2)
- Учёт производственного календаря (праздники)
- Интеграция с графиком Б24 (`timeman.schedule.get`) вместо ручного расписания
- Уведомления руководителю о новых опозданиях
