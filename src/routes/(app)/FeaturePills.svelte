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

<ul class="mt-4 no-scrollbar flex list-none gap-2 overflow-x-auto" aria-label="Особенности сервиса">
	{#each FEATURES as feature (feature.label)}
		{@const Icon = feature.icon}
		<li
			class="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium"
		>
			<Icon class="size-3.5 text-accent-600" aria-hidden="true" />
			{feature.label}
		</li>
	{/each}
</ul>
