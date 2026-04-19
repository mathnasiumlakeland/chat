import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearPendingModelCachePurge,
	purgeCachedModelArtifactsForModelId,
	readPendingModelCachePurge,
	writePendingModelCachePurge
} from './model-artifact-cache';

describe('model artifact cache utilities', () => {
	const deleteSpy = vi.fn<(request: RequestInfo) => Promise<boolean>>();
	const keysSpy = vi.fn<() => Promise<Request[]>>();
	const openSpy = vi.fn();

	beforeEach(() => {
		deleteSpy.mockReset();
		keysSpy.mockReset();
		openSpy.mockReset();
		localStorage.clear();

		vi.stubGlobal('caches', {
			open: openSpy.mockResolvedValue({
				keys: keysSpy,
				delete: deleteSpy
			})
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('purges only the cached files for the requested ONNX model repo', async () => {
		keysSpy.mockResolvedValue([
			new Request('https://huggingface.co/onnx-community/Ternary-Bonsai-1.7B-ONNX/resolve/main/config.json'),
			new Request(
				'https://huggingface.co/onnx-community/Ternary-Bonsai-1.7B-ONNX/resolve/main/onnx/model_q2f16.onnx'
			),
			new Request('https://huggingface.co/onnx-community/Ternary-Bonsai-4B-ONNX/resolve/main/config.json')
		]);
		deleteSpy.mockResolvedValue(true);

		const deletedEntries = await purgeCachedModelArtifactsForModelId(
			'onnx-community/Ternary-Bonsai-1.7B-ONNX'
		);

		expect(openSpy).toHaveBeenCalledWith('transformers-cache');
		expect(deleteSpy).toHaveBeenCalledTimes(2);
		expect(deletedEntries).toBe(2);
	});

	it('stores and clears the pending purge marker', () => {
		writePendingModelCachePurge({
			modelId: 'onnx-community/Ternary-Bonsai-4B-ONNX',
			requestedAt: 123
		});

		expect(readPendingModelCachePurge()).toEqual({
			modelId: 'onnx-community/Ternary-Bonsai-4B-ONNX',
			requestedAt: 123
		});

		clearPendingModelCachePurge();
		expect(readPendingModelCachePurge()).toBeNull();
	});
});
