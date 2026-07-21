<script lang="ts">
	import { ArrowLeft } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Card from '$lib/ui/Card.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The number is rendered as its own token beside the step, so it is not repeated in the title. */
	const STEPS = [
		{
			title: 'Установите Happ',
			description: 'Найдите приложение Happ в App Store или Google Play и установите его.'
		},
		{
			title: 'Отсканируйте QR-код',
			description:
				'Откройте Happ и отсканируйте код ниже — или вставьте ссылку на подписку вручную.'
		},
		{
			title: 'Подключитесь',
			description: 'Нажмите «Подключиться» в приложении — доступ уже открыт.'
		}
	];
</script>

<svelte:head>
	<title>Установка — VPN</title>
</svelte:head>

<!-- Not part of the swipe deck (nav.ts: sectionOfPath('/setup') is null), so it carries its own
     way back rather than leaning on the island. -->
<div class="px-5 pt-[max(26px,calc(env(safe-area-inset-top)+26px))] pb-10">
	<IconButton onclick={() => goto(resolve('/'))} aria-label="Назад на главную">
		<ArrowLeft class="size-[19px]" strokeWidth={1.9} aria-hidden="true" />
	</IconButton>

	<h1 class="mt-5 text-h1 font-bold tracking-[-.02em]">Установка и настройка</h1>
	<p class="mt-2 text-2xs text-muted">Три шага — и VPN готов к работе.</p>

	<ol class="mt-7 list-none space-y-4">
		{#each STEPS as step, index (step.title)}
			<li>
				<Card>
					<div class="flex items-start gap-4">
						<!-- The counter is decoration over an ordered list that already numbers itself;
						     announcing it again would read every step twice. -->
						<span
							class="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-on-accent"
							aria-hidden="true"
						>
							{index + 1}
						</span>
						<div class="min-w-0">
							<p class="text-md font-bold">{step.title}</p>
							<p class="mt-1.5 text-2xs text-muted">{step.description}</p>
						</div>
					</div>
				</Card>
			</li>
		{/each}
	</ol>

	<div class="mt-4">
		<Card>
			<QrCode value={data.subscription.subscriptionUrl} size={220} />
			<div class="mt-5">
				<CopyField value={data.subscription.subscriptionUrl} label="Ссылка подписки" />
			</div>
		</Card>
	</div>
</div>
