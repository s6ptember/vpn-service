<script lang="ts">
	import { Globe, Headset, ShieldOff, Zap } from 'lucide-svelte';

	/**
	 * Product copy, not domain data — the same status as the feature list on PlanCard (plan-value.ts).
	 * Static because none of it is a promise the server can verify per plan; it describes the service.
	 */
	const FEATURES = [
		{ icon: ShieldOff, label: 'Без логов' },
		{ icon: Zap, label: 'XRAY VLESS' },
		{ icon: Headset, label: 'Поддержка 24/7' },
		{ icon: Globe, label: 'Все локации' }
	];
</script>

<!-- Outlined pills on the page itself, not filled chips on a card: the reference puts exactly this
     row under the greeting, and an outline keeps it quiet enough to stay a caption for the screen
     rather than competing with the card below it. -->
<ul class="mt-5 no-scrollbar flex list-none gap-2 overflow-x-auto" aria-label="Особенности сервиса">
	{#each FEATURES as feature (feature.label)}
		{@const Icon = feature.icon}
		<li
			class="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-xs font-medium text-muted"
		>
			<Icon class="size-3.5 text-accent-600" aria-hidden="true" />
			{feature.label}
		</li>
	{/each}
</ul>
