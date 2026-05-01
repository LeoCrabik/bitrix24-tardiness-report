# Отчёт по опозданиям — Битрикс24

Тиражное приложение для маркетплейса Битрикс24.  
Автоматически фиксирует опоздания сотрудников на основе данных учёта рабочего времени, предоставляет руководителю сводный отчёт с возможностью экспорта в Excel, а сотрудникам — возможность указать причину опоздания.

## Быстрый старт (локальная разработка)

```bash
git clone https://github.com/LeoCrabik/bitrix24-tardiness-report.git
cd bitrix24-tardiness-report
cp .env.example .env
# Запустить ngrok: ngrok http 80
# Прописать ngrok URL в .env → APP_URL=https://xxx.ngrok-free.app
docker compose up --build
```

Подробно: [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)

## Деплой на сервер

```bash
cp .env.example .env.prod  # заполнить prod-значения
# Положить SSL-сертификаты в nginx/ssl/
docker compose -f docker-compose.prod.yml up --build -d
```

## Документация

| Документ | Описание |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Полная функциональная спецификация |
| [docs/API_METHODS.md](docs/API_METHODS.md) | Используемые методы Битрикс24 REST API |
| [docs/DATA_STRUCTURES.md](docs/DATA_STRUCTURES.md) | Схема универсальных списков |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектура приложения |
| [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | Локальная разработка и деплой |

## Стек

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js (Express)
- **Хранилище**: Универсальные списки Битрикс24, Redis (токены)
- **Proxy**: nginx
- **Туннель (dev)**: ngrok
- **Контейнеры**: Docker + Docker Compose

## Scopes

`timeman`, `lists`, `user`, `department`
