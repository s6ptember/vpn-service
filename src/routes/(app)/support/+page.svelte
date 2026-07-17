<script lang="ts">
	import EmptyState from '$lib/ui/EmptyState.svelte';
</script>

<svelte:head>
	<title>Поддержка — VPN</title>
</svelte:head>

<!-- Shell only: A13 fills in the FAQ accordion, A14 the ticket form. -->
<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Поддержка</h1>

	<div class="mt-5">
		<EmptyState
			title="Скоро здесь появятся ответы"
			description="Частые вопросы и форма обращения готовятся."
		/>
	</div>
</div>
