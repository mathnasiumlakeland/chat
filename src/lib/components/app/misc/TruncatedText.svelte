<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';

	interface Props {
		text: string;
		class?: string;
		showTooltip?: boolean;
	}

	let { text, class: className = '', showTooltip = true }: Props = $props();

	let textElement: HTMLSpanElement | undefined = $state();
	let isTruncated = $state(false);

	function checkTruncation() {
		if (textElement) {
			isTruncated = textElement.scrollWidth > textElement.clientWidth;
		}
	}

	$effect(() => {
		if (textElement) {
			checkTruncation();

			const observer = new ResizeObserver(checkTruncation);
			observer.observe(textElement);

			return () => observer.disconnect();
		}
	});
</script>

{#if isTruncated && showTooltip}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<span bind:this={textElement} class="{className} block truncate" {...props}>
					{text}
				</span>
			{/snippet}
		</Tooltip.Trigger>

		<Tooltip.Content class="z-[9999]">
			<p>{text}</p>
		</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<span bind:this={textElement} class="{className} block truncate">
		{text}
	</span>
{/if}
