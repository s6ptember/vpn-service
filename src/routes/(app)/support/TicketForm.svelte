<script lang="ts">
	import { untrack } from 'svelte';
	import { CircleCheck } from 'lucide-svelte';
	import { enhance } from '$app/forms';
	import { haptic } from '$lib/client/telegram-haptics';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import Textarea from '$lib/ui/Textarea.svelte';
	import { TICKET_MESSAGE_MAX } from '$lib/types';

	interface Props {
		/** The answer to the last submission, if the page has one. */
		result?: { ok: boolean; message: string | null; text: string } | null;
	}

	let { result = null }: Props = $props();

	// Seeded from the echo so a no-JS reload comes back filled; after mount the field belongs to the
	// person typing in it, which is why this is read once and never re-synced from the prop.
	let text = $state(untrack(() => result?.text ?? ''));
	let sending = $state(false);

	/**
	 * A refusal stands only while the field still holds the text the server answered about. Editing
	 * it retires the answer — one that survives the correction tells somebody their fix did not take.
	 * The confirmation is the other way round: it is about a message that has already left, so it
	 * stays until something new is typed.
	 */
	let refusal = $derived(result && !result.ok && text === result.text ? result.message : null);
	let sent = $derived(result?.ok === true && text === '');
</script>

<form
	method="POST"
	action="?/createTicket"
	use:enhance={() => {
		sending = true;

		return async ({ result: outcome, update }) => {
			// reset: false keeps what was typed — a refusal below is about exactly that string, and
			// clearing the field on success is this component's job, not the form's.
			await update({ reset: false });
			if (outcome.type === 'success') text = '';
			sending = false;
			haptic();
		};
	}}
>
	<Textarea
		bind:value={text}
		name="message"
		label="Ваше обращение"
		placeholder="Опишите, что случилось: какое устройство, какое приложение, что вы уже пробовали."
		maxlength={TICKET_MESSAGE_MAX}
		counter
		rows={5}
		error={refusal ?? undefined}
	/>

	<!--
		Never disabled while the message is short. A dead button explains nothing, and the schema is
		the only thing that decides what counts as a message anyway — so the refusal comes back from
		the server and lands under the field, where it can say what to do about it.
	-->
	<Button type="submit" class="mt-3 w-full" loading={sending}>Отправить обращение</Button>
</form>

{#if sent}
	<div class="mt-3">
		<Card>
			<div class="flex items-start gap-3" role="status" aria-live="polite">
				<CircleCheck class="mt-0.5 size-5 shrink-0 text-accent-600" aria-hidden="true" />
				<div class="min-w-0">
					<p class="text-[15px] font-semibold">Отправили</p>
					<p class="mt-1 text-[14px] text-muted">Админ ответит вам в личку в Telegram.</p>
				</div>
			</div>
		</Card>
	</div>
{/if}
