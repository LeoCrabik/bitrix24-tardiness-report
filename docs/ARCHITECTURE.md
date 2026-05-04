# Архитектура приложения

## Обзор

```
┌──────────────────────────────────────────────────────────┐
│                    Портал Битрикс24                      │
│                                                          │
│  ┌────────────┐   REST API   ┌──────────────────────┐   │
│  │  timeman   │◄────────────►│  Универсальные       │   │
│  │  (данные   │              │  списки              │   │
│  │   РВ)      │              │  - Опоздания         │   │
│  └────────────┘              │  - Настройки         │   │
│                              └──────────────────────┘   │
└──────────────────────────────────────────────────────────┘
          ▲ REST API (OAuth2)         ▲ REST API
          │                          │
┌─────────┴──────────────────────────┴──────────┐
│              Backend (Node.js / Express)       │
│                                                │
│  ┌──────────┐  ┌─────────────────────────────┐ │
│  │  OAuth   │  │  API Routes                 │ │
│  │  Handler │  │  + on-demand импорт опозд.  │ │
│  └──────────┘  └─────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  Token Store (Redis)                     │  │
│  │  portal:{domain} → { access_token,      │  │
│  │                       refresh_token,     │  │
│  │                       server_endpoint }  │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
          ▲ iframe (POST → 302 redirect → GET)
          │
┌─────────┴──────────────────────────────────────┐
│              Frontend (React + TS)              │
│         (production build в frontend/dist/)     │
│                                                 │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  │
│  │ Настройки│  │  Отчёт     │  │  Мои       │  │
│  │ (admin)  │  │ (manager)  │  │  опоздания │  │
│  └──────────┘  └────────────┘  └────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Backend (Node.js / Express)

### Модули

| Модуль | Файл | Описание |
|---|---|---|
| `install.handler` | `services/install.handler.js` | ONAPPINSTALL: сохранение токенов, создание списков |
| `oauth.service` | `services/oauth.service.js` | Обмен кода на токены, авторефреш |
| `bitrix.client` | `services/bitrix.client.js` | Обёртка REST API Б24: `callMethod`, `callWithUserToken`, `callBatch` |
| `tardiness.service` | `services/tardiness.service.js` | Бизнес-логика: импорт опозданий, CRUD записей и настроек |
| `export.service` | `services/export.service.js` | Генерация Excel (ExcelJS) |
| `api.routes` | `routes/api.js` | HTTP-маршруты для фронтенда |

### API Routes

Все маршруты защищены middleware `extractContext`, который определяет `domain` и `userId` через `user.current` с пользовательским access_token.

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/me` | Роль текущего пользователя (`admin`/`manager`/`employee`) |
| `GET` | `/api/users` | Список сотрудников (для выбора в настройках) |
| `GET` | `/api/settings` | Текущие настройки |
| `POST` | `/api/settings` | Сохранить настройки |
| `GET` | `/api/report` | Отчёт + on-demand импорт за запрошенный период |
| `GET` | `/api/report/export` | Скачать Excel (domain и token передаются как query-params) |
| `POST` | `/api/tardiness/:id/reason-status` | Принять/отклонить причину |
| `GET` | `/api/my-tardiness` | Мои опоздания + on-demand импорт |
| `POST` | `/api/my-tardiness/:id/reason` | Сотрудник указывает причину |

---

## Логика фиксации опозданий — on-demand

Нет фонового cron-задания. Импорт происходит при каждом запросе отчёта:

```
GET /api/report?dateFrom=2026-03-01&dateTo=2026-03-31
  ↓
importTardinessForPeriod(domain, userIds, dateFrom, dateTo, settings, userAccessToken):

  1. getExistingRecordNames() — один запрос к Б24, Set всех NAME уже записанных фактов
  2. timeman.settings(userId) — проверить UF_TIMEMAN (если false — пропустить пользователя)
  3. getMonthsInRange(dateFrom, dateTo) — [{month:3, year:2026}]
  4. Для каждого месяца:
       timeman.timecontrol.reports.get(USER_ID, MONTH, YEAR) [пользовательский токен]
       → report.days[] — массив рабочих дней за месяц
  5. Для каждого дня:
       date = workday_date_start.substring(0,10)   // "2026-03-02"
       recordName = "${date}_user_${userId}"
       если в Set → пропустить (уже записано)
       planStart = расписание для этого дня недели
       tz = TZ из workday_date_start
       lateMinutes = (actualStart - planStart+tz) / 60000
       если lateMinutes > lateThreshold → createRecord() + добавить в Set
  ↓
getRecords() — вернуть все записи, JS-фильтрация по дате и userId
```

**Почему не cron:**
- `timeman.timecontrol.reports.get` — единственный метод, дающий историю рабочих дней
- Вызов on-demand при открытии отчёта гарантирует, что сотрудники уже открыли день
- Нет побочных эффектов (в отличие от `timeman.open`, который мог открывать день)

---

## Frontend (React + TypeScript)

### Инициализация

При загрузке `App.tsx`:
1. `initBX24()` — читает `bx_auth` и `DOMAIN` из URL query params (proxy добавляет их при редиректе)
2. `GET /api/me` → `{ userId, role: 'admin' | 'manager' | 'employee' }`
3. Показать соответствующую страницу

### Страницы

| Страница | Роль | Описание |
|---|---|---|
| `SettingsPage` | admin | Настройка: отслеживаемые сотрудники, руководители, расписание, порог |
| `ReportPage` | manager | Таблица опозданий с фильтрами, принятие/отклонение причин, экспорт Excel |
| `MyTardinessPage` | employee | Свои опоздания, ввод причины |

### Технологии

| Библиотека | Назначение |
|---|---|
| React 18 | UI |
| TypeScript | Типизация |
| `@tanstack/react-query` | Кэш и запросы к backend |
| Ant Design (antd) | UI-компоненты |
| dayjs | Работа с датами |
| Vite | Сборщик (только для build, не для dev-сервера) |
| ExcelJS | Генерация Excel (на backend) |

---

## Хранилище токенов (Redis)

Ключ: `portal:{domain}`  
Значение (JSON):
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "server_endpoint": "https://systemcrm.bitrix24.ru/rest/",
  "member_id": "b281fab..."
}
```

`bitrix.client.js` автоматически обновляет `access_token` при получении ошибки `expired_token`.

---

## Деплой (marketplace)

- Приложение размещается на внешнем хостинге (VPS/PaaS)
- Backend доступен по HTTPS
- URL обработчика установки и iframe регистрируются в карточке приложения Б24
- Токены порталов хранятся в Redis на стороне сервера
- Frontend собирается (`npm run build`) и раздаётся backend'ом как статика
