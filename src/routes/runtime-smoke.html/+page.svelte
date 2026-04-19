<script lang="ts">
	import { onMount } from 'svelte';
	import { MODEL_CATALOG } from '$lib/constants/models';
	import { createInferenceBackend } from '$lib/runtime/create-inference-backend';
	import type { RuntimeInfo } from '$lib/types/runtime';

	interface RuntimeSmokeResult {
		chunks: string[];
		crossOriginIsolated: boolean;
		elapsedMs: number;
		errors: string[];
		loadProgressEvents: number;
		output: string;
		prompt: string;
		runtimeInfo: RuntimeInfo | null;
		sharedArrayBuffer: boolean;
	}

	type RuntimeSmokeWindow = Window & {
		__bonsaiRuntimeSmokeReady?: boolean;
		__runBonsaiRuntimeSmoke?: (selectedPrompt: string) => Promise<RuntimeSmokeResult>;
	};

	let status = $state('Preparing runtime smoke harness...');
	let lastError = $state<string | null>(null);
	let lastResult = $state<RuntimeSmokeResult | null>(null);

	async function runRuntimeSmoke(selectedPrompt: string): Promise<RuntimeSmokeResult> {
		const chunks: string[] = [];
		const errors: string[] = [];
		const model = MODEL_CATALOG[0];
		const backend = createInferenceBackend(model.runtimeKind);
		const startedAt = Date.now();
		let loadProgressEvents = 0;

		const handleWindowError = (event: ErrorEvent) => {
			errors.push(String(event.error?.stack || event.error || event.message));
		};

		window.addEventListener('error', handleWindowError);

		try {
				status = `Loading ${model.id}`;
			lastError = null;

			await backend.load(model, {
				contextTokens: model.contextTokens,
				progressCallback: ({ loaded, total }) => {
					loadProgressEvents += 1;

					if (!total) {
						status = `Downloading model: ${(loaded / 1024 / 1024).toFixed(1)} MB`;
						return;
					}

					const percent = ((loaded / total) * 100).toFixed(1);
					status = `Downloading model: ${percent}% (${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`;
				}
			});

			status = 'Generating runtime smoke response...';
			const runtimeInfo = backend.getRuntimeInfo();
			const output = await backend.complete(
				[{ role: 'user', content: selectedPrompt }],
				model.defaultSampling.sampling,
				{
					onToken: (chunk) => chunks.push(chunk)
				},
				{ nPredict: 64 }
			);

			if (errors.length > 0) {
				throw new Error(`Browser runtime emitted errors:\n${errors.join('\n')}`);
			}

			if (!output.trim()) {
				throw new Error('Browser runtime returned an empty response.');
			}

			const result: RuntimeSmokeResult = {
				prompt: selectedPrompt,
				output,
				chunks,
				errors,
				loadProgressEvents,
				elapsedMs: Date.now() - startedAt,
				crossOriginIsolated: globalThis.crossOriginIsolated,
				sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
				runtimeInfo
			};

			lastResult = result;
			status = 'Runtime smoke completed.';
			return result;
		} catch (error) {
			lastError = error instanceof Error ? error.stack || error.message : String(error);
			status = 'Runtime smoke failed.';
			throw error;
		} finally {
			window.removeEventListener('error', handleWindowError);
			await backend.unload().catch(() => {});
		}
	}

	onMount(() => {
		const runtimeSmokeWindow = window as RuntimeSmokeWindow;
		runtimeSmokeWindow.__runBonsaiRuntimeSmoke = runRuntimeSmoke;
		runtimeSmokeWindow.__bonsaiRuntimeSmokeReady = true;
		status = 'Runtime smoke harness ready.';

		return () => {
			delete runtimeSmokeWindow.__runBonsaiRuntimeSmoke;
			delete runtimeSmokeWindow.__bonsaiRuntimeSmokeReady;
		};
	});
</script>

<svelte:head>
	<title>Runtime Smoke</title>
</svelte:head>

<div class="runtime-smoke">
	<h1>Runtime Smoke</h1>
	<p>{status}</p>

	{#if lastError}
		<pre class="error">{lastError}</pre>
	{/if}

	{#if lastResult}
		<pre>{JSON.stringify(lastResult, null, 2)}</pre>
	{/if}
</div>

<style>
	.runtime-smoke {
		padding: 1.5rem;
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
	}

	h1 {
		margin: 0 0 0.75rem;
		font-size: 1.1rem;
	}

	p {
		margin: 0 0 1rem;
	}

	pre {
		margin: 0;
		padding: 1rem;
		border-radius: 0.75rem;
		background: #111827;
		color: #f9fafb;
		overflow: auto;
	}

	.error {
		margin-bottom: 1rem;
		background: #450a0a;
		color: #fecaca;
	}
</style>
