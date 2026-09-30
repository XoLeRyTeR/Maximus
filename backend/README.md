# Backend AgroGrant

Backend — TypeScript приложение на Node.js 22. Оно применяет миграции PostgreSQL, запускает MAX бота в режиме Long Polling, получает данные организаций через Checko и использует GigaChat для классификации деятельности хозяйства.

## Запуск в составе Docker Compose

Основной сценарий описан в [корневом README](../README.md#быстрый-запуск-через-docker-compose).

```powershell
docker compose up --build -d bot
docker compose logs -f bot
docker compose ps
```

Контейнер собирается в два этапа: TypeScript компилируется в build образе, а runtime образ содержит только production зависимости, `dist`, миграции, скрипты запуска и сертификаты. При каждом старте backend последовательно применяет ещё не выполненные файлы из `backend/migrations/`. Healthcheck проверяет соединение с БД и наличие всех миграций.

В Compose адрес БД собирается из `DB_HOST=db`, `POSTGRES_DB`, `POSTGRES_USER` и `POSTGRES_PASSWORD`. Значение `DATABASE_URL` контейнеру для подключения не требуется.

## Локальный запуск

Понадобятся Node.js 22+, npm и PostgreSQL.

1. В корневом `.env` задайте:

   ```dotenv
   BOT_TOKEN_MAX=
   CHECKO_API=
   GIGA_API_KEY=
   DATABASE_URL=postgresql://user:password@localhost:5432/agrogrant
   GIGACHAT_MODEL=GigaChat-2
   ```

2. Установите зависимости и при необходимости создайте БД:

   ```powershell
   Set-Location backend
   npm ci
   npm run db:create
   ```

3. Запустите один из режимов:

   ```powershell
   npm run dev        # src/main.ts, watch mode
   npm start          # npm run build и запуск dist/main.js
   npm run build      # только проверка и компиляция TypeScript
   npm run start:prod # запуск уже собранного dist/main.js
   ```

`npm run db:create` подключается к служебной БД `postgres` и создаёт базу, указанную в `DATABASE_URL`. Если база уже существует, команда ничего не меняет. Таблицы создаются миграциями автоматически при запуске приложения.

## Переменные окружения

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `BOT_TOKEN_MAX` | да | токен MAX бота |
| `CHECKO_API` | да | API ключ Checko |
| `GIGA_API_KEY` | да для функций GigaChat | авторизация GigaChat |
| `GIGACHAT_MODEL` | нет | модель, по умолчанию `GigaChat-2` |
| `DATABASE_URL` | да при локальном запуске | PostgreSQL URL |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | в Docker | покомпонентное подключение к БД; имеет приоритет над `DATABASE_URL` |
| `NODE_EXTRA_CA_CERTS` | нет | свой CA bundle; по умолчанию `backend/certs/russian_trusted_root_ca.pem` |

Файл `.env` хранится в корне репозитория и не должен попадать в Git.

## Проверки

```powershell
npm run build
npm run smoke
npm run test:support
npm run test:delivery
```

- `build` проверяет TypeScript и создаёт `dist/`;
- `smoke` проверяет основной сценарий регистрации;
- `test:support` проверяет выбор и отображение мер поддержки;
- `test:delivery` проверяет доставку сообщений MAX и может требовать рабочие внешние настройки.

## Команды и поведение бота

- `/start` — регистрация по ИНН/ОГРН;
- `/profile`, `/change` — просмотр и замена профиля;
- `/activity`, `/classify` — просмотр, ручное уточнение и повторная классификация направлений;
- `/region` — регион работы хозяйства;
- `/support`, `/catalog` — подбор и просмотр мер;
- `/applications` — список выбранных мер;
- `/help` — подсказка.

В MVP у одного MAX пользователя хранится один профиль. Checko сообщает регистрационные данные организации или ИП, но не подтверждает принадлежность организации пользователю. `/support` и `/catalog` показывают только меры с указанным дедлайном не раньше текущей даты по Москве. «Хочу податься» сохраняет выбор в БД и не отправляет заявление.

## Диагностика

```powershell
# Docker
docker compose logs --tail 200 bot
docker compose ps

# Проверить сборку локально
Set-Location backend
npm run build
```

Если бот сразу завершается, проверьте обязательные ключи и доступность PostgreSQL. Ошибки TLS к MAX обычно означают, что процесс не видит CA bundle. Две копии приложения с одним токеном нельзя одновременно запускать в Long Polling режиме.
