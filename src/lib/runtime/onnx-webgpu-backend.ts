import type { ModelCatalogEntry } from '$lib/types/models';
import type {
	InferenceCompletionHandlers,
	InferenceCompletionOptions,
	InferenceLoadOptions,
	InferenceMessage,
	RuntimeInfo,
	SamplingConfig
} from '$lib/types/runtime';
import type { InferenceBackend } from './inference-backend';

export class OnnxWebgpuBackend implements InferenceBackend {
	async load(_entry: ModelCatalogEntry, _options?: InferenceLoadOptions): Promise<void> {
		throw new Error('The ONNX WebGPU runtime is defined but not implemented in this build.');
	}

	async unload(): Promise<void> {}

	async complete(
		_messages: InferenceMessage[],
		_sampling: SamplingConfig,
		_handlers?: InferenceCompletionHandlers,
		_options?: InferenceCompletionOptions
	): Promise<string> {
		throw new Error('The ONNX WebGPU runtime is defined but not implemented in this build.');
	}

	abort(): void {}

	getRuntimeInfo(): RuntimeInfo | null {
		return null;
	}
}
