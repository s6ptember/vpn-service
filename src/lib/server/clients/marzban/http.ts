import * as v from 'valibot';
import { MarzbanError } from '$lib/server/errors';
import type { MarzbanApi, MarzbanUser, MarzbanUserInput } from './types';
import { MARZBAN_USER_STATUSES } from './types';

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 250;

/**
 * Marzban never tells us when the admin token dies, so we guess low and lean on the 401 refresh
 * below. A token that expires early costs one extra POST; one that lingers costs a failed job.
 */
const TOKEN_TTL_MS = 50 * 60_000;

export interface MarzbanHttpOptions {
	baseUrl: string;
	username: string;
	password: string;
	/** Must match a tag in the panel's xray_config.json, else Marzban answers 422 (tech.md 8). */
	inboundTags: string[];
	vlessFlow: string;
	/** XRAY_SUBSCRIPTION_URL_PREFIX. Only used to absolutise a relative subscription_url. */
	subUrlPrefix: string;
	/** Injectable transport: tests drive the client without touching the network. */
	fetch?: typeof globalThis.fetch;
	now?: () => number;
}

const TokenSchema = v.object({ access_token: v.pipe(v.string(), v.minLength(1)) });

/** The panel's user payload. Unknown keys are ignored: Marzban adds fields between versions. */
const RawUserSchema = v.object({
	username: v.string(),
	status: v.picklist(MARZBAN_USER_STATUSES),
	// 0 or null means "never expires" in Marzban.
	expire: v.nullish(v.number()),
	used_traffic: v.nullish(v.number()),
	subscription_url: v.string(),
	links: v.nullish(v.array(v.string()))
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class MarzbanHttp implements MarzbanApi {
	readonly #baseUrl: string;
	readonly #username: string;
	readonly #password: string;
	readonly #inboundTags: string[];
	readonly #vlessFlow: string;
	readonly #subUrlPrefix: string;
	readonly #fetch: typeof globalThis.fetch;
	readonly #now: () => number;

	/**
	 * Instance field, never a module variable: a module-level cache would be shared by every
	 * request in the process (CLAUDE.md 1.2), and a test could not get a clean client.
	 */
	#cachedToken: { value: string; expiresAtMs: number } | null = null;

	constructor(options: MarzbanHttpOptions) {
		this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
		this.#username = options.username;
		this.#password = options.password;
		this.#inboundTags = options.inboundTags;
		this.#vlessFlow = options.vlessFlow;
		this.#subUrlPrefix = options.subUrlPrefix.replace(/\/+$/, '');
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#now = options.now ?? Date.now;
	}

	async createUser(input: MarzbanUserInput): Promise<MarzbanUser> {
		const body: Record<string, unknown> = {
			username: input.username,
			proxies: { vless: { flow: this.#vlessFlow } },
			inbounds: { vless: this.#inboundTags },
			expire: this.#toSeconds(input.expiresAtMs),
			data_limit: input.dataLimitBytes,
			data_limit_reset_strategy: 'no_reset',
			status: 'active'
		};
		if (input.note !== undefined) body.note = input.note;

		const response = await this.#authorized('/api/user', { method: 'POST', json: body });
		return this.#toUser(await this.#parse(response, 'createUser'));
	}

	async getUser(username: string): Promise<MarzbanUser | null> {
		const response = await this.#authorized(`/api/user/${encodeURIComponent(username)}`, {
			method: 'GET'
		});
		// Absence is an answer, not a failure: the provision job asks before it decides to create.
		if (response.status === 404) return null;
		return this.#toUser(await this.#parse(response, 'getUser'));
	}

	async setExpiry(username: string, expiresAtMs: number): Promise<MarzbanUser> {
		const response = await this.#authorized(`/api/user/${encodeURIComponent(username)}`, {
			method: 'PUT',
			json: { expire: this.#toSeconds(expiresAtMs) }
		});
		return this.#toUser(await this.#parse(response, 'setExpiry'));
	}

	async setStatus(username: string, status: 'active' | 'disabled'): Promise<void> {
		const response = await this.#authorized(`/api/user/${encodeURIComponent(username)}`, {
			method: 'PUT',
			json: { status }
		});
		this.#assertOk(response, 'setStatus');
	}

	async deleteUser(username: string): Promise<void> {
		const response = await this.#authorized(`/api/user/${encodeURIComponent(username)}`, {
			method: 'DELETE'
		});
		// Already gone is the state we wanted. A job that retries a delete must converge, not wedge.
		if (response.status === 404) return;
		this.#assertOk(response, 'deleteUser');
	}

	/**
	 * ms -> s. Marzban's `expire` is unix seconds while the whole app speaks milliseconds
	 * (tech.md 5). This function and its inverse are the only conversion in the codebase
	 * (CLAUDE.md 4), which is why nothing outside this file may divide by 1000.
	 */
	#toSeconds(ms: number): number {
		return Math.floor(ms / 1000);
	}

	/** s -> ms. 0 or null from the panel means "never expires" and stays 0 in our type. */
	#fromSeconds(seconds: number | null | undefined): number {
		return seconds ? seconds * 1000 : 0;
	}

	/**
	 * The single place a subscription URL is concatenated (tech.md 8). Marzban returns a relative
	 * path when XRAY_SUBSCRIPTION_URL_PREFIX is unset; past this line the URL is always absolute,
	 * so no caller ever has to wonder.
	 */
	#absoluteSubUrl(url: string): string {
		return url.startsWith('/') ? `${this.#subUrlPrefix}${url}` : url;
	}

	#toUser(raw: v.InferOutput<typeof RawUserSchema>): MarzbanUser {
		return {
			username: raw.username,
			status: raw.status,
			expiresAtMs: this.#fromSeconds(raw.expire),
			usedTrafficBytes: raw.used_traffic ?? 0,
			subscriptionUrl: this.#absoluteSubUrl(raw.subscription_url),
			links: raw.links ?? []
		};
	}

	async #accessToken(force: boolean): Promise<string> {
		const cached = this.#cachedToken;
		if (!force && cached && cached.expiresAtMs > this.#now()) return cached.value;

		const response = await this.#send(`${this.#baseUrl}/api/admin/token`, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'application/json'
			},
			// Form-urlencoded, not JSON: the panel's token endpoint is an OAuth2 password form.
			body: new URLSearchParams({
				username: this.#username,
				password: this.#password
			}).toString()
		});

		this.#assertOk(response, 'token');
		const parsed = v.safeParse(TokenSchema, await this.#readJson(response, 'token'));
		if (!parsed.success) {
			throw new MarzbanError('token response has an unexpected shape', {
				status: response.status
			});
		}

		this.#cachedToken = {
			value: parsed.output.access_token,
			expiresAtMs: this.#now() + TOKEN_TTL_MS
		};
		return parsed.output.access_token;
	}

	async #authorized(path: string, init: { method: string; json?: unknown }): Promise<Response> {
		const url = `${this.#baseUrl}${path}`;
		let response = await this.#send(url, this.#withAuth(init, await this.#accessToken(false)));

		if (response.status === 401) {
			// The cached token died before our TTL guess: panel restart, or the admin was rotated.
			// One forced refresh, one replay. A second 401 is a real credential problem.
			response = await this.#send(url, this.#withAuth(init, await this.#accessToken(true)));
		}

		return response;
	}

	#withAuth(init: { method: string; json?: unknown }, token: string): RequestInit {
		const headers: Record<string, string> = {
			accept: 'application/json',
			authorization: `Bearer ${token}`
		};
		if (init.json !== undefined) headers['content-type'] = 'application/json';

		return {
			method: init.method,
			headers,
			body: init.json === undefined ? undefined : JSON.stringify(init.json)
		};
	}

	/**
	 * One HTTP call with the tech.md 8 retry policy: 10s timeout, three retries on 5xx and on
	 * network failure with exponential backoff, and never a retry on 4xx — a 422 for an unknown
	 * inbound tag is a config bug that will fail identically every time.
	 */
	async #send(url: string, init: RequestInit): Promise<Response> {
		let last: MarzbanError | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			if (attempt > 0) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));

			let response: Response;
			try {
				response = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
			} catch (cause) {
				const timedOut =
					cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
				last = new MarzbanError(
					timedOut ? `marzban request timed out after ${TIMEOUT_MS}ms` : 'marzban is unreachable',
					{ cause }
				);
				continue;
			}

			if (response.status >= 500) {
				last = new MarzbanError(`marzban answered ${response.status}`, { status: response.status });
				continue;
			}

			return response;
		}

		throw last ?? new MarzbanError('marzban is unreachable', {});
	}

	#assertOk(response: Response, operation: string): void {
		if (response.ok) return;
		throw new MarzbanError(`${operation} failed with ${response.status}`, {
			status: response.status
		});
	}

	async #readJson(response: Response, operation: string): Promise<unknown> {
		try {
			return await response.json();
		} catch (cause) {
			throw new MarzbanError(`${operation} returned a body that is not json`, {
				status: response.status,
				cause
			});
		}
	}

	async #parse(
		response: Response,
		operation: string
	): Promise<v.InferOutput<typeof RawUserSchema>> {
		this.#assertOk(response, operation);
		const parsed = v.safeParse(RawUserSchema, await this.#readJson(response, operation));
		if (!parsed.success) {
			throw new MarzbanError(`${operation} returned a user with an unexpected shape`, {
				status: response.status
			});
		}
		return parsed.output;
	}
}
