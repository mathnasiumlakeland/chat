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

type WorkerRequestId = number;

type WorkerLoadRequest = {
	type: 'load';
	requestId: WorkerRequestId;
	data: {
		modelKey: string;
	};
};

type WorkerGenerateRequest = {
	type: 'generate';
	requestId: WorkerRequestId;
	data: {
		maxNewTokens: number;
		messages: InferenceMessage[];
		sampling: SamplingConfig;
	};
};

type WorkerControlRequest =
	| {
			type: 'interrupt';
			requestId: WorkerRequestId;
	  }
	| {
			type: 'reset';
	  };

type WorkerRequest = WorkerLoadRequest | WorkerGenerateRequest | WorkerControlRequest;

type WorkerResponse =
	| {
			status: 'progress_total';
			requestId: WorkerRequestId;
			progress: number;
			loaded: number;
			total: number;
	  }
	| {
			status: 'loading';
			requestId: WorkerRequestId;
			data: string;
	  }
	| {
			status: 'ready';
			requestId: WorkerRequestId;
	  }
	| {
			status: 'start';
			requestId: WorkerRequestId;
	  }
	| {
			status: 'update';
			requestId: WorkerRequestId;
			output: string;
			numTokens: number;
			tps: number | null;
	  }
	| {
			status: 'complete';
			requestId: WorkerRequestId;
			output: string;
	  }
	| {
			status: 'interrupted';
			requestId: WorkerRequestId;
	  }
	| {
			status: 'error';
			requestId: WorkerRequestId;
			data: string;
	  };

function createAbortError(): Error {
	try {
		return new DOMException('Aborted', 'AbortError');
	} catch {
		const error = new Error('Aborted');
		error.name = 'AbortError';
		return error;
	}
}

function buildLibraryLabel(dtype: string): string {
	return `Transformers.js WebGPU (${dtype})`;
}

function sanitizeContextTokens(
	requestedContextTokens: number | undefined,
	fallbackContextTokens: number
): number {
	const resolvedContextTokens = requestedContextTokens ?? fallbackContextTokens;

	if (!Number.isFinite(resolvedContextTokens)) {
		return fallbackContextTokens;
	}

	return Math.max(1, Math.min(Math.floor(resolvedContextTokens), fallbackContextTokens));
}

function resolveSafePredictTokens(requestedPredictTokens?: number): number {
	const fallbackPredictTokens = 1024;
	const resolvedPredictTokens = requestedPredictTokens ?? fallbackPredictTokens;

	if (!Number.isFinite(resolvedPredictTokens)) {
		return fallbackPredictTokens;
	}

	return Math.max(1, Math.min(Math.floor(resolvedPredictTokens), 1024));
}

export class OnnxWebgpuBackend implements InferenceBackend {
	#worker: Worker | null = null;
	#workerMessageHandler: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
	#runtimeInfo: RuntimeInfo | null = null;
	#loadedModelId: string | null = null;
	#nextRequestId = 0;
	#activeLoad:
		| {
				requestId: WorkerRequestId;
				resolve: () => void;
				reject: (reason: unknown) => void;
				progressCallback?: InferenceLoadOptions['progressCallback'];
		  }
		| null = null;
	#activeCompletion:
		| {
				requestId: WorkerRequestId;
				resolve: (value: string) => void;
				reject: (reason: unknown) => void;
				handlers: InferenceCompletionHandlers;
				lastDecodedTokens: number;
				removeAbortListener: () => void;
		  }
		| null = null;

	#createWorker(): Worker {
		if (this.#worker) {
			return this.#worker;
		}

		const worker = new Worker(new URL('./transformers-webgpu-worker.ts', import.meta.url), {
			type: 'module'
		});
		const onMessage = (event: MessageEvent<WorkerResponse>) => {
			this.#handleWorkerMessage(event);
		};

		worker.addEventListener('message', onMessage);
		this.#worker = worker;
		this.#workerMessageHandler = onMessage;
		return worker;
	}

	#handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
		const message = event.data;

		if (this.#activeLoad?.requestId === message.requestId) {
			switch (message.status) {
				case 'progress_total':
					this.#activeLoad.progressCallback?.({
						loaded: Number(message.loaded ?? 0),
						total: Number(message.total ?? 0)
					});
					return;
				case 'ready': {
					const pendingLoad = this.#activeLoad;
					this.#activeLoad = null;
					pendingLoad.resolve();
					return;
				}
				case 'error': {
					const pendingLoad = this.#activeLoad;
					this.#activeLoad = null;
					pendingLoad.reject(new Error(message.data));
					return;
				}
				default:
					return;
			}
		}

		if (this.#activeCompletion?.requestId === message.requestId) {
			switch (message.status) {
				case 'update': {
					const pendingCompletion = this.#activeCompletion;
					pendingCompletion.handlers.onToken?.(message.output);

					const nextDecodedTokens = Number(message.numTokens ?? pendingCompletion.lastDecodedTokens);
					for (let count = pendingCompletion.lastDecodedTokens; count < nextDecodedTokens; count += 1) {
						pendingCompletion.handlers.onTokenDecoded?.();
					}
					pendingCompletion.lastDecodedTokens = Math.max(
						pendingCompletion.lastDecodedTokens,
						nextDecodedTokens
					);
					return;
				}
				case 'complete': {
					const pendingCompletion = this.#activeCompletion;
					this.#activeCompletion = null;
					pendingCompletion.removeAbortListener();
					pendingCompletion.resolve(message.output);
					return;
				}
				case 'interrupted': {
					const pendingCompletion = this.#activeCompletion;
					this.#activeCompletion = null;
					pendingCompletion.removeAbortListener();
					pendingCompletion.reject(createAbortError());
					return;
				}
				case 'error': {
					const pendingCompletion = this.#activeCompletion;
					this.#activeCompletion = null;
					pendingCompletion.removeAbortListener();
					pendingCompletion.reject(new Error(message.data));
					return;
				}
				default:
					return;
			}
		}
	}

	#postMessage(message: WorkerRequest): void {
		this.#createWorker().postMessage(message);
	}

	#clearPendingState(error: Error): void {
		this.#activeLoad?.reject(error);
		this.#activeLoad = null;

		if (this.#activeCompletion) {
			const pendingCompletion = this.#activeCompletion;
			this.#activeCompletion = null;
			pendingCompletion.removeAbortListener();
			pendingCompletion.reject(error);
		}
	}

	#resetRuntimeState(terminateWorker: boolean): void {
		const abortError = createAbortError();
		this.#clearPendingState(abortError);
		this.#worker?.postMessage({ type: 'reset' });

		if (terminateWorker) {
			this.#terminateWorker();
		}

		this.#runtimeInfo = null;
		this.#loadedModelId = null;
	}

	#terminateWorker(): void {
		if (!this.#worker) {
			return;
		}

		if (this.#workerMessageHandler) {
			this.#worker.removeEventListener('message', this.#workerMessageHandler);
		}

		this.#worker.terminate();
		this.#worker = null;
		this.#workerMessageHandler = null;
	}

	async load(entry: ModelCatalogEntry, options: InferenceLoadOptions = {}): Promise<void> {
		if (this.#loadedModelId === entry.id && this.#runtimeInfo) {
			return;
		}

		this.#resetRuntimeState(false);

		if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
			throw new Error(
				'WebGPU is not available in this browser, so the ternary Transformers.js runtime cannot start.'
			);
		}

		const requestId = this.#nextRequestId++;
		const contextTokens = sanitizeContextTokens(options.contextTokens, entry.contextTokens);

		await new Promise<void>((resolve, reject) => {
			this.#activeLoad = {
				requestId,
				resolve,
				reject,
				progressCallback: options.progressCallback
			};

			this.#postMessage({
				type: 'load',
				requestId,
				data: {
					modelKey: entry.spaceModelId ?? entry.id
				}
			});
		});

		this.#loadedModelId = entry.id;
		this.#runtimeInfo = {
			runtimeKind: 'onnx-webgpu',
			modelId: entry.id,
			contextTokens,
			loadedAt: Date.now(),
			usesMultithread: false,
			library: buildLibraryLabel('q2f16')
		};
	}

	async unload(): Promise<void> {
		this.#resetRuntimeState(true);
	}

	async complete(
		messages: InferenceMessage[],
		sampling: SamplingConfig,
		handlers: InferenceCompletionHandlers = {},
		options: InferenceCompletionOptions = {}
	): Promise<string> {
		if (!this.#worker || !this.#runtimeInfo) {
			throw new Error('The ONNX WebGPU backend is not loaded.');
		}

		if (this.#activeCompletion) {
			throw new Error('A completion is already in progress.');
		}

		const requestId = this.#nextRequestId++;

		return new Promise<string>((resolve, reject) => {
			const onAbort = () => {
				this.abort();
			};

			if (options.abortSignal?.aborted) {
				reject(createAbortError());
				return;
			}

			options.abortSignal?.addEventListener('abort', onAbort, { once: true });

			this.#activeCompletion = {
				requestId,
				resolve,
				reject,
				handlers,
				lastDecodedTokens: 0,
				removeAbortListener: () => options.abortSignal?.removeEventListener('abort', onAbort)
			};

			this.#postMessage({
				type: 'generate',
				requestId,
				data: {
					messages,
					sampling,
					maxNewTokens: resolveSafePredictTokens(options.nPredict)
				}
			});
		});
	}

	abort(): void {
		if (!this.#activeCompletion) {
			return;
		}

		const pendingCompletion = this.#activeCompletion;
		this.#activeCompletion = null;
		pendingCompletion.removeAbortListener();
		this.#postMessage({
			type: 'interrupt',
			requestId: pendingCompletion.requestId
		});
		pendingCompletion.reject(createAbortError());
	}

	getRuntimeInfo(): RuntimeInfo | null {
		return this.#runtimeInfo;
	}
}
