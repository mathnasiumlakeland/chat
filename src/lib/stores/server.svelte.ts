import { getModelArtifactPath, MODEL_CATALOG } from '$lib/constants/models';
import { ServerRole } from '$lib/enums';
import { selectedModelId } from '$lib/stores/model-state.svelte';

function getActiveModel() {
	return MODEL_CATALOG.find((entry) => entry.id === selectedModelId()) ?? MODEL_CATALOG[0];
}

function createProps(): ApiLlamaCppServerProps {
	const model = getActiveModel();

	return {
		role: ServerRole.ROUTER,
		model_path: getModelArtifactPath(model),
		model_alias: model.displayName,
		modalities: {
			vision: false,
			audio: false
		},
		default_generation_settings: {
			n_ctx: model.contextTokens,
			params: {
				temperature: model.defaultSampling.sampling.temp,
				top_p: model.defaultSampling.sampling.top_p,
				top_k: model.defaultSampling.sampling.top_k,
				repeat_penalty: model.defaultSampling.sampling.penalty_repeat,
				max_tokens: model.defaultSampling.nPredict
			}
		},
		webui_settings: {},
		webui: true
	} as ApiLlamaCppServerProps;
}

class ServerStore {
	props = $state<ApiLlamaCppServerProps | null>(createProps());
	loading = $state(false);
	error = $state<string | null>(null);
	role = $state<ServerRole | null>(ServerRole.ROUTER);

	get defaultParams(): ApiLlamaCppServerProps['default_generation_settings']['params'] | null {
		return this.props?.default_generation_settings?.params ?? null;
	}

	get contextSize(): number | null {
		return this.props?.default_generation_settings?.n_ctx ?? null;
	}

	get webuiSettings(): Record<string, string | number | boolean> | undefined {
		return this.props?.webui_settings;
	}

	get isRouterMode(): boolean {
		return true;
	}

	get isModelMode(): boolean {
		return false;
	}

	async fetch(): Promise<void> {
		this.loading = true;
		this.error = null;
		this.props = createProps();
		this.role = ServerRole.ROUTER;
		this.loading = false;
	}

	clear(): void {
		this.props = createProps();
		this.error = null;
		this.loading = false;
		this.role = ServerRole.ROUTER;
	}
}

export const serverStore = new ServerStore();

export const serverProps = () => serverStore.props;
export const serverLoading = () => serverStore.loading;
export const serverError = () => serverStore.error;
export const serverRole = () => serverStore.role;
export const defaultParams = () => serverStore.defaultParams;
export const contextSize = () => serverStore.contextSize;
export const isRouterMode = () => serverStore.isRouterMode;
export const isModelMode = () => serverStore.isModelMode;
