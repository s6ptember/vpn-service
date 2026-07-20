<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';

	interface Props {
		/** Field name -> message from the last rejected submit. */
		errors?: Record<string, string>;
		/** What was typed, so a no-JS reload comes back filled instead of blank. */
		values?: Record<string, string>;
	}

	let { errors = {}, values = {} }: Props = $props();

	// Read once, on purpose: after mount this input belongs to the person typing in it.
	let telegramId = $state(untrack(() => values.telegramId ?? ''));
	let queueing = $state(false);

	/**
	 * A message stands only while the input still holds exactly what the server rejected. Editing the
	 * field retires it — the same rule PlanForm follows, and it needs no extra state to notice.
	 */
	let error = $derived(
		errors.telegramId && telegramId === (values.telegramId ?? '') ? errors.telegramId : undefined
	);
</script>

<form
	method="POST"
	action="?/reconcile"
	class="space-y-3"
	use:enhance={() => {
		queueing = true;

		return async ({ result, update }) => {
			// Queued means the field has done its job; a stale id sitting in it invites a second click
			// that the hour-long key would drop anyway. A refusal keeps what was typed.
			if (result.type === 'success') telegramId = '';

			await update({ reset: false });
			queueing = false;
		};
	}}
>
	<Input
		bind:value={telegramId}
		name="telegramId"
		label="Telegram ID"
		inputmode="numeric"
		required
		{error}
		placeholder="700000111"
	/>

	<Button type="submit" size="sm" class="w-full" loading={queueing}>Сверить с Marzban</Button>
</form>
