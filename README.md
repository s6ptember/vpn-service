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

Пошаговый гайд — **`deploy.md`**: от пустого сервера до работающего мини-аппа.

Один VPS, одна команда. Панель Marzban ставится и настраивается сама: конфиг Xray с ключами
REALITY, миграции панели и оба админских аккаунта заводит одноразовый сервис `marzban-init` до
её старта.

```bash
scripts/init-env.sh      # .env из примера + сгенерированные секреты; остальное дописать руками
scripts/deploy.sh        # сборка + up + проверка одноразовых сервисов
```

Не `docker compose build && up -d`: правка `.env` не меняет ни одного входа сборки, поэтому образ
молча остаётся со старыми секретами, а вышедшие одноразовые сервисы не видны в `docker compose ps`
без `-a` — упавшая проверка выглядит там ровно как успешная. `deploy.sh` закрывает обе дыры.
Подробности и разбор ошибок — в `deploy.md`.

## Команды

| Команда                  | Что делает                                      |
| ------------------------ | ----------------------------------------------- |
| `npm run dev`            | дев-сервер                                      |
| `npm run build`          | прод-сборка                                     |
| `npm run check`          | `svelte-check`                                  |
| `npm run lint`           | `prettier --check` + `eslint`                   |
| `npm run format`         | `prettier --write`                              |
| `npm run test:unit`      | vitest                                          |
| `npm run test:e2e`       | playwright                                      |
| `npm run db:generate`    | сгенерировать миграцию из схемы (только тимлид) |
| `npm run db:migrate`     | применить миграции                              |
| `npm run db:seed`        | залить фикстуры                                 |
| `npm run tg:set-webhook` | зарегистрировать вебхук бота в Telegram         |
| `npm run db:check`       | `drizzle-kit check` — конфликты миграций        |

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
