import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_CATALOG } from '$lib/constants/models';
import type { SamplingConfig } from '$lib/types/runtime';

type WorkerMessageListener = (event: MessageEvent) => void;

class MockWorker {
	static instances: MockWorker[] = [];

	listeners = new Set<WorkerMessageListener>();
	postMessage = vi.fn((message: Record<string, unknown>) => {
		this.lastPostedMessage = message;
	});
	terminate = vi.fn();
	lastPostedMessage: Record<string, unknown> | null = null;

	constructor(_url: URL, _options: WorkerOptions) {
		MockWorker.instances.push(this);
	}

	addEventListener(_type: 'message', listener: WorkerMessageListener) {
		this.listeners.add(listener);
	}

	removeEventListener(_type: 'message', listener: WorkerMessageListener) {
		this.listeners.delete(listener);
	}

	emit(message: Record<string, unknown>) {
		for (const listener of this.listeners) {
			listener({ data: message } as MessageEvent);
		}
	}
}

describe('OnnxWebgpuBackend', () => {
	beforeEach(() => {
		MockWorker.instances = [];
		vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
		vi.stubGlobal(
			'navigator',
			Object.assign(globalThis.navigator ?? {}, {
				gpu: {}
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('loads the ONNX WebGPU worker-backed runtime and exposes runtime metadata', async () => {
		const { OnnxWebgpuBackend } = await import('./onnx-webgpu-backend');
		const backend = new OnnxWebgpuBackend();
		const model = MODEL_CATALOG[0];
		const loadPromise = backend.load(model, { contextTokens: model.contextTokens });
		await Promise.resolve();
		const worker = MockWorker.instances[0];

		expect(worker).toBeDefined();
		expect(worker.lastPostedMessage).toMatchObject({
			type: 'load',
			data: {
				modelKey: '1.7b'
			}
		});

		const requestId = Number(worker.lastPostedMessage?.requestId);
		worker.emit({
			status: 'ready',
			requestId
		});

		await loadPromise;

		expect(backend.getRuntimeInfo()).toMatchObject({
			runtimeKind: 'onnx-webgpu',
			modelId: model.id,
			contextTokens: model.contextTokens,
			usesMultithread: false,
			library: 'Transformers.js WebGPU (q2f16)'
		});
	});

	it('streams updates from the worker and resolves with the final response', async () => {
		const { OnnxWebgpuBackend } = await import('./onnx-webgpu-backend');
		const backend = new OnnxWebgpuBackend();
		const model = MODEL_CATALOG[0];
		const loadPromise = backend.load(model);
		await Promise.resolve();
		const worker = MockWorker.instances[0];
		const loadRequestId = Number(worker.lastPostedMessage?.requestId);
		worker.emit({ status: 'ready', requestId: loadRequestId });
		await loadPromise;

		const chunks: string[] = [];
		let decodedTokens = 0;
		const completionPromise = backend.complete(
			[{ role: 'user', content: 'hello' }],
			model.defaultSampling.sampling,
			{
				onToken: (chunk) => chunks.push(chunk),
				onTokenDecoded: () => {
					decodedTokens += 1;
				}
			},
			{ nPredict: 64 }
		);

		expect(worker.lastPostedMessage).toMatchObject({
			type: 'generate',
			data: {
				messages: [{ role: 'user', content: 'hello' }],
				maxNewTokens: 64
			}
		});

		const generateRequestId = Number(worker.lastPostedMessage?.requestId);
		worker.emit({
			status: 'update',
			requestId: generateRequestId,
			output: 'Bon',
			numTokens: 1,
			tps: 10
		});
		worker.emit({
			status: 'update',
			requestId: generateRequestId,
			output: 'sai',
			numTokens: 2,
			tps: 12
		});
		worker.emit({
			status: 'complete',
			requestId: generateRequestId,
			output: 'Bonsai'
		});

		await expect(completionPromise).resolves.toBe('Bonsai');
		expect(chunks).toEqual(['Bon', 'sai']);
		expect(decodedTokens).toBe(2);
	});

	it('aborts the active generation when requested', async () => {
		const { OnnxWebgpuBackend } = await import('./onnx-webgpu-backend');
		const backend = new OnnxWebgpuBackend();
		const model = MODEL_CATALOG[0];
		const loadPromise = backend.load(model);
		await Promise.resolve();
		const worker = MockWorker.instances[0];
		const loadRequestId = Number(worker.lastPostedMessage?.requestId);
		worker.emit({ status: 'ready', requestId: loadRequestId });
		await loadPromise;

		const completionPromise = backend.complete(
			[{ role: 'user', content: 'abort this' }],
			model.defaultSampling.sampling satisfies SamplingConfig
		);
		const generateRequestId = Number(worker.lastPostedMessage?.requestId);

		backend.abort();

		expect(worker.lastPostedMessage).toMatchObject({
			type: 'interrupt',
			requestId: generateRequestId
		});
		await expect(completionPromise).rejects.toThrow(/aborted/i);
	});

	it('reuses the same worker across model loads and only resets generation state', async () => {
		const { OnnxWebgpuBackend } = await import('./onnx-webgpu-backend');
		const backend = new OnnxWebgpuBackend();
		const firstModel = MODEL_CATALOG[0];
		const secondModel = MODEL_CATALOG[1];

		const firstLoad = backend.load(firstModel);
		await Promise.resolve();
		const worker = MockWorker.instances[0];
		const firstLoadRequestId = Number(worker.lastPostedMessage?.requestId);
		worker.emit({ status: 'ready', requestId: firstLoadRequestId });
		await firstLoad;

		const secondLoad = backend.load(secondModel);
		await Promise.resolve();

		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.postMessage).toHaveBeenCalledWith({ type: 'reset' });
		expect(MockWorker.instances).toHaveLength(1);
		expect(worker.lastPostedMessage).toMatchObject({
			type: 'load',
			data: {
				modelKey: '4b'
			}
		});

		const secondLoadRequestId = Number(worker.lastPostedMessage?.requestId);
		worker.emit({ status: 'ready', requestId: secondLoadRequestId });
		await secondLoad;

		expect(backend.getRuntimeInfo()).toMatchObject({
			modelId: secondModel.id
		});
	});

	it('terminates the worker and clears runtime state on unload', async () => {
		const { OnnxWebgpuBackend } = await import('./onnx-webgpu-backend');
		const backend = new OnnxWebgpuBackend();
		const model = MODEL_CATALOG[0];
		const loadPromise = backend.load(model);
		await Promise.resolve();
		const worker = MockWorker.instances[0];
		const loadRequestId = Number(worker.lastPostedMessage?.requestId);
		worker.emit({ status: 'ready', requestId: loadRequestId });
		await loadPromise;

		await backend.unload();

		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(backend.getRuntimeInfo()).toBeNull();
	});
});
