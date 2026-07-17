<script lang="ts">
	interface Props {
		lines?: number;
		height?: string;
	}

	let { lines = 1, height = '1rem' }: Props = $props();

	let rows = $derived(Array.from({ length: Math.max(1, Math.trunc(lines)) }, (_, index) => index));
</script>

<!-- Filler carries no meaning: the live region belongs to whoever is loading. -->
<div class="space-y-2" aria-hidden="true">
	{#each rows as row (row)}
		<div
			class="rounded-[6px] bg-ink/[.07] motion-safe:animate-pulse {rows.length > 1 &&
			row === rows.length - 1
				? 'w-2/3'
				: 'w-full'}"
			style:height
		></div>
	{/each}
</div>
