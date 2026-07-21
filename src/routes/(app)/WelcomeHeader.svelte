<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';

	interface Props {
		/** The Telegram first name, or null for a browser visitor with no session. */
		name: string | null;
		photoUrl?: string | null;
	}

	let { name, photoUrl = null }: Props = $props();
</script>

<!--
	The reference opens this screen with the portrait, a quiet greeting and the name in white — not in
	the accent. The accent is spent once per screen, on the button that does something; spending it on
	a salutation would leave the card below competing with a greeting.

	The reference also hangs a bell off this corner. There is no notifications feature behind it, and
	a control that does nothing is worse than an absent one, so the row ends at the name.
-->
<div class="flex items-center gap-3">
	<Avatar {photoUrl} firstName={name} />
	<div class="min-w-0 flex-1">
		<p class="text-2xs leading-tight text-muted">Добро пожаловать,</p>
		<h1 class="truncate text-h3 leading-tight font-bold tracking-[-.02em]">
			{name ?? 'Инкогнито'}
		</h1>
	</div>
</div>
