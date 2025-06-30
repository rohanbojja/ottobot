<script lang="ts">
	import { cn } from "$lib/utils.js";

	let className: string | undefined | null = undefined;
	export { className as class };
</script>

<div class={cn("p-6 pt-0", className)} {...$$restProps}>
	<slot />
</div>