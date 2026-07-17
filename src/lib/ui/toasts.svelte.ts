export type ToastTone = 'neutral' | 'success' | 'danger';

export interface Toast {
	id: number;
	message: string;
	tone: ToastTone;
}

/** The mock's timing: long enough to read one line, short enough not to sit on the island. */
const DISMISS_AFTER_MS = 2000;

class ToastStore {
	items = $state<Toast[]>([]);

	#nextId = 0;
	#timers = new Map<number, ReturnType<typeof setTimeout>>();

	push(message: string, tone: ToastTone = 'neutral'): number {
		const id = this.#nextId++;
		this.items = [...this.items, { id, message, tone }];
		this.#timers.set(
			id,
			setTimeout(() => this.dismiss(id), DISMISS_AFTER_MS)
		);
		return id;
	}

	dismiss(id: number): void {
		const timer = this.#timers.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.#timers.delete(id);
		}
		this.items = this.items.filter((toast) => toast.id !== id);
	}
}

/**
 * A module singleton, which CLAUDE.md 1.2 otherwise forbids on the server. It is safe here and only
 * here: this is client UI state. Nothing under `$lib/server` imports it, and the only writer is
 * `push()` from a browser event handler — SSR evaluates the module but never touches the array, so
 * no request can ever observe another request's toasts.
 */
export const toasts = new ToastStore();
