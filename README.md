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
   никогда — панель живёт только внутри Docker-сети.
3. **Бот.** Токен и username у BotFather, короткое имя мини-аппа для `RETURN_DEEPLINK`, свой
   численный Telegram id в `ADMIN_CHAT_ID`.
4. **Stripe.** Вебхук на `https://app.<домен>/api/stripe/webhook`, `whsec_…` в
   `STRIPE_WEBHOOK_SECRET`.

### Запуск

```bash
scripts/init-env.sh      # .env из примера + сгенерированные секреты; остальное дописать руками
docker compose build     # .env уезжает в сборку BuildKit-секретом
docker compose up -d
```

Проверка, что всё поднялось:

```bash
docker compose ps        # marzban-init, app-migrate и marzban-check — Exited (0)
docker compose logs marzban-check
```

`marzban-check` — единственное место, где сходится вся цепочка: он логинится в панель тем самым
аккаунтом, с которым собрано приложение, и убеждается, что инбаунд с нужным тегом там есть.
Ненулевой выход означает, что оплата пройдёт, а доступ не выдастся, — чинить до продажи.

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
хеш, и приложение получит `401`. `marzban-check` это ловит и говорит, что делать —
`marzban-cli admin delete`, затем `docker compose up -d marzban-init`.

**Дашборд панели не публикуется.** Наружу уходит только `/sub/*`. До панели — SSH-туннелем на
`marzban:8000` внутри Docker-сети, аккаунтом из `MARZBAN_SUDO_USERNAME`.

**Тарифов на свежей базе нет** — их заводит админ через `/profile/admin`. Фикстуры (`plans`,
промокоды, FAQ и два фальшивых пользователя) есть отдельным профилем и предназначены для стенда,
не для прода: `docker compose --profile seed up app-seed`.

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
