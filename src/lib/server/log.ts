/**
 * Structured logging. One JSON object per line, so `docker logs` pipes straight into jq.
 *
 * Every field crosses redact() before it is printed. tech.md 2 is absolute here: a line may carry
 * requestId, an event name and entity ids, and must never carry initData, a token, a Stripe key or
 * a whole webhook body. redact() makes that true by default instead of by everyone remembering it
 * at every call site.
 */

const MASK = '[redacted]';
const CIRCULAR = '[circular]';
const TRUNCATED = '[truncated]';
const UNREADABLE = '[unreadable]';
const MAX_DEPTH = 6;

/** Owned by the log envelope. A caller field of the same name must not be able to rename its line. */
const RESERVED_FIELDS = new Set(['level', 'time', 'event']);

/**
 * Whole key names that are sensitive on their own. `key` and `hash` sit here rather than in the
 * substring list below, because as substrings they would eat `idempotencyKey` and `dedupeKey` —
 * ids the queue is supposed to log.
 */
const SENSITIVE_KEYS = new Set([
	'key',
	'hash',
	'payload',
	'body',
	'rawbody',
	'cookie',
	'setcookie',
	'authorization',
	'credentials',
	'privatekey',
	'salt',
	'nonce'
]);

/** Substrings that make a key sensitive however it is spelled or cased. */
const SENSITIVE_PARTS = [
	'token',
	'secret',
	'password',
	'passwd',
	'signature',
	'initdata',
	'apikey',
	'authorization',
	'cookie'
];

/**
 * Secrets recognised by their own shape, wherever they appear: pasted into a message, echoed by an
 * upstream error, concatenated into a URL. Each pattern is specific enough that ordinary prose
 * cannot match it, so benign fields survive untouched.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
	/\d{6,}:[A-Za-z0-9_-]{30,}/g, // telegram bot token
	/\b[sprk]k_(?:live|test)_[A-Za-z0-9]+/g, // stripe api key
	/\bwhsec_[A-Za-z0-9+/=]{16,}/g, // stripe webhook secret
	/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, // authorization header
	/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // jwt, e.g. the marzban token
	/\bhash=[A-Za-z0-9]+/g // initData signature
];

/**
 * Whole-value shapes: the entire string is nothing but a credential. Deliberately narrow. A
 * "long opaque blob" rule was tried here and removed: it cannot tell a secret from an id, and it
 * ate the UUID requestId that tech.md 2 requires on every line. Secrets under a sensitive key are
 * already gone by name; this catches only what is unmistakable by shape.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
	/^[0-9a-f]{40,}$/i // hmac digest, session secret, sha
];

/** Raw Telegram initData: a query string carrying auth_date and the signing hash. */
const INIT_DATA_SHAPE = /(?:^|&)auth_date=\d+/;

function normalizeKey(key: string): string {
	return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
	const normalized = normalizeKey(key);
	if (SENSITIVE_KEYS.has(normalized)) return true;
	return SENSITIVE_PARTS.some((part) => normalized.includes(part));
}

/**
 * Masks a string value. Whole-value credentials disappear entirely; a secret embedded in upstream
 * prose ("POST /bot123:AA.../sendMessage failed") loses just the secret and keeps the sentence,
 * because that sentence is why anyone opens the log.
 */
function maskString(value: string): string {
	if (value.length >= 16 && INIT_DATA_SHAPE.test(value) && value.includes('hash=')) return MASK;
	if (value.length >= 24 && CREDENTIAL_SHAPES.some((shape) => shape.test(value))) return MASK;
	return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, MASK), value);
}

function errorToJson(err: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
	const out: Record<string, unknown> = { name: err.name, message: maskString(err.message) };
	// AppError.code is the field a reader greps for first.
	if ('code' in err && typeof err.code === 'string') out.code = err.code;
	// The stack belongs in the log and nowhere else (CLAUDE.md 2).
	if (typeof err.stack === 'string') out.stack = maskString(err.stack);
	if (err.cause !== undefined) out.cause = walk(err.cause, seen, depth + 1);
	return out;
}

function walk(value: unknown, seen: WeakSet<object>, depth: number): unknown {
	if (value === null || value === undefined) return value;

	switch (typeof value) {
		case 'string':
			return maskString(value);
		case 'number':
		case 'boolean':
			return value;
		case 'bigint':
			return `${value}`;
		case 'function':
			return '[function]';
		case 'symbol':
			return value.toString();
	}

	const obj = value as object;
	// Path-scoped, not global: a node is circular only when it contains itself. The same object
	// referenced twice side by side still prints twice, which is what a reader expects.
	if (seen.has(obj)) return CIRCULAR;
	if (depth >= MAX_DEPTH) return TRUNCATED;
	if (obj instanceof Date) return obj.toISOString();

	seen.add(obj);
	try {
		if (obj instanceof Error) return errorToJson(obj, seen, depth);
		if (Array.isArray(obj)) return obj.map((item) => walk(item, seen, depth + 1));
		if (obj instanceof Set) return [...obj].map((item) => walk(item, seen, depth + 1));
		if (obj instanceof URL) return maskString(obj.href);
		if (obj instanceof Map) {
			const out: Record<string, unknown> = {};
			for (const [k, v] of obj) {
				const name = String(k);
				out[name] = isSensitiveKey(name) ? MASK : walk(v, seen, depth + 1);
			}
			return out;
		}

		// Object.keys does not run user code; reading a property does. Enumerate first, then read
		// each value defensively, so one hostile member costs that member and not its siblings.
		let keys: string[];
		try {
			keys = Object.keys(obj);
		} catch {
			return UNREADABLE;
		}

		const out: Record<string, unknown> = {};
		for (const k of keys) {
			if (isSensitiveKey(k)) {
				out[k] = MASK;
				continue;
			}
			// A getter or a Proxy trap is arbitrary code and may throw. redact() runs inside catch
			// blocks, so a throw here would destroy the very error someone is trying to record.
			let value: unknown;
			try {
				value = (obj as Record<string, unknown>)[k];
			} catch {
				out[k] = UNREADABLE;
				continue;
			}
			out[k] = walk(value, seen, depth + 1);
		}
		return out;
	} finally {
		seen.delete(obj);
	}
}

/**
 * Deep-clones `value` with every secret masked, by key name first (token, secret, initData,
 * cookie…) and by value shape second, so a Stripe key hiding under a friendly name still never
 * reaches stdout. Safe against cycles and against hostile depth.
 */
export function redact(value: unknown): unknown {
	return walk(value, new WeakSet(), 0);
}

/**
 * Redacts and renders on one line. For the places that need text rather than structure: the
 * `jobs.lastError` column and any other TEXT field an error has to fit into.
 */
export function redactText(value: unknown): string {
	// The whole body is guarded: jobs.lastError is written from a catch block, so a throw here would
	// lose the job failure it exists to describe.
	try {
		if (typeof value === 'string') return maskString(value);
		if (value instanceof Error) return maskString(`${value.name}: ${value.message}`);

		const safe = redact(value);
		if (typeof safe === 'string') return safe;
		return JSON.stringify(safe) ?? String(safe);
	} catch {
		return UNREADABLE;
	}
}

export type LogFields = Record<string, unknown>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
	debug(event: string, fields?: LogFields): void;
	info(event: string, fields?: LogFields): void;
	warn(event: string, fields?: LogFields): void;
	error(event: string, fields?: LogFields): void;
	/** Returns a logger that stamps `bindings` onto every line it writes: requestId, jobId, orderId. */
	child(bindings: LogFields): Logger;
}

class JsonLogger implements Logger {
	readonly #bindings: LogFields;

	constructor(bindings: LogFields) {
		this.#bindings = bindings;
	}

	debug(event: string, fields?: LogFields): void {
		this.#write('debug', event, fields);
	}

	info(event: string, fields?: LogFields): void {
		this.#write('info', event, fields);
	}

	warn(event: string, fields?: LogFields): void {
		this.#write('warn', event, fields);
	}

	error(event: string, fields?: LogFields): void {
		this.#write('error', event, fields);
	}

	child(bindings: LogFields): Logger {
		// Copy, never mutate: two concurrent requests share this object graph and must not see
		// each other's bindings.
		return new JsonLogger({ ...this.#bindings, ...bindings });
	}

	#write(level: LogLevel, event: string, fields?: LogFields): void {
		let text: string;
		try {
			const merged = redact({ ...this.#bindings, ...fields }) as LogFields;

			// Envelope first so it reads well and wins outright: a field named `event` must not rename
			// the line it appears on. A collision is a call-site bug, so the value is kept under a
			// prefixed key rather than silently dropped.
			const line: Record<string, unknown> = { level, time: new Date().toISOString(), event };
			for (const [k, v] of Object.entries(merged)) {
				line[RESERVED_FIELDS.has(k) ? `field_${k}` : k] = v;
			}

			text = JSON.stringify(line);
		} catch (cause) {
			// Redaction and serialisation both run arbitrary code (getters, toJSON). Logging is called
			// from catch blocks, so it degrades to a stub line and never throws over the top of the
			// failure it was asked to report.
			text = JSON.stringify({
				level,
				time: new Date().toISOString(),
				event,
				logError: cause instanceof Error ? cause.message : 'unserializable log fields'
			});
		}

		// One stream keeps lines ordered under `docker logs`; `level` carries the severity that
		// stderr would otherwise encode, and the collector reads the field, not the pipe.
		console.log(text);
	}
}

/**
 * Root logger. This module-level singleton is safe precisely because it holds no request data: it
 * is a formatter over an immutable bindings object, with no mutable state to leak. That is the line
 * CLAUDE.md 1.2 draws — a module variable on the server lives for the whole process and is shared
 * by every request, so anything request-scoped (the user, the requestId) rides event.locals and
 * reaches a log line only through `log.child({ requestId })` inside the request that owns it.
 */
export const log: Logger = new JsonLogger({});
