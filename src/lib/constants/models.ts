import type { ModelCatalogEntry } from '$lib/types/models';
import type { SamplingPreset } from '$lib/types/runtime';

export const BALANCED_SAMPLING_PRESET: SamplingPreset = {
	id: 'balanced',
	label: 'Balanced',
	description: 'Moderate temperature with tight top-k for concise local chat.',
	nPredict: 384,
	sampling: {
		temp: 0.5,
		top_p: 0.9,
		top_k: 20,
		penalty_repeat: 1
	}
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
	{
		id: 'prism-ml/Bonsai-1.7B-gguf',
		hfRepo: 'prism-ml/Bonsai-1.7B-gguf',
		hfFilename: 'Bonsai-1.7B.gguf',
		runtimeKind: 'gguf-wasm',
		format: 'GGUF Q1_0_g128',
		cacheSizeBytes: 250_000_000,
		loadedSizeBytes: 240_000_000,
		contextTokens: 4_096,
		status: 'ready',
		defaultSampling: BALANCED_SAMPLING_PRESET
	},
	{
		id: 'prism-ml/Bonsai-4B-gguf',
		hfRepo: 'prism-ml/Bonsai-4B-gguf',
		hfFilename: 'Bonsai-4B.gguf',
		runtimeKind: 'gguf-wasm',
		format: 'GGUF Q1_0_g128',
		cacheSizeBytes: 570_000_000,
		loadedSizeBytes: 570_000_000,
		contextTokens: 4_096,
		status: 'ready',
		defaultSampling: BALANCED_SAMPLING_PRESET
	}
];

export const DEFAULT_MODEL_ID = MODEL_CATALOG[0].id;
