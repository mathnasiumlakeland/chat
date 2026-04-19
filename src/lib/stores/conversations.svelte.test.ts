import { beforeEach, describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from '$lib/constants/models';
import { databaseService, resetDefaultDatabaseForTests } from '$lib/services/database.service';
import { settingsStore } from '$lib/stores/settings.svelte';
import { conversationsStore } from './conversations.svelte';

async function resetConversationsStore() {
	await resetDefaultDatabaseForTests();
	settingsStore.forceSyncWithServerDefaults();
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

	it('adds the configured default system message before the first user message', async () => {
		const model = MODEL_CATALOG[0];

		const { conversation, userMessage, assistantMessage } = await conversationsStore.createTurn(
			'Solve 2 + 2',
			model
		);

		const allMessages = await databaseService.getConversationMessages(conversation.id);
		const rootMessage = allMessages.find((message) => message.type === 'root');
		const systemMessage = allMessages.find((message) => message.type === 'system');

		expect(rootMessage).toBeDefined();
		expect(systemMessage?.content).toBe('You are ChatMATh, a friendly assistant');
		expect(systemMessage?.parent).toBe(rootMessage?.id);
		expect(userMessage.parent).toBe(systemMessage?.id);
		expect(assistantMessage.parent).toBe(userMessage.id);
		expect(conversationsStore.getInferenceMessages()).toEqual([
			{
				role: 'system',
				content: 'You are ChatMATh, a friendly assistant'
			},
			{
				role: 'user',
				content: 'Solve 2 + 2'
			}
		]);
	});
});
