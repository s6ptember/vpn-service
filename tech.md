# tech.md — VPN Mini App + Marzban

**Версия ядра: v4**

Changelog:
- `v4` — редизайн Главной и Профиля, продуктовое решение вне исходного роадмапа (раздел 11 переписан). Главная получает приветствие, полосу пилюль с особенностями сервиса и карточку «Текущий план»; колода тарифов и промокод переезжают со страницы в `Sheet`, открываемые кнопками карточки. Новый роут `/setup` — инструкция по установке, достижима только с активной подпиской. Профиль теперь рендерится и без сессии (инкогнито-состояние) вместо приглашения войти. Раздела 7 не касается: трафик читается вживую через уже существующий `MarzbanApi.getUser` и уходит в read-model страницы (`SubscriptionReader`, файл разработчика, не `lib/types`) отдельным полем-промисом — не блокирует load и не требует нового поля в замороженном `SubscriptionDTO`.
- `v3` — два исправления, оба найдены на стадии 6.
  - Ключ идемпотентности `subscription.notify_expiry` стал `expiry:<subscriptionId>:<expiresAtMs>:<daysLeft>`. Прежний ключ не содержал срока, а подписка сохраняет `id` при продлении: второй срок пересчитывал уже потраченный ключ, unique-индекс его глушил, и продлившийся человек не получал предупреждений никогда. Все остальные повторяющиеся ключи в разделе 6 несут временной компонент — этот был исключением по недосмотру.
  - Раздел 15 уточнён: задача A17 («харденинг: заголовки») даёт разработчику право править `hooks.server.ts` и `Caddyfile` в части заголовков безопасности. Прежняя редакция закрепляла оба файла за тимлидом целиком, из-за чего задача, выданная разработчику, была невыполнима внутри своих границ.
- `v2` — оплата переехала с Telegram Stars на Stripe. Изменились: `orders` (провайдер, публичный id, id сессии и платёжного намерения), `users.stripeCustomerId`, новая таблица `webhookEvents`, тип `Currency` вместо `'XTR'`, контракт `PaymentProvider`, вебхук `/api/stripe/webhook`. Требования к коду, конвенция коммитов, топ-5 по SvelteKit и Definition of Done переехали в `CLAUDE.md`.
- `v1` — первая редакция. Заморожены: схема БД, контракты джобов, общие типы, интерфейсы внешних клиентов, список UI-примитивов.

Файл — единственный источник истины по контрактам. Правила кода живут в `CLAUDE.md`, он подтягивается в каждую сессию Claude Code автоматически. Оба меняет только тимлид, append-only, каждое изменение контракта бампает версию. Разработчик читает оба файла в начале сессии и подчиняется им дословно. Нужного контракта нет → выдать блок `CONTRACT GAP`, код с выдуманным типом не писать.

---

## 1. Проект

Продажа VPN-подписок через Telegram Mini App. Один сервер держит панель Marzban и веб-приложение.

Разделение ответственности:
- **Marzban** — управляет соединениями XRAY/VLESS: заводит прокси-пользователей, держит лимиты, отдаёт ссылку на подписку. Единственный источник истины по доступу к VPN.
- **Приложение (Mini App)** — авторизует человека по его Telegram-аккаунту, продаёт подписку на 7/30/90 дней, ведёт заказы, промокоды, поддержку и админку. Единственный источник истины по деньгам и по тому, кому доступ положен.

Приложение никогда не лезет в БД Marzban. Только REST API Marzban.

Аудитория: пользователи Telegram, покупающие VPN на срок. Цель v1: человек открывает мини-апп, платит, за секунды получает ссылку и QR, подключается.

**Команда: тимлид + один разработчик (A).** Слайсы идут последовательно, не параллельно. Ценность разбиения здесь не в параллелизме, а в изоляции сессий: одна задача = один слайс = один PR = одна сессия.

---

## 2. Стек

| Слой | Выбор | Замечание |
|---|---|---|
| Фреймворк | SvelteKit 2, `adapter-node` | Svelte 5, руны обязательны |
| Язык | TypeScript, strict | `any` в PR не проходит ревью |
| Стили | TailwindCSS 4 | CSS-first конфиг: `@import "tailwindcss"` + `@theme`, файла `tailwind.config.js` нет |
| БД | SQLite (better-sqlite3) | один файл на volume, WAL |
| ORM | Drizzle ORM + drizzle-kit | миграции генерятся из схемы |
| Валидация | valibot | tree-shakeable, дёшев для бандла мини-аппа |
| Очередь | своя, поверх таблицы `jobs` | pg-boss не подходит: Postgres нет |
| Прокси | Caddy | TLS, автосертификаты |
| Оплата | Stripe (`stripe` SDK, hosted Checkout) | подтверждение только через вебхук Stripe |
| VPN | Marzban (Xray-core) | тег образа пинится, `latest` запрещён |
| Контейнеризация | Docker + Docker Compose | |
| Тесты | vitest, Playwright, fast-check | |
| Линт | eslint + prettier + svelte-check | |
| QR | `qrcode` (генерация SVG) | рендерится в примитиве `QrCode.svelte` |
| Иконки | `lucide-svelte` | других наборов не заводим |
| CI/CD | GitHub Actions | гейт на PR, деплой на мёрдж в main |

---

## 3. Архитектура и деплой

Один VPS. Docker Compose, три сервиса и один one-shot:

```
                    :443
                 ┌─────────┐
  Telegram ─────▶│  caddy  │
  клиенты        └────┬────┘
                      │  app.example.com      → app:3000
                      │  sub.example.com/sub/*→ marzban:8000
                      ▼
        ┌──────────────┬──────────────────┐
        │              │                  │
   ┌────┴────┐   ┌─────┴──────┐    ┌──────┴──────┐
   │   app   │   │app-migrate │    │   marzban   │
   │SvelteKit│   │ one-shot   │    │ + xray-core │
   │ + worker│   └────────────┘    └──────┬──────┘
   └────┬────┘                            │
        │ /data/app.db                    │ :443,:8443 наружу (VLESS)
        │ HTTP → marzban:8000/api ────────┘
        ▼
   volume app-data                   volume marzban-data
```

Правила:
- Порт `8000` Marzban **не публикуется наружу**. Панель и `/api` доступны только внутри Docker-сети и через SSH-туннель. Наружу Caddy отдаёт только путь `/sub/*` на отдельном сабдомене: клиентам VPN нужна ссылка подписки, дашборд им не нужен.
- Приложение слушает `3000` внутри сети, наружу его отдаёт только Caddy.
- `app-migrate` прогоняет миграции и завершается. `app` стартует через `depends_on: { app-migrate: { condition: service_completed_successfully } }`. Так две реплики никогда не мигрируют один файл SQLite одновременно.
- Реплика ровно одна. SQLite + встроенный воркер этого требуют. Горизонтальное масштабирование вне рамок v1.
- Бэкап: cron на хосте, `sqlite3 /data/app.db ".backup /backup/app-$(date +%F).db"` плюс архив `/var/lib/marzban`. Ротация 14 дней.

**Реального времени в проекте нет.** SSE и websocket не заводим. Человек возвращается из браузера в мини-апп по диплинку `t.me/<bot>/<app>?startapp=order_<publicId>`, клиент читает `start_param` и дёргает `invalidate('app:subscription')`. Если вебхук ещё не доехал, показываем «Ждём подтверждение оплаты» и повторяем `invalidate` раз в 3 секунды, максимум минуту. Транспорт разработчику писать не нужно.

### Переменные окружения (`.env.example`)

```dotenv
# app
NODE_ENV=production
PUBLIC_APP_URL=https://app.example.com
DATABASE_PATH=/data/app.db
SESSION_SECRET=            # openssl rand -hex 32
SESSION_TTL_DAYS=7

# telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=   # header X-Telegram-Bot-Api-Secret-Token
ADMIN_CHAT_ID=             # chat id админа ВПН, он же единственный админ панели
INIT_DATA_MAX_AGE_SEC=86400

# marzban
MARZBAN_API_URL=http://marzban:8000
MARZBAN_ADMIN_USERNAME=
MARZBAN_ADMIN_PASSWORD=
MARZBAN_INBOUND_TAGS=VLESS TCP REALITY
MARZBAN_VLESS_FLOW=xtls-rprx-vision
MARZBAN_SUB_URL_PREFIX=https://sub.example.com

# payments
PAYMENT_PROVIDER=stripe            # stripe | fake
STRIPE_SECRET_KEY=                 # sk_live_… / sk_test_…
STRIPE_WEBHOOK_SECRET=             # whsec_… из stripe listen или из дашборда
PRICE_CURRENCY=usd                 # ISO 4217 в нижнем регистре, как требует Stripe
RETURN_DEEPLINK=https://t.me/<bot_username>/<app_short_name>
```

`src/lib/server/config.ts` — единственное место, где читается `$env/static/private`. Модуль парсит переменные схемой valibot на старте и падает с внятным сообщением, если чего-то нет. Ни один другой модуль в `process.env` не смотрит.

В `.env` самого Marzban обязательно `XRAY_SUBSCRIPTION_URL_PREFIX=https://sub.example.com`, иначе API вернёт относительный путь вместо абсолютной ссылки, и клиент получит битый QR.

---

## 4. Структура папок

```
.
├─ docker-compose.yml
├─ Caddyfile
├─ .env.example
├─ drizzle.config.ts
├─ drizzle/                        # миграции, только тимлид
├─ scripts/{migrate.ts,seed.ts}
├─ tech.md  LEAD.md  DEV_A.md  CLAUDE.md
└─ src/
   ├─ app.html
   ├─ app.css                      # @import "tailwindcss" + @theme токены
   ├─ app.d.ts                     # App.Locals
   ├─ hooks.server.ts              # сессия → locals, security-заголовки
   ├─ lib/
   │  ├─ types/                    # общие типы, контракты (тимлид)
   │  ├─ ui/                       # примитивы (тимлид)
   │  ├─ client/                   # runed-классы состояния, *.svelte.ts
   │  └─ server/
   │     ├─ config.ts
   │     ├─ errors.ts              # AppError и наследники
   │     ├─ db/{index.ts,schema.ts}
   │     ├─ auth/{init-data.ts,session.ts}
   │     ├─ jobs/{queue.ts,worker.ts,handlers/*.ts}
   │     ├─ clients/               # внешние клиенты: интерфейс + real + fake
   │     │  ├─ marzban/{types.ts,http.ts,fake.ts,index.ts}
   │     │  ├─ telegram/{types.ts,http.ts,fake.ts,index.ts}
   │     │  └─ payments/{types.ts,stars.ts,fake.ts,index.ts}
   │     ├─ container.ts           # композиционный корень
   │     ├─ plans/                 # домен
   │     ├─ billing/               # заказы, промокоды, цена
   │     ├─ subscriptions/
   │     ├─ support/
   │     └─ admin/
   └─ routes/
      ├─ +layout.svelte            # островок + свайп-обёртка
      ├─ +layout.server.ts         # user вниз по дереву
      ├─ (app)/
      │  ├─ +page.svelte           # Главная: тарифы (эталонный слайс)
      │  ├─ +page.server.ts
      │  ├─ support/{+page.svelte,+page.server.ts}
      │  └─ profile/
      │     ├─ {+page.svelte,+page.server.ts}
      │     └─ admin/…             # доступ только у ADMIN_CHAT_ID
      ├─ api/
      │  ├─ auth/telegram/+server.ts
      │  ├─ stripe/webhook/+server.ts
      │  └─ telegram/webhook/+server.ts
      └─ dev/kitchen-sink/+page.svelte   # только вне прода
```

Правило слайсинга: разработчик владеет фичей сверху донизу — `lib/server/<домен>` + свой роут + локальные компоненты роута. `lib/types`, `lib/ui`, `lib/server/db/schema.ts`, layout, `drizzle/` — территория тимлида, закрыта CODEOWNERS.

---

## 5. Схема БД (Drizzle, SQLite)

Соглашения:
- PK — `integer autoIncrement`. Публично наружу id не светим.
- Время — `integer({ mode: 'timestamp_ms' })`. **Внутри приложения миллисекунды. У Marzban `expire` — секунды.** Конвертация живёт только в `clients/marzban/http.ts`.
- Деньги — целое в минимальных единицах + `currency`. Валюта одна на всю базу, из `PRICE_CURRENCY`; `usd` и `eur` двухзначные, 100 минорных единиц = 1 доллар или евро. Нулевые валюты вроде `jpy` не поддерживаем: они сломают арифметику скидки.
- Удаления мягкие: `archivedAt`. Заказы ссылаются на тарифы, физическое удаление порвёт историю.
- В листинге ниже `…` вместо повторяющегося `integer('<имя>', { mode: 'timestamp_ms' })`. Имена колонок — snake_case, поля — camelCase, `createdAt`/`updatedAt` обязательны и `notNull`.

```ts
// src/lib/server/db/schema.ts

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull().unique(),
  username: text('username'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  photoUrl: text('photo_url'),
  languageCode: text('language_code'),
  stripeCustomerId: text('stripe_customer_id').unique(),  // создаётся лениво, на первом чекауте
  isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const plans = sqliteTable('plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  durationDays: integer('duration_days').notNull(),      // 7 | 30 | 90, но поле свободное
  priceMinor: integer('price_minor').notNull(),           // центы, не меньше MIN_CHARGE_MINOR
  currency: text('currency', { enum: ['usd', 'eur'] }).notNull(),
  trafficLimitBytes: integer('traffic_limit_bytes').notNull().default(0), // 0 = безлимит
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: …, updatedAt: …,
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' })
});

export const promoCodes = sqliteTable('promo_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),                  // хранить в UPPERCASE
  discountType: text('discount_type', { enum: ['percent', 'fixed'] }).notNull(),
  discountValue: integer('discount_value').notNull(),     // percent: 1..100, fixed: минорные единицы
  maxUses: integer('max_uses'),                           // null = без лимита
  usedCount: integer('used_count').notNull().default(0),
  validFrom: integer('valid_from', { mode: 'timestamp_ms' }),
  validUntil: integer('valid_until', { mode: 'timestamp_ms' }),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: …, archivedAt: …
});

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  planId: integer('plan_id').notNull().references(() => plans.id),
  promoCodeId: integer('promo_code_id').references(() => promoCodes.id),
  planSnapshot: text('plan_snapshot', { mode: 'json' }).$type<PlanSnapshot>().notNull(),
  basePriceMinor: integer('base_price_minor').notNull(),
  discountMinor: integer('discount_minor').notNull().default(0),
  finalPriceMinor: integer('final_price_minor').notNull(),
  currency: text('currency').notNull(),
  status: text('status', { enum: ['pending', 'paid', 'failed', 'canceled'] }).notNull(),
  provider: text('provider', { enum: ['stripe', 'fake'] }).notNull(),
  publicId: text('public_id').notNull().unique(),                       // nanoid, уходит в client_reference_id и metadata.orderId
  providerSessionId: text('provider_session_id').unique(),              // cs_…
  providerPaymentIntentId: text('provider_payment_intent_id').unique(), // pi_…, якорь идемпотентности оплаты
  createdAt: …, paidAt: …
}, (t) => [index('orders_user_created_idx').on(t.userId, t.createdAt)]);

export const webhookEvents = sqliteTable('webhook_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider', { enum: ['stripe', 'fake'] }).notNull(),
  eventId: text('event_id').notNull().unique(),   // evt_…; Stripe ретраит и шлёт дубли
  type: text('type').notNull(),
  receivedAt: …
});

export const promoRedemptions = sqliteTable('promo_redemptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  promoCodeId: integer('promo_code_id').notNull().references(() => promoCodes.id),
  userId: integer('user_id').notNull().references(() => users.id),
  orderId: integer('order_id').notNull().unique().references(() => orders.id),
  createdAt: …
}, (t) => [unique('promo_once_per_user').on(t.promoCodeId, t.userId)]);

export const subscriptions = sqliteTable('subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().unique().references(() => users.id), // ровно одна на человека
  planId: integer('plan_id').notNull().references(() => plans.id),          // последний купленный
  marzbanUsername: text('marzban_username').notNull().unique(),             // tg_<telegramId>
  subscriptionUrl: text('subscription_url').notNull(),
  startsAt: …, expiresAt: …,
  status: text('status', { enum: ['active', 'expired', 'revoked'] }).notNull(),
  lastSyncedAt: …, createdAt: …, updatedAt: …
}, (t) => [index('subs_expires_idx').on(t.expiresAt)]);

export const supportTickets = sqliteTable('support_tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  message: text('message').notNull(),                    // 10..2000 символов
  status: text('status', { enum: ['new', 'delivered', 'failed'] }).notNull(),
  adminMessageId: integer('admin_message_id'),
  createdAt: …, deliveredAt: …
}, (t) => [index('tickets_user_created_idx').on(t.userId, t.createdAt)]);

export const faqItems = sqliteTable('faq_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true)
});

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: text('status', { enum: ['pending', 'running', 'done', 'failed'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  runAt: …, lockedAt: …,
  lastError: text('last_error'),
  createdAt: …, updatedAt: …
}, (t) => [index('jobs_status_runat_idx').on(t.status, t.runAt)]);
```

Что **не** храним:
- Признак админа. Админ вычисляется как `user.telegramId === config.ADMIN_CHAT_ID`. Так требование «админ выставляется в .env» остаётся правдой, а не копией в базе, которая разъедется.
- initData, токены Marzban, что-либо из платёжных данных карт.

Прагмы при открытии соединения (`db/index.ts`, один раз):

```ts
pragma('journal_mode = WAL');
pragma('busy_timeout = 5000');
pragma('foreign_keys = ON');
pragma('synchronous = NORMAL');
```

---

## 6. Контракты очереди и событий

Своя очередь на таблице `jobs`. Один процесс, один воркер, `setInterval` раз в 2 секунды. Захват задачи — внутри `BEGIN IMMEDIATE`, статус `pending → running`.

```ts
// src/lib/types/jobs.ts
export interface JobMap {
  'subscription.provision':     { orderId: number };
  'subscription.sweep':         Record<string, never>;
  'subscription.notify_expiry': { subscriptionId: number; daysLeft: 3 | 1 };
  'support.notify_admin':       { ticketId: number };
  'telegram.send_message':      { chatId: number; text: string; dedupeKey: string };
  'marzban.reconcile':          { subscriptionId: number };
}
export type JobType = keyof JobMap;
```

| Джоб | Кто ставит | Ключ идемпотентности | Эффект |
|---|---|---|---|
| `subscription.provision` | вебхук Stripe на `checkout.session.completed` | `provision:order:<orderId>` | завести или продлить пользователя в Marzban, записать `subscriptions`, погасить промокод, поставить `telegram.send_message` со ссылкой |
| `subscription.sweep` | планировщик, раз в 5 мин | `sweep:<floor(now/300000)>` | найти истёкшие подписки, статус `expired`, поставить `notify_expiry` за 3 и за 1 день |
| `subscription.notify_expiry` | sweep | `expiry:<subscriptionId>:<expiresAtMs>:<daysLeft>` | одно сообщение о скором окончании |
| `support.notify_admin` | создание тикета | `ticket:<ticketId>` | отправить обращение в личку `ADMIN_CHAT_ID`, записать `adminMessageId` |
| `telegram.send_message` | любой домен | `tg:<dedupeKey>` | одно исходящее сообщение |
| `marzban.reconcile` | админка, ручной запуск | `reconcile:<subscriptionId>:<floor(now/3600000)>` | сверить локальный `expiresAt` с `expire` в Marzban, локальное состояние — ведущее |

Правила:
- **Ключ идемпотентности обязателен и уникален.** Вставка дубля ловится по unique-индексу и молча считается успехом. Так повторная доставка вебхука не выдаёт вторую подписку.
- **Ключ повторяющегося джоба обязан содержать компонент того периода, за который он отвечает.** Строки в `jobs` не чистятся, поэтому ключ без периода гасит работу навсегда, а не на один цикл. Отсюда `sweep:<окно>`, `reconcile:<id>:<час>` и `expiry:<id>:<expiresAtMs>:<daysLeft>`: `expiresAtMs` меняется при продлении, и новый срок получает свои предупреждения. Ключ, состоящий только из id сущности, — ошибка, а не оптимизация (`v3`).
- **Хендлер идемпотентен сам по себе**, не только на вставке. Прогон дважды с тем же payload даёт ровно один эффект. На каждый хендлер — тест на это.
- Ретраи: `runAt = now + min(2^attempts * 30s, 1h)`. После `maxAttempts` статус `failed` и алерт админу.
- Payload — только id и скаляры. Объекты домена внутрь не кладём: к моменту исполнения они протухнут.
- Хендлер не возвращает значений, кроме признака успеха. Всё, что нужно дальше, он кладёт новым джобом.
- Планировщик ставит `sweep` с ключом от временного окна. Рестарт контейнера внутри окна дубля не создаст.

---

## 7. Общие типы (`src/lib/types`)

Заморожено. Разработчик их не расширяет.

Типы строк БД руками не пишем: `type OrderRow = typeof orders.$inferSelect`, `type OrderInsert = typeof orders.$inferInsert`. Строки живут внутри `lib/server`, наружу из `load` идут только DTO из этого раздела.

```ts
// result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
// Правило: ожидаемый исход домена (промокод просрочен, лимит выбран) — Result.
// Неожиданный (Marzban лёг, БД недоступна) — throw AppError. Исключениями поток не рулим.

// user.ts
export interface SessionUser {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  isAdmin: boolean;          // вычисляется, в БД не лежит
}

// money.ts
export type Currency = 'usd' | 'eur';        // ISO 4217 в нижнем регистре, формат Stripe
export const MIN_CHARGE_MINOR: Record<Currency, number> = { usd: 50, eur: 50 };
// Минимальная сумма списания у Stripe. Ни один заказ ниже неё не создаётся.

// plan.ts
export interface PlanDTO {
  id: number;
  name: string;
  description: string | null;
  durationDays: number;
  priceMinor: number;                        // центы
  currency: Currency;
  trafficLimitBytes: number;
  isActive: boolean;
  sortOrder: number;
}
export type PlanSnapshot = Pick<PlanDTO, 'name' | 'durationDays' | 'priceMinor' | 'currency' | 'trafficLimitBytes'>;

// billing.ts
export interface PriceQuote {
  basePriceMinor: number;
  discountMinor: number;
  finalPriceMinor: number;
  currency: Currency;
  promoCode: string | null;
}
export interface OrderDTO {
  id: number;
  plan: PlanSnapshot;
  status: 'pending' | 'paid' | 'failed' | 'canceled';
  finalPriceMinor: number;
  currency: Currency;
  createdAt: number;
  paidAt: number | null;
}
export interface PromoCodeDTO {
  id: number;
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
}
export type PromoError = 'not_found' | 'inactive' | 'expired' | 'exhausted' | 'already_used';

// subscription.ts
export interface SubscriptionDTO {
  planName: string;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: number;
  daysLeft: number;
  subscriptionUrl: string;   // отдаём только владельцу
}

// support.ts
export interface FaqItemDTO { id: number; question: string; answer: string }
```

`App.Locals`:

```ts
// src/app.d.ts
declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
      requestId: string;
    }
  }
}
```

---

## 8. Внешние клиенты: интерфейс + фейк

Каждый внешний сервис — интерфейс, реальная реализация, фейк. Разработчик пишет против фейка и не ждёт ни доступов, ни бота, ни поднятой панели. `PAYMENT_PROVIDER=fake` и `MARZBAN_API_URL` пустой в dev → поднимаются фейки. Выбор реализации живёт в `container.ts`, нигде больше.

```ts
// clients/marzban/types.ts
export interface MarzbanApi {
  createUser(input: MarzbanUserInput): Promise<MarzbanUser>;
  getUser(username: string): Promise<MarzbanUser | null>;
  setExpiry(username: string, expiresAtMs: number): Promise<MarzbanUser>;
  setStatus(username: string, status: 'active' | 'disabled'): Promise<void>;
  deleteUser(username: string): Promise<void>;
}
export interface MarzbanUserInput {
  username: string;                 // tg_<telegramId>, 3..32 символа
  expiresAtMs: number;              // ms; клиент сам переведёт в секунды
  dataLimitBytes: number;           // 0 = безлимит
  note?: string;
}
export interface MarzbanUser {
  username: string;
  status: 'active' | 'disabled' | 'limited' | 'expired' | 'on_hold';
  expiresAtMs: number;
  usedTrafficBytes: number;
  subscriptionUrl: string;          // абсолютный, зависит от XRAY_SUBSCRIPTION_URL_PREFIX
  links: string[];
}
```

Реализация `http.ts`:
- `POST /api/admin/token`, form-urlencoded `username`/`password` → `{ access_token }`. Токен кэшируется в памяти, обновляется по `401` и по TTL.
- `POST /api/user` — тело собирается из конфига: `proxies: { vless: { flow: MARZBAN_VLESS_FLOW } }`, `inbounds: { vless: MARZBAN_INBOUND_TAGS.split(',') }`, `expire` в **секундах**, `data_limit`, `data_limit_reset_strategy: 'no_reset'`, `status: 'active'`.
- `GET|PUT|DELETE /api/user/{username}`.
- Таймаут 10 с, три ретрая на `5xx` и сетевые ошибки, экспоненциальная пауза. На `4xx` ретраев нет, кидаем `MarzbanError` с кодом.
- Имена инбаундов не хардкодим: тег из `.env` обязан совпадать с тегом в `xray_config.json`, иначе Marzban ответит `422`.
- `subscription_url` нормализуем на выходе: начинается с `/` → приклеиваем `MARZBAN_SUB_URL_PREFIX`. Дальше по коду ссылка всегда абсолютная. Это единственное место, где живёт склейка.

```ts
// clients/telegram/types.ts
export interface TelegramApi {
  sendMessage(chatId: number, text: string, options?: SendOptions): Promise<{ messageId: number }>;
}

// clients/payments/types.ts
export interface PaymentProvider {
  readonly id: 'stripe' | 'fake';
  /** Создаёт checkout-сессию и возвращает ссылку, которую клиент откроет через WebApp.openLink. */
  createCheckout(order: OrderRow, plan: PlanSnapshot, user: UserRow): Promise<{ url: string; sessionId: string }>;
  /** Проверяет подпись сырого тела и приводит событие провайдера к нашему типу.
   *  Кидает PaymentSignatureError. Типы Stripe SDK наружу не выходят. */
  parseWebhook(rawBody: string, signature: string): PaymentEvent;
}

export type PaymentEvent =
  | { kind: 'paid';    eventId: string; orderPublicId: string; sessionId: string; paymentIntentId: string; amountMinor: number; currency: Currency }
  | { kind: 'failed';  eventId: string; orderPublicId: string; reason: string }
  | { kind: 'ignored'; eventId: string };
```

Фейки:
- `FakeMarzban` — держит пользователей в `Map`, отдаёт `subscriptionUrl` вида `https://sub.local/sub/<username>`, валидирует вход по контракту и падает, если слайс шлёт мусор. Этот фейк и есть тестовый шов.
- `FakeTelegram` — пишет исходящие в массив, тест читает массив.
- `FakePayments` — отдаёт `url` вида `http://localhost:5173/dev/pay/<publicId>` (страница с одной кнопкой «Оплатить») и метод `simulatePaid(publicId)`, который собирает `PaymentEvent` и бьёт в наш же вебхук. Так e2e проходит весь путь без единого запроса в Stripe.
- Фейки умеют возвращать ошибку по требованию (`fake.failNext('timeout' | 500)`) — на этом строятся тесты пути ошибки.

---

## 9. Аутентификация и авторизация

### Поток

1. Мини-апп грузится → `Telegram.WebApp.ready()` → берём сырую строку `initData`.
2. Клиент шлёт `POST /api/auth/telegram` с этой строкой.
3. Сервер валидирует подпись:

```ts
// auth/init-data.ts — класс InitDataValidator, зависимость одна: botToken
const params = new URLSearchParams(rawInitData);       // работаем с СЫРОЙ строкой
const hash = params.get('hash');
params.delete('hash');                                  // удаляем только hash, всё остальное остаётся
const dataCheckString = [...params.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `${k}=${v}`)
  .join('\n');
const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
// сравнение постоянного времени
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(hash ?? ''))) throw new AuthError('bad_signature');
```

   Ловушка: собирать `dataCheckString` из объекта `initDataUnsafe` нельзя. JSON-экранирование (`https:\/\/t.me\/…` в `photo_url`) при пересборке теряется, и хеш не сходится на ровном месте. Валидируем только сырую строку.

   Поле `signature` (Ed25519 для сторонней проверки) из `dataCheckString` **не** выкидываем: по алгоритму убирается только `hash`. Проверяем `auth_date`: старше `INIT_DATA_MAX_AGE_SEC` → `401`.
4. Upsert `users` по `telegramId`. Обновляем `username`, `firstName`, `lastName`, `photoUrl` при каждом входе: человек их меняет.
5. Ставим сессионную куку: подписанный HMAC-токен, `httpOnly`, `secure`, `sameSite: 'none'`, `path: '/'`, TTL из `SESSION_TTL_DAYS`.
6. Клиент вызывает `invalidateAll()`, SSR отрисовывает уже авторизованное состояние.
7. `hooks.server.ts` → `handle` читает куку, кладёт `event.locals.user`. Роуты сессию сами не разбирают.

### Почему так

- **Первый GET документа приходит без initData.** Она доступна только клиенту (из `window.Telegram.WebApp` или из хеша URL, который на сервер не уходит). Поэтому сначала оболочка, потом обмен initData на куку, потом данные.
- **`sameSite: 'none'` обязателен.** На Telegram Desktop и Web мини-апп живёт в iframe, при `lax` кука не приедет. Значит `secure` обязателен тоже, а CSRF-защита SvelteKit по `Origin` должна остаться включённой.
- **`frame-ancestors` обязан пускать Telegram.** Заголовок `X-Frame-Options: DENY` или узкий CSP убьют мини-апп в вебе. В `hooks.server.ts` ставим `Content-Security-Policy: frame-ancestors https://web.telegram.org https://*.telegram.org;` и не ставим `X-Frame-Options` вовсе.

### Авторизация

Гард один, в `handle`, и он различает три случая. Первый GET документа приходит без куки всегда, поэтому `401` на него закрыл бы вход в приложение целиком.

| Запрос | Сессии нет | Сессия есть, не админ |
|---|---|---|
| GET страницы `(app)` | рендерим оболочку, `locals.user = null` | норма |
| GET/POST `/profile/admin/**` | рендерим оболочку (после обмена гард сработает уже с юзером) | `403` |
| POST любого action | `401` | `401` на админских, иначе норма |
| `/api/**` кроме публичных | `401` | `401` на админских, иначе норма |

Публичные пути, гард их пропускает целиком: `/api/auth/telegram`, `/api/telegram/webhook`, `/api/stripe/webhook`. Они приходят без сессии по определению и защищены собственной подписью.

Следствия, обязательные к исполнению:
- `load` под `(app)` обязан пережить `locals.user === null` и вернуть публичную часть (`plans`) с пустыми личными полями. Ровно один рендер живёт в этом состоянии, дальше приезжает кука и `invalidateAll()` перезапускает загрузку.
- `+layout.svelte` держит поверх контента сплеш, пока `data.user === null`. Полупустой профиль человек не увидит.
- `locals.user.isAdmin === (user.telegramId === config.ADMIN_CHAT_ID)`.
- Каждый action под `/profile/admin` проверяет `isAdmin` **на сервере, в самом action**. Гард в `handle` и спрятанная кнопка в UI — не замена этой проверке, а дополнение к ней.
- Вебхук Telegram проверяет заголовок `X-Telegram-Bot-Api-Secret-Token` против `TELEGRAM_WEBHOOK_SECRET` и на несовпадении отвечает `401`. `setWebhook` вызывается с тем же `secret_token`.
- Вебхук Stripe проверяет заголовок `stripe-signature` против `STRIPE_WEBHOOK_SECRET` по сырому телу запроса и на несовпадении отвечает `400`. Это его единственная аутентификация: куки и сессии там нет.

---

## 10. Оплата

Провайдер — **Stripe**, hosted Checkout. Нативный платёжный слой Telegram не используем: он для цифровых товаров требует Stars, а `provider_token` разрешён только для физических (см. раздел 17, там же ограничения и риски этого решения).

Из этого следует форма интеграции: **страница оплаты открывается во внешнем браузере, а не внутри мини-аппа.** `openInvoice` работает только с телеграмными инвойсами и здесь не применим. Хостед-страница Stripe в браузере даёт рабочие 3DS, Apple Pay и Google Pay, чего вложенный iframe внутри WebView не гарантирует.

Поток:

1. Человек выбирает тариф, по желанию вводит промокод. Клиент шлёт action `?/createCheckout` с `{ planId, promoCode? }`.
2. Сервер **пересчитывает цену сам**. Цена, пришедшая с клиента, игнорируется всегда. Создаёт `orders` со `status: 'pending'`, `publicId` = nanoid, `planSnapshot` = слепок тарифа.
3. `stripe.checkout.sessions.create`:
   ```ts
   {
     mode: 'payment',
     client_reference_id: order.publicId,
     metadata: { orderId: String(order.id), publicId: order.publicId },
     customer: user.stripeCustomerId ?? undefined,
     customer_creation: user.stripeCustomerId ? undefined : 'always',
     line_items: [{
       quantity: 1,
       price_data: {
         currency: config.PRICE_CURRENCY,
         unit_amount: quote.finalPriceMinor,          // цена уже со скидкой, купоны Stripe не используем
         product_data: { name: plan.name, description: `${plan.durationDays} дней` }
       }
     }],
     success_url: `${config.RETURN_DEEPLINK}?startapp=order_${order.publicId}`,
     cancel_url:  `${config.RETURN_DEEPLINK}?startapp=cancel_${order.publicId}`,
     expires_at: now + 30 * 60
   }
   ```
   Скидку считаем у себя и кладём в `unit_amount`. Промокоды Stripe (`coupons`, `promotion_codes`) не заводим: две системы скидок разъедутся, а история цены живёт в `planSnapshot` и `orders`.
4. Сервер пишет `providerSessionId` в заказ и отдаёт `session.url` в action.
5. Клиент: `WebApp.openLink(url)`. Мини-апп при этом остаётся открытым и показывает состояние «Ждём оплату».
6. Человек платит, Stripe редиректит на `success_url` → `t.me/<bot>/<app>?startapp=order_<publicId>` → Telegram открывает мини-апп заново. Клиент читает `WebApp.initDataUnsafe.start_param`, дёргает `invalidate('app:subscription')` и показывает результат.
7. Stripe шлёт вебхук на `POST /api/stripe/webhook`. Это **единственный источник факта оплаты**. Редирект на `success_url` фактом не является: его можно открыть руками.
8. Хендлер вебхука: проверяет подпись, дедуплицирует по `eventId`, сверяет `amount_total` и `currency` с заказом, пишет `providerPaymentIntentId` (unique) и `status: 'paid'`, ставит джоб `subscription.provision`, отвечает `200`. Тяжёлое делает воркер.
9. Джоб заводит или продлевает пользователя в Marzban: `newExpiry = max(now, currentExpiresAt) + durationDays * 86_400_000`. Продление активной подписки прибавляет дни, а не обнуляет их.

Вебхук Stripe, обязательные детали:

- **Подпись считается по сырому телу.** В `+server.ts` берём `await request.text()`, не `request.json()`. Любой парс до проверки ломает подпись, и вебхук перестаёт приниматься на ровном месте.
- Проверяем заголовок `stripe-signature` через `STRIPE_WEBHOOK_SECRET`. Подпись не сошлась → `400`, без единого обращения к БД.
- Подписываемся на `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Всё остальное → `{ kind: 'ignored' }` и `200`.
- На `checkout.session.completed` дополнительно смотрим `payment_status === 'paid'`: при отложенных методах оплаты сессия завершается раньше, чем приходят деньги.
- **Stripe ретраит и присылает дубли.** Вставка в `webhookEvents` по unique `eventId` — первый барьер, unique на `orders.providerPaymentIntentId` — второй. Оба дубля отдают `200` и ничего не делают.
- Отвечаем быстро. Stripe ждёт ответ секунды; Marzban в этом хендлере не дёргаем.
- Локально: `stripe listen --forward-to localhost:5173/api/stripe/webhook` даёт `whsec_…` для `.env`.
- Радар и 3DS включены: VPN — категория с высоким возвратом платежей.

Цена и промокод — две разные вещи, два класса:

```ts
// billing/promo-validator.ts — правила и время
class PromoValidator {
  check(promo: PromoCodeRow | null, redemptions: number, now: number): Result<PromoCodeDTO, PromoError>
}
// billing/price-calculator.ts — чистая арифметика, времени внутри нет, property-based тесты
class PriceCalculator {
  quote(plan: PlanSnapshot, promo: PromoCodeDTO | null): PriceQuote
}
```

Инварианты `quote` (их и проверяет fast-check):
- `finalPriceMinor >= MIN_CHARGE_MINOR[currency]` — Stripe не проводит платёж меньше 50 центов. Скидка, уводящая цену ниже порога, упирается в порог, а не в ноль.
- `finalPriceMinor <= basePriceMinor`.
- `discountMinor === basePriceMinor - finalPriceMinor`.
- Результат — целое, округление вниз, для `percent` — `floor(base * value / 100)`.
- Функция чистая: одинаковый вход даёт одинаковый выход, времени внутри нет.

Промокод: проверка и инкремент `usedCount` — в одной транзакции `BEGIN IMMEDIATE` вместе с созданием `promoRedemptions`. Unique `(promoCodeId, userId)` держит правило «один код — одно применение на человека» на уровне БД, а не на уровне доброй воли. Ошибки — из `PromoError`, текст для человека собирает UI.

Возвраты в v1 не автоматизируем. Разовый возврат тимлид делает из дашборда Stripe; вебхук `charge.refunded` не слушаем, подписка при этом остаётся активной до конца срока. Автоматический отзыв доступа на возврат — стадия 6, если возвраты пойдут потоком.

---

## 11. UI: секции, навигация, дизайн

### Секции

Три роута, порядок фиксирован индексами: `0 /support` · `1 /` (Главная, по умолчанию) · `2 /profile`.

Навигация — данные, не разметка. Один файл, тимлид:

```ts
// lib/ui/nav.ts
export const SECTIONS = [
  { index: 0, href: '/support', label: 'Поддержка', icon: LifeBuoy },
  { index: 1, href: '/',        label: 'Главная',   icon: Home },
  { index: 2, href: '/profile', label: 'Профиль',   icon: User }
] as const;
```

Свайп: `Swipeable.svelte` в `lib/ui`, pointer events, порог 60 px или скорость > 0.4 px/мс, дальше `goto(SECTIONS[next].href)` с направленным слайдом.

Предзагрузка обязательна, иначе на месте соседней секции полсекунды висит скелет:
- кнопки островка — `data-sveltekit-preload-data="tap"`;
- свайп — `preloadData(SECTIONS[next].href)` из `$app/navigation` в момент, когда жест перевалил за 20 px и направление уже понятно. К концу жеста данные лежат.

На старте вызываем `WebApp.disableVerticalSwipes()`, иначе вертикальная составляющая жеста схлопнет мини-апп посреди свайпа. `prefers-reduced-motion` отключает слайд, переход остаётся.

### Островок

Signature-элемент приложения. Fixed внизу, `env(safe-area-inset-bottom)`, три кнопки, активная — пилюля, которая переезжает пружиной за сменой роута.

```css
/* app.css */
@theme {
  --color-glass: color-mix(in oklab, var(--tg-theme-bg-color, #101014) 62%, transparent);
  --color-glass-edge: color-mix(in oklab, white 18%, transparent);
  --radius-island: 999px;
  --ease-spring: linear(0, 0.31, 0.79, 1.02, 1.05, 1);
}
.island {
  background: var(--color-glass);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--color-glass-edge);
  box-shadow: 0 8px 32px rgb(0 0 0 / 0.28), inset 0 1px 0 rgb(255 255 255 / 0.14);
}
```

Цвета берём из Telegram: `--tg-theme-bg-color`, `--tg-theme-text-color`, `--tg-theme-button-color`, `--tg-theme-hint-color`, `--tg-theme-secondary-bg-color`. Своя палитра поверх них — только акцент и стекло. Тёмная и светлая темы приезжают из клиента бесплатно, отдельного переключателя нет.

Ограничение: `backdrop-filter` на старых WebView Android не работает. Фолбэк — сплошной `--tg-theme-secondary-bg-color` через `@supports not (backdrop-filter: blur(1px))`. Стекло — украшение, читаемость от него не зависит.

Копия интерфейса: активный залог, предложения с заглавной, кнопка называет действие («Купить 30 дней», не «Отправить»). Ошибка говорит, что произошло и что делать. Пустой экран профиля — приглашение купить, а не «данных нет».

### Содержимое секций

- **Главная** (`v4`): приветствие («Добро пожаловать» + имя из Telegram, `Инкогнито` без сессии), затем ряд овальных пилюль с особенностями сервиса — статичная копия (без логов, XRAY VLESS, поддержка 24/7, все локации), не из БД. Ниже карточка **«Текущий план»**: имя тарифа, статус (`Badge`: активна / закончилась / отозвана / «Статус отсутствует» без подписки), дата окончания, строка трафика — использовано из живого чтения Marzban против `trafficLimitBytes` тарифа; читается промисом, стримится отдельно от остального `load`, при недоступной панели показывает то, что есть, но никогда не блокирует и не роняет страницу. Три кнопки на карточке: «Купить» открывает `Sheet` с колодой тарифов (карточка тарифа не меняется — имя, срок, цена, кнопка покупки, подпись «продлит до <дата>» при активной подписке); «Установить и настроить» — та же шторка при отсутствии подписки, иначе переход на `/setup`; «Промокоды» — отдельная шторка с полем ввода (код уходит в форму покупки тем же способом, что и раньше, на месте не валидируется).
- **Установка** (`/setup`, `v4`, вне трёх секций и свайпа — `sectionOfPath` возвращает `null`): достижима только с активной подпиской, иначе редирект на `/`. Инструкция «поставьте Happ → отсканируйте QR или вставьте ссылку → подключитесь» с той же ссылкой подписки и QR, что и в профиле.
- **Поддержка**: аккордеон FAQ из `faqItems` + форма обращения (textarea 10..2000, счётчик, кнопка). После отправки — состояние «Отправили, админ ответит в личку». Лимит: 3 обращения в час на человека, иначе `429` и внятный текст.
- **Профиль** (`v4`: рендерится и без сессии): аватар (`photoUrl`, фолбэк — инициал; без сессии и без фото — нейтральная иконка), имя (`Инкогнито` без сессии), `@username` (строка скрыта без сессии, а не пустая). Блок промокода — только при сессии. Ниже подписка: активный или истёкший тариф (дата окончания, дней осталось, ссылка подписки с кнопкой «Скопировать», QR, кнопка «Продлить» — уводит на главную) либо пустое состояние «Подписки нет» с кнопкой «Выбрать тариф», которое рендерится и без сессии. Ниже история покупок из `orders` (только при сессии и непустой истории). Для `ADMIN_CHAT_ID` — вход в админку.
- **Админка** (`/profile/admin`): CRUD тарифов (создать, редактировать, архивировать), CRUD промокодов, список последних обращений, ручной `marzban.reconcile`, список упавших джобов.

---

## 12. Список UI-примитивов

Тимлид собирает **до** раздачи задач и рендерит все в `/dev/kitchen-sink`. Разработчик берёт отсюда и своих кнопок не пишет.

База: `shadcn-svelte` там, где компонент есть, минус его тема — токены наши, из `@theme`. Стеклянные вещи (`Island`, `Sheet`) пишем сами, у shadcn такого нет.

| Компонент | Пропсы (эскиз) |
|---|---|
| `Button.svelte` | `variant: 'primary' \| 'ghost' \| 'danger'`, `size: 'sm' \| 'md'`, `loading`, `disabled`, `onclick`, `children` |
| `Card.svelte` | `padded`, `interactive`, `children` |
| `Input.svelte` | `value = $bindable()`, `label`, `error`, `type`, `maxlength` |
| `Textarea.svelte` | `value = $bindable()`, `label`, `error`, `maxlength`, `counter` |
| `Badge.svelte` | `tone: 'neutral' \| 'success' \| 'warn' \| 'danger'`, `children` |
| `Island.svelte` | `sections`, `activeIndex` |
| `Swipeable.svelte` | `index`, `count`, `onnavigate`, `children` |
| `Sheet.svelte` | `open = $bindable()`, `title`, `children` |
| `Modal.svelte` | `open = $bindable()`, `title`, `children`, `onconfirm` |
| `QrCode.svelte` | `value`, `size` |
| `CopyField.svelte` | `value`, `label` |
| `Skeleton.svelte` | `lines`, `height` |
| `Toast.svelte` + `toasts.svelte.ts` | `push(message, tone)` |
| `EmptyState.svelte` | `title`, `description`, `action` |
| `Money.svelte` | `minor`, `currency` — единственное место форматирования цены |

Качественный пол для каждого: работает от 320 px, фокус виден с клавиатуры, `prefers-reduced-motion` уважается, у интерактивных элементов есть `aria-label`.

---

## 13. Правила кода — в `CLAUDE.md`

Требования к коду не живут здесь. Они лежат в `CLAUDE.md` в корне репозитория, потому что Claude Code подтягивает его в каждую сессию автоматически: правило, которое обязано срабатывать на каждой строке, должно быть в контексте всегда, а не по запросу. Контракты читаются по необходимости, правила — нет.

В `CLAUDE.md` переехали:
- топ-5 рекомендаций по коду на SvelteKit (руны, состояние, гард, граница сервера, form actions);
- требования к безопасности, ООП и DRY;
- конвенция коммитов, PR и комментариев, включая автора коммитов и запрет следов нейросети;
- Definition of Done одной задачи.

Дублей нет: каждое правило живёт ровно в одном файле. Здесь остаются контракты — схема, типы, джобы, клиенты, UI, стратегия тестов, роадмап.

---

## 14. Стратегия тестов

Тесты привязаны к слайсу и PR, не к стадии. Слайс мёрджится только с тестами, гейт без них красный.

Главная ловушка: сессия пишет код, потом пишет тесты, подтверждающие, что код делает то, что делает, вместе с багами. Тесты зелёные и не проверяют ничего. Правило: **тесты выводятся из критериев приёмки задачи, не из реализации**. Тест кодирует контракт, не зеркалит код.

Обязательные типы тестов на слайс:

- **Контрактные на стыках.** Джоб или вызов внешнего клиента соответствует контракту из этого файла. Фейковый клиент — тестовый шов: валидирует вход и падает, если слайс шлёт мусор.
- **Идемпотентность джобов.** На каждый хендлер — тест: два прогона с тем же payload дают ровно один эффект. Иначе двойная выдача подписки при повторной доставке вебхука.
- **Путь ошибки.** Marzban отдал `500`, таймаут, `422` на неизвестный инбаунд; Telegram отдал `429` с `retry_after`. Проверяется через фейк, умеющий возвращать ошибку.
- **Property-based (fast-check) на чистой доменной логике.** `PriceCalculator` и расчёт даты окончания: генерим входы, проверяем инварианты из раздела 10.
- **E2E (Playwright)** на сквозной путь: initData → сессия → покупка через `FakePayments.simulatePaid` → подписка и QR в профиле.

Что не тестируем: разметку примитивов, обёртки Drizzle, чужие библиотеки.

Сессии идут в Claude Code: подход к тестам фиксируется скиллом `engineering:testing-strategy`. Ревью PR — `engineering:code-review`. Решения по контрактам и слайсингу тимлид оформляет через `engineering:architecture` (ADR).

---

## 15. Владение инфраструктурой

| Область | Владелец | Правило |
|---|---|---|
| `drizzle/` миграции | тимлид | генерятся из схемы, применяются в `app-migrate`. Разработчик миграции не пишет вообще |
| `lib/server/db/schema.ts` | тимлид | правка — только через `CONTRACT GAP` и бамп версии ядра |
| `lib/types` | тимлид | то же |
| `lib/ui` | тимлид | собран до старта фич |
| layout, `hooks.server.ts` | тимлид | исключение: заголовки безопасности в `handle` правит разработчик в рамках A17 (`v3`) |
| `scripts/seed.ts` | тимлид | общие фикстуры: тарифы 7/30/90, два промокода, FAQ, два пользователя. Фейки отдают те же данные |
| `config.ts`, `.env.example` | тимлид | разработчик стартует без единого реального секрета |
| CI/CD, Caddyfile, compose | тимлид | исключение: блок заголовков в `Caddyfile` правит разработчик в рамках A17 — HSTS ставит только тот, кто терминирует TLS (`v3`) |
| домены и роуты фич | разработчик A | целиком, сверху донизу |

CI, гейт на PR: `svelte-check` · `eslint` + `prettier --check` · `vitest run` · `playwright test` · `vite build` · миграции на временном файле SQLite + `drizzle-kit check` на конфликты. Деплоя на PR нет.

CI, деплой на мёрдж в main: сборка образа → пуш → ssh → `docker compose up -d` → `app-migrate` отрабатывает до старта `app`.

Branch protection на `main`: только через PR, мёрдж при зелёном CI. CODEOWNERS на `tech.md`, `src/lib/types/**`, `src/lib/server/db/schema.ts`, `src/lib/ui/**`, `src/routes/+layout*`, `drizzle/**`.

---

## 16. Дорожная карта

Один разработчик, стадии идут последовательно. Одна задача = один вертикальный слайс = один PR.

### Стадия 0 — скелет (тимлид, до раздачи задач)

Репозиторий, compose, Caddyfile, CI, `config.ts`, `.env.example`, схема БД + первая миграция, `seed.ts`, примитивы `lib/ui` + kitchen-sink, layout с островком и свайпом, гард в `hooks.server.ts`, очередь + демо-джоб, фейки Marzban/Telegram/Payments, эталонный слайс «Главная: список тарифов только на чтение».

Чек-лист «скелет готов», разработчик не начинает фичи, пока он не зелёный целиком:
- CI зелёный на тривиальном PR;
- layout, островок, свайп между тремя секциями и гард в `main`;
- примитивы импортируются и отрисованы в `/dev/kitchen-sink`;
- очередь гоняет демо-джоб, ретрай и `failed` видны в БД;
- фейки отдают сид-данные, `fake.failNext()` работает;
- миграции проходят на временном SQLite в CI;
- эталонный слайс в `main` и задеплоен на тестовый VPS;
- мини-апп открывается из бота на тестовом домене.

### Стадия 1 — вход и профиль
- `A1` Обмен initData на сессию: `/api/auth/telegram`, валидация подписи, upsert пользователя, кука.
- `A2` Профиль: аватар, имя, `@username`, пустое состояние без подписки.

### Стадия 2 — тарифы
- `A3` Главная: карточки активных тарифов из БД (расширение эталонного слайса).
- `A4` Админка: CRUD тарифов, архивирование вместо удаления.

### Стадия 3 — оплата и выдача доступа
- `A5` Заказ и чекаут: пересчёт цены на сервере, `orders`, `checkout.sessions.create`, `WebApp.openLink`, состояние «Ждём оплату».
- `A6` Вебхук Stripe: подпись по сырому телу, дедуп по `webhookEvents.eventId`, сверка `amount_total` и `currency`, идемпотентность по `providerPaymentIntentId`.
- `A7` Возврат по диплинку: `start_param=order_<publicId>`, опрос `invalidate` до минуты, состояния «оплачено» и «не дождались».
- `A8` Джоб `subscription.provision`: Marzban, продление от `max(now, expiresAt)`, запись `subscriptions`, сообщение со ссылкой.
- `A9` Профиль: активный тариф, дата окончания, ссылка, QR, копирование.

### Стадия 4 — промокоды и история
- `A10` Промокоды: применение, транзакция с инкрементом, ошибки `PromoError`, лимит попыток.
- `A11` Админка: CRUD промокодов.
- `A12` История покупок из `orders` в профиле.

### Стадия 5 — поддержка
- `A13` FAQ из БД, аккордеон.
- `A14` Форма обращения → `supportTickets` → джоб `support.notify_admin` → личка `ADMIN_CHAT_ID`, лимит 3/час.

### Стадия 6 — эксплуатация
- `A15` `subscription.sweep` + уведомления за 3 и 1 день.
- `A16` Админка: упавшие джобы, ручной `marzban.reconcile`, последние обращения.
- `A17` Харденинг: заголовки, лимиты, бэкапы, прогон чек-листа безопасности из `CLAUDE.md`.

### Стадия 7 — редизайн панели (продуктовое решение, вне исходного роадмапа)
- `A18` Главная и Профиль: карточка «Текущий план» (статус, срок, трафик) вместо всегда открытой колоды тарифов, покупка и промокод через `Sheet`, страница `/setup` с инструкцией установки, Профиль без сессии показывает инкогнито-состояние вместо приглашения войти. См. раздел 11 и changelog `v4`.

Вне рамок v1: автоматический отзыв доступа на возврат платежа, автопродление подпиской Stripe Billing, реферальная программа, несколько нод Marzban, лимит устройств, редактирование FAQ из админки (правится в `seed.ts`), мультиязычность.

---

## 17. Решения по умолчанию и открытые вопросы

Принято по умолчанию, менять — только через бамп версии ядра:

1. **Оплата — Stripe, hosted Checkout во внешнем браузере.** Два ограничения, которые тимлид обязан снять до стадии 3, иначе стадия встанет:

   - **Telegram требует Stars для цифровых товаров.** Документация Bot API прямо говорит: чтобы соответствовать платёжным политикам Google и правилам ревью Apple, бот или мини-апп обязан продавать цифровые товары и услуги внутри Telegram за Stars, а `provider_token` нужен только для физических товаров. VPN-подписка — цифровая услуга. Отсюда форма интеграции: платёж уезжает во внешний браузер, внутри Telegram платёжного UI нет. Риск остаётся: бот, продающий цифровое мимо Stars, может получить ограничения для пользователей iOS и Android. Решение принимает заказчик, не разработчик.
   - **Stripe не работает в Грузии.** Merchant-аккаунт открывается примерно в 46 странах, Грузии среди них нет; резиденту нужно юрлицо в поддерживаемой стране. Это **единственный long-lead проекта**: регистрация компании и KYC тянутся неделями. Разработку это не блокирует, слайсы идут против `FakePayments`, но релиз блокирует полностью.

   Архитектура к развороту готова: `PaymentProvider` — интерфейс. Возврат к Stars стоит одной реализации класса и миграции на `currency`, домен не трогаем.
2. **Скидки считаем у себя.** Купоны и promotion codes Stripe не заводим: две системы скидок разъедутся, а `planSnapshot` и `orders` должны остаться единственной историей цены.
3. **Одна подписка на человека, продление прибавляет дни.** Покупка 30 дней при активных 12 даёт 42. Параллельных подписок нет.
4. **Один Marzban-пользователь на человека**, имя `tg_<telegramId>`. Лимита устройств нет: Marzban его из коробки не даёт.
5. **Два сабдомена**: `app.example.com` — мини-апп, `sub.example.com` — только `/sub/*` Marzban. Дашборд панели — через SSH-туннель.
6. **Тег образа Marzban пинится.** Перед запуском тимлид проверяет активность апстрима и фиксирует версию. Панель за интерфейсом `MarzbanApi`, поэтому переезд на другую панель стоит одной реализации, а не переписывания домена.

Требуют ответа заказчика до стадии 3:
- Юрлицо под Stripe: есть готовое в поддерживаемой стране или регистрируем. Пока ответа нет, стадия 3 идёт на `FakePayments` и не релизится.
- Валюта расчётов: `usd` или `eur`. От неё зависит `seed.ts` и порог минимального списания.
- Цены тарифов на старте, в центах.
- Лимит трафика на тариф: безлимит или гигабайты.
- Домены и кто держит DNS.

---

## Приложение: ВХОД для мета-промпта разбиения

Копировать в блок «ВХОД» вместе с этим файлом целиком.

```
ПОЛНОЕ ТЗ ПРОЕКТА:
<< этот файл целиком + CLAUDE.md целиком >>

СТЕК:
SvelteKit 2 (fullstack, adapter-node), Svelte 5 (runes), TypeScript, TailwindCSS 4,
Drizzle ORM + SQLite (better-sqlite3), своя очередь на таблице jobs, valibot,
Stripe (hosted Checkout + вебхук), Docker Compose, Caddy, Marzban (Xray-core) за REST API.
Тесты: vitest + Playwright, fast-check (property-based на чистой доменной логике).

КОМАНДА:
- Тимлид (я): скелет, CI/CD, общие компоненты, контракты, миграции, ревью.
- Разработчиков: 1 — A: s6ptember. Слайсы последовательные.
  Генерируй tech.md, LEAD.md, DEV_A.md. DEV_B.md не нужен.
  CLAUDE.md уже написан и приложен, не переписывай его — только сошлись на него.

ХОСТИНГ: тестовый VPS (автодеплой из main) + прод. Один сервер держит и приложение, и Marzban.

LONG-LEAD: Stripe. Merchant-аккаунт требует юрлица в поддерживаемой стране, Грузии в списке нет:
регистрация и KYC тянутся неделями и блокируют релиз стадии 3, но не разработку.
Слайсы идут против FakePayments с первого дня.

СРЕДА СЕССИЙ: Claude Code. Ядро лежит в репо и подтягивается через CLAUDE.md,
ручное прикладывание tech.md не нужно.
```
