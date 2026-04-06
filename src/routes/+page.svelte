<script lang="ts">
	import { onMount } from 'svelte';
	import { ChatScreen } from '$lib/components/app';
	import { DEFAULT_MODEL_ID } from '$lib/constants/models';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';

	onMount(async () => {
		await conversationsStore.initialize();
		await modelsStore.fetch();
		await modelsStore.selectModelById(DEFAULT_MODEL_ID);
		conversationsStore.clearActiveConversation();
		chatStore.clearUIState();
		void chatStore.ensureLoaded().catch((error) => {
			console.error('Failed to preload default model:', error);
		});
	});
</script>

<svelte:head>
	<title>Bonsai Browser Chat</title>
</svelte:head>

<ChatScreen showCenteredEmpty />
