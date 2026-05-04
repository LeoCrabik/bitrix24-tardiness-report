# Локальная разработка

## Схема окружения

```
Битрикс24-портал (браузер)
        │
        │ HTTPS
        ▼
  cloudflared  (https://xxx.trycloudflare.com)
        │
        │ HTTP :80
        ▼
  proxy.js (Node.js)
        │
        └── все маршруты ──► backend :3001
                                  ├── /api/*       → бизнес-логика
                                  ├── /bitrix/*    → обработчик установки
                                  └── /*           → frontend/dist/ (static)

  Redis :6379  ◄──  backend (хранит токены порталов)
```

Один публичный URL — и для iframe (фронтенд), и для обработчика установки (бэкенд).  
Битрикс24 работает только через HTTPS — cloudflared решает это без SSL-сертификатов.

**Особенность:** Битрикс24 открывает iframe POST-запросом на стартовый URL с `AUTH_ID` в теле.  
`proxy.js` при POST на не-backend маршруты парсит тело, извлекает `AUTH_ID` и делает `302 redirect` на GET с `?bx_auth=AUTH_ID`. Frontend читает этот параметр и инициализирует сессию.

---

## Требования

- Node.js 18+
- Redis (бинарник под Windows: `C:\Temp\redis\redis-server.exe`, или Docker)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- Аккаунт разработчика на [developers.bitrix24.ru](https://developers.bitrix24.ru)

---

## Первый запуск

### 1. Установить зависимости

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Создать `.env` в корне проекта

```dotenv
APP_URL=https://xxx.trycloudflare.com   # заполнить после шага 4

BITRIX_CLIENT_ID=local.xxxxxxxxxxxx
BITRIX_CLIENT_SECRET=xxxxxxxx

REDIS_URL=redis://127.0.0.1:6379
PORT=3001
```

### 3. Собрать фронтенд

```bash
cd frontend && npm run build
```

Собранные файлы попадут в `frontend/dist/`. Backend раздаёт их как статику — Vite dev server не нужен.

### 4. Запустить туннель

```bash
cloudflared tunnel --url http://localhost:80
```

Скопировать URL вида `https://xxxx.trycloudflare.com` в `.env` → `APP_URL`.

### 5. Зарегистрировать приложение в Битрикс24

1. Портал → Разработчикам → Мои приложения → Добавить
2. Тип: **Тиражное приложение** (или локальное для разработки)
3. Заполнить:
   - **URL обработчика установки:** `https://xxxx.trycloudflare.com/bitrix/install`
   - **URL приложения (iframe):** `https://xxxx.trycloudflare.com/`
   - Права доступа: `timeman`, `lists`, `user`, `department`
4. Скопировать **Client ID** и **Client Secret** в `.env`

### 6. Запустить сервисы

```bash
# Терминал 1 — Redis
C:\Temp\redis\redis-server.exe

# Терминал 2 — proxy (маршрутизатор на :80)
node proxy.js

# Терминал 3 — backend
cd backend && node src/index.js
```

### 7. Установить приложение на портал

В Битрикс24: найти своё приложение → Установить.  
При установке Б24 отправит POST на `/bitrix/install` — backend создаст списки и сохранит токен.

---

## Workflow ежедневной разработки

```bash
# После изменений в backend — перезапустить процесс
Ctrl+C → node src/index.js

# После изменений в frontend — пересобрать
cd frontend && npm run build
# (backend подхватит новые файлы из dist/ автоматически)

# Новый URL туннеля (если cloudflared перезапустился):
# 1. Обновить APP_URL в .env
# 2. Перезапустить backend
# 3. Обновить URL в настройках приложения Б24
# 4. Переустановить приложение (удалить + установить)
```

---

## Переменные окружения

| Переменная | Пример | Описание |
|---|---|---|
| `APP_URL` | `https://xxx.trycloudflare.com` | Публичный URL приложения |
| `BITRIX_CLIENT_ID` | `local.abc123` | Client ID из настроек приложения Б24 |
| `BITRIX_CLIENT_SECRET` | `xxx` | Client Secret |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Адрес Redis |
| `PORT` | `3001` | Порт backend |

---

## Troubleshooting

**502 Bad Gateway** — proxy.js или backend не запущен. Проверить оба процесса.

**"Missing domain or access token"** — приложение открыто не через Битрикс24, или токен не передался. Убедиться, что URL в настройках Б24 совпадает с текущим туннелем.

**Настройки не читаются / пустые** — переустановить приложение. После переустановки приходят свежие токены и пересоздаётся singleton настроек.

**"wrong_client" от timeman.timecontrol.reports.get** — метод требует пользовательский токен (не app-токен). В коде должен использоваться `callWithUserToken` с `x-bitrix-access-token`.

**Туннель сменил URL** — обновить `APP_URL` в `.env`, перезапустить backend, обновить URL в Б24, переустановить приложение.

**Redis не сохраняет токены** — убедиться, что Redis запущен (`redis-cli ping` → `PONG`).

---

## Деплой на сервер (production)

### Требования
- VPS с Ubuntu 22.04+
- Node.js 18+, Redis, nginx с SSL

### Шаги

```bash
git clone https://github.com/LeoCrabik/bitrix24-tardiness-report.git
cd bitrix24-tardiness-report
cp .env.example .env
# Заполнить .env (APP_URL = ваш домен, токены Б24)

cd frontend && npm install && npm run build
cd ../backend && npm install

# Запустить backend (например через pm2)
pm2 start src/index.js --name tardiness-backend
```

В production proxy.js не нужен — nginx проксирует `/api/*` и `/bitrix/*` на backend, остальное отдаёт из `frontend/dist/`.
