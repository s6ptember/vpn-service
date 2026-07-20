<script lang="ts">
	import { ArrowLeft } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CopyField from '$lib/ui/CopyField.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const STEPS = [
		{
			title: '1. Установите Happ',
			description: 'Найдите приложение Happ в App Store или Google Play и установите его.'
		},
		{
			title: '2. Отсканируйте QR-код',
			description:
				'Откройте Happ и отсканируйте код ниже — или вставьте ссылку на подписку вручную.'
		},
		{
			title: '3. Подключитесь',
			description: 'Нажмите «Подключиться» в приложении — доступ уже открыт.'
		}
	];
</script>

<svelte:head>
	<title>Установка — VPN</title>
</svelte:head>

<!-- Not part of the swipe deck (nav.ts: sectionOfPath('/setup') is null), so it carries its own
     way back rather than leaning on the island. -->
<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-10">
	<button
		type="button"
		class="-ml-1 flex items-center gap-1 text-[15px] text-muted press"
		onclick={() => goto(resolve('/'))}
	>
		<ArrowLeft class="size-4" aria-hidden="true" />
		Назад
	</button>

	<h1 class="mt-3 text-[28px] font-bold tracking-[-.02em]">Установка и настройка</h1>
	<p class="mt-2 text-[15px] text-muted">Три шага — и VPN готов к работе.</p>

	<ol class="mt-6 list-none space-y-5">
		{#each STEPS as step (step.title)}
			<li>
				<p class="text-[15px] font-semibold">{step.title}</p>
				<p class="mt-1 text-[14px] text-muted">{step.description}</p>
			</li>
		{/each}
	</ol>

	<div class="mt-6 rounded-card bg-surface p-4">
		<QrCode value={data.subscription.subscriptionUrl} size={200} />
		<div class="mt-4">
			<CopyField value={data.subscription.subscriptionUrl} label="Ссылка подписки" />
		</div>
	</div>
</div>
