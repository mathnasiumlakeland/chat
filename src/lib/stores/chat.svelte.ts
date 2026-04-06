import { goto } from '$app/navigation';
import { DEFAULT_MODEL_ID, MODEL_CATALOG } from '$lib/constants/models';
import { SYSTEM_MESSAGE_PLACEHOLDER } from '$lib/constants';
import { ErrorDialogType } from '$lib/enums';
import { createInferenceBackend } from '$lib/runtime/create-inference-backend';
import type { InferenceBackend } from '$lib/runtime/inference-backend';
import { databaseService, DatabaseService } from '$lib/services/database.service';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { modelStateStore, selectedModelId } from '$lib/stores/model-state.svelte';
import type { ErrorDialogState } from '$lib/types/chat';
import type { RuntimeKind, SamplingConfig } from '$lib/types/runtime';
import { findDescendantMessages, findLeafNode } from '$lib/utils';
import { trimConversationTitle } from '$lib/utils/format';
import { splitLeadingThinkBlock } from '$lib/utils/reasoning';
import { calculateTokensPerSecond, estimateDisplayedTokenCount } from '$lib/utils/generation-stats';
import { SvelteSet } from 'svelte/reactivity';

function getSelectedModelOrThrow(modelId: string | null = selectedModelId()) {
	if (!modelId) {
		throw new Error('Select a model before sending a message.');
	}

	const model = MODEL_CATALOG.find((entry) => entry.id === modelId);
	if (!model) {
		throw new Error(`Unknown model "${modelId}".`);
	}

	return model;
}

class ChatStore {
	backend: InferenceBackend | null = null;
	backendRuntimeKind = $state<RuntimeKind | null>(null);
	isGenerating = $state(false);
	loadedModelId = $state<string | null>(null);
	lastResponse = $state('');
	currentResponse = $state('');
	abortController = $state<AbortController | null>(null);
	errorDialogState = $state<ErrorDialogState | null>(null);
	activeProcessingState = $state<ApiProcessingState | null>(null);
	pendingEditMessageId = $state<string | null>(null);
	private loadingChats = $state.raw<SvelteSet<string>>(new SvelteSet());
	private activeConversationId = $state<string | null>(null);
	isEditModeActive = $state(false);
	private addFilesHandler = $state<((files: File[]) => void) | null>(null);
	private pendingDraftMessage = $state('');
	private pendingDraftFiles = $state<ChatUploadedFile[]>([]);
	private loadPromise: Promise<void> | null = null;
	private loadingModelId: string | null = null;
	private pendingCompletion = $state<{
		conversationId: string;
		assistantMessageId: string;
		modelId: string;
		prefix: string;
	} | null>(null);

	private snapshotUploadedFiles(files: ChatUploadedFile[]): ChatUploadedFile[] {
		return files.map((file) => ({ ...file }));
	}

	private markChatLoading(conversationId: string, loading: boolean): void {
		const next = new SvelteSet(this.loadingChats);
		if (loading) next.add(conversationId);
		else next.delete(conversationId);
		this.loadingChats = next;
	}

	private setGenerationState(
		conversationId: string,
		outputTokensUsed: number,
		outputTokensMax: number,
		contextTotal: number,
		sampling: SamplingConfig,
		elapsedMs: number
	): void {
		this.activeConversationId = conversationId;
		this.activeProcessingState = {
			status: 'generating',
			tokensDecoded: outputTokensUsed,
			tokensRemaining: outputTokensMax > 0 ? Math.max(outputTokensMax - outputTokensUsed, 0) : 0,
			progressPercent: undefined,
			contextUsed: conversationsStore.getInferenceMessages().length,
			contextTotal,
			outputTokensUsed,
			outputTokensMax,
			temperature: sampling.temp,
			topP: sampling.top_p,
			hasNextToken: true,
			tokensPerSecond: calculateTokensPerSecond(outputTokensUsed, elapsedMs),
			speculative: false
		} as ApiProcessingState;
	}

	private getNowMs(): number {
		return typeof performance !== 'undefined' ? performance.now() : Date.now();
	}

	private clearGenerationState(): void {
		this.activeProcessingState = null;
	}

	private scheduleAfterNextPaint(callback: () => void): void {
		const start = () => {
			globalThis.setTimeout(callback, 50);
		};

		if (typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(() => {
				requestAnimationFrame(start);
			});
			return;
		}

		globalThis.setTimeout(callback, 50);
	}

	private startAssistantCompletion(
		conversationId: string,
		assistantMessage: DatabaseMessage,
		modelId: string,
		prefix = ''
	): void {
		this.scheduleAfterNextPaint(() => {
			void this.runAssistantCompletion(conversationId, assistantMessage, modelId, prefix).catch((error) => {
				console.error('Assistant completion failed:', error);
			});
		});
	}

	setBackend(backend: InferenceBackend, runtimeKind: RuntimeKind = 'gguf-wasm'): void {
		this.backend = backend;
		this.backendRuntimeKind = runtimeKind;
		this.loadedModelId = null;
	}

	async getBackend(runtimeKind: RuntimeKind): Promise<InferenceBackend> {
		if (this.backend && this.backendRuntimeKind === runtimeKind) {
			return this.backend;
		}

		if (this.backend) {
			await this.backend.unload();
		}

		this.backend = createInferenceBackend(runtimeKind);
		this.backendRuntimeKind = runtimeKind;
		this.loadedModelId = null;
		return this.backend;
	}

	async ensureLoaded(): Promise<void> {
		const model = getSelectedModelOrThrow();
		let backend = await this.getBackend(model.runtimeKind);

		if (this.loadedModelId === model.id && backend.getRuntimeInfo()) {
			return;
		}

		if (this.loadPromise) {
			if (this.loadingModelId === model.id) {
				return this.loadPromise;
			}

			await this.loadPromise.catch(() => {
				// Let the new load attempt surface its own error state.
			});
			backend = await this.getBackend(model.runtimeKind);

			if (this.loadedModelId === model.id && backend.getRuntimeInfo()) {
				return;
			}
		}

		const loadPromise = (async () => {
			await modelStateStore.setLoadState('loading');
			modelStateStore.setProgress(0);

			try {
				await backend.load(model, {
					contextTokens: model.contextTokens,
					progressCallback: ({ loaded, total }) => {
						if (!total) return;
						modelStateStore.setProgress(Math.round((loaded / total) * 100));
					}
				});

				this.loadedModelId = model.id;
				modelStateStore.setRuntimeInfo(backend.getRuntimeInfo());
				await modelStateStore.setLoadState('ready');
			} catch (error) {
				this.loadedModelId = null;
				modelStateStore.setRuntimeInfo(null);
				const message =
					error instanceof Error
						? error.message
						: 'The browser runtime stopped unexpectedly while loading the model.';
				await modelStateStore.setLoadState('error', message);
				throw error;
			} finally {
				modelStateStore.setProgress(0);
			}
		})();

		this.loadPromise = loadPromise;
		this.loadingModelId = model.id;

		try {
			await loadPromise;
		} finally {
			if (this.loadPromise === loadPromise) {
				this.loadPromise = null;
				this.loadingModelId = null;
			}
		}
	}

	async unloadModel(modelId: string): Promise<void> {
		if (this.loadedModelId !== modelId) return;

		await this.backend?.unload();
		this.loadedModelId = null;
		modelStateStore.setRuntimeInfo(null);
		await modelStateStore.setLoadState('idle');
	}

	private async runAssistantCompletion(
		conversationId: string,
		assistantMessage: DatabaseMessage,
		modelId: string,
		prefix = ''
	): Promise<void> {
		const model = getSelectedModelOrThrow(modelId);

		this.abortController = new AbortController();
		this.isGenerating = true;
		this.lastResponse = prefix;
		this.currentResponse = prefix;
		this.markChatLoading(conversationId, true);
		const generationStartedAt = this.getNowMs();
		let outputTokenCount = estimateDisplayedTokenCount(prefix);
		this.setGenerationState(
			conversationId,
			outputTokenCount,
			model.defaultSampling.nPredict,
			model.contextTokens,
			model.defaultSampling.sampling,
			0
		);
		let scheduledFlushId: number | ReturnType<typeof setTimeout> | null = null;
		let flushUsesTimeout = false;

		const flushStreamUpdate = () => {
			scheduledFlushId = null;
			flushUsesTimeout = false;
			const parsedResponse = splitLeadingThinkBlock(this.lastResponse);
			this.currentResponse = parsedResponse.content;
			conversationsStore.patchMessageLocally(assistantMessage.id, {
				content: parsedResponse.content,
				thinking: parsedResponse.thinking,
				status: 'streaming'
			});
			this.setGenerationState(
				conversationId,
				outputTokenCount,
				model.defaultSampling.nPredict,
				model.contextTokens,
				model.defaultSampling.sampling,
				this.getNowMs() - generationStartedAt
			);
		};

		const cancelScheduledFlush = () => {
			if (scheduledFlushId === null) return;

			if (flushUsesTimeout) {
				clearTimeout(scheduledFlushId as ReturnType<typeof setTimeout>);
			} else {
				cancelAnimationFrame(scheduledFlushId as number);
			}

			scheduledFlushId = null;
			flushUsesTimeout = false;
		};

		const scheduleStreamUpdate = () => {
			if (scheduledFlushId !== null) return;

			if (typeof requestAnimationFrame === 'function') {
				scheduledFlushId = requestAnimationFrame(flushStreamUpdate);
				flushUsesTimeout = false;
				return;
			}

			scheduledFlushId = globalThis.setTimeout(flushStreamUpdate, 16);
			flushUsesTimeout = true;
		};

		try {
			await this.ensureLoaded();

			const backend = await this.getBackend(model.runtimeKind);
			const messages = conversationsStore.getInferenceMessages();

			const response = await backend.complete(
				messages,
				model.defaultSampling.sampling,
				{
					onToken: (chunk) => {
						this.lastResponse += chunk;
						scheduleStreamUpdate();
					},
					onTokenDecoded: () => {
						outputTokenCount += 1;
						scheduleStreamUpdate();
					}
				},
				{
					abortSignal: this.abortController.signal,
					nPredict: model.defaultSampling.nPredict
				}
			);

			cancelScheduledFlush();
			flushStreamUpdate();
			const parsedResponse = splitLeadingThinkBlock(response);
			this.lastResponse = response;
			this.currentResponse = parsedResponse.content;
			await conversationsStore.persistMessage(assistantMessage.id, {
				content: parsedResponse.content,
				status: 'done',
				error: undefined,
				model: model.id,
				thinking: parsedResponse.thinking
			});
			this.clearGenerationState();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'The browser runtime stopped unexpectedly.';
			const status = this.abortController.signal.aborted ? 'aborted' : 'error';
			const parsedResponse = splitLeadingThinkBlock(this.lastResponse);

			await conversationsStore.persistMessage(assistantMessage.id, {
				content: parsedResponse.content,
				status,
				error: status === 'error' ? message : 'Generation stopped.',
				model: model.id,
				thinking: parsedResponse.thinking
			});

			if (status === 'error') {
				this.errorDialogState = {
					type: ErrorDialogType.SERVER,
					message
				};
				await modelStateStore.setLoadState('error', message);
			}
		} finally {
			cancelScheduledFlush();
			this.abortController = null;
			this.isGenerating = false;
			this.markChatLoading(conversationId, false);
		}
	}

	async sendPrompt(prompt: string): Promise<void> {
		await this.sendMessage(prompt);
	}

	async sendMessage(message: string, extras?: DatabaseMessageExtra[]): Promise<void> {
		const text = message.trim();
		if (!text && (!extras || extras.length === 0)) {
			return;
		}

		try {
			const model = getSelectedModelOrThrow();
			const hadActiveConversation = Boolean(conversationsStore.activeConversation);

			const { conversation, assistantMessage } = await conversationsStore.createTurn(
				text,
				model,
				extras
			);

			if (!hadActiveConversation) {
				this.pendingCompletion = {
					conversationId: conversation.id,
					assistantMessageId: assistantMessage.id,
					modelId: model.id,
					prefix: ''
				};
				await goto(`/chat/${conversation.id}`);
				return;
			}

			this.startAssistantCompletion(conversation.id, assistantMessage, model.id);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'The browser runtime stopped unexpectedly.';
			this.errorDialogState = {
				type: ErrorDialogType.SERVER,
				message
			};
			throw error;
		}
	}

	stopGeneration(): void {
		this.abortController?.abort();
		this.backend?.abort();
	}

	stopGenerationForChat(conversationId: string): void {
		if (this.activeConversationId === conversationId) {
			this.stopGeneration();
		}
	}

	syncLoadingStateForChat(conversationId: string): void {
		this.activeConversationId = conversationId;
	}

	startPendingCompletionForChat(conversationId: string): void {
		const pendingCompletion = this.pendingCompletion;
		if (!pendingCompletion || pendingCompletion.conversationId !== conversationId) {
			return;
		}

		const assistantMessage = conversationsStore.activeConversationMessages.find(
			(message) => message.id === pendingCompletion.assistantMessageId
		);
		if (!assistantMessage) {
			return;
		}

		this.pendingCompletion = null;
		this.startAssistantCompletion(
			pendingCompletion.conversationId,
			assistantMessage,
			pendingCompletion.modelId,
			pendingCompletion.prefix
		);
	}

	clearUIState(): void {
		this.currentResponse = '';
		this.lastResponse = '';
	}

	setActiveProcessingConversation(conversationId: string | null): void {
		this.activeConversationId = conversationId;
	}

	clearProcessingState(_conversationId: string): void {
		this.clearGenerationState();
	}

	restoreProcessingStateFromMessages(_messages: DatabaseMessage[], _conversationId: string): void {
		if (!this.isGenerating) {
			this.clearGenerationState();
		}
	}

	getConversationModel(messages: DatabaseMessage[]): string | null {
		for (let index = messages.length - 1; index >= 0; index--) {
			if (messages[index].model) {
				return messages[index].model ?? null;
			}
		}

		return conversationsStore.activeConversation?.modelId ?? null;
	}

	savePendingDraft(message: string, files: ChatUploadedFile[]): void {
		this.pendingDraftMessage = message;
		this.pendingDraftFiles = this.snapshotUploadedFiles(files);
	}

	consumePendingDraft(): { message: string; files: ChatUploadedFile[] } | null {
		if (!this.pendingDraftMessage && this.pendingDraftFiles.length === 0) {
			return null;
		}

		const draft = {
			message: this.pendingDraftMessage,
			files: this.snapshotUploadedFiles(this.pendingDraftFiles)
		};
		this.pendingDraftMessage = '';
		this.pendingDraftFiles = [];
		return draft;
	}

	dismissErrorDialog(): void {
		this.errorDialogState = null;
	}

	getDeletionInfo(messageId: string): {
		totalCount: number;
		userMessages: number;
		assistantMessages: number;
		messageTypes: string[];
	} | null {
		const target = conversationsStore.activeConversationMessages.find((message) => message.id === messageId);
		if (!target) return null;

		const descendantIds = findDescendantMessages(conversationsStore.activeConversationMessages, messageId);
		const ids = new Set([messageId, ...descendantIds]);
		const messages = conversationsStore.activeConversationMessages.filter((message) => ids.has(message.id));

		return {
			totalCount: messages.length,
			userMessages: messages.filter((message) => message.role === 'user').length,
			assistantMessages: messages.filter((message) => message.role === 'assistant').length,
			messageTypes: [...new Set(messages.map((message) => message.type))]
		};
	}

	async deleteMessage(messageId: string): Promise<void> {
		const conversation = conversationsStore.activeConversation;
		if (!conversation) return;

		const message = conversationsStore.activeConversationMessages.find((entry) => entry.id === messageId);
		if (!message) return;

		await DatabaseService.deleteMessageCascading(conversation.id, messageId);

		const nextCurrNode =
			message.parent &&
			findLeafNode(
				conversationsStore.activeConversationMessages.filter((entry) => entry.id !== messageId),
				message.parent
			);

		await databaseService.updateConversation(conversation.id, {
			currNode: nextCurrNode ?? message.parent ?? conversation.currNode
		});
		await conversationsStore.loadConversation(conversation.id);
	}

	async editUserMessagePreserveResponses(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		await DatabaseService.updateMessage(messageId, {
			content: newContent,
			extra: newExtras
		});

		conversationsStore.patchMessageLocally(messageId, {
			content: newContent,
			extra: newExtras
		});
	}

	async editAssistantMessage(
		messageId: string,
		newContent: string,
		shouldBranch: boolean
	): Promise<void> {
		const conversation = conversationsStore.activeConversation;
		const message = conversationsStore.activeConversationMessages.find((entry) => entry.id === messageId);
		if (!conversation || !message) return;

		if (!shouldBranch) {
			await DatabaseService.updateMessage(messageId, { content: newContent });
			conversationsStore.patchMessageLocally(messageId, { content: newContent });
			return;
		}

		const branchedMessage = await DatabaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: message.type,
				timestamp: Date.now(),
				role: message.role,
				content: newContent,
				model: message.model,
				status: 'done'
			},
			message.parent
		);

		await databaseService.updateConversation(conversation.id, {
			currNode: branchedMessage.id
		});
		await conversationsStore.loadConversation(conversation.id);
	}

	async editMessageWithBranching(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		const conversation = conversationsStore.activeConversation;
		const message = conversationsStore.activeConversationMessages.find((entry) => entry.id === messageId);
		if (!conversation || !message) return;

		const modelId = message.model ?? conversation.modelId ?? DEFAULT_MODEL_ID;
		const editedUserMessage = await DatabaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: 'text',
				timestamp: Date.now(),
				role: 'user',
				content: newContent,
				status: 'done',
				model: modelId,
				extra: newExtras
			},
			message.parent
		);

		const assistantMessage = (await DatabaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: 'text',
				timestamp: Date.now() + 1,
				role: 'assistant',
				content: '',
				status: 'streaming',
				model: modelId
			},
			editedUserMessage.id
		)) as DatabaseMessage;

		await databaseService.updateConversation(conversation.id, {
			currNode: assistantMessage.id,
			name: trimConversationTitle(newContent)
		});

		await conversationsStore.loadConversation(conversation.id);
		await this.runAssistantCompletion(conversation.id, assistantMessage, modelId);
	}

	async regenerateMessageWithBranching(messageId: string, modelOverride?: string): Promise<void> {
		const conversation = conversationsStore.activeConversation;
		const message = conversationsStore.activeConversationMessages.find((entry) => entry.id === messageId);
		if (!conversation || !message?.parent) return;

		const modelId = modelOverride ?? message.model ?? conversation.modelId ?? DEFAULT_MODEL_ID;
		const assistantMessage = (await DatabaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: 'text',
				timestamp: Date.now(),
				role: 'assistant',
				content: '',
				status: 'streaming',
				model: modelId
			},
			message.parent
		)) as DatabaseMessage;

		await databaseService.updateConversation(conversation.id, {
			currNode: assistantMessage.id
		});

		await conversationsStore.loadConversation(conversation.id);
		await this.runAssistantCompletion(conversation.id, assistantMessage, modelId);
	}

	async continueAssistantMessage(messageId: string): Promise<void> {
		const conversation = conversationsStore.activeConversation;
		const message = conversationsStore.activeConversationMessages.find((entry) => entry.id === messageId);
		if (!conversation || !message) return;

		await databaseService.updateConversation(conversation.id, {
			currNode: message.id
		});
		await conversationsStore.loadConversation(conversation.id);
		await this.runAssistantCompletion(conversation.id, message, message.model ?? conversation.modelId, message.content);
	}

	async addSystemPrompt(): Promise<void> {
		const model = getSelectedModelOrThrow();
		const conversation =
			conversationsStore.activeConversation ?? (await conversationsStore.createConversationForModel(model));

		const rootMessage = conversationsStore.activeConversationMessages.find((message) => message.type === 'root');
		const parentId = rootMessage?.id ?? conversation.currNode;
		if (!parentId) return;

		const systemMessage = await DatabaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: 'system',
				timestamp: Date.now(),
				role: 'system',
				content: SYSTEM_MESSAGE_PLACEHOLDER,
				status: 'done',
				model: model.id
			},
			parentId
		);

		await databaseService.updateConversation(conversation.id, {
			currNode: systemMessage.id
		});
		await conversationsStore.loadConversation(conversation.id);
		this.pendingEditMessageId = systemMessage.id;
	}

	async removeSystemPromptPlaceholder(messageId: string): Promise<boolean> {
		const conversation = conversationsStore.activeConversation;
		if (!conversation) return false;

		await DatabaseService.deleteMessage(messageId);
		await conversationsStore.loadConversation(conversation.id);
		return false;
	}

	clearPendingEditMessageId(): void {
		this.pendingEditMessageId = null;
	}

	setEditModeActive(handler: (files: File[]) => void): void {
		this.isEditModeActive = true;
		this.addFilesHandler = handler;
	}

	clearEditMode(): void {
		this.isEditModeActive = false;
		this.addFilesHandler = null;
	}

	getAddFilesHandler(): ((files: File[]) => void) | null {
		return this.addFilesHandler;
	}

	getAllLoadingChats(): string[] {
		return Array.from(this.loadingChats);
	}
}

export const chatStore = new ChatStore();

export const errorDialog = () => chatStore.errorDialogState;
export const isLoading = () => chatStore.isGenerating;
export const isChatStreaming = () => chatStore.isGenerating;
export const isEditing = () => chatStore.isEditModeActive;
export const getAddFilesHandler = () => chatStore.getAddFilesHandler();
export const pendingEditMessageId = () => chatStore.pendingEditMessageId;
export const activeProcessingState = () => chatStore.activeProcessingState;
export const getAllLoadingChats = () => chatStore.getAllLoadingChats();
