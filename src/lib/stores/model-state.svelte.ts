import { browser } from '$app/environment';
import { DEFAULT_MODEL_ID, normalizeModelId } from '$lib/constants/models';
import { databaseService } from '$lib/services/database.service';
import type { ModelStateRecord } from '$lib/types/models';
import type { RuntimeInfo } from '$lib/types/runtime';

const DEFAULT_MODEL_STATE: ModelStateRecord = {
	id: 'default',
	selectedModelId: DEFAULT_MODEL_ID,
	loadState: 'idle',
	lastUsedAt: null,
	lastError: null
};

class ModelStateStore {
	initialized = $state(false);
	record = $state<ModelStateRecord>(DEFAULT_MODEL_STATE);
	overlayOpen = $state(false);
	progress = $state(0);
	runtimeInfo = $state<RuntimeInfo | null>(null);

	private snapshotRecord(): ModelStateRecord {
		return $state.snapshot(this.record);
	}

	async initialize(): Promise<void> {
		if (!browser || this.initialized) {
			return;
		}

		const savedRecord = await databaseService.getModelState();
		const normalizedRecord: ModelStateRecord = {
			...savedRecord,
			selectedModelId: normalizeModelId(savedRecord.selectedModelId) ?? DEFAULT_MODEL_ID
		};

		this.record = normalizedRecord;
		this.overlayOpen = false;

		if (savedRecord.selectedModelId !== normalizedRecord.selectedModelId) {
			await databaseService.saveModelState(normalizedRecord);
		}

		this.initialized = true;
	}

	async selectModel(modelId: string): Promise<void> {
		await this.initialize();
		const normalizedModelId = normalizeModelId(modelId) ?? DEFAULT_MODEL_ID;
		const nextRecord: ModelStateRecord = {
			...this.snapshotRecord(),
			selectedModelId: normalizedModelId,
			lastUsedAt: Date.now(),
			lastError: null
		};

		this.record = nextRecord;
		this.overlayOpen = false;
		await databaseService.saveModelState(nextRecord);
	}

	async syncConversationModel(modelId: string): Promise<void> {
		await this.initialize();
		const normalizedModelId = normalizeModelId(modelId) ?? DEFAULT_MODEL_ID;

		if (this.record.selectedModelId === normalizedModelId) {
			return;
		}

		const nextRecord: ModelStateRecord = {
			...this.snapshotRecord(),
			selectedModelId: normalizedModelId,
			lastError: null
		};

		this.record = nextRecord;
		this.overlayOpen = false;
		await databaseService.saveModelState(nextRecord);
	}

	async setLoadState(loadState: ModelStateRecord['loadState'], lastError: string | null = null) {
		await this.initialize();
		const nextRecord: ModelStateRecord = {
			...this.snapshotRecord(),
			loadState,
			lastError
		};

		this.record = nextRecord;
		await databaseService.saveModelState(nextRecord);
	}

	setOverlayOpen(open: boolean): void {
		this.overlayOpen = open;
	}

	setProgress(progress: number): void {
		this.progress = progress;
	}

	setRuntimeInfo(runtimeInfo: RuntimeInfo | null): void {
		this.runtimeInfo = runtimeInfo;
	}
}

export const modelStateStore = new ModelStateStore();

export const selectedModelId = () => modelStateStore.record.selectedModelId;
export const modelLoadState = () => modelStateStore.record.loadState;
export const modelLoadProgress = () => modelStateStore.progress;
export const modelLastError = () => modelStateStore.record.lastError;
export const modelRuntimeInfo = () => modelStateStore.runtimeInfo;
