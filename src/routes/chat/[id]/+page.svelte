<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ChatScreen } from '$lib/components/app';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { conversationsStore, activeConversation } from '$lib/stores/conversations.svelte';

	let chatId = $derived(page.params.id);
	let currentChatId: string | undefined = undefined;

	$effect(() => {
		if (chatId && chatId !== currentChatId) {
			currentChatId = chatId;

			(async () => {
				const success = await conversationsStore.loadConversation(chatId);
				if (success) {
					chatStore.syncLoadingStateForChat(chatId);
					chatStore.startPendingCompletionForChat(chatId);
				} else {
					await goto(resolve('/'));
				}
			})();
		}
	});
</script>

<svelte:head>
	<title>{activeConversation()?.name || 'Chat'} - Bonsai Browser Chat</title>
</svelte:head>

<ChatScreen />
