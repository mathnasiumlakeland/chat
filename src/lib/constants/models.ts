import type { ModelCatalogEntry } from '$lib/types/models';
import type { SamplingPreset } from '$lib/types/runtime';

export const BONSAI_CONTEXT_TOKENS = 32_768;
export const BONSAI_8B_CONTEXT_TOKENS = 65_536;

export const BALANCED_SAMPLING_PRESET: SamplingPreset = {
	id: 'balanced',
	label: 'Deterministic',
	description: 'Greedy decoding tuned to match the ternary Bonsai WebGPU Space.',
	nPredict: 1_024,
	sampling: {
		temp: 0,
		top_p: 1,
		top_k: 0,
		penalty_repeat: 1
	}
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
	{
		id: 'onnx-community/Ternary-Bonsai-1.7B-ONNX',
		spaceModelId: '1.7b',
		displayName: 'Bonsai 1.7B',
		hfRepo: 'onnx-community/Ternary-Bonsai-1.7B-ONNX',
		hfFilename: 'onnx/model_q2f16.onnx',
		runtimeKind: 'onnx-webgpu',
		format: 'Transformers.js q2f16 WebGPU',
		cacheSizeBytes: 470_000_000,
		loadedSizeBytes: 470_000_000,
		contextTokens: BONSAI_CONTEXT_TOKENS,
		status: 'ready',
		defaultSampling: BALANCED_SAMPLING_PRESET
	},
	{
		id: 'onnx-community/Ternary-Bonsai-4B-ONNX',
		spaceModelId: '4b',
		displayName: 'Bonsai 4B',
		hfRepo: 'onnx-community/Ternary-Bonsai-4B-ONNX',
		hfFilename: 'onnx/model_q2f16.onnx',
		runtimeKind: 'onnx-webgpu',
		format: 'Transformers.js q2f16 WebGPU',
		cacheSizeBytes: 1_100_000_000,
		loadedSizeBytes: 1_100_000_000,
		contextTokens: BONSAI_CONTEXT_TOKENS,
		status: 'ready',
		defaultSampling: BALANCED_SAMPLING_PRESET
	},
	{
		id: 'onnx-community/Ternary-Bonsai-8B-ONNX',
		spaceModelId: '8b',
		displayName: 'Bonsai 8B',
		hfRepo: 'onnx-community/Ternary-Bonsai-8B-ONNX',
		hfFilename: 'onnx/model_q2f16.onnx',
		runtimeKind: 'onnx-webgpu',
		format: 'Transformers.js q2f16 WebGPU',
		cacheSizeBytes: 2_200_000_000,
		loadedSizeBytes: 2_200_000_000,
		contextTokens: BONSAI_8B_CONTEXT_TOKENS,
		status: 'ready',
		defaultSampling: BALANCED_SAMPLING_PRESET
	}
];

export const DEFAULT_MODEL_ID = MODEL_CATALOG[0].id;

const LEGACY_MODEL_ID_MAP: Record<string, string> = {
	'prism-ml/Bonsai-1.7B-gguf': MODEL_CATALOG[0].id,
	'onnx-community/Bonsai-1.7B-ONNX': MODEL_CATALOG[0].id,
	'1.7b': MODEL_CATALOG[0].id,
	'prism-ml/Bonsai-4B-gguf': MODEL_CATALOG[1].id,
	'4b': MODEL_CATALOG[1].id,
	'prism-ml/Bonsai-8B-gguf': MODEL_CATALOG[2].id,
	'8b': MODEL_CATALOG[2].id
};

export function normalizeModelId(modelId: string | null | undefined): string | null {
	if (!modelId) {
		return null;
	}

	return LEGACY_MODEL_ID_MAP[modelId] ?? modelId;
}

export function getModelCatalogEntry(
	modelId: string | null | undefined
): ModelCatalogEntry | undefined {
	const normalizedModelId = normalizeModelId(modelId);

	if (!normalizedModelId) {
		return undefined;
	}

	return MODEL_CATALOG.find((entry) => entry.id === normalizedModelId);
}

export function getModelArtifactPath(entry: ModelCatalogEntry): string {
	if (entry.runtimeKind === 'onnx-webgpu') {
		return entry.hfRepo;
	}

	return `${entry.hfRepo}/${entry.hfFilename}`;
}
