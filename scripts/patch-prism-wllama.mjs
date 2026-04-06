import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');

const singleThreadRuntime = await readFile(
	path.join(rootDir, 'static/runtime/prism/single-thread/wllama.js'),
	'utf8'
);
const multiThreadRuntime = await readFile(
	path.join(rootDir, 'static/runtime/prism/multi-thread/wllama.js'),
	'utf8'
);

function replaceSection(source, startMarker, endMarker, replacement, description) {
	const start = source.indexOf(startMarker);
	if (start === -1) {
		throw new Error(`Could not find start marker for ${description}.`);
	}

	const end = endMarker ? source.indexOf(endMarker, start) : source.length;
	if (end === -1) {
		throw new Error(`Could not find end marker for ${description}.`);
	}

	return source.slice(0, start) + replacement + source.slice(end);
}

async function patchSourceWorkers() {
	const filePath = path.join(rootDir, 'node_modules/@wllama/wllama/src/workers-code/generated.ts');
	let source = await readFile(filePath, 'utf8');

	source = source.replace(
		/export const LIBLLAMA_VERSION = '.*?';/,
		"export const LIBLLAMA_VERSION = 'prism-custom';"
	);
	source = replaceSection(
		source,
		'export const WLLAMA_MULTI_THREAD_CODE = ',
		'\n\nexport const WLLAMA_SINGLE_THREAD_CODE = ',
		`export const WLLAMA_MULTI_THREAD_CODE = ${JSON.stringify(multiThreadRuntime)};\n\nexport const WLLAMA_SINGLE_THREAD_CODE = `,
		'source multi-thread worker'
	);
	source = replaceSection(
		source,
		'export const WLLAMA_SINGLE_THREAD_CODE = ',
		'',
		`export const WLLAMA_SINGLE_THREAD_CODE = ${JSON.stringify(singleThreadRuntime)};\n`,
		'source single-thread worker'
	);
	source = source
		.replaceAll('m.HEAPU8.subarray', '(m.HEAPU8 ?? HEAPU8).subarray')
		.replaceAll('m.HEAPU8.set', '(m.HEAPU8 ?? HEAPU8).set')
		.replaceAll('Module.HEAPU8.buffer', '(Module.HEAPU8 ?? HEAPU8).buffer');

	await writeFile(filePath, source);
}

async function patchEsmWorkers() {
	const filePath = path.join(rootDir, 'node_modules/@wllama/wllama/esm/index.js');
	let source = await readFile(filePath, 'utf8');

	source = source.replace(
		/var LIBLLAMA_VERSION = ".*?";/,
		'var LIBLLAMA_VERSION = "prism-custom";'
	);
	source = replaceSection(
		source,
		'var WLLAMA_MULTI_THREAD_CODE = ',
		'\nvar WLLAMA_SINGLE_THREAD_CODE = ',
		`var WLLAMA_MULTI_THREAD_CODE = ${JSON.stringify(multiThreadRuntime)};\nvar WLLAMA_SINGLE_THREAD_CODE = `,
		'esm multi-thread worker'
	);
	source = replaceSection(
		source,
		'var WLLAMA_SINGLE_THREAD_CODE = ',
		'\n\n// src/worker.ts',
		`var WLLAMA_SINGLE_THREAD_CODE = ${JSON.stringify(singleThreadRuntime)};\n\n// src/worker.ts`,
		'esm single-thread worker'
	);
	source = source
		.replaceAll('m.HEAPU8.subarray', '(m.HEAPU8 ?? HEAPU8).subarray')
		.replaceAll('m.HEAPU8.set', '(m.HEAPU8 ?? HEAPU8).set')
		.replaceAll('Module.HEAPU8.buffer', '(Module.HEAPU8 ?? HEAPU8).buffer');

	await writeFile(filePath, source);
}

async function patchWorkerBridge() {
	const workerSourcePath = path.join(rootDir, 'node_modules/@wllama/wllama/src/worker.ts');
	let workerSource = await readFile(workerSourcePath, 'utf8');

	workerSource = workerSource.replace(
		"`function wModuleInit() { ${mainModuleCode}; return Module; }`,",
		"`function wModuleInit() { ${mainModuleCode}; Object.defineProperties(Module, { HEAP8: { get() { return HEAP8; } }, HEAPU8: { get() { return HEAPU8; } }, HEAP32: { get() { return HEAP32; } }, HEAPU32: { get() { return HEAPU32; } } }); return Module; }`,"
	);

	await writeFile(workerSourcePath, workerSource);
}

await patchSourceWorkers();
await patchEsmWorkers();
await patchWorkerBridge();

console.log('Patched @wllama/wllama with Prism-generated worker wrappers.');
