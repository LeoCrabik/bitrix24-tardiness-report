# Локальная разработка

## Схема локального окружения

```
Браузер / Битрикс24-портал
        │
        │ HTTPS (ngrok tunnel)
        ▼
  ngrok (https://xxx.ngrok-free.app)
        │
        │ HTTP :80
        ▼
  nginx (Docker)  ──── /api/*, /bitrix/* ──►  backend :3001 (Docker)
        │                                            │
        └────────── /* ──────────────────►  frontend :5173 (Docker, Vite HMR)
                                                     │
                                              redis :6379 (Docker)
```

Одна ngrok-ссылка — и для iframe (фронтенд), и для обработчика установки (бэкенд). Битрикс24 работает только через HTTPS — ngrok это решает без SSL-сертификатов.

---

## Требования

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [ngrok](https://ngrok.com/download) (бесплатный аккаунт, authtoken)
- Аккаунт разработчика на [developers.bitrix24.ru](https://developers.bitrix24.ru) **или** локальный Битрикс24 box

---

## Первый запуск

### 1. Клонировать репозиторий и настроить env

```bash
git clone https://github.com/LeoCrabik/bitrix24-tardiness-report.git
cd bitrix24-tardiness-report
cp .env.example .env
```

### 2. Запустить ngrok

```bash
ngrok http 80
```

Скопировать URL из вывода, например: `https://a1b2c3d4.ngrok-free.app`

> **Совет:** Зарегистрировать в ngrok фиксированный домен (бесплатно 1 штука).  
> Тогда URL не меняется при каждом запуске:  
> `ngrok http --domain=your-fixed-domain.ngrok-free.app 80`

### 3. Прописать ngrok URL в `.env`

```dotenv
APP_URL=https://a1b2c3d4.ngrok-free.app
```

### 4. Зарегистрировать приложение в Битрикс24

**Вариант A — облачный dev-портал:**
1. Зайти на [developers.bitrix24.ru](https://developers.bitrix24.ru) → Мои приложения → Добавить
2. Тип: **Тиражное приложение**
3. Заполнить:
   - **URL обработчика** (handler): `https://a1b2c3d4.ngrok-free.app/bitrix/install`
   - **URL приложения** (iframe): `https://a1b2c3d4.ngrok-free.app/`
   - Права доступа: `timeman`, `lists`, `user`, `department`
4. Скопировать **Client ID** и **Client Secret** в `.env`:
   ```dotenv
   BITRIX_CLIENT_ID=local.xxxxxxxxxxxx
   BITRIX_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

**Вариант B — локальный Битрикс24 box:**
1. Зайти в административную панель → Marketplace → Разработчикам → Добавить приложение
2. Те же URLs, что в варианте A
3. Если box на той же машине — ngrok всё равно нужен (Б24 box делает запрос с себя к приложению, а не напрямую к localhost)

### 5. Запустить Docker

```bash
docker compose up --build
```

После запуска:
- nginx: `http://localhost:80`
- frontend (Vite): внутри Docker на порту 5173 (доступен через nginx)
- backend: внутри Docker на порту 3001 (доступен через nginx)
- redis: внутри Docker на порту 6379

### 6. Установить приложение на портал

В Битрикс24 перейти в Marketplace → найти своё приложение → Установить.  
При установке Б24 отправит POST на `/bitrix/install` — бэкенд создаст списки и сохранит токен.

---

## Workflow разработки

```bash
# Запустить окружение
docker compose up

# Перезапустить только backend (после изменений в package.json)
docker compose restart backend

# Посмотреть логи
docker compose logs -f backend
docker compose logs -f frontend

# Остановить
docker compose down

# Остановить и удалить данные Redis (сброс токенов)
docker compose down -v
```

Фронтенд обновляется автоматически через Vite HMR.  
Бэкенд перезапускается через `nodemon` при изменении файлов.

---

## Деплой на сервер (production)

### Требования к серверу
- VPS с Ubuntu 22.04+
- Docker + Docker Compose
- Домен с SSL (или Let's Encrypt)

### Шаги

```bash
# 1. На сервере — клонировать репо
git clone https://github.com/LeoCrabik/bitrix24-tardiness-report.git
cd bitrix24-tardiness-report

# 2. Создать prod env
cp .env.example .env.prod
# Заполнить .env.prod — APP_URL=https://yourdomain.com и т.д.

# 3. Положить SSL-сертификаты
mkdir -p nginx/ssl
# Скопировать fullchain.pem и privkey.pem в nginx/ssl/
# Либо использовать certbot + acme.sh (см. ниже)

# 4. Запустить
docker compose -f docker-compose.prod.yml up --build -d

# 5. Обновление (CI/CD или вручную)
git pull
docker compose -f docker-compose.prod.yml up --build -d --no-deps backend frontend_build
```

### SSL через Let's Encrypt (certbot)

```bash
# Установить certbot
apt install certbot

# Получить сертификат (домен должен уже смотреть на сервер)
certbot certonly --standalone -d yourdomain.com

# Сертификаты будут в /etc/letsencrypt/live/yourdomain.com/
# Скопировать или симлинкнуть в nginx/ssl/
ln -s /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/fullchain.pem
ln -s /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/privkey.pem

# Автообновление (добавить в crontab)
0 3 * * * certbot renew --quiet && docker compose -f /path/to/docker-compose.prod.yml restart nginx
```

---

## Переменные окружения — полный список

| Переменная | Dev | Prod | Описание |
|---|---|---|---|
| `APP_URL` | ngrok URL | https://yourdomain.com | Публичный URL приложения |
| `BITRIX_CLIENT_ID` | local.xxx | local.xxx | Client ID из настроек приложения Б24 |
| `BITRIX_CLIENT_SECRET` | xxx | xxx | Client Secret |
| `REDIS_URL` | redis://redis:6379 | redis://redis:6379 | Адрес Redis |
| `PORT` | 3001 | 3001 | Порт backend |
| `NODE_ENV` | development | production | Окружение |
| `TARDINESS_CHECK_HOUR` | 10 | 10 | Час запуска cron (UTC) |
| `TARDINESS_CHECK_MINUTE` | 0 | 0 | Минута запуска cron |

---

## Troubleshooting

**ngrok показывает "tunnel not found"** — перезапустить ngrok, обновить `APP_URL` в `.env` и в настройках приложения на портале Б24.

**Б24 не может достучаться до `/bitrix/install`** — проверить, что nginx запущен (`docker compose ps`), проверить ngrok inspect: `http://localhost:4040`.

**Redis не сохраняет токены** — проверить, что volume `redis_data` создан: `docker volume ls`.

**CORS ошибки в браузере** — убедиться, что фронтенд обращается к `/api/...` (через nginx), а не напрямую к `localhost:3001`.
