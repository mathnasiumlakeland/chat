import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { DEFAULT_MODEL_ID, MODEL_CATALOG } from '$lib/constants/models';
import { databaseService } from '$lib/services/database.service';
import { selectedModelId } from '$lib/stores/model-state.svelte';
import type { ModelCatalogEntry } from '$lib/types/models';
import type { McpServerOverride } from '$lib/types/chat';
import { filterByLeafNodeId, findLeafNode } from '$lib/utils';
import { trimConversationTitle } from '$lib/utils/format';

export interface ConversationTreeItem {
	conversation: DatabaseConversation;
	depth: number;
}

function cloneOverrides(overrides?: McpServerOverride[]): McpServerOverride[] {
	return overrides?.map((override) => ({ ...override })) ?? [];
}

function inferModel(modelId?: string) {
	return MODEL_CATALOG.find((entry) => entry.id === modelId) ?? MODEL_CATALOG[0];
}

export function buildConversationTree(
	items: DatabaseConversation[] = conversationsStore.list as DatabaseConversation[]
): ConversationTreeItem[] {
	const byParent = new Map<string | undefined, DatabaseConversation[]>();

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

	walk(undefined, 0);
	return result;
}

class ConversationsStore {
	initialized = $state(false);
	loading = $state(false);
	list = $state<DatabaseConversation[]>([]);
	activeConversation = $state<DatabaseConversation | null>(null);
	activeConversationMessages = $state<DatabaseMessage[]>([]);
	pendingMcpServerOverrides = $state<McpServerOverride[]>([]);
	titleUpdateConfirmationCallback?:
		| ((currentTitle: string, newTitle: string) => Promise<boolean>)
		| undefined;

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
		const parentId = conversation.currNode;

		if (!parentId) {
			throw new Error('The active conversation is missing its root node.');
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
				name: trimConversationTitle(prompt)
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
				content: message.content
			}));
	}

	patchMessageLocally(messageId: string, updates: Partial<Omit<DatabaseMessage, 'id'>>): void {
		this.activeConversationMessages = this.activeConversationMessages.map((message) =>
			message.id === messageId ? { ...message, ...updates } : message
		);
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

	async deleteConversation(
		id: string,
		_options?: {
			deleteWithForks?: boolean;
		}
	): Promise<void> {
		await databaseService.deleteConversation(id);
		await this.reloadConversations();

		if (this.activeConversation?.id === id) {
			this.clearActiveConversation();
			await goto(resolve('/'));
		}
	}

	async navigateToSibling(siblingId: string): Promise<void> {
		if (!this.activeConversation) return;

		await databaseService.updateConversation(this.activeConversation.id, {
			currNode: siblingId
		});

		await this.loadConversation(this.activeConversation.id);
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

	setMcpServerOverride(serverId: string, enabled: boolean): void {
		const target = this.activeConversation ?? null;
		const overrides = this.getAllMcpServerOverrides().filter(
			(override) => override.serverId !== serverId
		);
		overrides.push({ serverId, enabled });

		if (target) {
			target.mcpServerOverrides = overrides;
			void databaseService.updateConversation(target.id, {
				mcpServerOverrides: overrides
			} as Partial<DatabaseConversation>);
		} else {
			this.pendingMcpServerOverrides = overrides;
		}
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

	async importConversationsData(_data: ExportedConversations): Promise<void> {
		console.warn('Conversation import is not implemented for the browser runtime yet.');
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
