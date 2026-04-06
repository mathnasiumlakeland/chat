import type { ModelCatalogEntry } from '$lib/types/models';
import type {
	InferenceCompletionHandlers,
	InferenceCompletionOptions,
	InferenceLoadOptions,
	InferenceMessage,
	RuntimeInfo,
	SamplingConfig
} from '$lib/types/runtime';

export interface InferenceBackend {
	load(entry: ModelCatalogEntry, options?: InferenceLoadOptions): Promise<void>;
	unload(): Promise<void>;
	complete(
		messages: InferenceMessage[],
		sampling: SamplingConfig,
		handlers?: InferenceCompletionHandlers,
		options?: InferenceCompletionOptions
	): Promise<string>;
	abort(): void;
	getRuntimeInfo(): RuntimeInfo | null;
}
