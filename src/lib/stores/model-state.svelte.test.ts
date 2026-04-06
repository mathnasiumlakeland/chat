import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '$lib/constants/models';
import { databaseService, resetDefaultDatabaseForTests } from '$lib/services/database.service';
import { modelStateStore } from './model-state.svelte';

const DEFAULT_RECORD = {
	id: 'default' as const,
	selectedModelId: DEFAULT_MODEL_ID,
	loadState: 'idle' as const,
	lastUsedAt: null,
	lastError: null
};

async function resetStore() {
	await resetDefaultDatabaseForTests();
	modelStateStore.initialized = false;
	modelStateStore.record = { ...DEFAULT_RECORD };
	modelStateStore.overlayOpen = false;
	modelStateStore.progress = 0;
	modelStateStore.runtimeInfo = null;
}

describe('modelStateStore', () => {
	beforeEach(async () => {
		await resetStore();
	});

	it('persists model selection to IndexedDB without cloning errors', async () => {
		await modelStateStore.initialize();
		await expect(modelStateStore.selectModel(DEFAULT_MODEL_ID)).resolves.toBeUndefined();

		const savedRecord = await databaseService.getModelState();

		expect(savedRecord.selectedModelId).toBe(DEFAULT_MODEL_ID);
		expect(savedRecord.lastUsedAt).toEqual(expect.any(Number));
		expect(savedRecord.lastError).toBeNull();
		expect(modelStateStore.overlayOpen).toBe(false);
	});

	it('defaults to Bonsai 1.7B when no model was stored yet', async () => {
		await resetDefaultDatabaseForTests();
		modelStateStore.initialized = false;
		modelStateStore.record = {
			id: 'default',
			selectedModelId: null,
			loadState: 'idle',
			lastUsedAt: null,
			lastError: null
		};

		await modelStateStore.initialize();

		expect(modelStateStore.record.selectedModelId).toBe(DEFAULT_MODEL_ID);
		expect(modelStateStore.overlayOpen).toBe(false);

		const savedRecord = await databaseService.getModelState();
		expect(savedRecord.selectedModelId).toBe(DEFAULT_MODEL_ID);
	});
});
