<script lang="ts">
	import type { Currency } from '$lib/types';
	import { formatMoney } from './money';

	interface Props {
		minor: number;
		currency: Currency;
	}

	let { minor, currency }: Props = $props();

	let formatted = $derived(formatMoney(minor, currency));
</script>

<span class="tabular-nums">{formatted}</span>
