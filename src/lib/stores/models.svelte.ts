import { browser } from '$app/environment';
import { MODEL_CATALOG } from '$lib/constants/models';
import { ModelModality, ServerModelStatus } from '$lib/enums';
import { chatStore } from '$lib/stores/chat.svelte';
import { modelStateStore } from '$lib/stores/model-state.svelte';
import type { ModelCatalogEntry, ModelModalities, ModelOption } from '$lib/types/models';
import type { ApiLlamaCppServerProps } from '$lib/types';

const FAVORITE_MODELS_LOCALSTORAGE_KEY = 'bonsai-browser-chat.favorite-model-ids';

function toModelOption(entry: ModelCatalogEntry): ModelOption {
	return {
		id: entry.id,
		model: entry.id,
		name: entry.id.split('/').at(-1) ?? entry.id,
		description: `${entry.format} · ${Math.round(entry.loadedSizeBytes / 1_000_000)} MB`,
		capabilities: [],
		modalities: {
			vision: false,
			audio: false
		},
		tags: [entry.format]
	};
}

function toModelProps(entry: ModelCatalogEntry): ApiLlamaCppServerProps {
	return {
		role: 'router',
		model_path: entry.hfFilename,
		model_alias: entry.id.split('/').at(-1) ?? entry.id,
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
	favoriteModelIds = $state<Set<string>>(this.loadFavorites());
	private modelProps = $state<Map<string, ApiLlamaCppServerProps>>(new Map());
	private modelLoadingStates = $state<Map<string, boolean>>(new Map());
	private fetchPromise: Promise<void> | null = null;

	private loadFavorites(): Set<string> {
		if (!browser) return new Set();

		try {
			const raw = localStorage.getItem(FAVORITE_MODELS_LOCALSTORAGE_KEY);
			if (!raw) return new Set();
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? new Set(parsed) : new Set();
		} catch {
			return new Set();
		}
	}

	private saveFavorites(): void {
		if (!browser) return;
		localStorage.setItem(
			FAVORITE_MODELS_LOCALSTORAGE_KEY,
			JSON.stringify(Array.from(this.favoriteModelIds))
		);
	}

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
		return MODEL_CATALOG.find((entry) => entry.id === modelId);
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
					name: entry.id.split('/').at(-1) ?? entry.id,
					object: 'model',
					owned_by: 'prism-ml',
					created: Date.now(),
					in_cache: true,
					path: entry.hfFilename,
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
		return this.models.find((option) => option.model === modelName);
	}

	getModelProps(modelId: string): ApiLlamaCppServerProps | null {
		return this.modelProps.get(modelId) ?? null;
	}

	async fetchModelProps(modelId: string): Promise<ApiLlamaCppServerProps | null> {
		const cached = this.modelProps.get(modelId);
		if (cached) return cached;

		const entry = this.getCatalogEntry(modelId);
		if (!entry) return null;

		const props = toModelProps(entry);
		this.modelProps.set(modelId, props);
		return props;
	}

	getModelContextSize(modelId: string): number | null {
		const props = this.getModelProps(modelId);
		const nCtx = props?.default_generation_settings?.n_ctx;
		return typeof nCtx === 'number' ? nCtx : null;
	}

	getModelModalities(modelId: string): ModelModalities | null {
		const option = this.models.find((model) => model.model === modelId || model.id === modelId);
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
		return this.routerModels.some(
			(model) => model.id === modelId && model.status?.value === ServerModelStatus.LOADED
		);
	}

	isModelOperationInProgress(modelId: string): boolean {
		return this.modelLoadingStates.get(modelId) ?? false;
	}

	getModelStatus(modelId: string): ServerModelStatus | null {
		return this.routerModels.find((model) => model.id === modelId)?.status?.value ?? null;
	}

	async selectModelById(modelId: string): Promise<void> {
		await this.fetch();
		const option = this.models.find((model) => model.id === modelId);
		if (!option) {
			throw new Error(`Unknown model "${modelId}".`);
		}

		this.selectedModelId = option.id;
		this.selectedModelName = option.model;
		await modelStateStore.selectModel(option.id);
	}

	selectModelByName(modelName: string): void {
		const option = this.models.find((model) => model.model === modelName);
		if (!option) return;
		void this.selectModelById(option.id);
	}

	async loadModel(modelId: string): Promise<void> {
		this.modelLoadingStates.set(modelId, true);
		this.setRouterStatus(modelId, ServerModelStatus.LOADING);

		try {
			await this.selectModelById(modelId);
			await chatStore.ensureLoaded();

			this.routerModels = this.routerModels.map((model) => ({
				...model,
				status: {
					value: model.id === modelId ? ServerModelStatus.LOADED : ServerModelStatus.UNLOADED
				}
			}));
		} finally {
			this.modelLoadingStates.delete(modelId);
		}
	}

	async unloadModel(modelId: string): Promise<void> {
		this.modelLoadingStates.set(modelId, true);

		try {
			await chatStore.unloadModel(modelId);
			this.setRouterStatus(modelId, ServerModelStatus.UNLOADED);
		} finally {
			this.modelLoadingStates.delete(modelId);
		}
	}

	toggleFavorite(modelId: string): void {
		const next = new Set(this.favoriteModelIds);

		if (next.has(modelId)) next.delete(modelId);
		else next.add(modelId);

		this.favoriteModelIds = next;
		this.saveFavorites();
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
