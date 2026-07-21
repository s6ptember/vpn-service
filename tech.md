# tech.md — VPN Mini App + Marzban

**Версия ядра: v7**

Changelog:
- `v7` — деплой становится однокомандным, раздел 3 переписан. Compose получает два одноразовых сервиса вокруг панели: `marzban-init` рендерит `xray_config.json` с REALITY-ключами, прогоняет миграции панели и заводит оба админских аккаунта, `marzban-check` после старта проверяет, что приложение действительно логинится в панель и что нужный инбаунд там есть. Собственный `.env` у Marzban упразднён: домен и секреты живут в одном `.env` в корне, compose раздаёт их через `${...}`, Caddyfile — через `{$...}`. Зафиксированы три поправки к дефолтам апстрима, без которых стек не работал: панель слушала `127.0.0.1` (её `UVICORN_HOST` читается только при настроенном TLS, поэтому команда контейнера заменена на прямой `uvicorn`), `SQLALCHEMY_DATABASE_URL` и `XRAY_JSON` по умолчанию указывали внутрь образа, а не на volume. Конфликт портов из прежней редакции раздела 3 закрыт: REALITY уходит на `8443`, `443` остаётся за Caddy. Схемы БД, типов, джобов и клиентов не касается.
- `v6` — редизайн по новому эталонному макету (`vpn-mockup.html`). Палитра уходит с сине-чёрной на нейтральный графит, акцент — `#B6CAEB` вместо `#AB93E1`, глубину даёт волосяная рамка на каждой карточке, а не ступень светлоты. **Акцентом не заливается ничего**: он живёт только как подложка бейджа, пилюля таб-бара, обводка аватара и рамка выбранного тарифа — поэтому `Card` теряет `tone`, а `Button` и `Badge` теряют `contrast`, которые существовали ровно ради залитой карточки. Шкала кеглей — тринадцать шагов вместо девяти. Гарнитур две: Space Grotesk несёт латиницу (в ней нарисован макет), Onest — кириллицу, которой в Space Grotesk нет; браузер выбирает по глифу через `unicode-range`, разметка не участвует. В разделе 12 добавлены `Chip` и `IconButton`, `Badge` получает `dot`, `Sheet` — `description` и кнопку закрытия. Колода тарифов в шторке из карточки-на-тариф становится радио-списком с одной кнопкой оплаты. Схемы БД, типов, джобов и клиентов не касается: изменения целиком в `app.css`, `lib/ui`, `static/fonts` и разметке роутов.
- `v5` — редизайн: приложение переезжает на одну тёмную палитру с единственным акцентом `#AB93E1` и фиксированную девятишаговую шкалу кеглей (раздел 11 дополнен палитрой и типографикой). `--tg-theme-*` больше не читаются, темы клиента не наследуются. Гарнитура — самохостящийся Onest в `static/fonts`. В разделе 12: `Card` получает `tone`, `Button` — вариант `contrast`, `Badge` — тон `contrast`; добавлены два примитива, `SectionHeading` и `Avatar` (последний переехал из `routes/(app)/profile` — его теперь просят два экрана). Схемы БД, типов, джобов и клиентов не касается: изменения целиком в `app.css`, `lib/ui` и разметке роутов.
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

Один VPS. Docker Compose, три долгоживущих сервиса и три one-shot. `scripts/deploy.sh` на чистой машине — весь деплой: руками после него не создаётся ничего.

Скрипт, а не голый `docker compose build && up -d`, по двум причинам, и обе — про молчаливую ложь. `.env` лежит вне контекста сборки, а BuildKit не кладёт содержимое секрет-маунта в ключ кеша: правка `.env` не меняет ни одного входа, сборка попадает в кеш, и образ остаётся со старыми секретами, отрапортовав успех — поэтому скрипт передаёт хеш `.env` build-аргументом. И `docker compose ps` без `-a` не показывает вышедшие контейнеры, то есть упавший `marzban-check` выглядит там ровно как успешный; скрипт дожидается всех трёх one-shot и падает на их коде возврата.

```
                    :443
                 ┌─────────┐
  Telegram ─────▶│  caddy  │
  клиенты        └────┬────┘
                      │  {$APP_DOMAIN}      → app:3000
                      │  {$SUB_DOMAIN}/sub/*→ marzban:8000
                      ▼
        ┌──────────────┬──────────────────┐
        │              │                  │
   ┌────┴────┐   ┌─────┴──────┐    ┌──────┴──────┐   ┌──────────────┐
   │   app   │   │app-migrate │    │   marzban   │◀──│ marzban-init │
   │SvelteKit│   │ one-shot   │    │ + xray-core │   │   one-shot   │
   │ + worker│   └────────────┘    └──────┬──────┘   └──────────────┘
   └────┬────┘                            │           marzban-check
        │ /data/app.db                    │ :8443 наружу (VLESS REALITY)
        │ HTTP → marzban:8000/api ────────┘
        ▼
   volume app-data                   volume marzban-data
```

Правила:
- Порт `8000` Marzban **не публикуется на внешний интерфейс**. Он биндится на петлю хоста (`127.0.0.1:8000:8000`), поэтому панель и `/api` достижимы изнутри Docker-сети и по SSH-туннелю, а из интернета — нет. Наружу Caddy отдаёт только путь `/sub/*` на отдельном сабдомене: клиентам VPN нужна ссылка подписки, дашборд им не нужен. Префикс `127.0.0.1:` — это и есть контроль доступа: без него Docker ставит DNAT с `0.0.0.0:8000` и публикует дашборд, `/api` и выдачу токена в открытом HTTP мимо Caddy.
- Приложение слушает `3000` внутри сети, наружу его отдаёт только Caddy.
- **Команда контейнера Marzban заменена на прямой `uvicorn main:app --host 0.0.0.0 --port 8000`.** Штатный `main.py` жёстко биндит `127.0.0.1`, когда TLS-сертификат не настроен, и `UVICORN_HOST` на этой ветке не читает вовсе: под родной командой панель недостижима ни для приложения, ни для Caddy. `main.py` импортируется безопасно (его `uvicorn.run` под `if __name__ == "__main__"`), роуты и startup-хуки регистрируются те же.
- **`SQLALCHEMY_DATABASE_URL` и `XRAY_JSON` задаются явно** и указывают в `/var/lib/marzban`. Дефолты апстрима относительны рабочей директории образа, то есть база панели и её конфиг легли бы в слой контейнера и умирали при каждом пересоздании.
- `app-migrate` прогоняет миграции и завершается. `app` стартует через `depends_on: { app-migrate: { condition: service_completed_successfully } }`. Так две реплики никогда не мигрируют один файл SQLite одновременно.
- `marzban-init` — тот же образ, тот же volume, до панели. Рендерит `xray_config.json` из шаблона со свежими ключами REALITY, прогоняет `alembic upgrade head`, заводит не-sudo аккаунт приложения и sudo-аккаунт оператора. Идемпотентен: повторный запуск сохраняет ключи и не трогает существующих админов. Порядок внутри задан апстримом — Marzban парсит `XRAY_JSON` на импорте, а `alembic` и `marzban-cli` импортируют весь пакет `app`, поэтому до появления валидного конфига не работает ни то, ни другое.
- `marzban-check` — после `service_healthy` панели. Проверяет, что аккаунт приложения логинится и что инбаунд с нужным тегом панель действительно отдаёт. От него не зависит никто: приложение обязано переживать мёртвую панель, поэтому его провал виден в `docker compose ps`, а не блокирует старт.
- **`app` намеренно не ждёт `marzban`.** Приложение — источник истины по деньгам и продолжает продавать, пока панель лежит; выдача доступа — джоб, а джобы ретраятся.
- REALITY слушает `8443`, а не `443`: `443` занят Caddy, и дважды один порт хост не займёт. Цена решения — не-443 эндпоинт у клиента; вернуть `443` можно только вторым IP на хосте (`<ip>:443:8443`). Номер порта Marzban копирует в ссылку подписки из конфига Xray и о публикации портов Docker не знает — значение в compose и в конфиге обязано совпадать, за этим следит `marzban-init`.
- Реплика ровно одна. SQLite + встроенный воркер этого требуют. Горизонтальное масштабирование вне рамок v1.
- Бэкап: cron на хосте, `sqlite3 /data/app.db ".backup /backup/app-$(date +%F).db"` плюс архив `/var/lib/marzban`. Ротация 14 дней.

**Реального времени в проекте нет.** SSE и websocket не заводим. Человек возвращается из браузера в мини-апп по диплинку `t.me/<bot>/<app>?startapp=order_<publicId>`, клиент читает `start_param` и дёргает `invalidate('app:subscription')`. Если вебхук ещё не доехал, показываем «Ждём подтверждение оплаты» и повторяем `invalidate` раз в 3 секунды, максимум минуту. Транспорт разработчику писать не нужно.

### Переменные окружения (`.env.example`)

Файл один на весь стек. Приложение получает его через `env_file` и через секрет сборки, Caddy и Marzban — через подстановку `${...}` в `docker-compose.yml`. Отдельного `.env` у Marzban нет (`v7`).

```dotenv
# deploy — домены поднимаются до первого up: Caddy идёт за сертификатом сразу
APP_DOMAIN=app.example.com
SUB_DOMAIN=sub.example.com
ACME_EMAIL=admin@example.com
# ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory   # пока DNS не разъехался

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
MARZBAN_ADMIN_USERNAME=vpnapp    # аккаунт приложения, marzban-init заводит его НЕ-sudo
MARZBAN_ADMIN_PASSWORD=          # не длиннее 72 байт: дальше bcrypt отказывает
MARZBAN_SUDO_USERNAME=           # аккаунт оператора для дашборда, необязателен
MARZBAN_SUDO_PASSWORD=
MARZBAN_INBOUND_TAGS=VLESS TCP REALITY
MARZBAN_VLESS_FLOW=xtls-rprx-vision
MARZBAN_SUB_URL_PREFIX=https://sub.example.com

# xray / reality — marzban-init рендерит их в конфиг панели один раз, на первом старте
REALITY_PORT=8443
REALITY_DEST=gateway.icloud.com:443
REALITY_SERVER_NAMES=gateway.icloud.com
REALITY_PRIVATE_KEY=             # пусто → ключи генерятся и остаются на volume навсегда
REALITY_SHORT_ID=

# payments
PAYMENT_PROVIDER=stripe            # stripe | fake
STRIPE_SECRET_KEY=                 # sk_live_… / sk_test_…
STRIPE_WEBHOOK_SECRET=             # whsec_… из stripe listen или из дашборда
PRICE_CURRENCY=usd                 # ISO 4217 в нижнем регистре, как требует Stripe
RETURN_DEEPLINK=https://t.me/<bot_username>/<app_short_name>
```

`src/lib/server/config.ts` — единственное место, где читается `$env/static/private`. Модуль парсит переменные схемой valibot на старте и падает с внятным сообщением, если чего-то нет. Ни один другой модуль в `process.env` не смотрит.

Домен написан в файле четырежды, и иначе быть не может: `PUBLIC_APP_URL` и `MARZBAN_SUB_URL_PREFIX` вмораживаются в образ на сборке и подстановке во время запуска не поддаются. Поэтому `marzban-init` сверяет все четыре написания до того, как что-либо стартует, и на расхождении валит деплой — рассинхрон иначе виден только человеку с битым QR.

`XRAY_SUBSCRIPTION_URL_PREFIX` панели compose собирает из `SUB_DOMAIN` сам. Без него API вернёт относительный путь вместо абсолютной ссылки, и клиент получит битый QR.

Ключ REALITY — секрет, поэтому в репозитории его нет: `marzban-init` генерирует пару на первом старте и оставляет на volume. Перегенерация обрубает всех уже выданных клиентов, поэтому существующий `xray_config.json` init не трогает никогда. Свой ключ можно закрепить через `REALITY_PRIVATE_KEY`; публичный из него **выводится** (`xray x25519 -i`), а не берётся второй переменной — Marzban не проверяет, что пара сходится, и при расхождении отдаёт рабочие с виду ссылки, по которым никто не подключится.

---

## 4. Структура папок

```
.
├─ docker-compose.yml
├─ Caddyfile
├─ .env.example
├─ drizzle.config.ts
├─ drizzle/                        # миграции, только тимлид
├─ marzban/                        # бутстрап панели, только тимлид
│  ├─ init.sh                      # конфиг Xray + миграции панели + оба админа
│  ├─ check.sh                     # после старта: логин приложения и наличие инбаунда
│  └─ xray_config.template.json    # шаблон REALITY, ключи подставляются на первом старте
├─ scripts/{migrate.ts,seed.ts,init-env.sh,deploy.sh,backup.sh}
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

Signature-элемент приложения. Absolute внизу рамки (не `fixed`: на десктопе рамка — макет телефона, и `fixed` вешает островок на низ вьюпорта), `env(safe-area-inset-bottom)`, три кнопки, активная — пилюля, которая переезжает пружиной за сменой роута.

Пилюля — **подложка, а не заливка** (`v6`): активная вкладка получает `bg-accent/12` и акцентный глиф, а не сплошной акцент с инверсией. Иначе внизу каждого экрана стоит третий блок цвета размером с кнопку.

```css
/* app.css */
@utility island {
  background: rgb(36 36 36 / 0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgb(255 255 255 / 0.09);
  box-shadow: 0 22px 44px -20px rgb(0 0 0 / 0.85);
}
```

Ограничение: `backdrop-filter` на старых WebView Android не работает. Фолбэк — сплошной `--color-elevated` через `@supports not (backdrop-filter: blur(1px))`. Стекло — украшение, читаемость от него не зависит.

### Палитра и типографика (`v6`)

Приложение фиксирует **одну тёмную палитру** и отдаёт её Telegram через `setHeaderColor`/`setBackgroundColor`. Переключателя тем нет и `--tg-theme-*` не читаются: все поверхности и акцент подогнаны под `#1A1A1A` и под светлой темой клиента рассыпаются. Токены живут в `@theme` в `app.css`, литералов цвета в разметке нет.

| Роль | Токен | Значение |
|---|---|---|
| Страница | `--color-page` | `#1A1A1A` |
| Карточка | `--color-surface` | `#242424` |
| Над карточкой: аватар | `--color-elevated` | `#2C2C2C` |
| Строка внутри шторки | `--color-inset` | `#262626` |
| Шторка | `--color-sheet` | `#1F1F1F` |
| За рамкой телефона (десктоп) | `--color-shell` | `#101010` |
| Основной текст | `--color-ink` | `#FFFFFF` |
| Вторичный текст | `--color-muted` | `rgb(255 255 255 / .6)` |
| Самый тихий текст, неактивная вкладка | `--color-subtle` | `rgb(255 255 255 / .42)` |
| Линия, рамка карточки | `--color-line` | `rgb(255 255 255 / .08)` |
| Линия под заголовком, рамка чипа | `--color-line-strong` | `rgb(255 255 255 / .10)` |
| Акцент | `--color-accent` | `#B6CAEB` |
| Текст **на** акценте | `--color-on-accent` | `#141414` |
| Ошибка | `--color-danger` | `#FF7A8A` |
| Предупреждение | `--color-warn` | `#FFD166` |

Ступени поверхностей стоят близко друг к другу намеренно: **карточка читается карточкой из-за волосяной рамки, а не из-за заливки**. Одна заливка на этой палитре — подъём в две ступени, которого никто не видит, поэтому `card` в `app.css` держит заливку, рамку и радиус вместе, и порознь они не используются.

Акцент один, ряда оттенков нет: всё, что мягче, — тот же тон на прозрачности (`bg-accent/15`, `border-accent/28`). Пять подобранных вручную соседей неизбежно расходятся, один тон — нет. Состояния устроены так же: цвет для текста, он же на 15% для подложки.

**Акцентом не заливается ни одна карточка.** Он появляется ровно там, где макет его тратит: кнопка `primary`, подложка и текст бейджа, глиф в чипе, обводка аватара, пилюля островка, рамка выбранного тарифа, шеврон раскрытого вопроса. Ключевое следствие: **`#B6CAEB` — светлый цвет**, поэтому всё, что им залито, несёт `text-on-accent`, а не белый.

Радиусы: `--radius-control` 14 (кнопка `ghost`) · `--radius-field` 16 (кнопка `primary`, поле ввода) · `--radius-plan` 20 (строка тарифа) · `--radius-card` 26 · `--radius-island` 999.

Шкала кеглей — тринадцать шагов, названы по роли, а не по размеру: `text-display` 40 · `text-title` 24 · `text-h1` 22 · `text-h2` 20 · `text-h3` 19 · `text-h4` 18 · `text-body` 17 · `text-md` 16 · `text-sm` 15 · `text-xs` 14 · `text-2xs` 13 · `text-3xs` 12 · `text-4xs` 11. Произвольных `text-[14px]` в разметке не бывает — экран выбирает шаг. Макет пишет три значения полупикселями (14.5 вопрос FAQ, 13.5 абзац, 12.5 подпись тарифа); они округлены до целых: на расстоянии чтения пара с 14, 13 и 12 неразличима, а пятнадцать разовых размеров превращаются в шкалу, из которой можно выбирать.

Гарнитур **две**, разделённых по алфавитам, и обе лежат в `static/fonts` (не `fonts.gstatic.com`: на один origin в CSP и один round trip на холодном WebView меньше).

- **Space Grotesk** — референсная гарнитура макета, ею набрана вся латиница: `Premium`, `XRAY`, `VLESS`, цены, `@username`. Подмножества `latin`, `latin-ext`.
- **Onest** — кириллица, которой в Space Grotesk нет вовсе (только `latin`, `latin-ext`, `vietnamese`). Интерфейс русский, и в одиночку Space Grotesk уронил бы каждое русское слово на системный шрифт: SF Pro на iOS, Roboto на Android — продукт выглядел бы по-разному у двух человек рядом.

Порядок в `--font-sans` — весь механизм: Space Grotesk первым, Onest за ним. Кириллических диапазонов первая не объявляет, поэтому браузер проваливается на вторую **по глифу**. Разметка шрифт не выбирает нигде.

Копия интерфейса: активный залог, предложения с заглавной, кнопка называет действие («Купить 30 дней», не «Отправить»). Ошибка говорит, что произошло и что делать. Пустой экран профиля — приглашение купить, а не «данных нет».

### Содержимое секций

- **Главная** (`v4`): приветствие («Добро пожаловать» + имя из Telegram, `Инкогнито` без сессии), затем ряд овальных пилюль с особенностями сервиса — статичная копия (`v6`: три штуки — «Без логов», «XRAY», «VLESS»; в одну строку на 360px, чего четвёртая уже не даёт), не из БД. Ниже карточка **«Текущий план»**: имя тарифа, статус (`Badge`: «Активен» с точкой / «Закончилась» / «Отозвана» / «Нет подписки»; при `daysLeft <= 3` слово то же, а тон уходит в `warn` — предупреждает цвет, не вторая фраза в пилюле), строка «Активен ещё N дней», строка трафика — использовано из живого чтения Marzban против `trafficLimitBytes` тарифа; читается промисом, стримится отдельно от остального `load`, при недоступной панели показывает то, что есть, но никогда не блокирует и не роняет страницу. Кнопки (`v6`, порядок зависит от доступа): при активной подписке ведёт «Инструкция по подключению» (переход на `/setup`), под ней пара — «Промокод» и «Продлить»; без подписки ведёт «Купить», под ней «Промокод» и «Установить». Обе кнопки, открывающие колоду, называются в accessible name своим же видимым словом («Купить подписку», «Продлить подписку»), иначе имя не содержит подписи (WCAG 2.5.3).

  **Колода тарифов (`v6`)** — радио-список в `Sheet`, а не карточка на тариф: один выбор, потом одна оплата. Строка тарифа несёт радио-кружок, имя, вторую строку «`<срок>` · `<подпись из БД или трафик>`» (срок пишется явно — `name` свободный текст, и тариф «Стартовый» иначе нигде не показал бы длительность), цену и тег скидки. Тег считается от **худшей** дневной ставки в колоде: колонки «было» в схеме нет, и процент обязан быть фактом о том, что на экране. Меньше 5% тега нет, 100% не бывает (пол, не округление: скидка может занижать, но не завышать). Под списком — одна кнопка «Оплатить» (accessible name «Оплатить тариф `<имя>`») и подпись «Продлит доступ до `<дата>`» при активной подписке.
- **Установка** (`/setup`, `v4`, вне трёх секций и свайпа — `sectionOfPath` возвращает `null`): достижима только с активной подпиской, иначе редирект на `/`. Инструкция «поставьте Happ → отсканируйте QR или вставьте ссылку → подключитесь» с той же ссылкой подписки и QR, что и в профиле.
- **Поддержка**: аккордеон FAQ из `faqItems` + форма обращения (textarea 10..2000, счётчик, кнопка). После отправки — состояние «Отправили, админ ответит в личку». Лимит: 3 обращения в час на человека, иначе `429` и внятный текст.
- **Профиль** (`v4`: рендерится и без сессии): аватар (`photoUrl`, фолбэк — инициал; без сессии и без фото — нейтральная иконка), имя (`Инкогнито` без сессии), `@username` (строка скрыта без сессии, а не пустая). Блок промокода — только при сессии. Ниже подписка: активный или истёкший тариф (дата окончания, дней осталось, ссылка подписки с кнопкой «Скопировать», QR, кнопка «Инструкция по подключению» на `/setup` при активной подписке и «Продлить» — уводит на главную) либо пустое состояние «Подписки нет» с кнопкой «Выбрать тариф», которое рендерится и без сессии. Ниже история покупок из `orders` (только при сессии и непустой истории). Для `ADMIN_CHAT_ID` — вход в админку.
- **Админка** (`/profile/admin`): CRUD тарифов (создать, редактировать, архивировать), CRUD промокодов, список последних обращений, ручной `marzban.reconcile`, список упавших джобов.

---

## 12. Список UI-примитивов

Тимлид собирает **до** раздачи задач и рендерит все в `/dev/kitchen-sink`. Разработчик берёт отсюда и своих кнопок не пишет.

База: `shadcn-svelte` там, где компонент есть, минус его тема — токены наши, из `@theme`. Стеклянные вещи (`Island`, `Sheet`) пишем сами, у shadcn такого нет.

| Компонент | Пропсы (эскиз) |
|---|---|
| `Button.svelte` | `variant: 'primary' \| 'ghost' \| 'danger'`, `size: 'sm' \| 'md'`, `loading`, `disabled`, `onclick`, `children` |
| `Card.svelte` | `padded`, `interactive`, `onclick`, `children` |
| `Input.svelte` | `value = $bindable()`, `label`, `error`, `type`, `maxlength` |
| `Textarea.svelte` | `value = $bindable()`, `label`, `error`, `maxlength`, `counter` |
| `Badge.svelte` | `tone: 'neutral' \| 'success' \| 'warn' \| 'danger'`, `dot` (`v6`), `children` |
| `SectionHeading.svelte` | `title`, `action?` — заголовок секции с линейкой (`v5`) |
| `Avatar.svelte` | `photoUrl`, `firstName`, `size: 'sm' \| 'lg'` (`v5`) |
| `Chip.svelte` | `icon?`, `children` — овальная пилюля с акцентным глифом (`v6`) |
| `IconButton.svelte` | `href?`, `onclick?`, `aria-label`, `children` — круг 40px в углу экрана (`v6`) |
| `Island.svelte` | `sections`, `activeIndex` |
| `Swipeable.svelte` | `index`, `count`, `onnavigate`, `children` |
| `Sheet.svelte` | `open = $bindable()`, `title`, `description?` (`v6`), `children` — ручка, заголовок и кнопка закрытия свои |
| `Modal.svelte` | `open = $bindable()`, `title`, `children`, `onconfirm` |
| `QrCode.svelte` | `value`, `size` |
| `CopyField.svelte` | `value`, `label` |
| `Skeleton.svelte` | `lines`, `height` |
| `Toast.svelte` + `toasts.svelte.ts` | `push(message, tone)` |
| `EmptyState.svelte` | `title`, `description`, `action` |
| `Money.svelte` | `minor`, `currency` — единственное место форматирования цены |

Качественный пол для каждого: работает от 320 px, фокус виден с клавиатуры, `prefers-reduced-motion` уважается, у интерактивных элементов есть `aria-label`.

Карточка одна, тонов у неё нет (`v6`). Референс не заливает акцентом ничего, поэтому `Card tone`, `Button variant="contrast"` и `Badge tone="contrast"` удалены — они существовали ровно ради того, чтобы выжить на акцентной заливке, и без неё им нечего делать. Иерархию на экране держат бейдж, кнопка и заголовок секции.

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
| CI/CD, Caddyfile, compose, `marzban/` | тимлид | исключение: блок заголовков в `Caddyfile` правит разработчик в рамках A17 — HSTS ставит только тот, кто терминирует TLS (`v3`) |
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
- `A19` Переезд на эталонный макет `vpn-mockup.html`: графитовая палитра с акцентом `#B6CAEB`, карточка «заливка + волосяная рамка», тринадцатишаговая шкала, Space Grotesk + Onest по алфавитам, колода тарифов радио-списком с одной оплатой, новые примитивы `Chip` и `IconButton`. См. раздел 11 и changelog `v6`.

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

   Проверка от 2026-07-21 (`v7`): `v0.8.4` от 2025-01-09 — по-прежнему последний стабильный релиз, и `latest` сейчас указывает ровно на этот образ. Разработка ушла в ветку `v1.0.0`, которая с 2025-08 в бете и представляет собой переписанный код с другими формами API. Апстрим стоит около полутора лет, и это тот самый сигнал, который этот пункт просит взвесить: весь `marzban/` и `clients/marzban/http.ts` написаны против `v0.8.4` построчно, поэтому бамп тега — не обновление, а перенос интеграции. `latest` в compose запрещён отдельно: он сдвинется молча в день релиза v1.0.0.

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
