import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '$lib/constants/models';
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
		const databaseName = `bonsai-browser-chat-migration-${crypto.randomUUID()}`;

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
			runtimeKind: 'gguf-wasm',
			samplingPresetId: 'balanced'
		});

		const modelState = await service.getModelState();
		expect(modelState).toEqual({
			id: 'default',
			selectedModelId: null,
			loadState: 'idle',
			lastUsedAt: null,
			lastError: null
		});

		migratedDatabase.close();
		await deleteDatabase(databaseName);
	});
});
