# CLAUDE.md — инструкции для ИИ-ассистента

Это тиражное приложение для маркетплейса Битрикс24. Всегда читай этот файл первым при начале работы над проектом.

---

## Что за проект

**Отчёт по опозданиям** — приложение, которое:
- Автоматически фиксирует опоздания сотрудников из модуля timeman Б24
- Даёт руководителю отчёт-таблицу с деталями по каждому опозданию
- Позволяет сотруднику написать причину опоздания, руководителю — принять/отклонить
- Экспортирует отчёт в Excel
- Хранит ВСЕ данные в универсальных списках Б24 (без внешней БД)

**Репозиторий:** https://github.com/LeoCrabik/bitrix24-tardiness-report  
**Документация:** папка `docs/` — читай её перед реализацией любой фичи

---

## Архитектура (коротко)

**Стек:** React + TypeScript (frontend, Vite) / Node.js Express (backend) / Redis (токены) / nginx (proxy)

**Запуск:** Docker Compose + ngrok для HTTPS-туннеля к Б24.  
- Dev: `docker compose up`  
- Prod: `docker compose -f docker-compose.prod.yml up -d`

**Маршруты nginx:**
- `/api/*` и `/bitrix/*` → backend `:3001`
- `/*` → frontend (Vite `:5173` в dev, статика в prod)

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
| Администратор | `ADMIN=Y` в `user.get` (портальный админ) | Страница настроек `/settings` |
| Руководитель | USER_ID в `PROPERTY_MANAGERS` в настройках | Отчёт `/report` + экспорт |
| Сотрудник | Все остальные | Свои опоздания `/my-tardiness` |

Один пользователь может быть одновременно руководителем и администратором.

---

## Ключевые Битрикс24 API методы

| Метод | Зачем |
|---|---|
| `timeman.settings` | Проверить включён ли timeman для сотрудника (`UF_TIMEMAN`), получить индивидуальный макс. порог начала дня |
| `timeman.schedule.get` | Получить рабочий график: `SHIFTS[].WORK_TIME_START`, `WORK_DAYS`, `SCHEDULE_VIOLATION_RULES.MAX_EXACT_START` |
| `timeman.timecontrol.reports.settings.get` | Определить роль текущего пользователя (`user_admin`, `user_head`, `report_view_type`) |
| `user.get` | Список сотрудников для выбора в настройках, проверка `ADMIN=Y` |
| `department.get` | Дерево подразделений |
| `lists.get` | Проверить существование списков при установке |
| `lists.element.add/get/update` | CRUD записей об опозданиях и настроек |
| `app.option.get/set` | Хранить ID созданных списков (чтобы не искать по коду каждый раз) |

**Scopes приложения:** `timeman`, `lists`, `user`, `department`

**⚠️ Открытый вопрос:** Нет подтверждённого REST-метода для получения истории фактического времени открытия рабочего дня по нескольким сотрудникам. При реализации проверить:
1. Существование метода `timeman.timecontrol.reports.get` (упоминается в документации как источник `REPORT_ID`)
2. Наличие REST-события на открытие рабочего дня (тип `OnTimMan*`)
3. Метод `timeman.timecontrol.reports.users.get` — возможно, возвращает статус текущего дня

До прояснения — MVP строится на **cron-based подходе** (ежедневная проверка).

---

## Логика фиксации опоздания

```
Cron (configurable время, напр. 13:00 UTC):
  Для каждого портала → для каждого отслеживаемого сотрудника:
    1. Получить плановое время начала из настроек приложения (PROPERTY_SCHEDULE)
    2. Получить фактическое время начала (исследовать при реализации)
    3. delta = фактическое - плановое (минуты)
    4. Если delta > PROPERTY_LATE_THRESHOLD И запись за сегодня не существует → создать в TARDINESS_APP_RECORDS
```

Если причина принята руководителем (`PROPERTY_REASON_STATUS = ACCEPTED`) — опоздание не засчитывается в счётчик, но запись остаётся.

---

## Формат расписания в настройках

```json
{
  "1": { "enabled": true, "start": "09:00", "end": "18:00" },
  "2": { "enabled": true, "start": "09:00", "end": "18:00" },
  "5": { "enabled": true, "start": "09:00", "end": "18:00" },
  "6": { "enabled": false, "start": "09:00", "end": "18:00" },
  "7": { "enabled": false, "start": "09:00", "end": "18:00" }
}
```
Ключи: `1` = понедельник, `7` = воскресенье (ISO 8601). Хранится как JSON-строка в поле `PROPERTY_SCHEDULE`.

---

## Установка приложения (ONAPPINSTALL)

При установке backend обязан:
1. Сохранить `application_token` и токены доступа портала в Redis
2. Вызвать `lists.get` — проверить наличие обоих списков по коду
3. Если нет — создать список + поля через `lists.add` + `lists.field.add`
4. Создать singleton-запись настроек с дефолтами
5. Сохранить ID созданных списков через `app.option.set`
6. Оба списка — доступ только администраторам портала

---

## Структура папок (целевая)

```
bitrix24-tardiness-report/
├── backend/
│   ├── src/
│   │   ├── index.js              # entry point, Express app
│   │   ├── routes/               # API routes
│   │   ├── services/
│   │   │   ├── bitrix.client.js  # обёртка над REST API Б24
│   │   │   ├── oauth.service.js  # OAuth2 flow, refresh token
│   │   │   ├── install.handler.js
│   │   │   ├── tardiness.service.js
│   │   │   ├── cron.service.js
│   │   │   └── export.service.js # ExcelJS
│   │   └── storage/
│   │       └── redis.js          # хранение токенов
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx               # роутинг + определение роли
│   │   ├── pages/
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── ReportPage.tsx
│   │   │   └── MyTardinessPage.tsx
│   │   ├── components/
│   │   └── api/                  # fetch-обёртки к backend
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── package.json
├── nginx/
│   ├── nginx.dev.conf
│   └── nginx.prod.conf
├── docs/
│   ├── SPEC.md                   # полная функциональная спецификация
│   ├── API_METHODS.md            # методы Б24 REST API
│   ├── DATA_STRUCTURES.md        # схема полей списков
│   ├── ARCHITECTURE.md           # схема компонентов
│   └── LOCAL_DEVELOPMENT.md      # как запустить локально
├── docker-compose.yml            # dev
├── docker-compose.prod.yml       # prod
├── .env.example
└── CLAUDE.md                     # этот файл
```

---

## Соглашения по коду

- Backend: CommonJS (`require`/`module.exports`), пока не переедем на ESM
- Frontend: ESM, TypeScript strict mode
- Никаких ORM — прямые вызовы Б24 REST API через `bitrix.client.js`
- Токены порталов хранятся в Redis с ключом `portal:{domain}` → `{ access_token, refresh_token, application_token }`
- Все даты/время хранятся в ISO 8601, часовой пояс портала применяется на уровне отображения

---

## Что ещё не сделано

- [ ] Backend: `package.json` и вся структура `src/`
- [ ] Backend: OAuth flow + обработчик установки
- [ ] Backend: bitrix.client.js (REST-клиент с авторефрешем токена)
- [ ] Backend: создание универсальных списков при установке
- [ ] Backend: cron-проверка опозданий
- [ ] Backend: API routes для фронтенда
- [ ] Backend: экспорт Excel
- [ ] Frontend: `package.json`, Vite, React Router
- [ ] Frontend: SettingsPage
- [ ] Frontend: ReportPage (таблица с группировкой по сотруднику)
- [ ] Frontend: MyTardinessPage
- [ ] Проверить метод получения фактического времени открытия рабочего дня
