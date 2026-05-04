# STATUS.md — текущее состояние проекта

> Обновлено: 2026-05-04

---

## Как запустить

### Требования
- Node.js (проверить: `node -v`)
- Redis: `C:\Temp\redis\redis-server.exe`
- cloudflared: `cloudflared.exe`

### Последовательность запуска (каждый в своём терминале)

```bash
# 1. Redis
C:\Temp\redis\redis-server.exe

# 2. Прокси (в корне проекта)
node proxy.js
# Должно напечатать: [proxy] Listening on :80

# 3. Backend (из папки backend/)
node src/index.js
# Должно напечатать: [server] Backend running on port 3001

# 4. Cloudflare туннель
cloudflared tunnel --url http://localhost:80
# Скопировать полученный URL вида https://xxxx.trycloudflare.com
```

### После получения нового URL туннеля

1. Обновить `.env`: `APP_URL=https://xxxx.trycloudflare.com`
2. Перезапустить backend (он читает `.env` при старте)
3. В Битрикс24 → Приложения → твоё приложение → изменить адрес на новый URL
4. **Переустановить приложение** в Битрикс24 (удалить и установить заново), чтобы получить свежие токены

### Сборка фронтенда (если менял код)

```bash
cd frontend
npm run build
# Собранный dist автоматически раздаётся backend'ом, Vite НЕ нужен
```

---

## Текущая архитектура в dev

```
Browser → :80 (proxy.js)
              ↓ (все маршруты)
         :3001 (backend, Express)
              ├── /api/*         → бизнес-логика
              ├── /bitrix/*      → обработчик установки
              └── /*             → frontend/dist/ (production build)
```

**Vite (`npm run dev`) НЕ используется.** Весь трафик идёт на backend, который раздаёт production build из `frontend/dist/`.

---

## Что работает ✅

| Функция | Статус |
|---------|--------|
| Установка приложения (`/bitrix/install`) | ✅ |
| Создание универсальных списков при установке | ✅ |
| OAuth токены в Redis (с автообновлением) | ✅ |
| Загрузка приложения через Cloudflare туннель | ✅ |
| Определение роли: admin (`user.admin`), manager, employee | ✅ |
| Навигация по ролям (вкладки) | ✅ |
| Список сотрудников (без гостей и уволенных) | ✅ |
| GET /api/settings (чтение настроек) | ✅ |

## Что не работает / не проверено ❌

| Функция | Проблема |
|---------|---------|
| **Сохранение настроек** | `lists.element.update` возвращает `true`, но данные не сохраняются |
| Отчёт по опозданиям | Зависит от настроек — нет trackedUsers, нечего проверять |
| Запись опоздания через `timeman.open` | Не тестировалось |
| Excel-экспорт | Не тестировался |
| Причины опозданий (submit/accept/reject) | Не тестировалось |

---

## Критический баг: настройки не сохраняются

### Симптомы
- `POST /api/settings` возвращает `{ ok: true }`
- После перезагрузки страницы настройки снова пустые
- Bitrix24 `lists.element.update` принимает запрос без ошибки, но данные не персистятся

### Что уже пробовали
1. **Plain strings**: `PROPERTY_328: JSON.stringify(value)` — не работает
2. **`{ n0: value }` формат**: `PROPERTY_328: { n0: JSON.stringify(value) }` — не работает
3. **Добавление `NAME: 'settings'`** — обязательно, без него 400, с ним всё равно не сохраняется

### Что нужно проверить
- Смотреть бэкенд-логи при сохранении: какие FIELD_ID реально возвращает `lists.field.get`
- Попробовать CODE-имена в update: `PROPERTY_TRACKED_USERS: { n0: value }` — так же как в `lists.element.add`
- Проверить через Битрикс24 UI: меняются ли данные в списке после вызова update?
- Проверить ELEMENT_ID: правильный ли ID возвращает `getSettings`?

### Где смотреть в коде

- `saveSettings` → `backend/src/services/tardiness.service.js:52`
- `getSettingsFieldMap` → `backend/src/services/tardiness.service.js:17`
- Логи бэкенда покажут: `[saveSettings] fieldMap=...` и `[saveSettings] FIELDS sent=...`

---

## Структура данных в Битрикс24

### Список настроек (`TARDINESS_APP_SETTINGS`)
Singleton-элемент с `NAME='settings'`. Поля:

| CODE | Тип | Описание |
|------|-----|---------|
| `TRACKED_USERS` | S | JSON-массив ID отслеживаемых сотрудников |
| `MANAGERS` | S | JSON-массив ID руководителей |
| `LATE_THRESHOLD` | N | Порог опоздания в минутах (по умолчанию 5) |
| `SCHEDULE` | S | JSON расписания (ключи 1-7, ISO день недели) |

**Реальные PROPERTY_ID** (числовые) определяются динамически через `lists.field.get` при каждом вызове.

### Список записей (`TARDINESS_APP_RECORDS`)
Каждый элемент = одно опоздание. NAME = `{date}_user_{userId}`.

| CODE | Тип | Описание |
|------|-----|---------|
| `USER_ID` | N | ID сотрудника |
| `DATE` | S:Date | Дата опоздания |
| `ACTUAL_START` | S:DateTime | Фактическое время начала |
| `PLAN_START` | S:DateTime | Плановое время начала |
| `LATE_MINUTES` | N | Минут опоздания |
| `REASON` | S | Текст причины (заполняет сотрудник) |
| `REASON_STATUS` | S | `NONE` / `PENDING` / `ACCEPTED` / `REJECTED` |
| `MANAGER_ID` | N | ID руководителя |
| `RESOLVED_AT` | S:DateTime | Дата принятия/отклонения |

---

## Особенности API Битрикс24 (выявлено опытным путём)

```js
// lists.element.add — plain string values, ELEMENT_CODE обязателен
{ IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, ELEMENT_CODE: '...', FIELDS: { NAME: '...', PROPERTY_TRACKED_USERS: '[]' } }

// lists.element.update — { n0: value }, NAME обязателен в FIELDS
{ IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, ELEMENT_ID: id, FIELDS: { NAME: '...', PROPERTY_328: { n0: 'value' } } }

// lists.element.get — SELECT обязателен, иначе свойства не возвращаются
//                    числовые PROPERTY_ID обязательны (CODE-имена не работают)
{ IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: id, FILTER: {}, SELECT: ['ID', 'NAME', 'PROPERTY_328', ...] }

// Чтение значения из ответа:
el.PROPERTY_328?.n0?.VALUE

// lists.field.get — возвращает объект { PROPERTY_328: { CODE: 'TRACKED_USERS', ... } }
// Используем для маппинга CODE → числовой FIELD_ID
```

---

## Файлы изменённые за последнюю сессию

| Файл | Что изменено |
|------|-------------|
| `backend/src/services/bitrix.client.js` | Добавлен `callWithUserToken` |
| `backend/src/services/tardiness.service.js` | `getSettingsFieldMap`, `getRecordsFieldMap`, `getUserRole` через `user.admin`, `getUsers` с фильтром `USER_TYPE: 'employee'` |
| `backend/src/services/oauth.service.js` | `refreshTokens` сохраняет `server_endpoint` и `member_id` |
| `backend/src/routes/api.js` | Передача `x-bitrix-access-token` в `getUserRole` |
| `backend/src/index.js` | Раздача `frontend/dist/` статики + SPA fallback |
| `frontend/src/App.tsx` | Навигация по вкладкам по роли |
| `frontend/src/api/client.ts` | `initBX24` через URL params (без `BX24.init()`) |
| `proxy.js` | Весь трафик → backend `:3001` (убран Vite `:5173`) |
| `CLAUDE.md` | Обновлены примеры API Б24 |

---

## Следующие шаги

1. **Исправить `saveSettings`**: найти правильный формат значений для `lists.element.update`
   - Смотреть логи: какие FIELD_ID приходят, что отправляется
   - Попробовать CODE-имена вместо числовых ID
2. **Проверить отчёт** после починки настроек
3. Протестировать `timeman.open` на реальных данных
4. Протестировать Excel-экспорт
