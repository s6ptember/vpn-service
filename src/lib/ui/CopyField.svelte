<script lang="ts">
	import { Check, Copy } from 'lucide-svelte';
	import { toasts } from './toasts.svelte';

	interface Props {
		value: string;
		/** Names the copied thing. Rendered above the row and folded into the button's accessible name. */
		label?: string;
	}

	let { value, label }: Props = $props();

	let copied = $state(false);
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	// The 2s reset lives on a timer, i.e. outside Svelte; the effect exists only to kill it on unmount.
	$effect(() => () => clearTimeout(resetTimer));

	// Old Telegram WebViews expose no async clipboard, and it also throws outside a secure context.
	// execCommand is deprecated but is the only path left there. It reports failure by returning
	// false rather than throwing, so the result has to be read.
	function copyViaExecCommand(): boolean {
		const helper = document.createElement('textarea');
		helper.value = value;
		helper.style.cssText = 'position:fixed;opacity:0';
		document.body.append(helper);
		helper.select();

		try {
			return document.execCommand('copy');
		} catch {
			return false;
		} finally {
			helper.remove();
		}
	}

	async function copy() {
		let ok = true;
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			ok = copyViaExecCommand();
		}

		// The fallback runs on exactly the WebViews most likely to refuse the write, so a silent
		// failure would leave an empty clipboard behind a "copied" toast.
		if (!ok) {
			toasts.push('Не удалось скопировать', 'danger');
			return;
		}

		copied = true;
		toasts.push('Ссылка скопирована', 'success');

		clearTimeout(resetTimer);
		resetTimer = setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="w-full">
	{#if label}
		<p class="mb-1.5 px-1 text-[13px] text-muted">{label}</p>
	{/if}

	<button
		type="button"
		onclick={copy}
		aria-label={label ? `Скопировать: ${label}` : 'Скопировать'}
		class="flex w-full items-center gap-2 rounded-control bg-ink/[.05] px-3.5 py-3 text-left press"
	>
		<span class="truncate font-mono text-[12px] text-muted">{value}</span>
		{#if copied}
			<Check class="ml-auto size-4 shrink-0 text-muted" strokeWidth={2.4} aria-hidden="true" />
		{:else}
			<Copy class="ml-auto size-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />
		{/if}
	</button>
</div>
