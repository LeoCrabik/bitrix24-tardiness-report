# Локальная разработка

## Схема локального окружения

```
Браузер / Битрикс24-портал
        │
        │ HTTPS (Cloudflare Tunnel / ngrok)
        ▼
  cloudflared / ngrok  (https://xxx.trycloudflare.com)
        │
        │ HTTP :80
        ▼
  proxy.js (Node.js)  ──── /api/*, /bitrix/* ──►  backend :3001
        │
        └────────── /* ──────────────────────►  frontend :5173 (Vite)
                                                     │
                                              redis :6379
```

Один публичный URL — и для iframe (фронтенд), и для обработчика установки (бэкенд).  
Битрикс24 работает только через HTTPS — туннель это решает без SSL-сертификатов.

**Особенность:** Битрикс24 открывает приложение POST-запросом на стартовый URL. Vite dev server не обрабатывает POST, поэтому `proxy.js` при получении POST на не-backend маршруты отвечает `303 redirect` → браузер делает GET → Vite отдаёт React-приложение.

---

## Требования

- Node.js 18+
- Redis (локальный или Docker)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) или [ngrok](https://ngrok.com/download)
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
APP_URL=https://xxx.trycloudflare.com   # заполнить после шага 3

BITRIX_CLIENT_ID=local.xxxxxxxxxxxx
BITRIX_CLIENT_SECRET=xxxxxxxx

REDIS_URL=redis://127.0.0.1:6379
PORT=3001
```

### 3. Запустить туннель

```bash
# Cloudflare (без аккаунта, бесплатно, но URL меняется при каждом запуске):
cloudflared tunnel --url http://localhost:80

# ngrok (с аккаунтом, можно зафиксировать домен):
ngrok http 80
```

Скопировать URL в `.env` → `APP_URL=https://...`

### 4. Зарегистрировать приложение в Битрикс24

1. Зайти на портал → Разработчикам → Мои приложения → Добавить
2. Тип: **Тиражное приложение** (или локальное для разработки)
3. Заполнить:
   - **URL обработчика установки:** `https://xxx.../bitrix/install`
   - **URL приложения (iframe):** `https://xxx.../`
   - Права доступа: `timeman`, `lists`, `user`, `department`
4. Скопировать **Client ID** и **Client Secret** в `.env`

### 5. Запустить сервисы

```bash
# Терминал 1 — proxy (маршрутизатор на :80)
node proxy.js

# Терминал 2 — backend
cd backend && node src/index.js

# Терминал 3 — frontend
cd frontend && npm run dev
```

### 6. Установить приложение на портал

В Битрикс24: Marketplace → найти своё приложение → Установить.  
При установке Б24 отправит POST на `/bitrix/install` — backend создаст списки и сохранит токен.

---

## Workflow разработки

```bash
# После изменений в backend — перезапустить процесс backend (Ctrl+C → node src/index.js)
# Frontend обновляется автоматически через Vite HMR

# Проверить логи backend
cat backend.log
cat backend.err

# Сбросить токены Redis (при смене портала)
redis-cli FLUSHALL
```

---

## Переменные окружения

| Переменная | Dev | Prod | Описание |
|---|---|---|---|
| `APP_URL` | cloudflare/ngrok URL | https://yourdomain.com | Публичный URL приложения |
| `BITRIX_CLIENT_ID` | local.xxx | local.xxx | Client ID из настроек приложения Б24 |
| `BITRIX_CLIENT_SECRET` | xxx | xxx | Client Secret |
| `REDIS_URL` | redis://127.0.0.1:6379 | redis://redis:6379 | Адрес Redis |
| `PORT` | 3001 | 3001 | Порт backend |
| `NODE_ENV` | development | production | Окружение |

---

## Troubleshooting

**Туннель показывает "tunnel not found"** — перезапустить туннель, обновить `APP_URL` в `.env` и в настройках приложения на портале Б24.

**Б24 не может достучаться до `/bitrix/install`** — проверить, что proxy.js запущен, проверить туннель.

**Redis не сохраняет токены** — убедиться, что Redis запущен (`redis-cli ping` → `PONG`).

**Белый экран в iframe** — убедиться, что Vite запущен на :5173 и proxy.js запущен на :80.

**POST на `/` возвращает 404** — убедиться, что proxy.js запущен (он делает 303 redirect для POST на frontend-маршруты).

**Ошибка "Missing domain or userId"** — BX24.js не инициализирован; проверить, что `BX24.init()` вызывается и `BX24.getAuth()` возвращает данные.

---

## Деплой на сервер (production)

### Требования
- VPS с Ubuntu 22.04+
- Docker + Docker Compose
- Домен с SSL

### Шаги

```bash
git clone https://github.com/LeoCrabik/bitrix24-tardiness-report.git
cd bitrix24-tardiness-report
cp .env.example .env
# Заполнить .env

docker compose -f docker-compose.prod.yml up --build -d
```
