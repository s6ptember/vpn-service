<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';

	interface Props {
		/** The Telegram first name, or null for a browser visitor with no session. */
		name: string | null;
		photoUrl?: string | null;
	}

	let { name, photoUrl = null }: Props = $props();
</script>

<!-- The reference opens every screen with the portrait and the greeting on one line, the name in the
     accent. It is the only place the accent is used as text at this size, which is what makes it
     read as a greeting rather than as a heading. -->
<div class="flex items-center gap-3">
	<Avatar {photoUrl} firstName={name} />
	<div class="min-w-0">
		<p class="text-xs font-medium text-muted">Добро пожаловать</p>
		<h1 class="truncate text-h1 font-bold tracking-[-.02em] text-accent-600">
			{name ?? 'Инкогнито'}
		</h1>
	</div>
</div>
