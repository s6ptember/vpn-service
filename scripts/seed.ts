import { and, eq, isNull } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { faqItems, plans, promoCodes, users } from '../src/lib/server/db/schema';
import { CURRENCIES, type Currency } from '../src/lib/types';

/**
 * Shared fixtures for dev and tests. Fakes serve the same data, so a slice written against a fake
 * sees what it will see against a seeded DB. Re-runnable: every insert keys off a natural key.
 *
 * Prices mirror vpn-miniapp.html one-to-one as minor units pending the open question in tech.md 17
 * (currency and launch prices). 90 days is priced ~30% under three 7-day-rate months.
 */
// Outside Vite nothing loads .env; docker passes the values through env_file instead.
try {
	process.loadEnvFile('.env');
} catch {
	// No .env: fall back to the real environment (docker, CI).
}

const path = process.env.DATABASE_PATH;
if (!path) {
	console.error('DATABASE_PATH is required');
	process.exit(1);
}

// `as Currency` would launder anything the shell says into the frozen union, and SQLite holds no
// CHECK on the column — a typo would seed a currency the app cannot price or charge in.
const currencyRaw = process.env.PRICE_CURRENCY ?? 'usd';
if (!CURRENCIES.includes(currencyRaw as Currency)) {
	console.error(`PRICE_CURRENCY must be one of ${CURRENCIES.join(' | ')}, got "${currencyRaw}"`);
	process.exit(1);
}
const currency = currencyRaw as Currency;

const adminChatId = Number(process.env.ADMIN_CHAT_ID || 100_000_001);
if (!Number.isSafeInteger(adminChatId) || adminChatId <= 0) {
	console.error(`ADMIN_CHAT_ID must be a positive integer, got "${process.env.ADMIN_CHAT_ID}"`);
	process.exit(1);
}

const now = new Date();
const db = createDb(path);

const PLANS = [
	{
		name: '7 дней',
		description: 'Попробовать без обязательств',
		durationDays: 7,
		priceMinor: 149,
		sortOrder: 0
	},
	{
		name: '30 дней',
		description: 'Обычный выбор',
		durationDays: 30,
		priceMinor: 499,
		sortOrder: 1
	},
	{
		name: '90 дней',
		description: 'Выгоднее всего',
		durationDays: 90,
		priceMinor: 1049,
		sortOrder: 2
	}
];

const PROMOS = [
	{ code: 'START30', discountType: 'percent' as const, discountValue: 30, maxUses: null },
	{ code: 'FRIEND10', discountType: 'percent' as const, discountValue: 10, maxUses: 500 }
];

// Copy mirrors vpn-miniapp.html. The device-count claim from the mock is dropped on purpose:
// tech.md 17.4 states Marzban gives no device limit, so promising one would be a lie.
const FAQ = [
	{
		question: 'Как подключиться после оплаты?',
		answer:
			'Ключ появится в профиле сразу после оплаты. Установите V2Box на iOS или Hiddify на Android, импортируйте ссылку или отсканируйте QR-код.'
	},
	{
		question: 'На скольких устройствах работает ключ?',
		answer:
			'Ключ один, устройств сколько нужно — импортируйте его на телефон, ноутбук и планшет. Скорость делится между подключениями.'
	},
	{
		question: 'VPN не подключается',
		answer:
			'Обновите подписку в приложении и выберите другую локацию. Если не помогло — проверьте срок тарифа в профиле и напишите нам.'
	},
	{
		question: 'Как продлить тариф?',
		answer:
			'Оплатите любой тариф на главной. Дни добавятся к текущей подписке, ключ останется прежним.'
	},
	{
		question: 'Вы ведёте логи?',
		answer: 'Нет. Храним только Telegram ID, срок подписки и историю оплат.'
	},
	{
		question: 'Можно вернуть деньги?',
		answer: 'Да, в течение 24 часов после оплаты, если подключиться не удалось.'
	}
];

const USERS = [
	{ telegramId: adminChatId, username: 'alex_k', firstName: 'Александр', lastName: null },
	{ telegramId: 100_000_002, username: 'mariia', firstName: 'Мария', lastName: 'Петрова' }
];

/**
 * Reconcile by hand: plans.name carries no unique constraint, so onConflictDoNothing has no target
 * to fire on and every run would insert another copy. Match the live row by name and update it,
 * otherwise insert. Archived rows are excluded from the match on purpose — a plan the admin retired
 * must stay retired, and a seed that revives it would undo A4's archiving in one command.
 */
for (const plan of PLANS) {
	const live = db
		.select({ id: plans.id })
		.from(plans)
		.where(and(eq(plans.name, plan.name), isNull(plans.archivedAt)))
		.get();

	if (live) {
		db.update(plans)
			.set({ ...plan, currency, trafficLimitBytes: 0, isActive: true, updatedAt: now })
			.where(eq(plans.id, live.id))
			.run();
		continue;
	}

	db.insert(plans)
		.values({
			...plan,
			currency,
			trafficLimitBytes: 0,
			isActive: true,
			createdAt: now,
			updatedAt: now
		})
		.run();
}

for (const promo of PROMOS) {
	db.insert(promoCodes)
		.values({ ...promo, isActive: true, createdAt: now, validFrom: null, validUntil: null })
		.onConflictDoUpdate({
			target: promoCodes.code,
			set: { discountType: promo.discountType, discountValue: promo.discountValue, isActive: true }
		})
		.run();
}

db.delete(faqItems).run();
FAQ.forEach((item, i) => {
	db.insert(faqItems)
		.values({ ...item, sortOrder: i, isActive: true })
		.run();
});

for (const user of USERS) {
	db.insert(users)
		.values({ ...user, photoUrl: null, languageCode: 'ru', createdAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: users.telegramId,
			set: { username: user.username, firstName: user.firstName, updatedAt: now }
		})
		.run();
}

console.log(
	`seeded: ${PLANS.length} plans (${currency}), ${PROMOS.length} promo codes, ${FAQ.length} faq items, ${USERS.length} users`
);
console.log(`admin is telegramId ${adminChatId} (ADMIN_CHAT_ID)`);
