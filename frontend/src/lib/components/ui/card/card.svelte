<script lang="ts">
	import { cn } from "$lib/utils.js";

	let className: string | undefined | null = undefined;
	export { className as class };
</script>

<div
	class={cn("rounded-xl border bg-card text-card-foreground shadow", className)}
	{...$$restProps}
>
	<slot />
</div>