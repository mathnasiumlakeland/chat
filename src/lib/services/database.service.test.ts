import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID, MODEL_CATALOG } from '$lib/constants/models';
import { createDatabase, DatabaseService } from './database.service';

const databases: Dexie[] = [];

async function deleteDatabase(name: string) {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () => resolve();
	});
}

afterEach(async () => {
	while (databases.length > 0) {
		const database = databases.pop();
		database?.close();
	}
});

describe('DatabaseService migrations', () => {
	it('migrates legacy conversations and seeds model state defaults', async () => {
		const databaseName = `chat-history-migration-${crypto.randomUUID()}`;

		const legacyDatabase = new Dexie(databaseName);
		databases.push(legacyDatabase);
		legacyDatabase.version(1).stores({
			conversations: 'id, lastModified, currNode, name',
			messages: 'id, convId, type, role, timestamp, parent, children'
		});

		await legacyDatabase.open();
		await legacyDatabase.table('conversations').add({
			id: 'legacy-conversation',
			name: 'Legacy chat',
			lastModified: 1_717_171_717,
			currNode: 'message-2'
		});
		await legacyDatabase.close();

		const migratedDatabase = createDatabase(databaseName);
		databases.push(migratedDatabase);
		const service = new DatabaseService(migratedDatabase);

		const conversation = await service.getConversation('legacy-conversation');
		expect(conversation).toMatchObject({
			id: 'legacy-conversation',
			modelId: DEFAULT_MODEL_ID,
			runtimeKind: MODEL_CATALOG[0].runtimeKind,
			samplingPresetId: 'balanced'
		});

		const modelState = await service.getModelState();
		expect(modelState).toEqual({
			id: 'default',
			selectedModelId: DEFAULT_MODEL_ID,
			loadState: 'idle',
			lastUsedAt: null,
			lastError: null
		});

		migratedDatabase.close();
		await deleteDatabase(databaseName);
	});

	it('normalizes legacy model ids onto the ternary catalog during upgrade', async () => {
		const databaseName = `chat-history-normalize-${crypto.randomUUID()}`;

		const legacyDatabase = new Dexie(databaseName);
		databases.push(legacyDatabase);
		legacyDatabase.version(2).stores({
			conversations:
				'id, lastModified, currNode, name, modelId, runtimeKind, samplingPresetId',
			messages: 'id, convId, type, role, timestamp, parent, children',
			modelState: 'id, selectedModelId, loadState, lastUsedAt'
		});

		await legacyDatabase.open();
		await legacyDatabase.table('conversations').add({
			id: 'legacy-conversation',
			name: 'Legacy chat',
			lastModified: 1_717_171_717,
			currNode: 'message-2',
			modelId: 'prism-ml/Bonsai-4B-gguf',
			runtimeKind: 'gguf-wasm',
			samplingPresetId: 'balanced'
		});
		await legacyDatabase.table('messages').add({
			id: 'message-2',
			convId: 'legacy-conversation',
			type: 'text',
			role: 'assistant',
			timestamp: 1_717_171_718,
			content: 'Hi',
			parent: null,
			children: [],
			model: 'prism-ml/Bonsai-4B-gguf'
		});
		await legacyDatabase.table('modelState').put({
			id: 'default',
			selectedModelId: 'prism-ml/Bonsai-4B-gguf',
			loadState: 'ready',
			lastUsedAt: 1_717_171_719,
			lastError: null
		});
		await legacyDatabase.close();

		const migratedDatabase = createDatabase(databaseName);
		databases.push(migratedDatabase);
		const service = new DatabaseService(migratedDatabase);

		const conversation = await service.getConversation('legacy-conversation');
		expect(conversation).toMatchObject({
			modelId: 'onnx-community/Ternary-Bonsai-4B-ONNX',
			runtimeKind: MODEL_CATALOG[1].runtimeKind
		});

		const messages = await service.getConversationMessages('legacy-conversation');
		expect(messages[0]?.model).toBe('onnx-community/Ternary-Bonsai-4B-ONNX');

		const modelState = await service.getModelState();
		expect(modelState.selectedModelId).toBe('onnx-community/Ternary-Bonsai-4B-ONNX');

		migratedDatabase.close();
		await deleteDatabase(databaseName);
	});
});
