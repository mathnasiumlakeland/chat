import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { DEFAULT_MODEL_ID, getModelCatalogEntry, MODEL_CATALOG } from '$lib/constants/models';
import { SYSTEM_MESSAGE_PLACEHOLDER } from '$lib/constants';
import { ErrorDialogType, MessageRole, MessageType, ToolCallType } from '$lib/enums';
import { createInferenceBackend } from '$lib/runtime/create-inference-backend';
import type { InferenceBackend } from '$lib/runtime/inference-backend';
import {
	MODEL_IDLE_EVICTION_MS,
	clearPendingModelCachePurge,
	purgeCachedModelArtifactsForModelId,
	readPendingModelCachePurge,
	writePendingModelCachePurge
} from '$lib/runtime/model-artifact-cache';
import {
	buildMcpAgenticSystemPrompt,
	buildToolResultContext,
	parseMcpAgenticDecision,
	parseMcpAgenticJsonObject
} from '$lib/runtime/mcp-agentic';
import { databaseService, DatabaseService } from '$lib/services/database.service';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { modelStateStore, selectedModelId } from '$lib/stores/model-state.svelte';
import { config } from '$lib/stores/settings.svelte';
import type { ErrorDialogState } from '$lib/types/chat';
import type { ApiChatCompletionToolCall } from '$lib/types/api';
import type { InferenceCompletionOptions, InferenceMessage, RuntimeKind, SamplingConfig } from '$lib/types/runtime';
import { findDescendantMessages, findLeafNode, findMessageById } from '$lib/utils';
import { trimConversationTitle } from '$lib/utils/format';
import { splitLeadingThinkBlock } from '$lib/utils/reasoning';
import { calculateTokensPerSecond, estimateDisplayedTokenCount } from '$lib/utils/generation-stats';
import {
	type ProcessingStateOwner,
	type ProcessingStateScope,
	matchesProcessingStateOwner
} from '$lib/utils/processing-scope';
import { SvelteSet } from 'svelte/reactivity';

function getSelectedModelOrThrow(modelId: string | null = selectedModelId()) {
	if (!modelId) {
		throw new Error('Select a model before sending a message.');
	}

	const model = getModelCatalogEntry(modelId);
	if (!model) {
		throw new Error(`Unknown model "${modelId}".`);
	}

	return model;
}

function createAbortError(): Error {
	try {
		return new DOMException('Aborted', 'AbortError');
	} catch {
		const error = new Error('Aborted');
		error.name = 'AbortError';
		return error;
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw createAbortError();
	}
}

function prependSystemInstruction(
	messages: InferenceMessage[],
	instruction: string
): InferenceMessage[] {
	if (messages[0]?.role === 'system') {
		return [
			{
				...messages[0],
				content: `${instruction}\n\n${messages[0].content}`
			},
			...messages.slice(1)
		];
	}

	return [
		{
			role: 'system',
			content: instruction
		},
		...messages
	];
}

function requiresLiveSqlQuery(messages: InferenceMessage[], toolNames: string[]): boolean {
	if (!toolNames.some((toolName) => toolName === 'sql_query' || toolName.endsWith('__sql_query'))) {
		return false;
	}

	const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
	return /\b(how many|count|number of|total|average|avg|sum|max|min|latest|top)\b/i.test(
		lastUserMessage
	);
}

const INVALID_MCP_PLANNER_RESPONSE =
	'Your previous response was invalid. Return exactly one JSON object and no surrounding prose. Use either {"mode":"tool","name":"tool_name","arguments":{...}} or {"mode":"answer","answer":"..."}.' as const;

const SQL_QUERY_PLAN_PROMPT = [
	'You are preparing arguments for the MCP sql_query tool.',
	'Return exactly one JSON object and no surrounding prose.',
	'Use this shape: {"sql":"SELECT ...","max_rows":200}.',
	'Write a single read-only SQLite query that answers the user.',
	'Only SELECT or WITH queries are allowed.',
	'Do not answer the user yet.'
].join('\n\n');

const SQL_QUERY_REPAIR_PROMPT = [
	'The previous SQL query failed.',
	'Return exactly one corrected JSON object for the sql_query tool.',
	'Do not answer the user yet.'
].join('\n\n');

const SQL_QUERY_ANSWER_PROMPT = [
	'You already have the tool result needed to answer the user.',
	'Answer the latest user request directly using only the tool result.',
	'Honor formatting requests like "just the number".',
	'Do not mention tool calls unless the user explicitly asks.'
].join('\n\n');

function createAgenticPlanningSampling(sampling: SamplingConfig): SamplingConfig {
	return {
		...sampling,
		temp: 0,
		top_p: 1,
		top_k: 0,
		penalty_repeat: 1
	};
}

function resolveAgenticPredictTokens(requestedPredictTokens?: number): number {
	const fallbackPredictTokens = requestedPredictTokens ?? 256;

	if (!Number.isFinite(fallbackPredictTokens)) {
		return 256;
	}

	return Math.max(64, Math.min(Math.floor(fallbackPredictTokens), 256));
}

function findToolName(toolNames: string[], suffix: string): string | null {
	return toolNames.find((toolName) => toolName === suffix || toolName.endsWith(`__${suffix}`)) ?? null;
}

function parseSqlQueryArguments(response: string): Record<string, unknown> | null {
	const parsed = parseMcpAgenticJsonObject(response);
	if (!parsed) {
		return null;
	}

	const sql = typeof parsed.sql === 'string' ? parsed.sql.trim() : '';
	if (!sql) {
		return null;
	}

	const argumentsRecord: Record<string, unknown> = {
		sql
	};
	const maxRows = parsed.max_rows;
	if (typeof maxRows === 'number' && Number.isFinite(maxRows)) {
		argumentsRecord.max_rows = Math.max(1, Math.min(Math.floor(maxRows), 200));
	}

	return argumentsRecord;
}

type AgenticFlowState = {
	currentAssistantMessage: DatabaseMessage;
};

type AgenticFlowResult = {
	finalAssistantMessage: DatabaseMessage;
	response: string;
};

function createToolCallId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createToolCallPayload(
	toolName: string,
	argumentsRecord: Record<string, unknown>
): ApiChatCompletionToolCall {
	return {
		id: createToolCallId(),
		type: ToolCallType.FUNCTION,
		function: {
			name: toolName,
			arguments: JSON.stringify(argumentsRecord)
		}
	};
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
	activeProcessingOwner = $state.raw<ProcessingStateOwner>({
		conversationId: null,
		messageId: null
	});
	pendingEditMessageId = $state<string | null>(null);
	private loadingChats = $state.raw<SvelteSet<string>>(new SvelteSet());
	isEditModeActive = $state(false);
	isPreparingNewChat = $state(false);
	private addFilesHandler = $state<((files: File[]) => void) | null>(null);
	private pendingDraftMessage = $state('');
	private pendingDraftFiles = $state<ChatUploadedFile[]>([]);
	private loadPromise: Promise<void> | null = null;
	private loadingModelId: string | null = null;
	private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
	private lastModelActivityAt: number | null = null;
	private activeEviction: Promise<void> | null = null;
	private pendingCompletion = $state<{
		conversationId: string;
		assistantMessageId: string;
		modelId: string;
		prefix: string;
	} | null>(null);
	private readonly onWindowActivity = () => {
		this.noteModelActivity();
	};
	private readonly onVisibilityChange = () => {
		if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
			return;
		}

		void this.evictModelIfIdle().catch((error) => {
			console.error('Failed to evict idle model artifacts:', error);
		});
	};
	private readonly onPageHide = () => {
		if (!this.loadedModelId) {
			return;
		}

		writePendingModelCachePurge({
			modelId: this.loadedModelId,
			requestedAt: Date.now()
		});
		void this.evictLoadedModel({ purgeDownloads: true }).catch((error) => {
			console.error('Failed to evict model artifacts during page hide:', error);
		});
	};

	constructor() {
		if (typeof window === 'undefined' || typeof document === 'undefined') {
			return;
		}

		for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'focus']) {
			window.addEventListener(eventName, this.onWindowActivity, { passive: true });
		}

		document.addEventListener('visibilitychange', this.onVisibilityChange);
		window.addEventListener('pagehide', this.onPageHide);
		void this.reconcilePendingModelCachePurge().catch((error) => {
			console.error('Failed to reconcile pending model cache purge:', error);
		});
	}

	private clearInactivityTimer(): void {
		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
			this.inactivityTimer = null;
		}
	}

	private scheduleInactivityEviction(): void {
		this.clearInactivityTimer();

		if (!this.loadedModelId) {
			return;
		}

		const lastActivityAt = this.lastModelActivityAt ?? Date.now();
		const remainingMs = Math.max(0, MODEL_IDLE_EVICTION_MS - (Date.now() - lastActivityAt));
		this.inactivityTimer = globalThis.setTimeout(() => {
			void this.evictModelIfIdle().catch((error) => {
				console.error('Failed to evict idle model artifacts:', error);
			});
		}, remainingMs);
	}

	private noteModelActivity(): void {
		if (!this.loadedModelId) {
			return;
		}

		this.lastModelActivityAt = Date.now();
		this.scheduleInactivityEviction();
	}

	private async syncLoadedModelStatus(loadedModelId: string | null): Promise<void> {
		const { modelsStore } = await import('$lib/stores/models.svelte');
		modelsStore.syncLoadedModelStatus(loadedModelId);
	}

	private async reconcilePendingModelCachePurge(): Promise<void> {
		const pendingPurge = readPendingModelCachePurge();
		if (!pendingPurge) {
			return;
		}

		try {
			await purgeCachedModelArtifactsForModelId(pendingPurge.modelId);
		} finally {
			clearPendingModelCachePurge();
			this.loadedModelId = null;
			this.lastModelActivityAt = null;
			modelStateStore.setRuntimeInfo(null);
			await modelStateStore.setLoadState('idle');
			await this.syncLoadedModelStatus(null);
		}
	}

	private async evictModelIfIdle(): Promise<void> {
		if (!this.loadedModelId) {
			this.clearInactivityTimer();
			return;
		}

		if (this.isGenerating || this.loadPromise) {
			this.lastModelActivityAt = Date.now();
			this.scheduleInactivityEviction();
			return;
		}

		const lastActivityAt = this.lastModelActivityAt ?? Date.now();
		if (Date.now() - lastActivityAt < MODEL_IDLE_EVICTION_MS) {
			this.scheduleInactivityEviction();
			return;
		}

		await this.evictLoadedModel({ purgeDownloads: true });
	}

	private async evictLoadedModel(options: { purgeDownloads: boolean }): Promise<void> {
		const modelId = this.loadedModelId;
		if (!modelId) {
			return;
		}

		if (this.activeEviction) {
			return this.activeEviction;
		}

		const eviction = (async () => {
			this.clearInactivityTimer();

			try {
				await this.backend?.unload();
			} finally {
				this.loadedModelId = null;
				this.lastModelActivityAt = null;
				modelStateStore.setRuntimeInfo(null);
				await modelStateStore.setLoadState('idle');
				await this.syncLoadedModelStatus(null);

				if (options.purgeDownloads) {
					await purgeCachedModelArtifactsForModelId(modelId);
				}

				clearPendingModelCachePurge();
			}
		})();

		this.activeEviction = eviction;

		try {
			await eviction;
		} finally {
			if (this.activeEviction === eviction) {
				this.activeEviction = null;
			}
		}
	}

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
		assistantMessageId: string,
		outputTokensUsed: number,
		outputTokensMax: number,
		contextTotal: number,
		sampling: SamplingConfig,
		elapsedMs: number
	): void {
		this.activeProcessingOwner = {
			conversationId,
			messageId: assistantMessageId
		};
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

	private setPreparingState(
		conversationId: string,
		assistantMessageId: string,
		outputTokensUsed: number,
		outputTokensMax: number,
		contextTotal: number,
		sampling: SamplingConfig
	): void {
		this.activeProcessingOwner = {
			conversationId,
			messageId: assistantMessageId
		};
		this.activeProcessingState = {
			status: 'preparing',
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
			tokensPerSecond: undefined,
			speculative: false
		} as ApiProcessingState;
	}

	private getNowMs(): number {
		return typeof performance !== 'undefined' ? performance.now() : Date.now();
	}

	private clearGenerationState(): void {
		this.activeProcessingState = null;
		this.activeProcessingOwner = {
			conversationId: null,
			messageId: null
		};
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

	setBackend(backend: InferenceBackend, runtimeKind: RuntimeKind = 'onnx-webgpu'): void {
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
				this.noteModelActivity();
				modelStateStore.setRuntimeInfo(backend.getRuntimeInfo());
				await modelStateStore.setLoadState('ready');
				await this.syncLoadedModelStatus(model.id);
			} catch (error) {
				this.loadedModelId = null;
				this.clearInactivityTimer();
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

		await this.evictLoadedModel({ purgeDownloads: false });
	}

	private async persistAgenticToolCall(
		assistantMessage: DatabaseMessage,
		toolCall: ApiChatCompletionToolCall,
		modelId: string
	): Promise<void> {
		const serializedToolCalls = JSON.stringify([toolCall]);

		await conversationsStore.persistMessage(assistantMessage.id, {
			content: assistantMessage.content,
			status: 'done',
			error: undefined,
			model: modelId,
			toolCalls: serializedToolCalls
		});

		assistantMessage.toolCalls = serializedToolCalls;
		assistantMessage.status = 'done';
		assistantMessage.model = modelId;
	}

	private async createAgenticToolResultMessage(
		conversationId: string,
		assistantMessage: DatabaseMessage,
		toolCallId: string,
		content: string,
		modelId: string,
		isError = false
	): Promise<DatabaseMessage> {
		const toolMessage = (await DatabaseService.createMessageBranch(
			{
				convId: conversationId,
				type: MessageType.TEXT,
				timestamp: Date.now(),
				role: MessageRole.TOOL,
				content,
				status: isError ? 'error' : 'done',
				model: modelId,
				toolCallId,
				toolCalls: ''
			},
			assistantMessage.id
		)) as DatabaseMessage;

		conversationsStore.addMessageToActive(toolMessage);
		await conversationsStore.updateCurrentNode(toolMessage.id);
		return toolMessage;
	}

	private async createAgenticAssistantMessage(
		conversationId: string,
		parentId: string,
		modelId: string
	): Promise<DatabaseMessage> {
		const assistantMessage = (await DatabaseService.createMessageBranch(
			{
				convId: conversationId,
				type: MessageType.TEXT,
				timestamp: Date.now() + 1,
				role: MessageRole.ASSISTANT,
				content: '',
				status: 'streaming',
				model: modelId,
				toolCalls: ''
			},
			parentId
		)) as DatabaseMessage;

		conversationsStore.addMessageToActive(assistantMessage);
		await conversationsStore.updateCurrentNode(assistantMessage.id);
		return assistantMessage;
	}

	private async finalizeAgenticAssistantMessage(
		assistantMessage: DatabaseMessage,
		content: string,
		modelId: string,
		status: DatabaseMessage['status'] = 'done',
		error?: string
	): Promise<void> {
		await conversationsStore.persistMessage(assistantMessage.id, {
			content,
			status,
			error,
			model: modelId
		});

		assistantMessage.content = content;
		assistantMessage.status = status;
		assistantMessage.error = error;
		assistantMessage.model = modelId;
	}

	private async completeWithForcedSqlQuery(
		backend: InferenceBackend,
		conversationId: string,
		messages: InferenceMessage[],
		sampling: SamplingConfig,
		options: InferenceCompletionOptions,
		toolNames: string[],
		flowState: AgenticFlowState,
		modelId: string,
		perChatOverrides = conversationsStore.getAllMcpServerOverrides()
	): Promise<AgenticFlowResult | null> {
		const sqlQueryToolName = findToolName(toolNames, 'sql_query');
		if (!sqlQueryToolName) {
			return null;
		}

		const schemaOverviewToolName = findToolName(toolNames, 'schema_overview');
		const plannerSampling = createAgenticPlanningSampling(sampling);
		const plannerOptions = {
			...options,
			nPredict: resolveAgenticPredictTokens(options.nPredict)
		};
		const sqlPlanningContext = [...messages];

		if (schemaOverviewToolName) {
			throwIfAborted(options.abortSignal);
			const schemaOverviewResult = await mcpStore.callTool(
				schemaOverviewToolName,
				{},
				perChatOverrides
			);

			if (!schemaOverviewResult.isError) {
				sqlPlanningContext.push({
					role: 'user',
					content: buildToolResultContext(schemaOverviewToolName, schemaOverviewResult)
				});
			}
		}

		let workingMessages = prependSystemInstruction(sqlPlanningContext, SQL_QUERY_PLAN_PROMPT);
		let lastToolErrorContent = '';
		let hasExecutedVisibleTool = false;

		for (let attempt = 0; attempt < 3; attempt += 1) {
			throwIfAborted(options.abortSignal);

			const sqlPlanResponse = await backend.complete(workingMessages, plannerSampling, {}, plannerOptions);
			const sqlArguments = parseSqlQueryArguments(sqlPlanResponse);

			if (!sqlArguments) {
				workingMessages = [
					...workingMessages,
					{
						role: 'system',
						content:
							'Your previous response was invalid. Return only JSON for sql_query using {"sql":"SELECT ...","max_rows":200}.'
					}
				];
				continue;
			}

			const toolCall = createToolCallPayload(sqlQueryToolName, sqlArguments);
			await this.persistAgenticToolCall(flowState.currentAssistantMessage, toolCall, modelId);

			const sqlResult = await mcpStore.callTool(sqlQueryToolName, sqlArguments, perChatOverrides);
			hasExecutedVisibleTool = true;
			const toolResultMessage = await this.createAgenticToolResultMessage(
				conversationId,
				flowState.currentAssistantMessage,
				toolCall.id ?? createToolCallId(),
				sqlResult.content,
				modelId,
				sqlResult.isError
			);
			if (sqlResult.isError) {
				lastToolErrorContent = sqlResult.content;
				flowState.currentAssistantMessage = await this.createAgenticAssistantMessage(
					conversationId,
					toolResultMessage.id,
					modelId
				);
				workingMessages = [
					...workingMessages,
					{
						role: 'assistant',
						content: JSON.stringify(sqlArguments, null, 2)
					},
					{
						role: 'user',
						content: buildToolResultContext(sqlQueryToolName, sqlResult)
					},
					{
						role: 'system',
						content: SQL_QUERY_REPAIR_PROMPT
					}
				];
				continue;
			}

			flowState.currentAssistantMessage = await this.createAgenticAssistantMessage(
				conversationId,
				toolResultMessage.id,
				modelId
			);

			throwIfAborted(options.abortSignal);

			const answerResponse = await backend.complete(
				prependSystemInstruction(
					[
						...messages,
						{
							role: 'user',
							content: buildToolResultContext(sqlQueryToolName, sqlResult)
						}
					],
					SQL_QUERY_ANSWER_PROMPT
				),
				sampling,
				{},
				options
			);

			const answerDecision = parseMcpAgenticDecision(answerResponse);
			const response =
				answerDecision?.mode === 'answer'
					? answerDecision.answer.trim()
					: answerResponse.trim();

			await this.finalizeAgenticAssistantMessage(
				flowState.currentAssistantMessage,
				response,
				modelId
			);
			return {
				finalAssistantMessage: flowState.currentAssistantMessage,
				response
			};
		}

		if (hasExecutedVisibleTool) {
			const response =
				lastToolErrorContent.trim() || 'The sql_query MCP tool could not complete successfully.';
			await this.finalizeAgenticAssistantMessage(
				flowState.currentAssistantMessage,
				response,
				modelId,
				'error',
				response
			);
			return {
				finalAssistantMessage: flowState.currentAssistantMessage,
				response
			};
		}

		return null;
	}

	private async completeWithMcpTools(
		backend: InferenceBackend,
		conversationId: string,
		messages: InferenceMessage[],
		sampling: SamplingConfig,
		options: InferenceCompletionOptions,
		flowState: AgenticFlowState,
		modelId: string,
		perChatOverrides = conversationsStore.getAllMcpServerOverrides()
	): Promise<AgenticFlowResult> {
		const toolDefinitions = mcpStore.getOpenAIToolDefinitions(perChatOverrides);
		if (toolDefinitions.length === 0) {
			const response = await backend.complete(messages, sampling, {}, options);
			await this.finalizeAgenticAssistantMessage(
				flowState.currentAssistantMessage,
				response,
				modelId
			);
			return {
				finalAssistantMessage: flowState.currentAssistantMessage,
				response
			};
		}

		const plannerPrompt = buildMcpAgenticSystemPrompt(
			toolDefinitions,
			mcpStore.getAgenticInstructions(perChatOverrides)
		);
		let workingMessages = prependSystemInstruction(messages, plannerPrompt);
		const availableToolNames = toolDefinitions.map((tool) => tool.function.name);
		const mustUseSqlQuery = requiresLiveSqlQuery(messages, availableToolNames);
		const plannerSampling = createAgenticPlanningSampling(sampling);
		const plannerOptions = {
			...options,
			nPredict: resolveAgenticPredictTokens(options.nPredict)
		};
		let executedToolNames: string[] = [];
		let invalidPlannerResponses = 0;
		const configuredMaxTurns = Number(config().agenticMaxTurns);
		const maxTurns = Number.isFinite(configuredMaxTurns)
			? Math.max(1, Math.floor(configuredMaxTurns))
			: 10;

		if (mustUseSqlQuery) {
			const forcedSqlResponse = await this.completeWithForcedSqlQuery(
				backend,
				conversationId,
				messages,
				sampling,
				options,
				availableToolNames,
				flowState,
				modelId,
				perChatOverrides
			);
			if (forcedSqlResponse) {
				return forcedSqlResponse;
			}
		}

		for (let turn = 0; turn < maxTurns; turn += 1) {
			throwIfAborted(options.abortSignal);

			const plannerResponse = await backend.complete(
				workingMessages,
				plannerSampling,
				{},
				plannerOptions
			);
			const decision = parseMcpAgenticDecision(plannerResponse);

			if (!decision) {
				invalidPlannerResponses += 1;
				if (invalidPlannerResponses >= 2) {
					const response = plannerResponse.trim();
					await this.finalizeAgenticAssistantMessage(
						flowState.currentAssistantMessage,
						response,
						modelId
					);
					return {
						finalAssistantMessage: flowState.currentAssistantMessage,
						response
					};
				}

				workingMessages = [
					...workingMessages,
					{
						role: 'system',
						content: INVALID_MCP_PLANNER_RESPONSE
					}
				];
				continue;
			}
			invalidPlannerResponses = 0;

			if (decision.mode === 'answer') {
				if (
					mustUseSqlQuery &&
					!executedToolNames.some(
						(toolName) => toolName === 'sql_query' || toolName.endsWith('__sql_query')
					)
				) {
					workingMessages = [
						...workingMessages,
						{
							role: 'system',
							content:
								'The user asked for a live database count or aggregate. You must call sql_query before answering.'
						}
					];
					continue;
				}

				const response = decision.answer.trim();
				await this.finalizeAgenticAssistantMessage(
					flowState.currentAssistantMessage,
					response,
					modelId
				);
				return {
					finalAssistantMessage: flowState.currentAssistantMessage,
					response
				};
			}

			const toolCall = createToolCallPayload(decision.name, decision.arguments);
			await this.persistAgenticToolCall(flowState.currentAssistantMessage, toolCall, modelId);

			const toolResult = await mcpStore.callTool(
				decision.name,
				decision.arguments,
				perChatOverrides
			);
			executedToolNames = [...executedToolNames, decision.name];
			const toolResultMessage = await this.createAgenticToolResultMessage(
				conversationId,
				flowState.currentAssistantMessage,
				toolCall.id ?? createToolCallId(),
				toolResult.content,
				modelId,
				toolResult.isError
			);

			workingMessages = [
				...workingMessages,
				{
					role: 'assistant',
					content: JSON.stringify(
						{
							mode: 'tool',
							name: decision.name,
							arguments: decision.arguments
						},
						null,
						2
					)
				},
				{
					role: 'user',
					content: buildToolResultContext(decision.name, toolResult)
				}
			];

			flowState.currentAssistantMessage = await this.createAgenticAssistantMessage(
				conversationId,
				toolResultMessage.id,
				modelId
			);
		}

		throwIfAborted(options.abortSignal);

		const finalResponse = await backend.complete(
			[
				...workingMessages,
				{
					role: 'system',
					content:
						'You have reached the tool-call limit. Respond with {"mode":"answer","answer":"..."} using only the tool results already gathered.'
				}
			],
			plannerSampling,
			{},
			plannerOptions
		);
		const finalDecision = parseMcpAgenticDecision(finalResponse);

		const response =
			finalDecision?.mode === 'answer' ? finalDecision.answer.trim() : finalResponse.trim();
		await this.finalizeAgenticAssistantMessage(flowState.currentAssistantMessage, response, modelId);
		return {
			finalAssistantMessage: flowState.currentAssistantMessage,
			response
		};
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
		if (outputTokenCount > 0) {
			this.setGenerationState(
				conversationId,
				assistantMessage.id,
				outputTokenCount,
				model.defaultSampling.nPredict,
				model.contextTokens,
				model.defaultSampling.sampling,
				0
			);
		} else {
			this.setPreparingState(
				conversationId,
				assistantMessage.id,
				outputTokenCount,
				model.defaultSampling.nPredict,
				model.contextTokens,
				model.defaultSampling.sampling
			);
		}
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
			if (outputTokenCount > 0) {
				this.setGenerationState(
					conversationId,
					assistantMessage.id,
					outputTokenCount,
					model.defaultSampling.nPredict,
					model.contextTokens,
					model.defaultSampling.sampling,
					this.getNowMs() - generationStartedAt
				);
			} else {
				this.setPreparingState(
					conversationId,
					assistantMessage.id,
					outputTokenCount,
					model.defaultSampling.nPredict,
					model.contextTokens,
					model.defaultSampling.sampling
				);
			}
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

		const agenticFlowState: AgenticFlowState = {
			currentAssistantMessage: assistantMessage
		};
		let shouldUseMcpTools = false;

		try {
			await this.ensureLoaded();

			const backend = await this.getBackend(model.runtimeKind);
			const messages = conversationsStore.getInferenceMessages();
			const perChatOverrides = conversationsStore.getAllMcpServerOverrides();
			const hasMcpServers = mcpStore.hasEnabledServers(perChatOverrides);
			const hasInitializedMcp = hasMcpServers
				? await mcpStore.ensureInitialized(perChatOverrides)
				: false;
			shouldUseMcpTools =
				hasInitializedMcp && mcpStore.getOpenAIToolDefinitions(perChatOverrides).length > 0;
			if (shouldUseMcpTools) {
				const agenticResult = await this.completeWithMcpTools(
					backend,
					conversationId,
					messages,
					model.defaultSampling.sampling,
					{
						abortSignal: this.abortController.signal,
						nPredict: model.defaultSampling.nPredict
					},
					agenticFlowState,
					model.id,
					perChatOverrides
				);

				cancelScheduledFlush();
				this.lastResponse = agenticResult.response;
				this.currentResponse = agenticResult.response;
				outputTokenCount = estimateDisplayedTokenCount(agenticResult.response);
				this.clearGenerationState();
			} else {
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
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'The browser runtime stopped unexpectedly.';
			const status = this.abortController.signal.aborted ? 'aborted' : 'error';
			const parsedResponse = splitLeadingThinkBlock(this.lastResponse);

			await conversationsStore.persistMessage(agenticFlowState.currentAssistantMessage.id, {
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
				this.noteModelActivity();
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

			if (!hadActiveConversation) {
				this.isPreparingNewChat = true;

				try {
					await this.ensureLoaded();
				} finally {
					this.isPreparingNewChat = false;
				}
			}

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
				await goto(resolve('/chat/[id]', { id: conversation.id }));
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
		if (
			this.activeProcessingOwner.conversationId === conversationId ||
			this.loadingChats.has(conversationId)
		) {
			this.stopGeneration();
		}
	}

	syncLoadingStateForChat(_conversationId: string): void {
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

	resetForHomeNavigation(): void {
		this.stopGeneration();
		this.pendingCompletion = null;
		this.loadingChats = new SvelteSet();
		this.isGenerating = false;
		this.isPreparingNewChat = false;
		this.clearEditMode();
		this.clearPendingEditMessageId();
		this.clearGenerationState();
		this.currentResponse = '';
		this.lastResponse = '';
	}

	setActiveProcessingConversation(_conversationId: string | null): void {
	}

	clearProcessingState(conversationId: string): void {
		if (this.activeProcessingOwner.conversationId === conversationId) {
			this.clearGenerationState();
		}
	}

	restoreProcessingStateFromMessages(_messages: DatabaseMessage[], conversationId: string): void {
		if (!this.isGenerating && this.activeProcessingOwner.conversationId === conversationId) {
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
		const conversation = conversationsStore.activeConversation;
		if (!conversation) return;

		await DatabaseService.updateMessage(messageId, {
			content: newContent,
			extra: newExtras
		});

		conversationsStore.patchMessageLocally(messageId, {
			content: newContent,
			extra: newExtras
		});

		const allMessages = await conversationsStore.getConversationMessages(conversation.id);
		const rootMessage = allMessages.find((message) => message.type === 'root' && message.parent === null);
		const targetMessage = findMessageById(allMessages, messageId);

		if (rootMessage && targetMessage?.parent === rootMessage.id && newContent.trim()) {
			await conversationsStore.updateConversationTitleWithConfirmation(
				conversation.id,
				trimConversationTitle(newContent)
			);
		}

		conversationsStore.updateConversationTimestamp();
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
			currNode: assistantMessage.id
		});

		const allMessages = await conversationsStore.getConversationMessages(conversation.id);
		const rootMessage = allMessages.find((entry) => entry.type === 'root' && entry.parent === null);
		if (rootMessage && message.parent === rootMessage.id && newContent.trim()) {
			await conversationsStore.updateConversationTitleWithConfirmation(
				conversation.id,
				trimConversationTitle(newContent)
			);
		}

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
		let conversation = conversationsStore.activeConversation;
		if (!conversation) {
			conversation = await conversationsStore.createConversationForModel(model);
		}
		if (!conversation) return;

		try {
			const allMessages = await conversationsStore.getConversationMessages(conversation.id);
			const rootMessage = allMessages.find((message) => message.type === 'root' && message.parent === null);
			const rootId = rootMessage?.id ?? (await DatabaseService.createRootMessage(conversation.id));
			const previousLeafId = conversation.currNode ?? rootId;
			const existingSystemMessage = allMessages.find(
				(message) => message.role === MessageRole.SYSTEM && message.parent === rootId
			);

			if (existingSystemMessage) {
				this.pendingEditMessageId = existingSystemMessage.id;
				return;
			}

			const firstActiveMessage = conversationsStore.activeMessages.find(
				(message) => message.parent === rootId
			);
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
				rootId
			);

			if (firstActiveMessage) {
				await DatabaseService.updateMessage(firstActiveMessage.id, { parent: systemMessage.id });
				await DatabaseService.updateMessage(systemMessage.id, {
					children: [firstActiveMessage.id]
				});

				const rootChildren = (rootMessage?.children ?? []).filter(
					(id: string) => id !== firstActiveMessage.id
				);
				await DatabaseService.updateMessage(rootId, {
					children: [
						...rootChildren.filter((id: string) => id !== systemMessage.id),
						systemMessage.id
					]
				});

				const firstMessageIndex = conversationsStore.findMessageIndex(firstActiveMessage.id);
				if (firstMessageIndex !== -1) {
					conversationsStore.updateMessageAtIndex(firstMessageIndex, {
						parent: systemMessage.id
					});
				}

				await conversationsStore.updateCurrentNode(previousLeafId);
			} else {
				await conversationsStore.updateCurrentNode(systemMessage.id);
			}

			conversationsStore.activeConversationMessages = [
				systemMessage,
				...conversationsStore.activeConversationMessages
			];
			conversationsStore.updateConversationTimestamp();
			this.pendingEditMessageId = systemMessage.id;
		} catch (error) {
			console.error('Failed to add system prompt:', error);
		}
	}

	async removeSystemPromptPlaceholder(messageId: string): Promise<boolean> {
		const conversation = conversationsStore.activeConversation;
		if (!conversation) return false;

		try {
			const allMessages = await conversationsStore.getConversationMessages(conversation.id);
			const systemMessage = findMessageById(allMessages, messageId);
			if (!systemMessage || systemMessage.role !== MessageRole.SYSTEM) {
				return false;
			}

			const rootMessage = allMessages.find((message) => message.type === 'root' && message.parent === null);
			if (!rootMessage) {
				return false;
			}

			if (allMessages.length === 2 && systemMessage.children.length === 0) {
				await conversationsStore.deleteConversation(conversation.id);
				return true;
			}

			for (const childId of systemMessage.children) {
				await DatabaseService.updateMessage(childId, { parent: rootMessage.id });
				const childIndex = conversationsStore.findMessageIndex(childId);
				if (childIndex !== -1) {
					conversationsStore.updateMessageAtIndex(childIndex, { parent: rootMessage.id });
				}
			}

			await DatabaseService.updateMessage(rootMessage.id, {
					children: [
						...rootMessage.children.filter((childId: string) => childId !== messageId),
						...systemMessage.children
					]
				});
			await DatabaseService.deleteMessage(messageId);
			await conversationsStore.loadConversation(conversation.id);
			conversationsStore.updateConversationTimestamp();
			return false;
		} catch (error) {
			console.error('Failed to remove system prompt placeholder:', error);
			return false;
		}
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

	isConversationLoading(conversationId: string | null | undefined): boolean {
		if (!conversationId) {
			return false;
		}

		return this.loadingChats.has(conversationId);
	}

	getProcessingStateFor(scope?: ProcessingStateScope): ApiProcessingState | null {
		return matchesProcessingStateOwner(this.activeProcessingOwner, scope)
			? this.activeProcessingState
			: null;
	}
}

export const chatStore = new ChatStore();

export const errorDialog = () => chatStore.errorDialogState;
export const isLoading = () => chatStore.isGenerating;
export const isChatStreaming = () => chatStore.isGenerating;
export const isPreparingNewChat = () => chatStore.isPreparingNewChat;
export const isEditing = () => chatStore.isEditModeActive;
export const getAddFilesHandler = () => chatStore.getAddFilesHandler();
export const pendingEditMessageId = () => chatStore.pendingEditMessageId;
export const activeProcessingState = () => chatStore.activeProcessingState;
export const isConversationLoading = (conversationId: string | null | undefined) =>
	chatStore.isConversationLoading(conversationId);
export const processingStateFor = (scope?: ProcessingStateScope) => chatStore.getProcessingStateFor(scope);
export const getAllLoadingChats = () => chatStore.getAllLoadingChats();
