import { describe, expect, it } from 'vitest';
import { createInferenceBackend } from './create-inference-backend';

describe('createInferenceBackend', () => {
	it('selects the GGUF WASM backend for Prism GGUF models', () => {
		expect(createInferenceBackend('gguf-wasm').constructor.name).toBe('GgufWasmBackend');
	});

	it('selects the ONNX WebGPU placeholder backend for future runtimes', () => {
		expect(createInferenceBackend('onnx-webgpu').constructor.name).toBe('OnnxWebgpuBackend');
	});
});
