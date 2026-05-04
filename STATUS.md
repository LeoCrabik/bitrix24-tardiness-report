# STATUS.md — текущее состояние проекта

> Обновлено: 2026-05-04

---

## Как запустить (dev)

### Требования
- Node.js 18+
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
2. Перезапустить backend
3. В Битрикс24 → Приложения → изменить адрес на новый URL
4. **Переустановить приложение** (удалить и установить заново) — чтобы получить свежие токены

### Сборка фронтенда (если менял код)

```bash
cd frontend
npm run build
# Собранный dist автоматически раздаётся backend'ом
```

---

## Текущая архитектура

```
Browser → :80 (proxy.js)
              ↓ (все маршруты)
         :3001 (backend, Express)
              ├── /api/*         → бизнес-логика
              ├── /bitrix/*      → обработчик установки
              └── /*             → frontend/dist/ (production build)
```

**Vite dev server НЕ используется.** Фронтенд собирается через `npm run build` и раздаётся бэкендом.

---

## Что работает ✅

| Функция | Статус |
|---------|--------|
| Установка приложения (`/bitrix/install`) | ✅ |
| Создание универсальных списков при установке | ✅ |
| OAuth токены в Redis (с автообновлением) | ✅ |
| Загрузка приложения через Cloudflare туннель | ✅ |
| Определение роли: admin, manager, employee | ✅ |
| Навигация по ролям (вкладки) | ✅ |
| GET /api/settings — чтение настроек | ✅ |
| POST /api/settings — сохранение настроек | ✅ |
| Импорт опозданий за произвольный период (`timeman.timecontrol.reports.get`) | ✅ |
| Создание записей об опозданиях | ✅ |
| GET /api/report — отчёт с фильтрами | ✅ |
| POST /api/my-tardiness/:id/reason — сотрудник указывает причину | ✅ |
| POST /api/tardiness/:id/reason-status — принять/отклонить причину | ✅ |
| GET /api/report/export — экспорт в Excel | ✅ |

---

## Известные особенности / ограничения

### FILTER в lists.element.get не работает
`FILTER: { NAME: '...' }` игнорируется Б24 — возвращает все записи.  
**Решение:** при импорте один раз загружаем все имена существующих записей в `Set`, проверяем в памяти (`getExistingRecordNames`).

### DateTime в Б24 — российский формат
Б24 хранит `S:DateTime` поля как `"04.05.2026 09:10:59"` (DD.MM.YYYY HH:MM:SS).  
**Решение:** `parseRecordDateTime()` в `normalizeRecord` конвертирует в ISO перед отправкой на фронт.

### lists.element.update требует ВСЕ IS_REQUIRED поля
При обновлении любого поля нужно передавать все поля с `IS_REQUIRED: 'Y'` (USER_ID, DATE, ACTUAL_START, PLAN_START, LATE_MINUTES), иначе — 400.  
**Решение:** `getRecordById()` читает запись перед обновлением, все поля пробрасываются в FIELDS.

### timeman.timecontrol.reports.get требует пользовательский токен
С app-токеном возвращает `wrong_client`.  
**Решение:** `callWithUserToken()` с `x-bitrix-access-token` из заголовка запроса.

### Экспорт Excel — токен в query params
Браузер открывает URL через `window.open` без кастомных заголовков.  
**Решение:** frontend добавляет `?domain=...&token=...` в URL, middleware принимает оба варианта.

---

## Структура данных в Битрикс24

### Список настроек (`TARDINESS_APP_SETTINGS`)
Singleton-элемент с `NAME='settings'`, `ELEMENT_CODE='app_settings'`.

| CODE | Тип | Описание |
|------|-----|---------|
| `TRACKED_USERS` | S | JSON-массив ID отслеживаемых сотрудников |
| `MANAGERS` | S | JSON-массив ID руководителей |
| `LATE_THRESHOLD` | N | Порог опоздания в минутах (по умолчанию 5) |
| `SCHEDULE` | S | JSON расписания (ключи 1-7, ISO день недели) |

### Список записей (`TARDINESS_APP_RECORDS`)
Каждый элемент = одно опоздание. NAME = `{date}_user_{userId}`.

| CODE | Тип | IS_REQUIRED | Описание |
|------|-----|-------------|---------|
| `USER_ID` | N | Y | ID сотрудника |
| `DATE` | S:Date | Y | Дата опоздания |
| `ACTUAL_START` | S:DateTime | Y | Фактическое время начала |
| `PLAN_START` | S:DateTime | Y | Плановое время начала |
| `LATE_MINUTES` | N | Y | Минут опоздания |
| `REASON` | S | N | Текст причины (заполняет сотрудник) |
| `REASON_STATUS` | S | N | `NONE` / `PENDING` / `ACCEPTED` / `REJECTED` |
| `MANAGER_ID` | N | N | ID руководителя |
| `RESOLVED_AT` | S:DateTime | N | Дата принятия/отклонения |

---

## Следующие шаги (v2)

- Учёт производственного календаря (праздники)
- Интеграция с графиком Б24 (`timeman.schedule.get`) вместо ручного расписания
- Уведомления руководителю о новых опозданиях
- Пагинация записей (сейчас грузятся все)
