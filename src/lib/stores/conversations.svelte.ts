import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { MCP_DEFAULT_ENABLED_LOCALSTORAGE_KEY } from '$lib/constants';
import { DEFAULT_MODEL_ID, getModelCatalogEntry, MODEL_CATALOG } from '$lib/constants/models';
import { databaseService } from '$lib/services/database.service';
import { selectedModelId } from '$lib/stores/model-state.svelte';
import { config } from '$lib/stores/settings.svelte';
import type { ModelCatalogEntry } from '$lib/types/models';
import type { McpServerOverride } from '$lib/types/chat';
import { filterByLeafNodeId, findLeafNode } from '$lib/utils';
import { trimConversationTitle } from '$lib/utils/format';
import { appendExtrasToInferenceContent } from '$lib/utils/inference-context';

export interface ConversationTreeItem {
	conversation: DatabaseConversation;
	depth: number;
}

function cloneOverrides(overrides?: McpServerOverride[]): McpServerOverride[] {
	return overrides?.map((override) => ({ ...override })) ?? [];
}

function inferModel(modelId?: string) {
	return getModelCatalogEntry(modelId) ?? MODEL_CATALOG[0];
}

function deriveConversationTitle(content: string): string {
	const firstLineOnly = Boolean(config().titleGenerationUseFirstLine);
	const normalizedContent = firstLineOnly
		? content
				.split(/\r?\n/)
				.find((line) => line.trim().length > 0) ?? content
		: content;

	return trimConversationTitle(normalizedContent);
}

function getConfiguredSystemMessage(): string | null {
	const systemMessage = config().systemMessage?.toString().trim();
	return systemMessage ? systemMessage : null;
}

export function buildConversationTree(
	items: DatabaseConversation[] = conversationsStore.list as DatabaseConversation[]
): ConversationTreeItem[] {
	const byParent = new Map<string | undefined, DatabaseConversation[]>();
	const conversationIds = new Set(items.map((conversation) => conversation.id));

	for (const conversation of items) {
		const key = conversation.forkedFromConversationId;
		const siblings = byParent.get(key) ?? [];
		siblings.push(conversation);
		byParent.set(key, siblings);
	}

	for (const siblings of byParent.values()) {
		siblings.sort((left, right) => right.lastModified - left.lastModified);
	}

	const result: ConversationTreeItem[] = [];
	const walk = (parentId: string | undefined, depth: number) => {
		for (const conversation of byParent.get(parentId) ?? []) {
			result.push({ conversation, depth });
			walk(conversation.id, depth + 1);
		}
	};

	const rootConversations = items
		.filter(
			(conversation) =>
				!conversation.forkedFromConversationId ||
				!conversationIds.has(conversation.forkedFromConversationId)
		)
		.sort((left, right) => right.lastModified - left.lastModified);

	for (const conversation of rootConversations) {
		result.push({ conversation, depth: 0 });
		walk(conversation.id, 1);
	}

	return result;
}

class ConversationsStore {
	initialized = $state(false);
	loading = $state(false);
	list = $state<DatabaseConversation[]>([]);
	activeConversation = $state<DatabaseConversation | null>(null);
	activeConversationMessages = $state<DatabaseMessage[]>([]);
	pendingMcpServerOverrides = $state<McpServerOverride[]>(ConversationsStore.loadMcpDefaults());
	titleUpdateConfirmationCallback?:
		| ((currentTitle: string, newTitle: string) => Promise<boolean>)
		| undefined;

	private static loadMcpDefaults(): McpServerOverride[] {
		if (!browser) {
			return [];
		}

		try {
			const raw = localStorage.getItem(MCP_DEFAULT_ENABLED_LOCALSTORAGE_KEY);
			if (!raw) {
				return [];
			}

			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}

			return parsed.flatMap((entry) => {
				if (!entry || typeof entry !== 'object') {
					return [];
				}

				const candidate = entry as Partial<McpServerOverride>;
				if (typeof candidate.serverId !== 'string' || typeof candidate.enabled !== 'boolean') {
					return [];
				}

				return [
					{
						serverId: candidate.serverId,
						enabled: candidate.enabled
					}
				];
			});
		} catch {
			return [];
		}
	}

	private saveMcpDefaults(): void {
		if (!browser) {
			return;
		}

		const defaults = this.pendingMcpServerOverrides.map((override) => ({
			serverId: override.serverId,
			enabled: override.enabled
		}));

		if (defaults.length > 0) {
			localStorage.setItem(MCP_DEFAULT_ENABLED_LOCALSTORAGE_KEY, JSON.stringify(defaults));
			return;
		}

		localStorage.removeItem(MCP_DEFAULT_ENABLED_LOCALSTORAGE_KEY);
	}

	get activeMessages(): DatabaseMessage[] {
		if (!this.activeConversation?.currNode) {
			return [];
		}

		return filterByLeafNodeId(
			this.activeConversationMessages,
			this.activeConversation.currNode,
			false
		) as DatabaseMessage[];
	}

	async init(): Promise<void> {
		if (!browser || this.initialized) return;
		await this.loadConversations();
		this.initialized = true;
	}

	async initialize(): Promise<void> {
		await this.init();
	}

	async loadConversations(): Promise<void> {
		this.list = (await databaseService.getAllConversations()) as DatabaseConversation[];
	}

	async reloadConversations(): Promise<void> {
		await this.initialize();
		await this.loadConversations();
	}

	clearActiveConversation(): void {
		this.activeConversation = null;
		this.activeConversationMessages = [];
		this.pendingMcpServerOverrides = ConversationsStore.loadMcpDefaults();
	}

	setTitleUpdateConfirmationCallback(
		callback: (currentTitle: string, newTitle: string) => Promise<boolean>
	): void {
		this.titleUpdateConfirmationCallback = callback;
	}

	findMessageIndex(messageId: string): number {
		return this.activeConversationMessages.findIndex((message) => message.id === messageId);
	}

	updateMessageAtIndex(index: number, updates: Partial<DatabaseMessage>): void {
		if (index < 0 || index >= this.activeConversationMessages.length) return;
		this.activeConversationMessages[index] = {
			...this.activeConversationMessages[index],
			...updates
		};
	}

	async getConversationMessages(conversationId: string): Promise<DatabaseMessage[]> {
		return (await databaseService.getConversationMessages(conversationId)) as DatabaseMessage[];
	}

	async loadConversation(id: string): Promise<boolean> {
		await this.initialize();
		this.loading = true;

		try {
			const conversation = (await databaseService.getConversation(id)) as
				| DatabaseConversation
				| undefined;
			if (!conversation) {
				this.clearActiveConversation();
				return false;
			}

			this.activeConversation = conversation;
			this.activeConversationMessages = await this.getConversationMessages(id);

			if (conversation.modelId) {
				const { modelStateStore } = await import('$lib/stores/model-state.svelte');
				await modelStateStore.syncConversationModel(conversation.modelId);
			}

			return true;
		} finally {
			this.loading = false;
		}
	}

	private async createConversationRecord(
		name: string,
		modelId: string,
		overrides: McpServerOverride[] = [],
		forkedFromConversationId?: string
	): Promise<DatabaseConversation> {
		const model = inferModel(modelId);
		const conversation = (await databaseService.createConversation({
			name,
			modelId: model.id,
			runtimeKind: model.runtimeKind,
			samplingPresetId: model.defaultSampling.id
		})) as DatabaseConversation;

		if (overrides.length > 0 || forkedFromConversationId) {
			await databaseService.updateConversation(conversation.id, {
				mcpServerOverrides: cloneOverrides(overrides),
				forkedFromConversationId
			} as Partial<DatabaseConversation>);
		}

		await databaseService.createRootMessage(conversation.id);
		return ((await databaseService.getConversation(conversation.id)) ??
			conversation) as DatabaseConversation;
	}

	async createConversation(name?: string): Promise<string> {
		const modelId = selectedModelId() ?? DEFAULT_MODEL_ID;
		const conversation = await this.createConversationRecord(
			name || `Chat ${new Date().toLocaleString()}`,
			modelId,
			this.pendingMcpServerOverrides
		);

		this.pendingMcpServerOverrides = [];
		await this.reloadConversations();
		await this.loadConversation(conversation.id);
		await goto(resolve('/chat/[id]', { id: conversation.id }));
		return conversation.id;
	}

	async createConversationForModel(model: ModelCatalogEntry, name = 'New chat'): Promise<DatabaseConversation> {
		const conversation = await this.createConversationRecord(
			name,
			model.id,
			this.pendingMcpServerOverrides
		);

		this.pendingMcpServerOverrides = [];
		await this.reloadConversations();
		await this.loadConversation(conversation.id);
		return conversation;
	}

	async ensureConversationForModel(modelId: string): Promise<DatabaseConversation> {
		await this.initialize();
		const existing = (await databaseService.getLatestConversationForModel(modelId)) as
			| DatabaseConversation
			| undefined;
		if (existing) {
			await this.loadConversation(existing.id);
			return existing;
		}

		return this.createConversationForModel(inferModel(modelId));
	}

	private async maybeCreateConfiguredSystemMessage(
		conversation: DatabaseConversation
	): Promise<DatabaseMessage | null> {
		const systemPrompt = getConfiguredSystemMessage();
		if (!systemPrompt) {
			return null;
		}

		const messages = await this.getConversationMessages(conversation.id);
		const rootMessage = messages.find((message) => message.type === 'root' && message.parent === null);
		if (!rootMessage) {
			return null;
		}

		const hasConversationMessages = messages.some((message) => message.id !== rootMessage.id);
		if (hasConversationMessages) {
			return null;
		}

		return (await databaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: 'system',
				timestamp: Date.now(),
				role: 'system',
				content: systemPrompt,
				status: 'done',
				model: conversation.modelId
			},
			rootMessage.id
		)) as DatabaseMessage;
	}

	async createTurn(
		prompt: string,
		model: ModelCatalogEntry,
		extras?: DatabaseMessageExtra[]
	): Promise<{
		conversation: DatabaseConversation;
		userMessage: DatabaseMessage;
		assistantMessage: DatabaseMessage;
	}> {
		const conversation =
			this.activeConversation ?? (await this.createConversationForModel(model));
		let parentId = conversation.currNode;

		if (!parentId) {
			throw new Error('The active conversation is missing its root node.');
		}

		const systemMessage = await this.maybeCreateConfiguredSystemMessage(conversation);
		if (systemMessage) {
			parentId = systemMessage.id;
		}

		const userMessage = (await databaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: 'text',
				timestamp: Date.now(),
				role: 'user',
				content: prompt,
				status: 'done',
				model: model.id,
				extra: extras
			},
			parentId
		)) as DatabaseMessage;

		const assistantMessage = (await databaseService.createMessageBranch(
			{
				convId: conversation.id,
				type: 'text',
				timestamp: Date.now() + 1,
				role: 'assistant',
				content: '',
				status: 'streaming',
				model: model.id
			},
			userMessage.id
		)) as DatabaseMessage;

		if (conversation.name === 'New chat') {
			await databaseService.updateConversation(conversation.id, {
				name: deriveConversationTitle(prompt)
			});
		}

		await this.reloadConversations();
		await this.loadConversation(conversation.id);

		return {
			conversation: (await databaseService.getConversation(conversation.id)) as DatabaseConversation,
			userMessage,
			assistantMessage
		};
	}

	getInferenceMessages(): { role: 'system' | 'user' | 'assistant'; content: string }[] {
		return this.activeMessages
			.filter((message) => message.type !== 'root')
			.filter((message) => !(message.role === 'assistant' && !message.content.trim()))
			.filter((message) => message.role !== 'tool')
			.map((message) => ({
				role: message.role as 'system' | 'user' | 'assistant',
				content: appendExtrasToInferenceContent(message.content, message.extra)
			}));
	}

	patchMessageLocally(messageId: string, updates: Partial<Omit<DatabaseMessage, 'id'>>): void {
		this.activeConversationMessages = this.activeConversationMessages.map((message) =>
			message.id === messageId ? { ...message, ...updates } : message
		);
	}

	addMessageToActive(message: DatabaseMessage): void {
		const parentId = message.parent ?? null;
		const nextMessages = this.activeConversationMessages.map((entry) =>
			entry.id === parentId && !entry.children.includes(message.id)
				? { ...entry, children: [...entry.children, message.id] }
				: entry
		);

		nextMessages.push(message);
		nextMessages.sort((left, right) => left.timestamp - right.timestamp);
		this.activeConversationMessages = nextMessages;
	}

	async updateCurrentNode(messageId: string): Promise<void> {
		if (!this.activeConversation) {
			return;
		}

		this.activeConversation.currNode = messageId;
		await databaseService.updateConversation(this.activeConversation.id, {
			currNode: messageId
		});
	}

	async persistMessage(
		messageId: string,
		updates: Partial<Omit<DatabaseMessage, 'id'>>
	): Promise<void> {
		await databaseService.updateMessage(messageId, updates);
		this.patchMessageLocally(messageId, updates);
	}

	async updateConversationName(id: string, name: string): Promise<void> {
		await databaseService.updateConversation(id, {
			name: trimConversationTitle(name)
		});
		await this.reloadConversations();
		if (this.activeConversation?.id === id) {
			await this.loadConversation(id);
		}
	}

	async updateConversationTitleWithConfirmation(
		id: string,
		newTitle: string
	): Promise<boolean> {
		const trimmedTitle = trimConversationTitle(newTitle);
		if (!trimmedTitle) {
			return false;
		}

		if (config().askForTitleConfirmation && this.titleUpdateConfirmationCallback) {
			const conversation = (await databaseService.getConversation(id)) as
				| DatabaseConversation
				| undefined;
			if (!conversation) {
				return false;
			}

			const shouldUpdate = await this.titleUpdateConfirmationCallback(
				conversation.name,
				trimmedTitle
			);
			if (!shouldUpdate) {
				return false;
			}
		}

		await this.updateConversationName(id, trimmedTitle);
		return true;
	}

	updateConversationTimestamp(): void {
		if (!this.activeConversation) {
			return;
		}

		const nextTimestamp = Date.now();
		this.activeConversation.lastModified = nextTimestamp;
		this.list = this.list
			.map((conversation) =>
				conversation.id === this.activeConversation?.id
					? {
							...conversation,
							lastModified: nextTimestamp
						}
					: conversation
			)
			.sort((left, right) => right.lastModified - left.lastModified);
	}

	async deleteConversation(
		id: string,
		options?: {
			deleteWithForks?: boolean;
		}
	): Promise<void> {
		const idsToDelete = new Set<string>([id]);
		if (options?.deleteWithForks) {
			const queue = [id];
			while (queue.length > 0) {
				const parentId = queue.shift()!;
				for (const conversation of this.list) {
					if (
						conversation.forkedFromConversationId === parentId &&
						!idsToDelete.has(conversation.id)
					) {
						idsToDelete.add(conversation.id);
						queue.push(conversation.id);
					}
				}
			}
		}

		await databaseService.deleteConversation(id, options);
		await this.reloadConversations();

		if (this.activeConversation && idsToDelete.has(this.activeConversation.id)) {
			this.clearActiveConversation();
			await goto(resolve('/'));
		} else if (this.activeConversation) {
			await this.loadConversation(this.activeConversation.id);
		}
	}

	async navigateToSibling(siblingId: string): Promise<void> {
		if (!this.activeConversation) return;

		const previousRootMessage = this.activeConversationMessages.find(
			(message) => message.type === 'root' && message.parent === null
		);
		const previousFirstUserMessage = previousRootMessage
			? this.activeConversationMessages.find(
					(message) => message.role === 'user' && message.parent === previousRootMessage.id
				)
			: undefined;

		await databaseService.updateConversation(this.activeConversation.id, {
			currNode: findLeafNode(this.activeConversationMessages, siblingId)
		});

		await this.loadConversation(this.activeConversation.id);

		const nextRootMessage = this.activeConversationMessages.find(
			(message) => message.type === 'root' && message.parent === null
		);
		const nextFirstUserMessage = nextRootMessage
			? this.activeConversationMessages.find(
					(message) => message.role === 'user' && message.parent === nextRootMessage.id
				)
			: undefined;

		if (
			nextFirstUserMessage &&
			nextFirstUserMessage.content.trim() &&
			(!previousFirstUserMessage ||
				nextFirstUserMessage.id !== previousFirstUserMessage.id ||
				nextFirstUserMessage.content.trim() !== previousFirstUserMessage.content.trim())
		) {
			await this.updateConversationTitleWithConfirmation(
				this.activeConversation.id,
				deriveConversationTitle(nextFirstUserMessage.content)
			);
		}
	}

	async forkConversation(
		messageId: string,
		options: { name: string; includeAttachments: boolean }
	): Promise<void> {
		if (!this.activeConversation) return;

		const path = filterByLeafNodeId(this.activeConversationMessages, messageId, true).filter(
			(message) => message.type !== 'root'
		) as DatabaseMessage[];

		const forkedConversation = await this.createConversationRecord(
			options.name.trim() || `${this.activeConversation.name} fork`,
			this.activeConversation.modelId || DEFAULT_MODEL_ID,
			cloneOverrides(this.activeConversation.mcpServerOverrides),
			this.activeConversation.id
		);

		const forkRoot = (await databaseService.getConversation(forkedConversation.id))?.currNode;
		let parentId = forkRoot ?? null;

		for (const message of path) {
			const cloned = await databaseService.createMessageBranch(
				{
					convId: forkedConversation.id,
					type: message.type,
					timestamp: Date.now(),
					role: message.role,
					content: message.content,
					status: message.status,
					model: message.model,
					toolCalls: message.toolCalls,
					toolCallId: message.toolCallId,
					extra: options.includeAttachments ? message.extra : undefined,
					timings: message.timings
				},
				parentId
			);

			parentId = cloned.id;
		}

		await this.reloadConversations();
		await this.loadConversation(forkedConversation.id);
		await goto(resolve('/chat/[id]', { id: forkedConversation.id }));
	}

	getAllMcpServerOverrides(): McpServerOverride[] {
		return cloneOverrides(
			this.activeConversation?.mcpServerOverrides ?? this.pendingMcpServerOverrides
		);
	}

	isMcpServerEnabledForChat(serverId: string): boolean {
		return this.getAllMcpServerOverrides().some(
			(override) => override.serverId === serverId && override.enabled
		);
	}

	private setPendingMcpServerOverride(
		serverId: string,
		enabled: boolean | undefined
	): void {
		if (enabled === undefined) {
			this.pendingMcpServerOverrides = this.pendingMcpServerOverrides.filter(
				(override) => override.serverId !== serverId
			);
		} else {
			const overrides = this.pendingMcpServerOverrides.filter(
				(override) => override.serverId !== serverId
			);
			overrides.push({ serverId, enabled });
			this.pendingMcpServerOverrides = overrides;
		}

		this.saveMcpDefaults();
	}

	setMcpServerOverride(serverId: string, enabled: boolean | undefined): void {
		const target = this.activeConversation ?? null;
		if (!target) {
			this.setPendingMcpServerOverride(serverId, enabled);
			return;
		}

		const overrides = this.getAllMcpServerOverrides().filter(
			(override) => override.serverId !== serverId
		);
		if (enabled !== undefined) {
			overrides.push({ serverId, enabled });
		}

		target.mcpServerOverrides = overrides.length > 0 ? overrides : undefined;
		this.list = this.list.map((conversation) =>
			conversation.id === target.id
				? {
						...conversation,
						mcpServerOverrides: target.mcpServerOverrides
					}
				: conversation
		);
		void databaseService.updateConversation(target.id, {
			mcpServerOverrides: target.mcpServerOverrides
		} as Partial<DatabaseConversation>);
	}

	async toggleMcpServerForChat(serverId: string): Promise<void> {
		this.setMcpServerOverride(serverId, !this.isMcpServerEnabledForChat(serverId));
	}

	async downloadConversation(conversationId: string): Promise<void> {
		const conversation = (await databaseService.getConversation(conversationId)) as
			| DatabaseConversation
			| undefined;
		if (!conversation) return;

		const messages = await this.getConversationMessages(conversationId);
		this.downloadConversationFile(
			{ conv: conversation, messages },
			`${conversation.name || 'conversation'}.json`
		);
	}

	downloadConversationFile(exported: ExportedConversations, filename: string): void {
		if (!browser) return;

		const blob = new Blob([JSON.stringify(exported, null, 2)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	async importConversationsData(data: ExportedConversations): Promise<void> {
		const conversations = Array.isArray(data) ? data : [data];
		await databaseService.importConversations(conversations);
		await this.reloadConversations();
	}

	async deleteAll(): Promise<void> {
		const conversations = await databaseService.getAllConversations();
		for (const conversation of conversations) {
			await databaseService.deleteConversation(conversation.id);
		}

		await this.reloadConversations();
		this.clearActiveConversation();
	}
}

export const conversationsStore = new ConversationsStore();

export const conversations = () => conversationsStore.list;
export const activeConversation = () => conversationsStore.activeConversation;
export const activeMessages = () => conversationsStore.activeMessages;
export const isConversationsInitialized = () => conversationsStore.initialized;
