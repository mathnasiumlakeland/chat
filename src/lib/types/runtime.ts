export type RuntimeKind = 'gguf-wasm' | 'onnx-webgpu';

export interface SamplingConfig {
	temp: number;
	top_p: number;
	top_k: number;
	penalty_repeat?: number;
}

export interface SamplingPreset {
	id: string;
	label: string;
	description: string;
	nPredict: number;
	sampling: SamplingConfig;
}

export interface InferenceMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface InferenceLoadProgress {
	loaded: number;
	total: number;
}

export interface InferenceLoadOptions {
	contextTokens?: number;
	progressCallback?: (progress: InferenceLoadProgress) => void;
}

export interface InferenceCompletionHandlers {
	onToken?: (chunk: string) => void;
	onTokenDecoded?: () => void;
}

export interface InferenceCompletionOptions {
	abortSignal?: AbortSignal;
	nPredict?: number;
}

export interface RuntimeInfo {
	runtimeKind: RuntimeKind;
	modelId: string;
	contextTokens: number;
	loadedAt: number;
	usesMultithread: boolean;
	library: string;
}
