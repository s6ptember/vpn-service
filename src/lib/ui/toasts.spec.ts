import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toasts } from './toasts.svelte';

// Derived from tech.md 12 (`Toast.svelte` + `toasts.svelte.ts` — `push(message, tone)`) and from the
// 2000ms dismiss the mock commits to, not from the store internals.
describe('toasts', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		// The store is a module singleton: leaking a toast leaks it into the next test.
		for (const toast of [...toasts.items]) toasts.dismiss(toast.id);
		vi.useRealTimers();
	});

	it('starts empty', () => {
		expect(toasts.items).toEqual([]);
	});

	it('shows the pushed message', () => {
		toasts.push('Ссылка скопирована');
		expect(toasts.items.map((t) => t.message)).toEqual(['Ссылка скопирована']);
	});

	it('defaults to the neutral tone', () => {
		toasts.push('Обращение отправлено');
		expect(toasts.items[0].tone).toBe('neutral');
	});

	it.each(['neutral', 'success', 'danger'] as const)('carries the %s tone through', (tone) => {
		toasts.push('Оплата', tone);
		expect(toasts.items[0].tone).toBe(tone);
	});

	it('stacks concurrent toasts in push order', () => {
		toasts.push('первый');
		toasts.push('второй');
		expect(toasts.items.map((t) => t.message)).toEqual(['первый', 'второй']);
	});

	it('gives every toast a distinct id, even for one repeated message', () => {
		const first = toasts.push('Ссылка скопирована');
		const second = toasts.push('Ссылка скопирована');
		expect(first).not.toBe(second);
		expect(new Set(toasts.items.map((t) => t.id)).size).toBe(2);
	});

	it('holds the toast for 2000ms and then drops it', () => {
		toasts.push('Оплата');
		vi.advanceTimersByTime(1999);
		expect(toasts.items).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(toasts.items).toEqual([]);
	});

	it('expires each toast on its own clock, not the last one pushed', () => {
		toasts.push('первый');
		vi.advanceTimersByTime(1000);
		toasts.push('второй');

		vi.advanceTimersByTime(1000);
		expect(toasts.items.map((t) => t.message)).toEqual(['второй']);

		vi.advanceTimersByTime(1000);
		expect(toasts.items).toEqual([]);
	});

	it('dismisses on demand before the timer fires', () => {
		const id = toasts.push('Оплата');
		toasts.dismiss(id);
		expect(toasts.items).toEqual([]);
	});

	it('leaves the other toasts alone when one is dismissed', () => {
		const id = toasts.push('первый');
		toasts.push('второй');
		toasts.dismiss(id);
		expect(toasts.items.map((t) => t.message)).toEqual(['второй']);
	});

	// The timer fires after a manual dismiss and the id may already be reused by a later push:
	// dismiss has to be a no-op the second time or it eats a live toast.
	it('is idempotent: dismissing twice, or after expiry, changes nothing', () => {
		const id = toasts.push('первый');
		toasts.dismiss(id);
		toasts.dismiss(id);
		expect(toasts.items).toEqual([]);

		toasts.push('второй');
		vi.advanceTimersByTime(2000);
		expect(toasts.items).toEqual([]);
		vi.advanceTimersByTime(2000);
		expect(toasts.items).toEqual([]);
	});
});
