/**
 * Escape, focus trap and body scroll lock for Sheet and Modal.
 *
 * These are the three things a dialog must do outside Svelte's reach, and both dialogs need all
 * three identically — so they live here once rather than twice. Every function returns its own
 * cleanup and keeps no module state, which makes it safe to call from an `$effect`.
 */

const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

/** Closes on Escape. Bound to the document so a click on the backdrop cannot strand the shortcut. */
export function onEscape(handler: () => void): () => void {
	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') handler();
	};

	document.addEventListener('keydown', onKeydown);
	return () => document.removeEventListener('keydown', onKeydown);
}

/** Keeps Tab inside `container` and returns focus where it came from on cleanup. */
export function trapFocus(container: HTMLElement): () => void {
	const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const focusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

	// Container carries tabindex="-1", so an empty dialog still takes focus away from the page behind.
	(focusable()[0] ?? container).focus();

	const onKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Tab') return;

		const items = focusable();
		if (items.length === 0) {
			event.preventDefault();
			container.focus();
			return;
		}

		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;

		if (event.shiftKey && (active === first || active === container)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	};

	container.addEventListener('keydown', onKeydown);
	return () => {
		container.removeEventListener('keydown', onKeydown);
		restoreTo?.focus();
	};
}

/** Freezes the page behind the dialog. Restores the previous inline value, not a hardcoded one. */
export function lockBodyScroll(): () => void {
	const previous = document.body.style.overflow;

	document.body.style.overflow = 'hidden';
	return () => {
		document.body.style.overflow = previous;
	};
}
