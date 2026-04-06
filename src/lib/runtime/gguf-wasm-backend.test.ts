import type {
	InferenceCompletionHandlers,
	SamplingConfig
} from '$lib/types/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_CATALOG } from '$lib/constants/models';

const runtimeAssets = {
	runtimeManifest: {
		asyncifyDiagnostics: '0',
		builtAt: '2026-04-06T06:49:35Z',
		commandSubmitBatchSize: '64',
		cpuProfile: 'OFF',
		declareAsmModuleExports: '1',
		exceptionFlag: '-fexceptions',
		ggmlWebgpuJspi: 'OFF',
		gpuProfile: 'OFF',
		numParamBuffers: '128',
		optimizationLevel: '-O3',
		paramUploadMode: 'queue-write-buffer',
		patchVendorBundle: '0',
		runtimeBridge: 'asyncify',
		runtimePreset: 'perf'
	},
	runtimeManifestUrl: '/runtime/prism/single-thread/runtime-manifest.json',
	runtimeScriptUrl: '/runtime/prism/single-thread/wllama.js',
	runtimeWasmUrl: '/runtime/prism/single-thread/wllama.wasm'
} as const;

const loadModelFromResponse = vi.fn(async () => {});
const exit = vi.fn(async () => {});
const isModelLoaded = vi.fn(() => true);
const completePrompt = vi.fn(
	async (
		_prompt: string,
		_sampling: SamplingConfig,
		handlers: InferenceCompletionHandlers,
		_options: { abortSignal?: AbortSignal }
	) => {
		handlers.onToken?.('<think>\n</think>\n\nBon');
		handlers.onTokenDecoded?.();
		handlers.onToken?.('sai');
		handlers.onTokenDecoded?.();
		return '<think>\n</think>\n\nBonsai';
	}
);

class MockPrismRawQ1Module {
	constructor(
		_publicConfig: Record<string, unknown>
	) {}

	loadModelFromResponse = loadModelFromResponse;
	exit = exit;
	isModelLoaded = isModelLoaded;
	completePrompt = completePrompt;

	getLoadedContextInfo() {
		return {
			n_ctx: 4_096
		};
	}
}

vi.mock('./prism-raw-q1-module', () => ({
	PrismRawQ1Module: MockPrismRawQ1Module
}));

vi.mock('./prism-assets', () => ({
	verifyPrismRuntimeAssets: vi.fn(async () => runtimeAssets)
}));

describe('GgufWasmBackend', () => {
	beforeEach(() => {
		loadModelFromResponse.mockClear();
		exit.mockClear();
		isModelLoaded.mockReset();
		isModelLoaded.mockReturnValue(true);
		completePrompt.mockClear();

		vi.stubGlobal(
			'navigator',
			Object.assign(globalThis.navigator ?? {}, {
				gpu: {}
			})
		);

		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'HEAD') {
				return new Response(null, { status: 200 });
			}

			if (String(input).includes('huggingface.co/')) {
				return new Response(new Uint8Array([1, 2, 3]), {
					status: 200,
					headers: {
						'content-length': '3',
						'content-type': 'application/octet-stream'
					}
				});
			}

			return new Response(JSON.stringify(runtimeAssets.runtimeManifest), {
				status: 200,
				headers: {
					'content-type': 'application/json'
				}
			});
		});

		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('caches', {
			open: vi.fn(async () => ({
				match: vi.fn(async () => undefined),
				put: vi.fn(async () => undefined)
			}))
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('loads the validated raw Q1 runtime and exposes runtime metadata', async () => {
		const { GgufWasmBackend } = await import('./gguf-wasm-backend');
		const backend = new GgufWasmBackend();

		await backend.load(MODEL_CATALOG[0], { contextTokens: MODEL_CATALOG[0].contextTokens });

		expect(fetch).toHaveBeenCalledWith(
			'https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B.gguf'
		);
		expect(loadModelFromResponse).toHaveBeenCalledWith(
			expect.any(Response),
			expect.objectContaining({
				nCtx: 4_096,
				nBatch: 256,
				nThreads: 1,
				nGpuLayers: 999,
				offloadKqv: true,
				dispatchPlan: expect.objectContaining({
					mode: 'static-throughput',
					load: { submitBatchSize: 64, paramBufferLimit: 128 }
				})
			})
		);
		expect(backend.getRuntimeInfo()).toMatchObject({
			runtimeKind: 'gguf-wasm',
			modelId: MODEL_CATALOG[0].id,
			contextTokens: 4_096,
			usesMultithread: false,
			library: 'Prism raw Asyncify WebGPU (64/128)'
		});
	});

	it('streams visible tokens and unloads the raw runtime cleanly', async () => {
		const { GgufWasmBackend } = await import('./gguf-wasm-backend');
		const backend = new GgufWasmBackend();

		await backend.load(MODEL_CATALOG[0], { contextTokens: MODEL_CATALOG[0].contextTokens });

		const streamedChunks: string[] = [];
		const text = await backend.complete(
			[
				{ role: 'assistant', content: '<think>\ninternal\n</think>\nVisible answer' },
				{ role: 'user', content: 'hello' }
			],
			MODEL_CATALOG[0].defaultSampling.sampling,
			{
				onToken: (chunk) => streamedChunks.push(chunk)
			}
		);

		expect(streamedChunks).toEqual(['Bon', 'sai']);
		expect(text).toBe('Bonsai');
		expect(completePrompt).toHaveBeenCalledWith(
			'<|im_start|>assistant\n<think>\ninternal\n</think>\nVisible answer<|im_end|>\n<|im_start|>user\nhello<|im_end|>\n<|im_start|>assistant\n',
			MODEL_CATALOG[0].defaultSampling.sampling,
			expect.any(Object),
			expect.objectContaining({
				maxTokens: 96,
				dispatchPlan: expect.objectContaining({
					mode: 'static-throughput'
				})
			})
		);

		await backend.unload();
		expect(exit).toHaveBeenCalledTimes(1);
	});

	it('propagates runtime completion failures for a simple prompt', async () => {
		const { GgufWasmBackend } = await import('./gguf-wasm-backend');
		const backend = new GgufWasmBackend();

		await backend.load(MODEL_CATALOG[0], { contextTokens: MODEL_CATALOG[0].contextTokens });

		completePrompt.mockRejectedValueOnce(new Error('Mock runtime failure'));

		await expect(
			backend.complete([{ role: 'user', content: 'hello' }], MODEL_CATALOG[0].defaultSampling.sampling)
		).rejects.toThrow('Mock runtime failure');
	});

	it('supports aborting an in-flight completion', async () => {
		const { GgufWasmBackend } = await import('./gguf-wasm-backend');
		const backend = new GgufWasmBackend();

		await backend.load(MODEL_CATALOG[0], { contextTokens: MODEL_CATALOG[0].contextTokens });

		completePrompt.mockImplementationOnce(
			async (
				_prompt: string,
				_sampling: SamplingConfig,
				_handlers: InferenceCompletionHandlers,
				options: { abortSignal?: AbortSignal }
			) =>
				await new Promise<string>((_resolve, reject) => {
					if (options.abortSignal?.aborted) {
						reject(new DOMException('Aborted', 'AbortError'));
						return;
					}

					options.abortSignal?.addEventListener(
						'abort',
						() => reject(new DOMException('Aborted', 'AbortError')),
						{ once: true }
					);
				})
		);

		const pending = backend.complete(
			[{ role: 'user', content: 'abort this' }],
			MODEL_CATALOG[0].defaultSampling.sampling
		);
		backend.abort();
		await expect(pending).rejects.toThrow(/aborted/i);
	});
});
