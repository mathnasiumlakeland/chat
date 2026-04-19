<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { Component } from 'svelte';

	interface Props {
		icon: Component;
		tooltip: string;
		tooltipMode?: 'default' | 'inline';
		variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
		size?: 'default' | 'sm' | 'lg' | 'icon';
		iconSize?: string;
		class?: string;
		disabled?: boolean;
		onclick: (e?: MouseEvent) => void;
		'aria-label'?: string;
	}

	let {
		icon,
		tooltip,
		tooltipMode = 'default',
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		disabled = false,
		iconSize = 'h-3 w-3',
		onclick,
		'aria-label': ariaLabel
	}: Props = $props();
</script>

{#if tooltipMode === 'inline'}
	<div class="group/action-icon relative inline-flex">
		<Button
			{variant}
			{size}
			{disabled}
			{onclick}
			class="h-6 w-6 p-0 {className} flex"
			aria-label={ariaLabel || tooltip}
		>
			{@const IconComponent = icon}

			<IconComponent class={iconSize} />
		</Button>

		<div
			class="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 group-hover/action-icon:block group-focus-within/action-icon:block"
		>
			<div class="rounded-md bg-primary px-3 py-1.5 text-xs whitespace-nowrap text-primary-foreground">
				{tooltip}
			</div>
			<div
				class="absolute top-full left-1/2 z-50 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-primary"
			></div>
		</div>
	</div>
{:else}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					{variant}
					{size}
					{disabled}
					{onclick}
					class="h-6 w-6 p-0 {className} flex"
					aria-label={ariaLabel || tooltip}
				>
					{@const IconComponent = icon}

					<IconComponent class={iconSize} />
				</Button>
			{/snippet}
		</Tooltip.Trigger>

		<Tooltip.Content>
			<p>{tooltip}</p>
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
