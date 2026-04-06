import type { ModelCatalogEntry } from '$lib/types/models';
import type {
	InferenceCompletionHandlers,
	InferenceCompletionOptions,
	InferenceLoadOptions,
	InferenceMessage,
	RuntimeInfo,
	SamplingConfig
} from '$lib/types/runtime';
import { splitLeadingThinkBlock } from '$lib/utils/reasoning';
import type { InferenceBackend } from './inference-backend';
import { type PrismRuntimeManifest, verifyPrismRuntimeAssets } from './prism-assets';
import {
	type RawQ1LoadConfig,
	type RawQ1WebgpuDispatchPlan,
	PrismRawQ1Module
} from './prism-raw-q1-module';

const STATIC_THROUGHPUT_DISPATCH_PLAN: RawQ1WebgpuDispatchPlan = {
	mode: 'static-throughput',
	load: { submitBatchSize: 64, paramBufferLimit: 128 },
	prefill: { submitBatchSize: 64, paramBufferLimit: 128 },
	firstToken: { submitBatchSize: 64, paramBufferLimit: 128 },
	decode: { submitBatchSize: 64, paramBufferLimit: 128 }
};

function formatBonsaiChatPrompt(
	messages: InferenceMessage[],
	addGenerationPrompt = true
): string {
	const prompt = messages
		.filter(
			(message) =>
				message.role === 'assistant' || message.role === 'system' || message.role === 'user'
		)
		.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>\n`)
		.join('');

	return addGenerationPrompt ? `${prompt}<|im_start|>assistant\n` : prompt;
}

function buildLibraryLabel(runtimeManifest: PrismRuntimeManifest): string {
	return `Prism raw Asyncify WebGPU (${runtimeManifest.commandSubmitBatchSize}/${runtimeManifest.numParamBuffers})`;
}

function createChainedAbortController(externalAbortSignal?: AbortSignal): {
	abort: () => void;
	controller: AbortController;
	dispose: () => void;
} {
	const controller = new AbortController();

	if (externalAbortSignal?.aborted) {
		controller.abort();
		return {
			controller,
			abort: () => controller.abort(),
			dispose: () => {}
		};
	}

	const onAbort = () => controller.abort();
	externalAbortSignal?.addEventListener('abort', onAbort, { once: true });

	return {
		controller,
		abort: () => controller.abort(),
		dispose: () => externalAbortSignal?.removeEventListener('abort', onAbort)
	};
}

export class GgufWasmBackend implements InferenceBackend {
	#modelCacheName = 'bonsai-model-cache-v1';
	#instance: PrismRawQ1Module | null = null;
	#runtimeInfo: RuntimeInfo | null = null;
	#loadedModelId: string | null = null;
	#activeAbortController: AbortController | null = null;

	#getModelUrl(entry: ModelCatalogEntry): string {
		return `https://huggingface.co/${entry.hfRepo}/resolve/main/${entry.hfFilename}`;
	}

	#buildLoadConfig(entry: ModelCatalogEntry, requestedContextTokens?: number): RawQ1LoadConfig {
		const nCtx = Math.min(requestedContextTokens ?? entry.contextTokens, 4_096);
		return {
			nCtx,
			nBatch: Math.min(nCtx, 256),
			nThreads: 1,
			nGpuLayers: 999,
			offloadKqv: true,
			dispatchPlan: STATIC_THROUGHPUT_DISPATCH_PLAN
		};
	}

	#resolveSafePredictTokens(requestedPredictTokens?: number): number {
		const safePredictTokens = 96;
		return Math.min(requestedPredictTokens ?? safePredictTokens, safePredictTokens);
	}

	async #fetchModelResponse(entry: ModelCatalogEntry): Promise<Response> {
		const modelUrl = this.#getModelUrl(entry);
		const cache =
			typeof caches !== 'undefined' ? await caches.open(this.#modelCacheName) : null;
		const cachedResponse = cache ? await cache.match(modelUrl) : undefined;

		if (cachedResponse) {
			return cachedResponse;
		}

		const response = await fetch(modelUrl);
		if (!response.ok) {
			throw new Error(`Failed to download ${entry.id}: ${response.status} ${response.statusText}`);
		}

		if (cache) {
			cache.put(modelUrl, response.clone()).catch(() => {
				// Cache writes are opportunistic. Model loading should continue even if quota blocks it.
			});
		}

		return response;
	}

	async load(entry: ModelCatalogEntry, options: InferenceLoadOptions = {}): Promise<void> {
		if (this.#loadedModelId === entry.id && this.#instance?.isModelLoaded()) {
			return;
		}

		await this.unload();

		if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
			throw new Error('WebGPU is not available in this browser, so the Q1 runtime cannot start.');
		}

		const assets = await verifyPrismRuntimeAssets();
		const modelResponse = await this.#fetchModelResponse(entry);
		const loadConfig = this.#buildLoadConfig(entry, options.contextTokens);

		this.#instance = new PrismRawQ1Module({
			assets,
			modelFileName: entry.hfFilename,
			modelUrl: this.#getModelUrl(entry),
			logger: {}
		});

		await this.#instance.loadModelFromResponse(modelResponse, {
			...loadConfig,
			progressCallback: options.progressCallback
		});

		const loadedInfo = this.#instance.getLoadedContextInfo();
		if (!loadedInfo) {
			throw new Error('The Q1 runtime finished loading without exposing context info.');
		}

		this.#loadedModelId = entry.id;
		this.#runtimeInfo = {
			runtimeKind: 'gguf-wasm',
			modelId: entry.id,
			contextTokens: loadedInfo.n_ctx,
			loadedAt: Date.now(),
			usesMultithread: false,
			library: buildLibraryLabel(assets.runtimeManifest)
		};
	}

	async unload(): Promise<void> {
		this.#activeAbortController?.abort();
		this.#activeAbortController = null;

		if (this.#instance) {
			await this.#instance.exit();
		}

		this.#instance = null;
		this.#runtimeInfo = null;
		this.#loadedModelId = null;
	}

	async complete(
		messages: InferenceMessage[],
		sampling: SamplingConfig,
		handlers: InferenceCompletionHandlers = {},
		options: InferenceCompletionOptions = {}
	): Promise<string> {
		if (!this.#instance) {
			throw new Error('The GGUF backend is not loaded.');
		}

		const { abort, controller, dispose } = createChainedAbortController(options.abortSignal);
		this.#activeAbortController = controller;

		let streamedRaw = '';
		let streamedVisibleLength = 0;

		try {
			const prompt = formatBonsaiChatPrompt(messages, true);
			const response = await this.#instance.completePrompt(
				prompt,
				sampling,
				{
					onToken: (chunk) => {
						streamedRaw += chunk;
						const visibleContent = splitLeadingThinkBlock(streamedRaw).content;
						const nextChunk = visibleContent.slice(streamedVisibleLength);

						if (!nextChunk) {
							return;
						}

						streamedVisibleLength = visibleContent.length;
						handlers.onToken?.(nextChunk);
					},
					onTokenDecoded: handlers.onTokenDecoded
				},
				{
					abortSignal: controller.signal,
					dispatchPlan: STATIC_THROUGHPUT_DISPATCH_PLAN,
					maxTokens: this.#resolveSafePredictTokens(options.nPredict)
				}
			);

			return splitLeadingThinkBlock(response).content;
		} finally {
			abort();
			dispose();
			this.#activeAbortController = null;
		}
	}

	abort(): void {
		this.#activeAbortController?.abort();
	}

	getRuntimeInfo(): RuntimeInfo | null {
		return this.#runtimeInfo;
	}
}
