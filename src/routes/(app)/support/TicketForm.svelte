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
	 */
	let refusal = $derived(result && !result.ok && text === result.text ? result.message : null);

	/**
	 * Latched from an actual submission, never derived from the field being empty. Emptiness is not
	 * proof of anything: somebody who selects their draft and deletes it to start over would be told
	 * their problem had already reached the admin.
	 *
	 * Seeded from the server answer so a no-JS reload still shows the confirmation. It goes down on
	 * the first keystroke of the next request and on the submit that follows — a card about the last
	 * message has nothing to say about the one being written.
	 */
	let sent = $state(untrack(() => result?.ok === true));
</script>

<form
	method="POST"
	action="?/createTicket"
	use:enhance={() => {
		sending = true;
		// The old confirmation goes down with the new attempt: it is about the previous message.
		sent = false;

		return async ({ result: outcome, update }) => {
			// reset: false keeps what was typed — a refusal below is about exactly that string, and
			// clearing the field on success is this component's job, not the form's.
			await update({ reset: false });

			if (outcome.type === 'success') {
				text = '';
				sent = true;
			}

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
		oninput={() => (sent = false)}
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
					<p class="text-h3 font-semibold">Отправили</p>
					<p class="mt-1.5 text-sm text-muted">Админ ответит вам в личку в Telegram.</p>
				</div>
			</div>
		</Card>
	</div>
{/if}
