<script lang="ts">
	import { cn } from '$lib/components/ui/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		children: Snippet;
		class?: string;
		icon?: Snippet;
	}

	let { children, class: className = '', icon, ...restProps }: Props = $props();
</script>

<button
	class={cn(
		'inline-flex cursor-pointer items-center gap-1 rounded-sm bg-muted-foreground/15 px-1.5 py-0.75',
		className
	)}
	{...restProps}
>
	{#if icon}
		{@render icon()}
	{/if}

	{@render children()}
</button>
