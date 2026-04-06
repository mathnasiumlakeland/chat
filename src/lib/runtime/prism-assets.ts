import { base } from '$app/paths';

export interface PrismRuntimeManifest {
	asyncifyDiagnostics: string;
	builtAt: string;
	commandSubmitBatchSize: string;
	cpuProfile: string;
	declareAsmModuleExports: string;
	exceptionFlag: string;
	ggmlWebgpuJspi: string;
	gpuProfile: string;
	numParamBuffers: string;
	optimizationLevel: string;
	paramUploadMode: string;
	patchVendorBundle: string;
	runtimeBridge: string;
	runtimePreset: string;
}

export interface PrismRuntimeAssets {
	runtimeManifest: PrismRuntimeManifest;
	runtimeManifestUrl: string;
	runtimeScriptUrl: string;
	runtimeWasmUrl: string;
}

function withBasePath(path: string): string {
	return `${base}${path}`;
}

export const PRISM_RUNTIME_ASSETS = {
	runtimeScriptUrl: withBasePath('/runtime/prism/single-thread/wllama.js'),
	runtimeWasmUrl: withBasePath('/runtime/prism/single-thread/wllama.wasm'),
	runtimeManifestUrl: withBasePath('/runtime/prism/single-thread/runtime-manifest.json')
} as const;

const EXPECTED_RUNTIME_MANIFEST = {
	runtimeBridge: 'asyncify',
	runtimePreset: 'perf',
	paramUploadMode: 'queue-write-buffer',
	commandSubmitBatchSize: '64',
	numParamBuffers: '128'
} as const;

function formatManifestMismatch(manifest: PrismRuntimeManifest): string | null {
	for (const [field, expectedValue] of Object.entries(EXPECTED_RUNTIME_MANIFEST)) {
		const actualValue = manifest[field as keyof PrismRuntimeManifest];
		if (actualValue !== expectedValue) {
			return `${field}=${actualValue} (expected ${expectedValue})`;
		}
	}

	return null;
}

export async function verifyPrismRuntimeAssets(): Promise<PrismRuntimeAssets> {
	const [runtimeScript, runtimeWasm, manifestResponse] = await Promise.all([
		fetch(PRISM_RUNTIME_ASSETS.runtimeScriptUrl, { method: 'HEAD' }).catch(() => null),
		fetch(PRISM_RUNTIME_ASSETS.runtimeWasmUrl, { method: 'HEAD' }).catch(() => null),
		fetch(PRISM_RUNTIME_ASSETS.runtimeManifestUrl).catch(() => null)
	]);

	if (!runtimeScript?.ok || !runtimeWasm?.ok) {
		throw new Error(
			'Prism raw runtime assets are missing. Sync the validated Q1 runtime into /static/runtime/prism/single-thread.'
		);
	}

	if (!manifestResponse?.ok) {
		throw new Error(
			'Prism raw runtime manifest is missing. Re-sync the validated Q1 runtime into /static/runtime/prism/single-thread.'
		);
	}

	const runtimeManifest = (await manifestResponse.json()) as PrismRuntimeManifest;
	const manifestMismatch = formatManifestMismatch(runtimeManifest);
	if (manifestMismatch) {
		throw new Error(
			`Prism raw runtime assets do not match the validated Q1 WebGPU baseline: ${manifestMismatch}.`
		);
	}

	return {
		runtimeManifest,
		runtimeManifestUrl: PRISM_RUNTIME_ASSETS.runtimeManifestUrl,
		runtimeScriptUrl: PRISM_RUNTIME_ASSETS.runtimeScriptUrl,
		runtimeWasmUrl: PRISM_RUNTIME_ASSETS.runtimeWasmUrl
	};
}
