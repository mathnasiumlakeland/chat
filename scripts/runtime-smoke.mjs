import { chromium } from 'playwright';

const runtimeSmokeUrl = process.env.RUNTIME_SMOKE_URL;

if (!runtimeSmokeUrl) {
	console.error(
		'RUNTIME_SMOKE_URL is required, for example: RUNTIME_SMOKE_URL=http://127.0.0.1:4174/runtime-smoke.html bun run test:runtime'
	);
	process.exit(1);
}

const prompt =
	process.env.RUNTIME_SMOKE_PROMPT ??
	'Reply with exactly one short sentence saying hello from Bonsai.';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(0);

page.on('console', (msg) => {
	console.log(`[browser:${msg.type()}] ${msg.text()}`);
});

page.on('pageerror', (error) => {
	console.error('[pageerror]', error.stack || error.message);
});

page.on('crash', () => {
	console.error('[page] crash');
});

try {
	await page.goto(runtimeSmokeUrl, {
		waitUntil: 'domcontentloaded',
		timeout: 120_000
	});

	const result = await page.evaluate(async ({ selectedPrompt }) => {
		const chunks = [];
		const errors = [];

		window.addEventListener('error', (event) => {
			errors.push(String(event.error?.stack || event.error || event.message));
		});

		const [{ GgufWasmBackend }, { MODEL_CATALOG }] = await Promise.all([
			import('/src/lib/runtime/gguf-wasm-backend.ts'),
			import('/src/lib/constants/models.ts')
		]);

		const backend = new GgufWasmBackend();
		const model = MODEL_CATALOG[0];
		const loadProgress = [];
		const startedAt = Date.now();

		await backend.load(model, {
			contextTokens: model.contextTokens,
			progressCallback: ({ loaded, total }) => {
				loadProgress.push({ loaded, total });
			}
		});

		const runtimeInfo = backend.getRuntimeInfo();
		const output = await backend.complete(
			[{ role: 'user', content: selectedPrompt }],
			model.defaultSampling.sampling,
			{
				onToken: (chunk) => chunks.push(chunk)
			},
			{ nPredict: 64 }
		);

		await backend.unload();

		return {
			prompt: selectedPrompt,
			output,
			chunks,
			errors,
			loadProgressEvents: loadProgress.length,
			elapsedMs: Date.now() - startedAt,
			crossOriginIsolated: globalThis.crossOriginIsolated,
			sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
			runtimeInfo
		};
	}, { selectedPrompt: prompt });

	if (result.errors.length > 0) {
		throw new Error(`Browser runtime emitted errors:\n${result.errors.join('\n')}`);
	}

	if (!result.output.trim()) {
		throw new Error('Browser runtime returned an empty response.');
	}

	console.log(JSON.stringify(result, null, 2));
} finally {
	await page.close().catch(() => {});
	await browser.close().catch(() => {});
}
