## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, vitest, playwright, tailwindcss, sveltekit-adapter

---

# CLAUDE.md

Правила, которые обязаны срабатывать на каждой строке кода. Claude Code подтягивает этот файл в каждую сессию автоматически, поэтому он живёт здесь, а не в `tech.md`.

**Источник истины по контрактам — `tech.md` (версия ядра v2).** Схема БД, общие типы, контракты джобов, интерфейсы внешних клиентов, список UI-примитивов, стратегия тестов, роадмап — там. Подчиняйся ему дословно.

**Файл роли** — `LEAD.md` (тимлид) или `DEV_A.md` (разработчик). Прочитай свой перед началом работы.

Дублей между файлами нет: правило живёт ровно в одном месте. Не переноси сюда контракты и не переноси туда правила.

---

## 0. Контракты не выдумываются

Нужного типа, поля, эндпоинта или контракта нет в `tech.md` → **СТОП**. Не пиши код с выдуманным типом, не «дополни схему по смыслу», не заведи локальный интерфейс «пока что».

Выдай блок:

```
CONTRACT GAP
Нужно: <что именно>
Зачем: <какая задача упирается>
Предлагаемая форма: <тип/поле/эндпоинт>
```

Дальше: открой issue с меткой `contract-change`, продолжай на локальной заглушке, жди, пока тимлид аппендит контракт в `tech.md` и бампнет версию.

Твой слайс повторяет структуру эталонного слайса в `routes/(app)/+page.*`. Сверяйся с ним, свою раскладку не изобретай.

---

## 1. Топ-5 по SvelteKit

Пять правил, которые дают больше всего результата на этом стеке. Ревью проверяет их механически.

### 1.1 Руны: `$derived` для вычислений, `$effect` — только для внешнего мира

`$state`, `$props`, `$derived`, `$derived.by` покрывают почти всё. `$effect` нужен там, где надо синхронизироваться с чем-то за пределами Svelte: Telegram WebApp API, canvas, подписка на внешний источник. Вычисляемое значение через `$effect` — источник лишних ререндеров, гонок и петель.

```svelte
<script lang="ts">
  let { plans, subscription }: { plans: PlanDTO[]; subscription: SubscriptionDTO | null } = $props();

  let selectedId = $state<number | null>(null);
  let selected = $derived(plans.find((p) => p.id === selectedId) ?? null);
  let extendsUntil = $derived(
    selected && subscription?.status === 'active'
      ? addDays(subscription.expiresAt, selected.durationDays)
      : null
  );

  // не так: let extendsUntil = $state(null);
  //         $effect(() => { extendsUntil = selected ? addDays(...) : null });
</script>
```

Цепочка `$derived` пересчитывается сама и ровно один раз за изменение. Та же цепочка на `$effect` даёт лишний проход рендера, а при взаимной зависимости двух эффектов — петлю.

Ещё: `$state.raw` для больших массивов, которые заменяются целиком (прокси на каждый элемент не строится), `$bindable()` для двустороннего пропса, `{@render children()}` вместо слотов.

### 1.2 Состояние — в runed-классах, глобального мутабельного состояния нет

Требование ООП здесь совпадает с требованием безопасности. Классы с рунами в полях живут в `.svelte.ts`, раздаются через `setContext`/`getContext`.

```ts
// lib/client/telegram.svelte.ts
export class TelegramSession {
  user = $state<SessionUser | null>(null);
  ready = $state(false);
  get isAdmin() { return this.user?.isAdmin ?? false; }
}
```

Жёсткое правило: **на сервере модульная переменная живёт весь процесс и общая для всех запросов**. `export let currentUser` в модуле `lib/server` — это утечка данных одного человека другому, а не удобство. Данные запроса живут в `event.locals` и нигде больше. Синглтоны в `container.ts` допустимы только для сервисов без состояния и для соединения с БД.

### 1.3 Один гард в `hooks.server.ts`, дальше `locals`

Проверка сессии в каждом `load` — это DRY-долг и дыра: забыл в одном месте, потерял всё. Гард один.

```ts
// hooks.server.ts
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID();
  event.locals.user = await sessions.read(event.cookies);

  // /api/auth/telegram, /api/telegram/webhook, /api/stripe/webhook приходят без сессии по определению
  if (!isPublicPath(event.url.pathname)) {
    const guarded = event.request.method !== 'GET' || event.url.pathname.startsWith('/api/');
    if (!event.locals.user && guarded) error(401, 'unauthorized');
    if (event.locals.user && isAdminPath(event.url.pathname) && !event.locals.user.isAdmin) error(403, 'forbidden');
  }

  const response = await resolve(event);
  response.headers.set('content-security-policy', 'frame-ancestors https://web.telegram.org https://*.telegram.org;');
  return response;
};
```

Первый GET документа всегда приходит без куки: `401` на него закроет вход в приложение целиком. Правила гарда целиком — в `tech.md`, раздел 9.

### 1.4 Граница сервера держится инструментом, а не памятью

Всё серверное — под `$lib/server/**`. Секреты — только из `$env/static/private`. Импортируешь такой модуль из клиентского кода — Vite ломает сборку. Это бесплатный статический контроль, который ловит утечку `TELEGRAM_BOT_TOKEN` или `STRIPE_SECRET_KEY` до ревью.

`load` отдаёт **DTO из `lib/types`, а не строки БД**. Строка `subscriptions` содержит `marzbanUsername`, строка `orders` — `providerPaymentIntentId`: наружу не идёт ничего, кроме полей DTO. Маппинг `row → DTO` живёт в домене, руками в `+page.server.ts` не пишется.

### 1.5 Form actions вместо самописных эндпоинтов, типы из `./$types`

Мутации — через `export const actions` и `use:enhance`. Даром получаем: CSRF-проверку по `Origin`, работу без JS, один путь для валидации, отсутствие параллельной вселенной fetch-обёрток. Схема valibot парсит `FormData` на сервере, `fail(400, { issues })` возвращает ошибки в форму.

`+server.ts` заводим только там, где нужен настоящий HTTP-эндпоинт для чужой системы: вебхук Telegram, вебхук Stripe, обмен initData. Всё остальное — actions.

Типы всегда генерятся: `import type { PageServerLoad, Actions } from './$types'`. Ручные аннотации `load` расходятся со схемой роута и врут.

> Remote functions (`query`/`form`/`command` в `.remote.ts`) остаются экспериментальными и меняются от релиза к релизу. В этом проекте их не включаем. Пересмотреть, когда стабилизируются.

---

## 2. Безопасность

- Никогда не доверяем клиенту: id пользователя, цена, статус оплаты, признак админа приходят с сервера, не из запроса.
- **Цену считает сервер.** Сумма, пришедшая из формы, игнорируется всегда.
- **Доступ выдаёт только вебхук Stripe с проверенной подписью.** Редирект на `success_url` фактом оплаты не является: эту ссылку открывают руками.
- **Подпись Stripe считается по сырому телу**: `await request.text()`, не `request.json()`. Парс до проверки ломает подпись.
- Вебхук Telegram проверяет `X-Telegram-Bot-Api-Secret-Token`, вебхук Stripe — `stripe-signature`. Не сошлось → ответ без единого обращения к БД.
- `initData` валидируется подписью на каждом обмене, сравнение хешей — `timingSafeEqual`, `dataCheckString` собирается только из сырой строки.
- Кука сессии: `httpOnly`, `secure`, `sameSite: 'none'`, подпись HMAC, TTL.
- Пароль админа Marzban — отдельный не-sudo аккаунт API, не суперадмин панели. Панель наружу не публикуется, снаружи доступен только `/sub/*`.
- Лимиты: обмен initData 10/мин на IP, промокод 5 попыток за 10 мин на человека, обращение в поддержку 3/час.
- Логи: `requestId`, тип события, id сущностей. Никогда — `initData`, токены, ключи Stripe, тело вебхука целиком. Функция `redact()` в `lib/server/log.ts`.
- Вход любого action и любого эндпоинта парсится схемой valibot. Непарсенных данных в домене не бывает.
- Ошибки наружу — код и человеческий текст. Стектрейс и `lastError` остаются в логе.

## 3. ООП

- Внешний сервис = интерфейс + реализация + фейк. Выбор — в `container.ts`. Типы Stripe SDK за границу `clients/payments` не выходят.
- Домен = класс-сервис с зависимостями через конструктор. Никаких импортов синглтонов внутрь домена, иначе тест придётся поднимать целиком.
- Чистая логика (цена, скидка, расчёт даты окончания) — отдельные классы без БД, времени и сети. Время приходит параметром: `now: number`.
- Ошибки — иерархия от `AppError` с полем `code`. Домен кидает `AppError` и про HTTP не знает. Маппинг `code → error(status, message)` живёт на границе роута, один хелпер `toHttp(err)`. `handleError` в hooks логирует с `requestId` и отдаёт наружу безопасную форму `App.Error`, статус он не ставит.
- Ожидаемый исход домена (промокод просрочен, лимит выбран) — `Result`. Неожиданный (Stripe лёг, БД недоступна) — `throw`. Исключениями поток не рулим.
- Наследование только там, где есть общий контракт (`abstract class JobHandler<T extends JobType>`). В остальном композиция.
- Хендлер джоба идемпотентен: два прогона с тем же payload дают ровно один эффект.

## 4. DRY

- Форматирование цены — `Money.svelte` и `formatMoney(minor, currency)` поверх `Intl.NumberFormat`, один раз. Делений на 100 по коду нет.
- Расчёт «дней осталось» — одна функция, её видят и UI, и джоб уведомлений.
- Конвертация ms ↔ s для Marzban — только внутри `clients/marzban/http.ts`.
- Проверка админства — только `locals.user.isAdmin`.
- Списки статусов и enum'ов — из `lib/types`, литералов в разметке нет.

## 5. Комментарии

Кратко, по делу, по-английски. Комментарий объясняет **почему**, а не пересказывает код. Закомментированный код в PR не остаётся.

```ts
// Stripe retries this webhook until we answer 2xx, so provisioning goes to a job.
await jobs.enqueue('subscription.provision', { orderId }, `provision:order:${orderId}`);
```

## 6. Коммиты и PR

- **Язык — только английский**: коммиты, заголовки и описания PR, комментарии в коде. Русский остаётся в текстах интерфейса и в документации.
- **Автор коммита фиксирован.** В репозитории один раз:
  ```bash
  git config user.name  "s6ptember"
  git config user.email "s6ptember@example.com"
  ```
- **Следов нейросети в истории нет.** Ни трейлера `Co-Authored-By`, ни строки `Generated with …`, ни эмодзи, ни ссылок на инструмент. Сессия, которая добавляет такой футер, ломает требование. Коммит выглядит как коммит человека.
- **Формат коммита — Conventional Commits, всегда**: `type(scope): summary`. `type` из закрытого набора `feat|fix|test|refactor|chore|docs`. `summary` в императиве, со строчной, без точки, до ~50 символов. Тело — только чтобы объяснить *почему*.
  ```
  feat(billing): recompute price on server before checkout
  fix(marzban): convert expiry to seconds on user create
  test(jobs): cover provision idempotency on duplicate webhook
  ```
- **Коммить сам по ходу работы**, маленькими логическими коммитами после каждого осмысленного шага. Не сваливай всё одним коммитом в конце. Каждый коммит по возможности проходит тайпчек.
- **PR**: заголовок краткий и содержит ID задачи Linear (ветка → PR → задача связываются автоматически). Тело короткое: что делает слайс, какие контракты и типы затрагивает, чем покрыт тестами.
- Дисциплина `stop-slop` действует на всю эту прозу: активный залог, императив, конкретика, без филлеров.

## 7. Definition of Done одной задачи

- `eslint` + `prettier` + `svelte-check` зелёные.
- `vite build` проходит.
- Тесты по доктрине из раздела «Стратегия тестов» в `tech.md`: выведены из критериев приёмки, а не из реализации; на каждый джоб — тест идемпотентности; на стыке слайса — контрактный тест; чистая логика — property-based.
- Задача Linear привязана, ID в заголовке PR.
- Контракты не выдуманы: всё из `tech.md`.
- Общие файлы не тронуты: `tech.md`, `lib/types`, `lib/server/db/schema.ts`, `lib/ui`, layout, `drizzle/`. Миграции разработчик не пишет вообще.
- Использованы примитивы из `lib/ui`, самописного UI нет.
- Секретов в диффе нет, `.env.example` обновлён, если появилась переменная.

## 8. Одна задача за раз

Реализуй одну задачу из стадийного списка в своём файле роли и отдавай сфокусированный дифф. Не вываливай всё приложение сразу: это бережёт ревью тимлида и держит PR читаемым.
