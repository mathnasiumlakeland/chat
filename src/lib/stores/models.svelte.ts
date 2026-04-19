import {
	getModelArtifactPath,
	getModelCatalogEntry,
	MODEL_CATALOG,
	normalizeModelId
} from '$lib/constants/models';
import { ModelModality, ServerModelStatus } from '$lib/enums';
import { chatStore } from '$lib/stores/chat.svelte';
import { modelStateStore } from '$lib/stores/model-state.svelte';
import type { ModelCatalogEntry, ModelModalities, ModelOption } from '$lib/types/models';
import type { ApiLlamaCppServerProps } from '$lib/types';

function toModelOption(entry: ModelCatalogEntry): ModelOption {
	return {
		id: entry.id,
		model: entry.id,
		name: entry.displayName,
		description: `${entry.format} · ${Math.round(entry.loadedSizeBytes / 1_000_000)} MB`,
		capabilities: [],
		modalities: {
			vision: false,
			audio: false
		},
		aliases: [entry.displayName],
		tags: [entry.format]
	};
}

function toModelProps(entry: ModelCatalogEntry): ApiLlamaCppServerProps {
	return {
		role: 'router',
		model_path: getModelArtifactPath(entry),
		model_alias: entry.displayName,
		webui: true,
		modalities: {
			vision: false,
			audio: false
		},
		default_generation_settings: {
			n_ctx: entry.contextTokens,
			params: {
				temperature: entry.defaultSampling.sampling.temp,
				top_p: entry.defaultSampling.sampling.top_p,
				top_k: entry.defaultSampling.sampling.top_k,
				repeat_penalty: entry.defaultSampling.sampling.penalty_repeat,
				max_tokens: entry.defaultSampling.nPredict
			}
		},
		webui_settings: {}
	} as unknown as ApiLlamaCppServerProps;
}

class ModelsStore {
	models = $state<ModelOption[]>([]);
	routerModels = $state<ApiModelDataEntry[]>([]);
	loading = $state(false);
	updating = $state(false);
	error = $state<string | null>(null);
	selectedModelId = $state<string | null>(null);
	selectedModelName = $state<string | null>(null);
	private modelProps = $state<Map<string, ApiLlamaCppServerProps>>(new Map());
	private modelLoadingStates = $state<Map<string, boolean>>(new Map());
	private fetchPromise: Promise<void> | null = null;

	private setRouterStatus(modelId: string, status: ServerModelStatus): void {
		this.routerModels = this.routerModels.map((model) =>
			model.id === modelId ? { ...model, status: { value: status } } : model
		);
	}

	private syncSelectionFromState(): void {
		this.selectedModelId = modelStateStore.record.selectedModelId;
		this.selectedModelName =
			this.models.find((option) => option.id === this.selectedModelId)?.model ?? null;
	}

	private getCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
		return getModelCatalogEntry(modelId);
	}

	get selectedModel(): ModelOption | null {
		if (!this.selectedModelId) return null;
		return this.models.find((model) => model.id === this.selectedModelId) ?? null;
	}

	get loadedModelIds(): string[] {
		return this.routerModels
			.filter((model) => model.status?.value === ServerModelStatus.LOADED)
			.map((model) => model.id);
	}

	get loadingModelIds(): string[] {
		return Array.from(this.modelLoadingStates.entries())
			.filter(([, loading]) => loading)
			.map(([id]) => id);
	}

	syncLoadedModelStatus(loadedModelId: string | null): void {
		this.routerModels = this.routerModels.map((model) => ({
			...model,
			status: {
				value:
					loadedModelId && model.id === loadedModelId
						? ServerModelStatus.LOADED
						: ServerModelStatus.UNLOADED
			}
		}));
	}

	get singleModelName(): string | null {
		return this.selectedModelName;
	}

	get selectedModelContextSize(): number | null {
		if (!this.selectedModelName) return null;
		return this.getModelContextSize(this.selectedModelName);
	}

	async fetch(): Promise<void> {
		if (this.fetchPromise) {
			return this.fetchPromise;
		}

		this.fetchPromise = (async () => {
			this.loading = true;
			await modelStateStore.initialize();

			try {
				this.models = MODEL_CATALOG.map(toModelOption);
				this.routerModels = MODEL_CATALOG.map((entry) => ({
					id: entry.id,
					name: entry.displayName,
					object: 'model',
					owned_by: entry.hfRepo.split('/')[0] ?? 'onnx-community',
					created: Date.now(),
					in_cache: true,
					path: getModelArtifactPath(entry),
					meta: {
						webui: true
					},
					status: {
						value:
							chatStore.loadedModelId === entry.id
								? ServerModelStatus.LOADED
								: ServerModelStatus.UNLOADED
					}
				})) as ApiModelDataEntry[];

				this.syncSelectionFromState();
				this.error = null;
			} catch (error) {
				this.error = error instanceof Error ? error.message : 'Failed to load models.';
				throw error;
			} finally {
				this.loading = false;
				this.fetchPromise = null;
			}
		})();

		return this.fetchPromise;
	}

	async fetchRouterModels(): Promise<void> {
		await this.fetch();
	}

	async fetchModalitiesForLoadedModels(): Promise<void> {}

	findModelByName(modelName: string): ModelOption | undefined {
		const normalizedModelId = normalizeModelId(modelName) ?? modelName;
		return this.models.find((option) => option.model === normalizedModelId);
	}

	getModelProps(modelId: string): ApiLlamaCppServerProps | null {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		return this.modelProps.get(normalizedModelId) ?? null;
	}

	async fetchModelProps(modelId: string): Promise<ApiLlamaCppServerProps | null> {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		const cached = this.modelProps.get(normalizedModelId);
		if (cached) return cached;

		const entry = this.getCatalogEntry(normalizedModelId);
		if (!entry) return null;

		const props = toModelProps(entry);
		this.modelProps.set(normalizedModelId, props);
		return props;
	}

	getModelContextSize(modelId: string): number | null {
		const props = this.getModelProps(modelId);
		const nCtx = props?.default_generation_settings?.n_ctx;
		return typeof nCtx === 'number' ? nCtx : null;
	}

	getModelModalities(modelId: string): ModelModalities | null {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		const option = this.models.find(
			(model) => model.model === normalizedModelId || model.id === normalizedModelId
		);
		return option?.modalities ?? { vision: false, audio: false };
	}

	getModelModalitiesArray(modelId: string): ModelModality[] {
		const modalities = this.getModelModalities(modelId);
		if (!modalities) return [];

		const result: ModelModality[] = [];
		if (modalities.vision) result.push(ModelModality.VISION);
		if (modalities.audio) result.push(ModelModality.AUDIO);
		return result;
	}

	modelSupportsVision(modelId: string): boolean {
		return this.getModelModalities(modelId)?.vision ?? false;
	}

	modelSupportsAudio(modelId: string): boolean {
		return this.getModelModalities(modelId)?.audio ?? false;
	}

	isModelLoaded(modelId: string): boolean {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		return this.routerModels.some(
			(model) => model.id === normalizedModelId && model.status?.value === ServerModelStatus.LOADED
		);
	}

	isModelOperationInProgress(modelId: string): boolean {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		return this.modelLoadingStates.get(normalizedModelId) ?? false;
	}

	getModelStatus(modelId: string): ServerModelStatus | null {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		return this.routerModels.find((model) => model.id === normalizedModelId)?.status?.value ?? null;
	}

	async selectModelById(modelId: string): Promise<void> {
		await this.fetch();
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		const option = this.models.find((model) => model.id === normalizedModelId);
		if (!option) {
			throw new Error(`Unknown model "${modelId}".`);
		}

		this.selectedModelId = option.id;
		this.selectedModelName = option.model;
		await modelStateStore.selectModel(option.id);
	}

	selectModelByName(modelName: string): void {
		const normalizedModelId = normalizeModelId(modelName) ?? modelName;
		const option = this.models.find((model) => model.model === normalizedModelId);
		if (!option) return;
		void this.selectModelById(option.id);
	}

	async loadModel(modelId: string): Promise<void> {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		this.modelLoadingStates.set(normalizedModelId, true);
		this.setRouterStatus(normalizedModelId, ServerModelStatus.LOADING);

			try {
				await this.selectModelById(normalizedModelId);
				await chatStore.ensureLoaded();
				this.syncLoadedModelStatus(normalizedModelId);
			} finally {
				this.modelLoadingStates.delete(normalizedModelId);
			}
	}

	async unloadModel(modelId: string): Promise<void> {
		const normalizedModelId = normalizeModelId(modelId) ?? modelId;
		this.modelLoadingStates.set(normalizedModelId, true);

		try {
			await chatStore.unloadModel(normalizedModelId);
			this.setRouterStatus(normalizedModelId, ServerModelStatus.UNLOADED);
		} finally {
			this.modelLoadingStates.delete(normalizedModelId);
		}
	}
}

export const modelsStore = new ModelsStore();

export const modelOptions = () => modelsStore.models;
export const routerModels = () => modelsStore.routerModels;
export const selectedModelId = () => modelsStore.selectedModelId;
export const selectedModelName = () => modelsStore.selectedModelName;
export const singleModelName = () => modelsStore.singleModelName;
export const modelsLoading = () => modelsStore.loading;
export const modelsUpdating = () => modelsStore.updating;
export const selectedModelContextSize = () => modelsStore.selectedModelContextSize;
