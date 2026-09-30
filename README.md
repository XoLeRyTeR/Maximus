# AgroGrant

AgroGrant — бот в MAX для регистрации хозяйства по ИНН/ОГРН и подбора грантов и субсидий. Backend получает сведения об организации через Checko, worker собирает меры поддержки и обогащает их через GigaChat, PostgreSQL хранит профили и каталог.

## Состав проекта

| Каталог | Назначение |
| --- | --- |
| `backend/` | MAX Long Polling бот, бизнес логика, миграции PostgreSQL |
| `worker/` | Парсинг сайтов и документов, summary, направления и дедлайны |
| `frontend/` | Мини приложение MAX на React/TypeScript; в текущий Compose не входит |
| `docs/` | Архитектура, сценарии, источники и материалы презентации |
| `backend/migrations/` | Версионируемая схема основной PostgreSQL |

Подробности: [backend/README.md](backend/README.md) и [worker/README.md](worker/README.md).

## Быстрый запуск через Docker Compose

Понадобятся Docker Desktop с Compose v2 и ключи MAX, Checko и GigaChat.

1. Создайте `.env` из примера:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Заполните в `.env`:

   ```dotenv
   BOT_TOKEN_MAX=токен_бота_MAX
   CHECKO_API=ключ_Checko
   GIGA_API_KEY=ключ_GigaChat
   POSTGRES_PASSWORD=сложный_пароль
   ```

   `POSTGRES_DB`, `POSTGRES_USER`, `GIGACHAT_MODEL` и `GIGACHAT_SCOPE` уже имеют рабочие значения по умолчанию. `DATABASE_URL` нужен для локального запуска без Docker; контейнеры используют `DB_HOST=db` и параметры `POSTGRES_*`.

3. Соберите и запустите систему из корня репозитория:

   ```powershell
   docker compose up --build -d
   docker compose ps
   docker compose logs -f bot worker
   ```

Compose запускает:

- `db` — PostgreSQL 17 с постоянным томом `postgres_data`;
- `bot` — backend и MAX Long Polling; при старте автоматически применяет SQL миграции;
- `worker` — ждёт готовности `db` и `bot`, выполняет полный цикл и повторяет его каждые 24 часа.

Успешный запуск backend виден по строке `Database ready. MAX bot is starting in Long Polling mode.` В MAX отправьте боту `/start`, затем ИНН или ОГРН.

PostgreSQL в Compose не публикует порт на хост. Содержимое локальной БД из `DATABASE_URL` автоматически в контейнерную БД не переносится. Не запускайте две копии backend с одним `BOT_TOKEN_MAX`: Long Polling клиенты будут перехватывать обновления друг у друга.

## Управление Compose

```powershell
# Статус и последние логи
docker compose ps
docker compose logs --tail 200 bot worker db

# Пересобрать после изменения кода
docker compose up --build -d

# Перезапустить один сервис
docker compose restart bot

# Остановить сервисы, сохранив PostgreSQL
docker compose down

# Удалить сервисы вместе с данными PostgreSQL — необратимо
docker compose down -v
```

### Разовый запуск worker в Docker

Плановый контейнер лучше остановить, чтобы два процесса не обновляли одни записи одновременно:

```powershell
docker compose stop worker

# Полный разовый цикл
docker compose run --rm --no-deps worker python -m app.main

# Только каталог «Своё Фермерство», без GigaChat стадий
docker compose run --rm --no-deps worker python -m app.main --source federal_catalog --skip-deadlines --skip-summary --skip-classification

# Обработать уже сохранённые записи
docker compose run --rm --no-deps worker python -m app.main --deadline-only
docker compose run --rm --no-deps worker python -m app.main --summary-only
docker compose run --rm --no-deps worker python -m app.main --classify-only

docker compose start worker
```

`--no-deps` подходит, когда `db` уже запущена. Если Compose остановлен, сначала выполните `docker compose up -d db bot`.

## Локальный запуск без Docker

Нужны Node.js 22+, Python 3.12+ и доступный PostgreSQL. В `.env` заполните `BOT_TOKEN_MAX`, `CHECKO_API`, `GIGA_API_KEY` и полный `DATABASE_URL`, например `postgresql://agrogrant:password@localhost:5432/agrogrant`.

### Backend

```powershell
Set-Location backend
npm ci
npm run db:create   # только если база из DATABASE_URL ещё не создана
npm run dev         # разработка с перезапуском
# либо npm start    # сборка TypeScript и обычный запуск
```

### Worker

В отдельном терминале из корня проекта:

```powershell
python -m pip install -r worker/requirements.txt
$env:PYTHONPATH = "worker"
python -m app.main --dry-run --sample 1 --max-pdfs 3
python -m app.main
```

На Windows команду `python -m app.main` нужно выполнять из корня с `PYTHONPATH=worker` либо из каталога `worker`. Ошибка `No module named 'app'` означает, что Python не видит каталог `worker`.

## Проверки

```powershell
# Backend
Set-Location backend
npm run build
npm run test:support

# Worker, запуск из корня
Set-Location ..
$env:PYTHONPATH = "worker"
python -m unittest discover -s worker/tests -v

# Экспорт текущей БД для просмотра
python test.py
```

`test.py` создаёт `parsed_data.json` и `parsed_data.csv` в корне проекта.

## Команды бота

- `/start` — начать регистрацию хозяйства;
- `/profile` — показать профиль;
- `/change` — заменить ИНН/ОГРН;
- `/activity <описание>` — уточнить фактическую деятельность;
- `/region <название>` — уточнить регион работы;
- `/support` — подходящие меры с подтверждённым актуальным дедлайном;
- `/catalog` — просмотр регионального каталога;
- `/applications` — сохранённые пользователем меры;
- `/help` — справка.

Карточки без проверенного дедлайна не показываются как открытые. Кнопка «Хочу податься» сохраняет интерес пользователя, но не отправляет заявку в ведомство.

## Важные ограничения

- Каталог «Своё Фермерство» содержит федеральные и региональные меры. Историческое значение `source='svoefermerstvo_federal'` не гарантирует федеральный охват.
- Портал часто указывает срок освоения средств, но не период приёма заявок. Worker не записывает срок освоения как дедлайн.
- `application_url` указывает на страницу источника, пока отдельная подтверждённая ссылка подачи не найдена.
- MAX работает в режиме Long Polling; одновременно включать Webhook нельзя.

Публичный корневой сертификат Минцифры для API MAX находится в `backend/certs/russian_trusted_root_ca.pem`. Его SHA-256: `D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31`.
