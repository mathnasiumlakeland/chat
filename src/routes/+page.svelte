<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { ChatScreen } from '$lib/components/app';
	import { DEFAULT_MODEL_ID } from '$lib/constants/models';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';

	if (browser) {
		conversationsStore.clearActiveConversation();
		chatStore.resetForHomeNavigation();
	}

	onMount(() => {
		let preloadTimer: ReturnType<typeof setTimeout> | undefined;

		void (async () => {
			await conversationsStore.initialize();
			await modelsStore.fetch();

			// Give any user-initiated model selection a chance to win before
			// opportunistically preloading the default model in the background.
			preloadTimer = setTimeout(() => {
				if ((modelsStore.selectedModelId ?? DEFAULT_MODEL_ID) !== DEFAULT_MODEL_ID) {
					return;
				}

				if (modelsStore.loadingModelIds.length > 0) {
					return;
				}

				void chatStore.ensureLoaded().catch((error) => {
					console.error('Failed to preload default model:', error);
				});
			}, 0);
		})();

		return () => {
			if (preloadTimer) {
				clearTimeout(preloadTimer);
			}
		};
	});
</script>

<svelte:head>
	<title>Local Chat</title>
</svelte:head>

<ChatScreen showCenteredEmpty />
