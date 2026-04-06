import { beforeEach, describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from '$lib/constants/models';
import { databaseService, resetDefaultDatabaseForTests } from '$lib/services/database.service';
import { conversationsStore } from './conversations.svelte';

async function resetConversationsStore() {
	await resetDefaultDatabaseForTests();
	conversationsStore.initialized = false;
	conversationsStore.loading = false;
	conversationsStore.list = [];
	conversationsStore.activeConversation = null;
	conversationsStore.activeConversationMessages = [];
	conversationsStore.pendingMcpServerOverrides = [];
	conversationsStore.titleUpdateConfirmationCallback = undefined;
}

describe('conversationsStore.createTurn', () => {
	beforeEach(async () => {
		await resetConversationsStore();
	});

	it('creates a fresh conversation when no active conversation is selected', async () => {
		const model = MODEL_CATALOG[0];
		const existingConversation = await conversationsStore.createConversationForModel(
			model,
			'Existing chat'
		);

		conversationsStore.clearActiveConversation();

		const { conversation, userMessage, assistantMessage } = await conversationsStore.createTurn(
			'Start a brand new chat',
			model
		);

		const allConversations = await databaseService.getAllConversations();

		expect(conversation.id).not.toBe(existingConversation.id);
		expect(allConversations).toHaveLength(2);
		expect(userMessage.convId).toBe(conversation.id);
		expect(assistantMessage.convId).toBe(conversation.id);
		expect(conversationsStore.activeConversation?.id).toBe(conversation.id);
	});
});
