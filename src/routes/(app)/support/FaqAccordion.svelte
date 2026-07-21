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

<!--
	Each row carries its own bottom hairline instead of the next one carrying a top border, and the
	card itself is almost flush top and bottom: the reference runs the rules the full width inside a
	single card, so the list reads as one block of questions rather than as six stacked cards.
-->
<Card padded={false}>
	<ul class="px-5 py-0.5">
		{#each items as item (item.id)}
			<li class="border-b border-line last:border-b-0">
				<!-- On the details, not on the summary: `toggle` fires for a tap and for the keyboard
				     alike, and it cannot fire for a state change that did not happen. -->
				<details name={GROUP} class="group" ontoggle={() => haptic()}>
					<summary
						class="flex cursor-pointer list-none items-center justify-between gap-3.5 py-[15px] select-none"
					>
						<h3 class="min-w-0 flex-1 text-xs leading-snug font-medium">{item.question}</h3>
						<!-- The span carries the rotation and the colour change: a class handed to a
						     component is not this component's element, so scoped styling would never
						     reach the svg. -->
						<span
							class="block shrink-0 text-white/45 transition-[transform,color] duration-[250ms] group-open:rotate-180 group-open:text-accent motion-reduce:transition-none"
						>
							<ChevronDown size={20} aria-hidden="true" />
						</span>
					</summary>

					<p class="pb-4 text-2xs leading-[1.55] text-muted select-text">{item.answer}</p>
				</details>
			</li>
		{/each}
	</ul>
</Card>
