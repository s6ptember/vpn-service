<script lang="ts">
	import { Cpu, EyeOff, Lock } from 'lucide-svelte';
	import Chip from '$lib/ui/Chip.svelte';

	/**
	 * Product copy, not domain data. Static because none of it is a promise the server can verify per
	 * plan; it describes the service.
	 *
	 * Three, and the protocol split across two of them, exactly as the reference sets this row: it
	 * wraps to one line on a 360px screen, which a fourth chip would not.
	 */
	const FEATURES = [
		{ icon: EyeOff, label: 'Без логов' },
		{ icon: Cpu, label: 'XRAY' },
		{ icon: Lock, label: 'VLESS' }
	];
</script>

<ul class="mt-4 flex list-none flex-wrap gap-2" aria-label="Особенности сервиса">
	{#each FEATURES as feature (feature.label)}
		<li>
			<Chip icon={feature.icon}>{feature.label}</Chip>
		</li>
	{/each}
</ul>
