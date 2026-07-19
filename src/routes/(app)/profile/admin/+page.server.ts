import { fail } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { planInput, plans } from '$lib/server/container';
import { log } from '$lib/server/log';
import type { Actions, PageServerLoad } from './$types';

/**
 * A4 — plans CRUD. Mutations go through form actions rather than hand-rolled endpoints, so CSRF by
 * Origin, no-JS submits and one validation path come for free (CLAUDE.md 1.5).
 */

/** Which form the answer belongs to: a plan id, or null for the create form. */
type Target = number | null;

interface ActionResult {
	target: Target;
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
	message,
	errors: {},
	values: {}
});

/**
 * The guard in hooks.server.ts already 403s a signed-in non-admin, and the shell still renders for a
 * request that has no cookie yet (tech.md 9). That render must not hand the plan list to nobody, so
 * the load answers empty until the session lands and invalidateAll() runs the load again.
 */
export const load: PageServerLoad = async ({ locals }) => ({
	plans: isAdmin(locals) ? plans.listEditable() : [],
	// One currency for the whole base (tech.md 5). The form shows it; it never submits it.
	currency: config.PRICE_CURRENCY
});

/**
 * Every action re-checks isAdmin on the server. tech.md 9 is explicit that the guard in `handle` and
 * a hidden button are additions to this check, not replacements for it.
 */
const forbidden = () =>
	fail(403, {
		target: null,
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
				target: null,
				message: null,
				errors: parsed.error,
				values
			} satisfies ActionResult);
		}

		const plan = plans.create(parsed.value);
		log.info('admin_plan_created', { requestId: locals.requestId, planId: plan.id });

		return ok(null, `Тариф «${plan.name}» создан.`);
	},

	update: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const id = planInput.parseId(values);

		if (!id.ok) {
			return fail(400, {
				target: null,
				message: id.error,
				errors: {},
				values
			} satisfies ActionResult);
		}

		const parsed = planInput.parse(values);

		if (!parsed.ok) {
			return fail(400, {
				target: id.value,
				message: null,
				errors: parsed.error,
				values
			} satisfies ActionResult);
		}

		const updated = plans.update(id.value, parsed.value);

		if (!updated.ok) {
			return fail(409, {
				target: id.value,
				message:
					updated.error === 'archived'
						? 'Тариф уже в архиве, его больше нельзя изменить.'
						: 'Такого тарифа больше нет.',
				errors: {},
				values
			} satisfies ActionResult);
		}

		log.info('admin_plan_updated', { requestId: locals.requestId, planId: id.value });

		return ok(id.value, `Тариф «${updated.value.name}» сохранён.`);
	},

	archive: async ({ request, locals }) => {
		if (!isAdmin(locals)) return forbidden();

		const values = formValues(await request.formData());
		const id = planInput.parseId(values);

		if (!id.ok) {
			return fail(400, {
				target: null,
				message: id.error,
				errors: {},
				values
			} satisfies ActionResult);
		}

		const archived = plans.archive(id.value);

		if (!archived.ok) {
			return fail(409, {
				target: id.value,
				message: 'Такого тарифа больше нет.',
				errors: {},
				values
			} satisfies ActionResult);
		}

		log.info('admin_plan_archived', { requestId: locals.requestId, planId: id.value });

		return ok(id.value, `Тариф «${archived.value.name}» в архиве.`);
	}
} satisfies Actions;
