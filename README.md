# VPN Mini App

Продажа VPN-подписок через Telegram Mini App. Приложение ведёт людей, деньги и заказы; доступом к
VPN управляет Marzban через REST API.

Контракты — `tech.md` (версия ядра v7). Правила кода — `CLAUDE.md`. Оба читаются до первой строки.

## Стек

SvelteKit 2 (`adapter-node`) · Svelte 5 (руны) · TypeScript strict · TailwindCSS 4 (CSS-first) ·
Drizzle ORM + SQLite (better-sqlite3) · valibot · Stripe · Marzban · Docker + Caddy.

## Запуск

```bash
npm ci
cp .env.test .env        # dev-значения: фейки Marzban/Telegram/Payments, реальных секретов не нужно
npm run db:migrate       # применяет drizzle/ на DATABASE_PATH
npm run db:seed          # тарифы 7/30/90, два промокода, FAQ, два пользователя
npm run dev
```

`.env.test` выбирает фейки: `PAYMENT_PROVIDER=fake` и пустой `MARZBAN_API_URL`. Разработчик стартует
без единого реального секрета — ни бота, ни поднятой панели, ни аккаунта Stripe.

Для прода `.env` собирается из `.env.example`.

## Деплой

Один VPS, одна команда. Панель Marzban ставится и настраивается сама: конфиг Xray с ключами
REALITY, миграции панели и оба админских аккаунта заводит одноразовый сервис `marzban-init` до
её старта.

### До первого запуска

1. **DNS.** `A`-записи для `app.<домен>` и `sub.<домен>` на IP этого VPS, **живые до** первого
   `up`: Caddy идёт за сертификатом сразу, а Let's Encrypt лимитирует неудачные попытки. Пока
   записи не разъехались, раскомментируй `ACME_CA` со стейджингом в `.env`.
2. **Порты на фаерволе.** `80`, `443` (tcp+udp) и `8443` (tcp, VLESS). `8000` наружу не открывать
   никогда: панель биндится на петлю хоста и доступна только по SSH-туннелю.
3. **Бот.** Токен и username у BotFather, короткое имя мини-аппа для `RETURN_DEEPLINK`, свой
   численный Telegram id в `ADMIN_CHAT_ID`.
4. **Stripe.** Вебхук на `https://app.<домен>/api/stripe/webhook`, `whsec_…` в
   `STRIPE_WEBHOOK_SECRET`.

### Запуск

```bash
scripts/init-env.sh      # .env из примера + сгенерированные секреты; остальное дописать руками
scripts/deploy.sh        # сборка + up + проверка одноразовых сервисов
```

`scripts/deploy.sh` вместо голого `docker compose build && up -d` — не для удобства, а потому что
оба шага молча врут:

- `.dockerignore` держит `.env` вне контекста сборки, а BuildKit намеренно не кладёт содержимое
  секрет-маунта в ключ кеша. Правка `.env` не меняет ни одного входа сборки, `build` попадает в кеш,
  и образ остаётся со старыми секретами и старым доменом — с рапортом об успехе. Скрипт передаёт
  хеш `.env` build-аргументом, и пересборка происходит ровно тогда, когда файл менялся.
- `docker compose ps` без `-a` показывает только живые контейнеры, а все три one-shot к этому
  моменту уже вышли. Упавший `marzban-check` выглядит там ровно как успешный: никак.

`marzban-check` — единственное место, где сходится вся цепочка: он логинится в панель тем самым
аккаунтом, что в `.env`, убеждается, что аккаунт не sudo, и что инбаунд с нужным тегом панель
действительно отдаёт. Ненулевой выход означает, что оплата пройдёт, а доступ не выдастся.

### Что про это стоит знать

**Домен живёт в одном файле.** `.env`: `APP_DOMAIN`, `SUB_DOMAIN`, `PUBLIC_APP_URL`,
`MARZBAN_SUB_URL_PREFIX`. Caddyfile и compose берут его оттуда. Написаний четыре, потому что две
переменные вмораживаются в образ на сборке; `marzban-init` сверяет их между собой и валит деплой на
расхождении.

**Образ — носитель секрета.** `config.ts` читает `$env/static/private`, vite инлайнит значения в
`build/` на этапе сборки. Собирай на хосте, который держит `.env`, и не пушь в реестр.

**Ключи REALITY генерируются один раз** и остаются на volume `marzban-data`. Повторный `up` их не
трогает: перегенерация обрубила бы всех уже выданных клиентов. Свой ключ закрепляется через
`REALITY_PRIVATE_KEY`.

**REALITY слушает `8443`, а не `443`** — `443` занят Caddy, дважды один порт хост не займёт.
Вернуть `443` можно только вторым IP на хосте.

**Смена `MARZBAN_ADMIN_PASSWORD`** не переписывает уже созданного админа: у него остаётся старый
хеш. Порядок важен — работающее приложение держит старый пароль, вмороженный в образ, и прямо
сейчас выдаёт доступы нормально. Сначала пересобрать, потом чинить панель:

```bash
scripts/deploy.sh                                                   # образ с новым паролем
docker compose stop marzban
docker compose run --rm marzban-init marzban-cli admin delete -u <username> -y
docker compose up -d marzban-init && docker compose start marzban
```

Панель останавливается не из осторожности: `marzban-init` пишет в тот же `db.sqlite3`, который
держит открытым живая панель. То же касается любого прогона `marzban-init` после апгрейда образа.

**Дашборд панели не публикуется наружу.** Публичен только `/sub/*`. Сама панель слушает петлю
хоста, поэтому до неё добираются туннелем, а дальше — `http://localhost:8000/dashboard/` в местном
браузере, аккаунтом из `MARZBAN_SUDO_USERNAME`:

```bash
ssh -L 8000:127.0.0.1:8000 user@vps
```

**Тарифов на свежей базе нет** — их заводит админ через `/profile/admin`. Фикстуры (`plans`,
промокоды, FAQ и два фальшивых пользователя) есть отдельным профилем и предназначены для стенда,
не для прода: `docker compose --profile seed up app-seed`.

### Бэкап и восстановление

`tech.md` (A17) требует ночной бэкап с ротацией в 14 дней. Он не входит в `docker compose`
намеренно: смысл бэкапа — пережить то, что он бэкапит, а джоб внутри контейнера умирает вместе
с ним.

```bash
sudo apt install sqlite3                       # backup.sh требует его, иначе падает на первой строке
sudo install -m 700 scripts/backup.sh /usr/local/bin/vpn-backup
sudo crontab -e                                # строку взять из scripts/backup.cron.example
```

Складывает в `/var/backups/vpn-service`: `app-<дата>.db` и `marzban-<дата>.tar.gz`. Копию забирать
с хоста наружу — бэкап на том же диске не переживает потерю диска.

Восстановление — **сначала volume панели, потом всё остальное**: `marzban-data` держит приватный
ключ REALITY и `xray_config.json`, и без них панель поднимется с новыми ключами, а все выданные
клиенты умрут.

```bash
docker compose down
B=/var/backups/vpn-service
docker run --rm -v vpn-service_marzban-data:/dst -v "$B":/src:ro alpine \
  sh -c 'rm -rf /dst/* && tar xzf /src/marzban-YYYY-MM-DD.tar.gz -C /dst'
docker run --rm -v vpn-service_app-data:/dst -v "$B":/src:ro alpine \
  cp /src/app-YYYY-MM-DD.db /dst/app.db
scripts/deploy.sh
```

`docker compose down -v` удаляет оба volume: базу приложения с заказами и ключи REALITY. `down`
без флага их сохраняет.

## Команды

| Команда               | Что делает                                      |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | дев-сервер                                      |
| `npm run build`       | прод-сборка                                     |
| `npm run check`       | `svelte-check`                                  |
| `npm run lint`        | `prettier --check` + `eslint`                   |
| `npm run format`      | `prettier --write`                              |
| `npm run test:unit`   | vitest                                          |
| `npm run test:e2e`    | playwright                                      |
| `npm run db:generate` | сгенерировать миграцию из схемы (только тимлид) |
| `npm run db:migrate`  | применить миграции                              |
| `npm run db:seed`     | залить фикстуры                                 |
| `npm run db:check`    | `drizzle-kit check` — конфликты миграций        |

## Где что лежит

```
src/lib/types/          общие типы и контракты (заморожено, тимлид)
src/lib/ui/             примитивы, все отрисованы в /dev/kitchen-sink (тимлид)
src/lib/client/         состояние клиента, runed-классы *.svelte.ts
src/lib/server/         всё серверное; импорт из клиента ломает сборку — это и есть защита
  config.ts             единственное место, читающее $env
  container.ts          композиционный корень: выбор реализации живёт здесь
  clients/              внешние сервисы: интерфейс + real + fake
  jobs/                 очередь на таблице jobs, воркер, хендлеры
  <домен>/              plans, billing, subscriptions, support, admin
src/routes/(app)/       три секции: /support · / · /profile
drizzle/                миграции (только тимлид, разработчик их не пишет)
marzban/                бутстрап панели: init.sh, check.sh, шаблон конфига Xray
```

Эталонный слайс — `routes/(app)/+page.*`. Свой слайс повторяет его раскладку.

## Дизайн

Источник — `vpn-miniapp.html`. Приложение фиксирует светлую палитру и отдаёт её Telegram через
`setHeaderColor`/`setBackgroundColor`, а не следует за `--tg-theme-*`. Токены — в `src/app.css`
(`@theme`), примитивы — в `src/lib/ui`. Своих кнопок слайсы не пишут.

## Kitchen sink

`/dev/kitchen-sink` рендерит все примитивы. Роут доступен только в dev: в проде гард в
`hooks.server.ts` отдаёт `404`.
