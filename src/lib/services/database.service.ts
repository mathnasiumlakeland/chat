import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_MODEL_ID, MODEL_CATALOG } from '$lib/constants/models';
import type { ConversationRecord, MessageRecord } from '$lib/types/chat';
import type { ModelStateRecord } from '$lib/types/models';
import { findDescendantMessages } from '$lib/utils/branching';
import { createId } from '$lib/utils/uuid';

const DATABASE_NAME = 'bonsai-browser-chat';
const DEFAULT_SAMPLING_PRESET_ID = MODEL_CATALOG[0].defaultSampling.id;

export class BonsaiChatDatabase extends Dexie {
	conversations!: EntityTable<ConversationRecord, 'id'>;
	messages!: EntityTable<MessageRecord, 'id'>;
	modelState!: EntityTable<ModelStateRecord, 'id'>;

	constructor(name: string = DATABASE_NAME) {
		super(name);

		this.version(1).stores({
			conversations: 'id, lastModified, currNode, name',
			messages: 'id, convId, type, role, timestamp, parent, children'
		});

		this.version(2)
			.stores({
				conversations:
					'id, lastModified, currNode, name, modelId, runtimeKind, samplingPresetId',
				messages: 'id, convId, type, role, timestamp, parent, children',
				modelState: 'id, selectedModelId, loadState, lastUsedAt'
			})
			.upgrade(async (transaction) => {
				await transaction
					.table<ConversationRecord, string>('conversations')
					.toCollection()
					.modify((conversation) => {
						conversation.modelId ??= DEFAULT_MODEL_ID;
						conversation.runtimeKind ??= 'gguf-wasm';
						conversation.samplingPresetId ??= DEFAULT_SAMPLING_PRESET_ID;
					});

				await transaction.table<ModelStateRecord, 'id'>('modelState').put({
					id: 'default',
					selectedModelId: null,
					loadState: 'idle',
					lastUsedAt: null,
					lastError: null
				});
			});
	}
}

export function createDatabase(name: string = DATABASE_NAME): BonsaiChatDatabase {
	return new BonsaiChatDatabase(name);
}

let database = createDatabase();

export async function resetDefaultDatabaseForTests(): Promise<void> {
	database.close();
	await database.delete();
	database = createDatabase();
	databaseService = new DatabaseService(database);
}

export class DatabaseService {
	constructor(private readonly db: BonsaiChatDatabase = database) {}

	async createConversation(input: {
		name: string;
		modelId: string;
		runtimeKind: ConversationRecord['runtimeKind'];
		samplingPresetId: string;
	}): Promise<ConversationRecord> {
		const conversation: ConversationRecord = {
			id: createId(),
			name: input.name,
			lastModified: Date.now(),
			currNode: null,
			modelId: input.modelId,
			runtimeKind: input.runtimeKind,
			samplingPresetId: input.samplingPresetId
		};

		await this.db.conversations.add(conversation);
		return conversation;
	}

	async createRootMessage(convId: string): Promise<string> {
		const rootMessage: MessageRecord = {
			id: createId(),
			convId,
			type: 'root',
			timestamp: Date.now(),
			role: 'system',
			content: '',
			parent: null,
			children: [],
			status: 'done'
		};

		await this.db.messages.add(rootMessage);
		await this.updateConversation(convId, {
			currNode: rootMessage.id
		});

		return rootMessage.id;
	}

	async createMessageBranch(
		message: Omit<MessageRecord, 'id' | 'children' | 'parent'>,
		parentId: string | null
	): Promise<MessageRecord> {
		return this.db.transaction('rw', [this.db.conversations, this.db.messages], async () => {
			if (parentId) {
				const parentMessage = await this.db.messages.get(parentId);
				if (!parentMessage) {
					throw new Error(`Parent message ${parentId} not found.`);
				}
			}

			const nextMessage: MessageRecord = {
				...message,
				id: createId(),
				parent: parentId,
				children: []
			};

			await this.db.messages.add(nextMessage);

			if (parentId) {
				const parentMessage = await this.db.messages.get(parentId);
				if (parentMessage) {
					await this.db.messages.update(parentId, {
						children: [...parentMessage.children, nextMessage.id]
					});
				}
			}

			await this.updateConversation(message.convId, {
				currNode: nextMessage.id
			});

			return nextMessage;
		});
	}

	async getAllConversations(): Promise<ConversationRecord[]> {
		return this.db.conversations.orderBy('lastModified').reverse().toArray();
	}

	async getConversation(id: string): Promise<ConversationRecord | undefined> {
		return this.db.conversations.get(id);
	}

	async getLatestConversationForModel(modelId: string): Promise<ConversationRecord | undefined> {
		const matches = await this.db.conversations.where('modelId').equals(modelId).toArray();
		return matches.sort((left, right) => right.lastModified - left.lastModified)[0];
	}

	async getConversationMessages(convId: string): Promise<MessageRecord[]> {
		return this.db.messages.where('convId').equals(convId).sortBy('timestamp');
	}

	async getMessage(id: string): Promise<MessageRecord | undefined> {
		return this.db.messages.get(id);
	}

	async updateConversation(
		id: string,
		updates: Partial<Omit<ConversationRecord, 'id'>>
	): Promise<void> {
		await this.db.conversations.update(id, {
			...updates,
			lastModified: Date.now()
		});
	}

	async updateMessage(id: string, updates: Partial<Omit<MessageRecord, 'id'>>): Promise<void> {
		await this.db.messages.update(id, updates);
	}

	async deleteMessage(id: string): Promise<void> {
		await this.db.transaction('rw', [this.db.messages], async () => {
			const message = await this.db.messages.get(id);
			if (!message) return;

			if (message.parent) {
				const parent = await this.db.messages.get(message.parent);
				if (parent) {
					await this.db.messages.update(parent.id, {
						children: parent.children.filter((childId) => childId !== id)
					});
				}
			}

			await this.db.messages.delete(id);
		});
	}

	async deleteConversation(id: string): Promise<void> {
		await this.db.transaction('rw', [this.db.conversations, this.db.messages], async () => {
			await this.db.conversations.delete(id);
			await this.db.messages.where('convId').equals(id).delete();
		});
	}

	async deleteMessageBranch(conversationId: string, messageId: string): Promise<void> {
		await this.db.transaction('rw', [this.db.conversations, this.db.messages], async () => {
			const messages = await this.db.messages.where('convId').equals(conversationId).toArray();
			const descendants = findDescendantMessages(messages, messageId);
			await this.db.messages.bulkDelete([messageId, ...descendants]);
		});
	}

	async deleteMessageCascading(conversationId: string, messageId: string): Promise<string[]> {
		return this.db.transaction('rw', [this.db.conversations, this.db.messages], async () => {
			const messages = await this.db.messages.where('convId').equals(conversationId).toArray();
			const descendants = findDescendantMessages(messages, messageId);
			const deletedIds = [messageId, ...descendants];
			const message = messages.find((entry) => entry.id === messageId);

			if (message?.parent) {
				const parent = await this.db.messages.get(message.parent);
				if (parent) {
					await this.db.messages.update(parent.id, {
						children: parent.children.filter((childId) => childId !== messageId)
					});
				}
			}

			await this.db.messages.bulkDelete(deletedIds);
			return deletedIds;
		});
	}

	async getModelState(): Promise<ModelStateRecord> {
		const existing = await this.db.modelState.get('default');
		if (existing) {
			return existing;
		}

		const initialState: ModelStateRecord = {
			id: 'default',
			selectedModelId: null,
			loadState: 'idle',
			lastUsedAt: null,
			lastError: null
		};

		await this.db.modelState.put(initialState);
		return initialState;
	}

	async saveModelState(record: ModelStateRecord): Promise<void> {
		await this.db.modelState.put(record);
	}

	static async createConversation(name: string): Promise<ConversationRecord> {
		return databaseService.createConversation({
			name,
			modelId: DEFAULT_MODEL_ID,
			runtimeKind: 'gguf-wasm',
			samplingPresetId: DEFAULT_SAMPLING_PRESET_ID
		});
	}

	static async createRootMessage(convId: string): Promise<string> {
		return databaseService.createRootMessage(convId);
	}

	static async createMessageBranch(
		message: Omit<MessageRecord, 'id' | 'children' | 'parent'>,
		parentId: string | null
	): Promise<MessageRecord> {
		return databaseService.createMessageBranch(message, parentId);
	}

	static async getAllConversations(): Promise<ConversationRecord[]> {
		return databaseService.getAllConversations();
	}

	static async getConversation(id: string): Promise<ConversationRecord | undefined> {
		return databaseService.getConversation(id);
	}

	static async getConversationMessages(convId: string): Promise<MessageRecord[]> {
		return databaseService.getConversationMessages(convId);
	}

	static async getMessage(id: string): Promise<MessageRecord | undefined> {
		return databaseService.getMessage(id);
	}

	static async updateConversation(
		id: string,
		updates: Partial<Omit<ConversationRecord, 'id'>>
	): Promise<void> {
		return databaseService.updateConversation(id, updates);
	}

	static async updateMessage(id: string, updates: Partial<Omit<MessageRecord, 'id'>>): Promise<void> {
		return databaseService.updateMessage(id, updates);
	}

	static async deleteConversation(id: string): Promise<void> {
		return databaseService.deleteConversation(id);
	}

	static async deleteMessage(id: string): Promise<void> {
		return databaseService.deleteMessage(id);
	}

	static async deleteMessageCascading(
		conversationId: string,
		messageId: string
	): Promise<string[]> {
		return databaseService.deleteMessageCascading(conversationId, messageId);
	}
}

export let databaseService = new DatabaseService(database);
