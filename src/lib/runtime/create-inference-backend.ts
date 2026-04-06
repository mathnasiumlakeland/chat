import type { RuntimeKind } from '$lib/types/runtime';
import type { InferenceBackend } from './inference-backend';
import { GgufWasmBackend } from './gguf-wasm-backend';
import { OnnxWebgpuBackend } from './onnx-webgpu-backend';

export function createInferenceBackend(runtimeKind: RuntimeKind): InferenceBackend {
	switch (runtimeKind) {
		case 'gguf-wasm':
			return new GgufWasmBackend();
		case 'onnx-webgpu':
			return new OnnxWebgpuBackend();
		default: {
			const exhaustiveCheck: never = runtimeKind;
			throw new Error(`Unsupported runtime kind: ${exhaustiveCheck}`);
		}
	}
}
