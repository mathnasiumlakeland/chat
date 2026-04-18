import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_ID } from '$lib/constants/models';
import type { ApiProcessingState } from '$lib/types';

const goto = vi.fn();

vi.mock('$app/navigation', () => ({
	goto
}));

vi.mock('$app/paths', () => ({
	base: '',
	resolve: (route: string, params?: Record<string, string>) =>
		route === '/chat/[id]' && params?.id ? `/chat/${params.id}` : route
}));

describe('chatStore.sendMessage', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it(
		'loads the model before creating and navigating to a new chat',
		async () => {
			const { chatStore } = await import('./chat.svelte');
			const { conversationsStore } = await import('./conversations.svelte');
			const { modelStateStore } = await import('./model-state.svelte');

			const events: string[] = [];
			modelStateStore.record = {
				...modelStateStore.record,
				selectedModelId: DEFAULT_MODEL_ID
			};
			conversationsStore.activeConversation = null;

			vi.spyOn(chatStore, 'ensureLoaded').mockImplementation(async () => {
				events.push('ensureLoaded');
			});
			vi.spyOn(conversationsStore, 'createTurn').mockImplementation(async () => {
				events.push('createTurn');
				return {
					conversation: { id: 'chat-123' } as DatabaseConversation,
					userMessage: { id: 'user-1' } as DatabaseMessage,
					assistantMessage: { id: 'assistant-1' } as DatabaseMessage
				};
			});

			await chatStore.sendMessage('hello');

			expect(events).toEqual(['ensureLoaded', 'createTurn']);
			expect(goto).toHaveBeenCalledWith('/chat/chat-123');
			expect(chatStore.isPreparingNewChat).toBe(false);
		},
		20_000
	);

	it(
		'does not create a chat when initial model loading fails',
		async () => {
			const { chatStore } = await import('./chat.svelte');
			const { conversationsStore } = await import('./conversations.svelte');
			const { modelStateStore } = await import('./model-state.svelte');

			modelStateStore.record = {
				...modelStateStore.record,
				selectedModelId: DEFAULT_MODEL_ID
			};
			conversationsStore.activeConversation = null;

			vi.spyOn(chatStore, 'ensureLoaded').mockRejectedValue(new Error('load failed'));
			const createTurnSpy = vi.spyOn(conversationsStore, 'createTurn');

			await expect(chatStore.sendMessage('hello')).rejects.toThrow('load failed');

			expect(createTurnSpy).not.toHaveBeenCalled();
			expect(goto).not.toHaveBeenCalled();
			expect(chatStore.isPreparingNewChat).toBe(false);
		},
		20_000
	);

	it('clears active generation state when returning to the home screen', async () => {
		const { chatStore, activeProcessingState, isChatStreaming, isLoading } =
			await import('./chat.svelte');

		const backendAbort = vi.fn();

		chatStore.backend = {
			abort: backendAbort
		} as never;
		chatStore.abortController = new AbortController();
		chatStore.isGenerating = true;
		chatStore.isPreparingNewChat = true;
		chatStore.activeProcessingState = {
			status: 'generating'
		} as ApiProcessingState;

		(chatStore as unknown as { markChatLoading: (conversationId: string, loading: boolean) => void })
			.markChatLoading('chat-123', true);
		(
			chatStore as unknown as {
				pendingCompletion: {
					conversationId: string;
					assistantMessageId: string;
					modelId: string;
					prefix: string;
				} | null;
			}
		).pendingCompletion = {
			conversationId: 'chat-123',
			assistantMessageId: 'assistant-1',
			modelId: DEFAULT_MODEL_ID,
			prefix: ''
		};

		chatStore.resetForHomeNavigation();

		expect(backendAbort).toHaveBeenCalledTimes(1);
		expect(chatStore.abortController?.signal.aborted).toBe(true);
		expect(chatStore.isPreparingNewChat).toBe(false);
		expect(isLoading()).toBe(false);
		expect(isChatStreaming()).toBe(false);
		expect(activeProcessingState()).toBeNull();
		expect(chatStore.getAllLoadingChats()).toEqual([]);
		expect(
			(
				chatStore as unknown as {
					pendingCompletion: {
						conversationId: string;
						assistantMessageId: string;
						modelId: string;
						prefix: string;
					} | null;
				}
			).pendingCompletion
		).toBeNull();
	});

	it('returns live processing state only for the owning conversation and assistant message', async () => {
		const { chatStore } = await import('./chat.svelte');

		const state: ApiProcessingState = {
			status: 'generating',
			tokensDecoded: 12,
			tokensRemaining: 20,
			contextUsed: 8,
			contextTotal: 32768,
			outputTokensUsed: 12,
			outputTokensMax: 32,
			temperature: 0.7,
			topP: 0.95,
			speculative: false,
			hasNextToken: true,
			tokensPerSecond: 18
		};

		const internal = chatStore as unknown as {
			activeProcessingOwner: { conversationId: string | null; messageId: string | null };
			activeProcessingState: ApiProcessingState | null;
		};

		internal.activeProcessingOwner = {
			conversationId: 'conv-story',
			messageId: 'assistant-story'
		};
		internal.activeProcessingState = state;

		expect(
			chatStore.getProcessingStateFor({
				conversationId: 'conv-story',
				messageId: 'assistant-story'
			})
		).toEqual(state);
		expect(chatStore.getProcessingStateFor({ conversationId: 'conv-story' })).toEqual(state);
		expect(
			chatStore.getProcessingStateFor({
				conversationId: 'conv-hello',
				messageId: 'assistant-hello'
			})
		).toBeNull();
		expect(chatStore.getProcessingStateFor({ conversationId: 'conv-hello' })).toBeNull();
	});
});
