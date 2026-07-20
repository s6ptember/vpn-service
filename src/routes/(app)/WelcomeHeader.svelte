<script lang="ts">
	interface Props {
		/** The Telegram first name, or null for a browser visitor with no session. */
		name: string | null;
	}

	let { name }: Props = $props();
</script>

<p class="text-[13px] font-medium text-muted">Добро пожаловать</p>
<h1 class="text-[28px] font-bold tracking-[-.02em]">{name ?? 'Инкогнито'}</h1>
