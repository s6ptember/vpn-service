<script lang="ts">
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<!-- Each section scrolls inside the frame, not the document: the island is pinned to the frame and
     the page behind it must slide under it. overscroll-contain stops a scroll at the end of one
     section from chaining out to Telegram's own view and collapsing the mini app. -->
<div class="no-scrollbar h-full overflow-y-auto overscroll-y-contain">
	{@render children()}
</div>
