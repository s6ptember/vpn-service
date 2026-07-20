import { fail } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import {
	jobs,
	planInput,
	plans,
	promoInput,
	promos,
	reconcileInput,
	subscriptions,
	tickets,
	users
} from '$lib/server/container';
import { toFailedJobView } from '$lib/server/jobs/job-view';
import { log } from '$lib/server/log';
import { toTicketAdminView } from '$lib/server/support';
import type { Actions, PageServerLoad } from './$types';

/**
 * A4 — plans CRUD, A11 — promo codes CRUD, A16 — operations. Mutations go through form actions rather
 * than hand-rolled endpoints, so CSRF by Origin, no-JS submits and one validation path come for free
 * (CLAUDE.md 1.5).
 */

/** tech.md 6: the reconcile key buckets by the hour, so a double-tap inside one costs nothing. */
const RECONCILE_WINDOW_MS = 3_600_000;

/**
 * Which form the answer belongs to.
 *
 * `kind` is not decoration: plans and promo codes have independent id sequences, so an answer about
 * promo 3 would otherwise land on the card for plan 3 — a save reported under a row that was never
 * touched. `id` is null for the two create forms and for reconcile, which has exactly one form.
 */
interface Target {
	kind: 'plan' | 'promo' | 'reconcile';
	id: number | null;
}

interface ActionResult {
	target: Target;
	/** Whether the write happened. The page reads it to pick a tone: red is for refusals only. */
	ok: boolean;
	/** One sentence for the admin. Null when the fields carry the message themselves. */
	message: string | null;
	/** Field name -> message, for the inputs that failed. */
	errors: Record<string, string>;
	/** What was typed, so a rejected form comes back filled instead of blank. */
	values: Record<string, string>;
}

const isAdmin = (locals: App.Locals): boolean => locals.user?.isAdmin ?? false;

/** Files have no place in these forms and would only complicate serialising the echo back. */
function formValues(data: FormData): Record<string, string> {
	const values: Record<string, string> = {};

	for (const [key, value] of data) {
		if (typeof value === 'string') values[key] = value;
	}

	return values;
}

const ok = (target: Target, message: string): ActionResult => ({
	target,
	ok: true,
	message,
	errors: {},
	values: {}
});

const plan = (id: number | null): Target => ({ kind: 'plan', id });
const promo = (id: number | null): Target => ({ kind: 'promo', id });
const reconcile = (): Target => ({ kind: 'reconcile', id: null });

/**
 * The guard in hooks.server.ts already 403s a signed-in non-admin, and the shell still renders for a
 * request that has no cookie yet (tech.md 9). That render must not hand the plan list to nobody, so
 * the load answers empty until the session lands and invalidateAll() runs the load again.
 */
export const load: PageServerLoad = async ({ locals }) => ({
	plans: isAdmin(locals) ? plans.listEditable() : [],
	/**
	 * Gated for the same reason, and it matters more here than for plans: a live promo code is a
	 * bearer secret — anybody holding one can spend it — so the list must never render for a request
	 * that has not proved who it belongs to.
	 */
	promoCodes: isAdmin(locals) ? promos.listEditable() : [],
	/**
	 * A16 — the operations half of the panel (tech.md 11). Gated like everything above it: a request
	 * that has not proved who it belongs to gets empty lists, not a queue's failure history.
	 *
	 * The join to the author happens here rather than in the reader, because `listRecent` owns one
	 * table and the view needs two. Bounded to twenty rows, so this is twenty lookups by primary key.
	 */
	tickets: isAdmin(locals)
		? tickets
				.listRecent()
				.map((ticket) => {
					const author = users.findById(ticket.userId);
					// A ticket whose author is gone cannot be answered, so it has no place on a screen
					// whose purpose is answering. Rows are never deleted, so this stays theoretical.
					return author ? toTicketAdminView(ticket, author) : null;
				})
				.filter((view) => view !== null)
		: [],
	failedJobs: isAdmin(locals) ? jobs.listFailed().map(toFailedJobView) : [],
	// One currency for the whole base (tech.md 5). The form shows it; it never submits it.
	currency: config.PRICE_CURRENCY
});

/**
 * Every action re-checks isAdmin on the server. tech.md 9 is explicit that the guard in `handle` and
 * a hidden button are additions to this check, not replacements for it.
 */
const forbidden = () =>
	fail(403, {
		target: plan(null),
		ok: false,
		message: 'Раздел только для администратора.',
		errors: {},
		values: {}
	} satisfies ActionResult);

export const actions = {
	create: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const parsed = planInput.parse(values);

		if (!parsed.ok) {
			return fail(400, {
				target: plan(null),
				ok: false,
				message: null,
				errors: parsed.error,
				values
			} satisfies ActionResult);
		}

		const created = plans.create(parsed.value);
		log.info('admin_plan_created', { requestId: locals.requestId, planId: created.id });

		return ok(plan(null), `Тариф «${created.name}» создан.`);
	},

	update: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const id = planInput.parseId(values);

		if (!id.ok) {
			return fail(400, {
				target: plan(null),
				ok: false,
				message: id.error,
				errors: {},
				values
			} satisfies ActionResult);
		}

		const parsed = planInput.parse(values);

		if (!parsed.ok) {
			return fail(400, {
				target: plan(id.value),
				ok: false,
				message: null,
				errors: parsed.error,
				values
			} satisfies ActionResult);
		}

		const updated = plans.update(id.value, parsed.value);

		if (!updated.ok) {
			return fail(409, {
				target: plan(id.value),
				ok: false,
				message:
					updated.error === 'archived'
						? 'Тариф уже в архиве, его больше нельзя изменить.'
						: 'Такого тарифа больше нет.',
				errors: {},
				values
			} satisfies ActionResult);
		}

		log.info('admin_plan_updated', { requestId: locals.requestId, planId: id.value });

		return ok(plan(id.value), `Тариф «${updated.value.name}» сохранён.`);
	},

	archive: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const id = planInput.parseId(values);

		if (!id.ok) {
			return fail(400, {
				target: plan(null),
				ok: false,
				message: id.error,
				errors: {},
				values
			} satisfies ActionResult);
		}

		const archived = plans.archive(id.value);

		if (!archived.ok) {
			return fail(409, {
				target: plan(id.value),
				ok: false,
				message: 'Такого тарифа больше нет.',
				errors: {},
				values
			} satisfies ActionResult);
		}

		log.info('admin_plan_archived', { requestId: locals.requestId, planId: id.value });

		return ok(plan(id.value), `Тариф «${archived.value.name}» в архиве.`);
	},

	/**
	 * A11 — promo codes CRUD. The same shape as the plan actions above, and deliberately so: one
	 * screen, one way an answer comes back, one way a refusal is phrased.
	 *
	 * Codes are never logged, only their ids. A working promo code is spendable by whoever reads it,
	 * and `redact()` masks by key name rather than by value (CLAUDE.md 2).
	 */
	createPromo: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const parsed = promoInput.parse(values);

		if (!parsed.ok) {
			return fail(400, {
				target: promo(null),
				ok: false,
				message: null,
				errors: parsed.error,
				values
			} satisfies ActionResult);
		}

		const created = promos.create(parsed.value);

		if (!created.ok) {
			// The code is unique (tech.md 5). Two campaigns reaching for the same obvious name is an
			// ordinary thing for an admin to do, not a 500.
			return fail(400, {
				target: promo(null),
				ok: false,
				message: null,
				errors: { code: 'Код: такой промокод уже есть' },
				values
			} satisfies ActionResult);
		}

		log.info('admin_promo_created', { requestId: locals.requestId, promoCodeId: created.value.id });

		return ok(promo(null), `Промокод создан.`);
	},

	updatePromo: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const id = promoInput.parseId(values);

		if (!id.ok) {
			return fail(400, {
				target: promo(null),
				ok: false,
				message: id.error,
				errors: {},
				values
			} satisfies ActionResult);
		}

		const parsed = promoInput.parse(values);

		if (!parsed.ok) {
			return fail(400, {
				target: promo(id.value),
				ok: false,
				message: null,
				errors: parsed.error,
				values
			} satisfies ActionResult);
		}

		const updated = promos.update(id.value, parsed.value);

		if (!updated.ok) {
			const message = {
				archived: 'Промокод уже в архиве, его больше нельзя изменить.',
				not_found: 'Такого промокода больше нет.',
				code_taken: 'Промокод с таким кодом уже есть.'
			}[updated.error];

			return fail(409, {
				target: promo(id.value),
				ok: false,
				message,
				errors: {},
				values
			} satisfies ActionResult);
		}

		log.info('admin_promo_updated', { requestId: locals.requestId, promoCodeId: id.value });

		return ok(promo(id.value), `Промокод сохранён.`);
	},

	archivePromo: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const id = promoInput.parseId(values);

		if (!id.ok) {
			return fail(400, {
				target: promo(null),
				ok: false,
				message: id.error,
				errors: {},
				values
			} satisfies ActionResult);
		}

		const archived = promos.archive(id.value);

		if (!archived.ok) {
			return fail(409, {
				target: promo(id.value),
				ok: false,
				message: 'Такого промокода больше нет.',
				errors: {},
				values
			} satisfies ActionResult);
		}

		log.info('admin_promo_archived', { requestId: locals.requestId, promoCodeId: id.value });

		return ok(promo(id.value), `Промокод «${archived.value.code}» в архиве.`);
	},

	/**
	 * A16 — queues a manual `marzban.reconcile` (tech.md 6, tech.md 11).
	 *
	 * The action does no reconciling itself, deliberately: talking to the panel inside a form submit
	 * would make the admin wait on a network call that has a retry policy of its own, and a Marzban
	 * timeout would come back as a failed save rather than as a job the queue will finish. So this
	 * resolves the person, enqueues, and answers.
	 *
	 * The Telegram id is the thing an admin can actually see (subscriptions/input.ts explains why),
	 * and the subscription id the contract keys on is derived here.
	 */
	reconcile: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const parsed = reconcileInput.parse(values);

		if (!parsed.ok) {
			return fail(400, {
				target: reconcile(),
				ok: false,
				message: null,
				errors: parsed.error,
				values
			} satisfies ActionResult);
		}

		const person = users.findByTelegramId(parsed.value.telegramId);

		if (!person) {
			return fail(404, {
				target: reconcile(),
				ok: false,
				message: null,
				errors: { telegramId: 'Telegram ID: такого человека нет' },
				values
			} satisfies ActionResult);
		}

		const subscription = subscriptions.findByUser(person.id);

		if (!subscription) {
			return fail(409, {
				target: reconcile(),
				ok: false,
				message: 'У этого человека нет подписки — сверять нечего.',
				errors: {},
				values
			} satisfies ActionResult);
		}

		/**
		 * tech.md 6 buckets this key by the hour, so a second click inside one is silently dropped by
		 * the unique index. The copy below says the work is queued rather than claiming it is new:
		 * the insert cannot report which of the two happened, and promising a fresh run we did not
		 * start would be worse than saying less.
		 */
		const hour = Math.floor(Date.now() / RECONCILE_WINDOW_MS);
		jobs.enqueue(
			'marzban.reconcile',
			{ subscriptionId: subscription.id },
			`reconcile:${subscription.id}:${hour}`
		);

		log.info('admin_reconcile_queued', {
			requestId: locals.requestId,
			subscriptionId: subscription.id
		});

		return ok(reconcile(), 'Сверка поставлена в очередь. Результат появится в логе.');
	}
} satisfies Actions;
