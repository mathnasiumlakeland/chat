<script lang="ts">
	import { PROCESSING_INFO_TIMEOUT } from '$lib/constants';
	import { useProcessingState } from '$lib/hooks/use-processing-state.svelte';
	import { isConversationLoading } from '$lib/stores/chat.svelte';
	import { activeConversation } from '$lib/stores/conversations.svelte';
	import { config } from '$lib/stores/settings.svelte';

	const processingState = useProcessingState(() => ({
		conversationId: activeConversation()?.id ?? null
	}));

	let currentConversationId = $derived(activeConversation()?.id ?? null);
	let isCurrentConversationLoading = $derived(isConversationLoading(currentConversationId));
	let processingDetails = $derived(processingState.getTechnicalDetails());
	let hasProcessingData = $derived(processingDetails.length > 0);

	let showProcessingInfo = $derived(isCurrentConversationLoading || hasProcessingData);

	$effect(() => {
		const keepStatsVisible = config().keepStatsVisible;
		const shouldMonitor = keepStatsVisible || isCurrentConversationLoading;

		if (shouldMonitor) {
			processingState.startMonitoring();
		}

		if (!isCurrentConversationLoading && !keepStatsVisible) {
			const timeout = setTimeout(() => {
				if (!config().keepStatsVisible && !isConversationLoading(currentConversationId)) {
					processingState.stopMonitoring();
				}
			}, PROCESSING_INFO_TIMEOUT);

			return () => clearTimeout(timeout);
		}
	});
</script>

<div class="chat-processing-info-container pointer-events-none" class:visible={showProcessingInfo}>
	<div class="chat-processing-info-content">
		{#if processingDetails.length > 0}
			<div class="chat-processing-info-details">
				{#each processingDetails as detail (detail)}
					<span class="chat-processing-info-detail pointer-events-auto backdrop-blur-sm">
						{detail}
					</span>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.chat-processing-info-container {
		position: sticky;
		top: 0;
		z-index: 10;
		padding: 0 1rem 0.75rem;
		opacity: 0;
		transform: translateY(50%);
		transition:
			opacity 300ms ease-out,
			transform 300ms ease-out;
	}

	.chat-processing-info-container.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.chat-processing-info-content {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		justify-content: center;
		max-width: 48rem;
		margin: 0 auto;
	}

	.chat-processing-info-detail {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		padding: 0.25rem 0.75rem;
		border-radius: 0.375rem;
		font-family:
			ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
		white-space: nowrap;
	}

	@media (max-width: 768px) {
		.chat-processing-info-content {
			gap: 0.5rem;
		}

		.chat-processing-info-detail {
			font-size: 0.7rem;
			padding: 0.2rem 0.5rem;
		}
	}
</style>
