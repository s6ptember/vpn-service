<script lang="ts">
	import { ChevronDown } from 'lucide-svelte';
	import { haptic } from '$lib/client/telegram-haptics';
	import Card from '$lib/ui/Card.svelte';
	import type { FaqItemDTO } from '$lib/types';

	interface Props {
		items: FaqItemDTO[];
	}

	let { items }: Props = $props();

	/**
	 * Native `<details>` rather than a hand-rolled disclosure: it is a button and a region with the
	 * right roles and the right keyboard behaviour before a line of script runs, it survives a page
	 * with no JS, and Ctrl+F finds text inside a closed one. app.css already hides the webkit marker,
	 * so the primitive was expected here.
	 *
	 * `name` makes the group exclusive — opening one answer closes the last. A WebView too old to
	 * know the attribute simply leaves both open, which is the harmless direction to degrade in.
	 */
	const GROUP = 'faq';
</script>

<Card padded={false}>
	<ul>
		{#each items as item, index (item.id)}
			<li class={index > 0 ? 'border-t border-line' : ''}>
				<!-- On the details, not on the summary: `toggle` fires for a tap and for the keyboard
				     alike, and it cannot fire for a state change that did not happen. -->
				<details name={GROUP} class="group" ontoggle={() => haptic()}>
					<summary class="flex cursor-pointer list-none items-start gap-3 p-4 press select-none">
						<h3 class="min-w-0 flex-1 text-[15px] leading-snug font-medium">{item.question}</h3>
						<!-- The span carries the rotation: a class handed to a component is not this
						     component's element, so scoped styling would never reach the svg. -->
						<span
							class="mt-0.5 block shrink-0 text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
						>
							<ChevronDown size={20} aria-hidden="true" />
						</span>
					</summary>

					<p class="px-4 pb-4 text-[14px] leading-relaxed text-muted select-text">{item.answer}</p>
				</details>
			</li>
		{/each}
	</ul>
</Card>
