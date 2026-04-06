import type {
	InferenceCompletionHandlers,
	InferenceLoadProgress,
	SamplingConfig
} from '$lib/types/runtime';
import type { PrismRuntimeAssets } from './prism-assets';

export interface RawQ1WebgpuDispatchTuning {
	submitBatchSize: number;
	paramBufferLimit: number;
}

export interface RawQ1WebgpuDispatchPlan {
	mode: 'static-latency' | 'static-throughput' | 'phase-split';
	load: RawQ1WebgpuDispatchTuning;
	prefill: RawQ1WebgpuDispatchTuning;
	firstToken: RawQ1WebgpuDispatchTuning;
	decode: RawQ1WebgpuDispatchTuning;
}

export interface RawQ1LoadConfig {
	nCtx: number;
	nBatch: number;
	nThreads: number;
	nGpuLayers: number;
	offloadKqv: boolean;
	dispatchPlan: RawQ1WebgpuDispatchPlan;
	progressCallback?: (progress: InferenceLoadProgress) => void;
}

export interface RawQ1CompletionOptions {
	abortSignal?: AbortSignal;
	dispatchPlan: RawQ1WebgpuDispatchPlan;
	maxTokens: number;
}

interface RawQ1LoadResponse {
	success: boolean;
	n_ctx: number;
	n_batch: number;
	n_ubatch: number;
	n_vocab: number;
	n_ctx_train: number;
	n_embd: number;
	n_layer: number;
	metadata_key: string[];
	metadata_val: string[];
	token_bos: number;
	token_eos: number;
	token_eot: number;
	list_tokens_eog: number[];
	add_bos_token: boolean;
	add_eos_token: boolean;
	has_encoder: boolean;
	token_decoder_start: number;
}

interface RawQ1RuntimeLogger {
	info?: (...args: unknown[]) => void;
	log?: (...args: unknown[]) => void;
	warn?: (...args: unknown[]) => void;
	error?: (...args: unknown[]) => void;
}

interface RuntimeModule extends Record<string, unknown> {
	ccall: (
		identifier: string,
		returnType: string | null,
		argTypes?: string[],
		args?: unknown[],
		options?: { async?: boolean }
	) => Promise<unknown>;
	__q1MemfsPatched?: boolean;
}

interface RawFilesystem extends Record<string, unknown> {
	mkdir: (path: string) => void;
	mount: (filesystem: unknown, options: { root: string }, target: string) => void;
	createDataFile?: (
		parent: string,
		name: string,
		data: Uint8Array,
		canRead: boolean,
		canWrite: boolean,
		canOwn: boolean
	) => void;
}

interface RawMemfsStreamOps extends Record<string, unknown> {
	read: (...args: unknown[]) => unknown;
	llseek: (...args: unknown[]) => unknown;
	mmap: (...args: unknown[]) => unknown;
	_read?: (...args: unknown[]) => unknown;
	_llseek?: (...args: unknown[]) => unknown;
	_mmap?: (...args: unknown[]) => unknown;
}

interface RawMemfs extends Record<string, unknown> {
	stream_ops: RawMemfsStreamOps;
	ops_table: {
		file: {
			stream: {
				read: (...args: unknown[]) => unknown;
				llseek: (...args: unknown[]) => unknown;
				mmap: (...args: unknown[]) => unknown;
			};
		};
	};
}

interface RawRuntimeGlobalState {
	HEAPU8?: Uint8Array;
	FS?: RawFilesystem;
	FS_createDataFile?: RawFilesystem['createDataFile'];
	MEMFS?: RawMemfs;
	Module?: RuntimeModule;
	mmapAlloc?: (size: number) => number;
	__q1WebgpuDispatchTuning?: RawQ1WebgpuDispatchTuning;
}

interface FileAllocation {
	id: number;
	ptr: number;
	size: number;
}

interface GlueFieldDef {
	type: GlueFieldType;
	name: string;
	isNullable: boolean;
}

type GlueFieldType =
	| 'arr_float'
	| 'arr_int'
	| 'arr_str'
	| 'bool'
	| 'float'
	| 'int'
	| 'raw'
	| 'str';

type GlueMessageName =
	| 'deco_req'
	| 'deco_res'
	| 'kvcc_req'
	| 'kvcc_res'
	| 'load_req'
	| 'load_res'
	| 'sacc_req'
	| 'sacc_res'
	| 'sint_req'
	| 'sint_res'
	| 'ssam_req'
	| 'ssam_res'
	| 'tokn_req'
	| 'tokn_res';

const GLUE_VERSION = 1;
const GLUE_MAGIC = new Uint8Array([71, 76, 85, 69]);
const GLUE_DTYPE_NULL = 0;
const GLUE_DTYPE_BOOL = 1;
const GLUE_DTYPE_INT = 2;
const GLUE_DTYPE_FLOAT = 3;
const GLUE_DTYPE_STRING = 4;
const GLUE_DTYPE_RAW = 5;
const GLUE_DTYPE_ARRAY_INT = 7;
const GLUE_DTYPE_ARRAY_FLOAT = 8;
const GLUE_DTYPE_ARRAY_STRING = 9;

const TYPE_MAP: Record<GlueFieldType, number> = {
	str: GLUE_DTYPE_STRING,
	int: GLUE_DTYPE_INT,
	float: GLUE_DTYPE_FLOAT,
	bool: GLUE_DTYPE_BOOL,
	raw: GLUE_DTYPE_RAW,
	arr_str: GLUE_DTYPE_ARRAY_STRING,
	arr_int: GLUE_DTYPE_ARRAY_INT,
	arr_float: GLUE_DTYPE_ARRAY_FLOAT
};

const GLUE_MESSAGE_PROTOTYPES: Record<GlueMessageName, { fields: GlueFieldDef[] }> = {
	load_req: {
		fields: [
			{ type: 'arr_str', name: 'model_paths', isNullable: false },
			{ type: 'bool', name: 'n_ctx_auto', isNullable: false },
			{ type: 'bool', name: 'use_mmap', isNullable: false },
			{ type: 'bool', name: 'use_mlock', isNullable: false },
			{ type: 'int', name: 'n_gpu_layers', isNullable: false },
			{ type: 'int', name: 'seed', isNullable: false },
			{ type: 'int', name: 'n_ctx', isNullable: false },
			{ type: 'int', name: 'n_threads', isNullable: false },
			{ type: 'bool', name: 'embeddings', isNullable: true },
			{ type: 'bool', name: 'offload_kqv', isNullable: true },
			{ type: 'int', name: 'n_batch', isNullable: true },
			{ type: 'int', name: 'n_seq_max', isNullable: true },
			{ type: 'str', name: 'pooling_type', isNullable: true },
			{ type: 'str', name: 'rope_scaling_type', isNullable: true },
			{ type: 'float', name: 'rope_freq_base', isNullable: true },
			{ type: 'float', name: 'rope_freq_scale', isNullable: true },
			{ type: 'float', name: 'yarn_ext_factor', isNullable: true },
			{ type: 'float', name: 'yarn_attn_factor', isNullable: true },
			{ type: 'float', name: 'yarn_beta_fast', isNullable: true },
			{ type: 'float', name: 'yarn_beta_slow', isNullable: true },
			{ type: 'int', name: 'yarn_orig_ctx', isNullable: true },
			{ type: 'str', name: 'cache_type_k', isNullable: true },
			{ type: 'str', name: 'cache_type_v', isNullable: true },
			{ type: 'bool', name: 'flash_attn', isNullable: true },
			{ type: 'bool', name: 'swa_full', isNullable: true }
		]
	},
	load_res: {
		fields: [
			{ type: 'bool', name: 'success', isNullable: false },
			{ type: 'int', name: 'n_ctx', isNullable: false },
			{ type: 'int', name: 'n_batch', isNullable: false },
			{ type: 'int', name: 'n_ubatch', isNullable: false },
			{ type: 'int', name: 'n_vocab', isNullable: false },
			{ type: 'int', name: 'n_ctx_train', isNullable: false },
			{ type: 'int', name: 'n_embd', isNullable: false },
			{ type: 'int', name: 'n_layer', isNullable: false },
			{ type: 'arr_str', name: 'metadata_key', isNullable: false },
			{ type: 'arr_str', name: 'metadata_val', isNullable: false },
			{ type: 'int', name: 'token_bos', isNullable: false },
			{ type: 'int', name: 'token_eos', isNullable: false },
			{ type: 'int', name: 'token_eot', isNullable: false },
			{ type: 'arr_int', name: 'list_tokens_eog', isNullable: false },
			{ type: 'bool', name: 'add_bos_token', isNullable: false },
			{ type: 'bool', name: 'add_eos_token', isNullable: false },
			{ type: 'bool', name: 'has_encoder', isNullable: false },
			{ type: 'int', name: 'token_decoder_start', isNullable: false }
		]
	},
	sint_req: {
		fields: [
			{ type: 'int', name: 'mirostat', isNullable: true },
			{ type: 'float', name: 'mirostat_tau', isNullable: true },
			{ type: 'float', name: 'mirostat_eta', isNullable: true },
			{ type: 'float', name: 'temp', isNullable: true },
			{ type: 'float', name: 'top_p', isNullable: true },
			{ type: 'int', name: 'top_k', isNullable: true },
			{ type: 'int', name: 'penalty_last_n', isNullable: true },
			{ type: 'float', name: 'penalty_repeat', isNullable: true },
			{ type: 'float', name: 'penalty_freq', isNullable: true },
			{ type: 'float', name: 'penalty_present', isNullable: true },
			{ type: 'float', name: 'dynatemp_range', isNullable: true },
			{ type: 'float', name: 'dynatemp_exponent', isNullable: true },
			{ type: 'arr_str', name: 'samplers_sequence', isNullable: true },
			{ type: 'str', name: 'grammar', isNullable: true },
			{ type: 'int', name: 'n_prev', isNullable: true },
			{ type: 'int', name: 'n_probs', isNullable: true },
			{ type: 'float', name: 'min_p', isNullable: true },
			{ type: 'float', name: 'typical_p', isNullable: true },
			{ type: 'float', name: 'typ_p', isNullable: true },
			{ type: 'arr_int', name: 'logit_bias_toks', isNullable: true },
			{ type: 'arr_float', name: 'logit_bias_vals', isNullable: true },
			{ type: 'arr_int', name: 'tokens', isNullable: true }
		]
	},
	sint_res: {
		fields: [{ type: 'bool', name: 'success', isNullable: false }]
	},
	tokn_req: {
		fields: [
			{ type: 'str', name: 'text', isNullable: false },
			{ type: 'bool', name: 'special', isNullable: false }
		]
	},
	tokn_res: {
		fields: [
			{ type: 'bool', name: 'success', isNullable: false },
			{ type: 'arr_int', name: 'tokens', isNullable: false }
		]
	},
	deco_req: {
		fields: [
			{ type: 'arr_int', name: 'tokens', isNullable: false },
			{ type: 'bool', name: 'skip_logits', isNullable: false }
		]
	},
	deco_res: {
		fields: [
			{ type: 'bool', name: 'success', isNullable: false },
			{ type: 'str', name: 'message', isNullable: false },
			{ type: 'int', name: 'n_past', isNullable: false }
		]
	},
	ssam_req: { fields: [] },
	ssam_res: {
		fields: [
			{ type: 'bool', name: 'success', isNullable: false },
			{ type: 'raw', name: 'piece', isNullable: false },
			{ type: 'int', name: 'token', isNullable: false }
		]
	},
	sacc_req: {
		fields: [{ type: 'arr_int', name: 'tokens', isNullable: false }]
	},
	sacc_res: {
		fields: [{ type: 'bool', name: 'success', isNullable: false }]
	},
	kvcc_req: { fields: [] },
	kvcc_res: {
		fields: [
			{ type: 'int', name: 'n_past', isNullable: false },
			{ type: 'bool', name: 'success', isNullable: false }
		]
	}
};

const rawGlobal = globalThis as typeof globalThis & RawRuntimeGlobalState;
const encoder = new TextEncoder();

const fsNameToFile: Record<string, FileAllocation> = {};
const fsIdToFile: Record<number, FileAllocation> = {};
let currentFileId = 0;

function createAbortError(): Error {
	if (typeof DOMException !== 'undefined') {
		return new DOMException('Aborted', 'AbortError');
	}

	const error = new Error('Aborted');
	error.name = 'AbortError';
	return error;
}

function safeModuleProp<T>(module: RuntimeModule | null, name: string): T | undefined {
	if (!module) {
		return undefined;
	}

	const descriptor = Object.getOwnPropertyDescriptor(module, name);
	if (!descriptor) {
		return undefined;
	}

	if ('value' in descriptor) {
		return descriptor.value as T;
	}

	return descriptor.get?.call(module) as T | undefined;
}

function getHeapU8(module: RuntimeModule | null): Uint8Array {
	const heap = rawGlobal.HEAPU8 ?? safeModuleProp<Uint8Array>(module, 'HEAPU8');
	if (!heap) {
		throw new Error('HEAPU8 is not reachable from the raw runtime.');
	}

	return heap;
}

function getFS(module: RuntimeModule | null): RawFilesystem {
	const fs = rawGlobal.FS ?? safeModuleProp<RawFilesystem>(module, 'FS');
	if (!fs) {
		throw new Error('FS is not reachable from the raw runtime.');
	}

	return fs;
}

function getMemfs(module: RuntimeModule | null): RawMemfs {
	const fsRecord = getFS(module) as RawFilesystem & {
		filesystems?: {
			MEMFS?: RawMemfs;
		};
	};
	const memfs =
		rawGlobal.MEMFS ??
		safeModuleProp<RawMemfs>(module, 'MEMFS') ??
		fsRecord.filesystems?.MEMFS;
	if (!memfs) {
		throw new Error('MEMFS is not reachable from the raw runtime.');
	}

	return memfs;
}

function getMmapAlloc(module: RuntimeModule | null): (size: number) => number {
	const mmapAlloc =
		rawGlobal.mmapAlloc ?? safeModuleProp<(size: number) => number>(module, 'mmapAlloc');
	if (!mmapAlloc) {
		throw new Error('mmapAlloc is not reachable from the raw runtime.');
	}

	return mmapAlloc;
}

function patchMemfs(module: RuntimeModule): void {
	if (module.__q1MemfsPatched) {
		return;
	}

	const memfs = getMemfs(module);
	const fs = getFS(module);

	memfs.stream_ops._read = memfs.stream_ops.read;
	memfs.stream_ops._llseek = memfs.stream_ops.llseek;
	memfs.stream_ops._mmap = memfs.stream_ops.mmap;

	const patchStream = (stream: { node: { name: string; contents?: Uint8Array; usedBytes?: number } }) => {
		const file = fsNameToFile[stream.node.name];
		if (!file) {
			return;
		}

		stream.node.contents = getHeapU8(module).subarray(file.ptr, file.ptr + file.size);
		stream.node.usedBytes = file.size;
	};

	memfs.stream_ops.read = (...args: unknown[]) => {
		patchStream(args[0] as Parameters<typeof patchStream>[0]);
		return memfs.stream_ops._read?.(...args);
	};
	memfs.ops_table.file.stream.read = memfs.stream_ops.read;

	memfs.stream_ops.llseek = (...args: unknown[]) => {
		patchStream(args[0] as Parameters<typeof patchStream>[0]);
		return memfs.stream_ops._llseek?.(...args);
	};
	memfs.ops_table.file.stream.llseek = memfs.stream_ops.llseek;

	memfs.stream_ops.mmap = (...args: unknown[]) => {
		const stream = args[0] as Parameters<typeof patchStream>[0];
		const position = args[2] as number;
		patchStream(stream);

		const file = fsNameToFile[stream.node.name];
		if (!file) {
			return memfs.stream_ops._mmap?.(...args);
		}

		return {
			ptr: file.ptr + position,
			allocated: false
		};
	};
	memfs.ops_table.file.stream.mmap = memfs.stream_ops.mmap;

	try {
		fs.mkdir('/models');
	} catch {
		// The mount path already exists on subsequent initializations.
	}

	fs.mount(memfs, { root: '.' }, '/models');
	module.__q1MemfsPatched = true;
}

function heapfsAlloc(module: RuntimeModule, name: string, size: number): FileAllocation {
	if (size <= 0) {
		throw new Error('File size must be greater than zero.');
	}

	const ptr = getMmapAlloc(module)(size);
	const file = {
		id: currentFileId,
		ptr,
		size
	};

	currentFileId += 1;
	fsIdToFile[file.id] = file;
	fsNameToFile[name] = file;
	return file;
}

function heapfsWrite(module: RuntimeModule, fileId: number, buffer: Uint8Array, offset: number): void {
	const file = fsIdToFile[fileId];
	if (!file) {
		throw new Error(`Unknown heapfs file id ${fileId}.`);
	}

	const end = offset + buffer.byteLength;
	if (end > file.size) {
		throw new Error(`Write past end of ${fileId}: ${end} > ${file.size}.`);
	}

	getHeapU8(module).set(buffer, file.ptr + offset);
}

function glueSerialize(message: Record<string, unknown> & { _name: GlueMessageName }): Uint8Array {
	const prototypeDef = GLUE_MESSAGE_PROTOTYPES[message._name];
	const buffers: Uint8Array[] = [];

	const writeUint32 = (value: number) => {
		const buffer = new ArrayBuffer(4);
		new DataView(buffer).setUint32(0, value, true);
		buffers.push(new Uint8Array(buffer));
	};

	const writeInt32 = (value: number) => {
		const buffer = new ArrayBuffer(4);
		new DataView(buffer).setInt32(0, value, true);
		buffers.push(new Uint8Array(buffer));
	};

	const writeFloat = (value: number) => {
		const buffer = new ArrayBuffer(4);
		new DataView(buffer).setFloat32(0, value, true);
		buffers.push(new Uint8Array(buffer));
	};

	const writeBool = (value: boolean) => writeUint32(value ? 1 : 0);

	const writeString = (value: string) => {
		const utf8 = encoder.encode(value);
		writeUint32(utf8.byteLength);
		buffers.push(utf8);
	};

	const writeRaw = (value: Uint8Array) => {
		writeUint32(value.byteLength);
		buffers.push(value);
	};

	const writeArray = <T>(value: T[], writeItem: (item: T) => void) => {
		writeUint32(value.length);
		for (const item of value) {
			writeItem(item);
		}
	};

	buffers.push(GLUE_MAGIC);
	writeUint32(GLUE_VERSION);
	buffers.push(encoder.encode(message._name));

	for (const field of prototypeDef.fields) {
		const value = message[field.name];
		if (!field.isNullable && (value === null || value === undefined)) {
			throw new Error(`${message._name}: missing field ${field.name}.`);
		}

		if (value === null || value === undefined) {
			writeUint32(GLUE_DTYPE_NULL);
			continue;
		}

		writeUint32(TYPE_MAP[field.type]);

		switch (field.type) {
			case 'str':
				writeString(value as string);
				break;
			case 'int':
				writeInt32(value as number);
				break;
			case 'float':
				writeFloat(value as number);
				break;
			case 'bool':
				writeBool(value as boolean);
				break;
			case 'raw':
				writeRaw(value as Uint8Array);
				break;
			case 'arr_str':
				writeArray(value as string[], writeString);
				break;
			case 'arr_int':
				writeArray(value as number[], writeInt32);
				break;
			case 'arr_float':
				writeArray(value as number[], writeFloat);
				break;
		}
	}

	const totalSize = buffers.reduce((size, buffer) => size + buffer.byteLength, 0);
	const output = new Uint8Array(totalSize);
	let offset = 0;

	for (const buffer of buffers) {
		output.set(buffer, offset);
		offset += buffer.byteLength;
	}

	return output;
}

function glueDeserialize(buffer: Uint8Array): Record<string, unknown> & { _name: GlueMessageName } {
	let offset = 0;
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const decoder = new TextDecoder();

	const readUint32 = () => {
		const value = view.getUint32(offset, true);
		offset += 4;
		return value;
	};

	const readInt32 = () => {
		const value = view.getInt32(offset, true);
		offset += 4;
		return value;
	};

	const readFloat = () => {
		const value = view.getFloat32(offset, true);
		offset += 4;
		return value;
	};

	const readBool = () => readUint32() !== 0;

	const readString = (length = readUint32()) => {
		const value = decoder.decode(buffer.slice(offset, offset + length));
		offset += length;
		return value;
	};

	const readRaw = () => {
		const length = readUint32();
		const value = buffer.slice(offset, offset + length);
		offset += length;
		return value;
	};

	const readArray = <T>(readItem: () => T): T[] => {
		const length = readUint32();
		const values: T[] = [];
		for (let index = 0; index < length; index += 1) {
			values.push(readItem());
		}
		return values;
	};

	const isMagicValid =
		buffer[0] === GLUE_MAGIC[0] &&
		buffer[1] === GLUE_MAGIC[1] &&
		buffer[2] === GLUE_MAGIC[2] &&
		buffer[3] === GLUE_MAGIC[3];

	offset += 4;
	if (!isMagicValid) {
		throw new Error('Invalid glue magic.');
	}

	const version = readUint32();
	if (version !== GLUE_VERSION) {
		throw new Error(`Unsupported glue version ${version}.`);
	}

	const name = readString(8) as GlueMessageName;
	const prototypeDef = GLUE_MESSAGE_PROTOTYPES[name];
	if (!prototypeDef) {
		throw new Error(`Unknown message name: ${name}.`);
	}

	const output = { _name: name } as Record<string, unknown> & { _name: GlueMessageName };

	for (const field of prototypeDef.fields) {
		const encodedType = readUint32();

		if (encodedType === GLUE_DTYPE_NULL) {
			if (!field.isNullable) {
				throw new Error(`${name}: field ${field.name} is unexpectedly null.`);
			}

			output[field.name] = null;
			continue;
		}

		if (encodedType !== TYPE_MAP[field.type]) {
			throw new Error(`${name}: field ${field.name} has unexpected type code ${encodedType}.`);
		}

		switch (field.type) {
			case 'str':
				output[field.name] = readString();
				break;
			case 'int':
				output[field.name] = readInt32();
				break;
			case 'float':
				output[field.name] = readFloat();
				break;
			case 'bool':
				output[field.name] = readBool();
				break;
			case 'raw':
				output[field.name] = readRaw();
				break;
			case 'arr_str':
				output[field.name] = readArray(readString);
				break;
			case 'arr_int':
				output[field.name] = readArray(readInt32);
				break;
			case 'arr_float':
				output[field.name] = readArray(readFloat);
				break;
		}
	}

	return output;
}

export class PrismRawQ1Module {
	readonly #assets: PrismRuntimeAssets;
	readonly #logger: RawQ1RuntimeLogger;
	readonly #modelFileName: string;
	readonly #modelUrl: string;
	readonly #runtimeCacheBust: number;
	#module: RuntimeModule | null = null;
	#loadedContextInfo: RawQ1LoadResponse | null = null;
	#runtimeStarted = false;
	#modelLoadedToHeap = false;
	#eogTokens = new Set<number>();
	#addBosToken = false;
	#bosToken: number | null = null;

	constructor({
		assets,
		logger = {},
		modelFileName,
		modelUrl,
		runtimeCacheBust = Date.now()
	}: {
		assets: PrismRuntimeAssets;
		logger?: RawQ1RuntimeLogger;
		modelFileName: string;
		modelUrl: string;
		runtimeCacheBust?: number;
	}) {
		this.#assets = assets;
		this.#logger = logger;
		this.#modelFileName = modelFileName;
		this.#modelUrl = modelUrl;
		this.#runtimeCacheBust = runtimeCacheBust;
	}

	getLoadedContextInfo(): RawQ1LoadResponse | null {
		return this.#loadedContextInfo;
	}

	isModelLoaded(): boolean {
		return this.#loadedContextInfo !== null;
	}

	async init(): Promise<RuntimeModule> {
		if (this.#module) {
			return this.#module;
		}

		this.#module = await new Promise<RuntimeModule>((resolve, reject) => {
			const moduleConfig = {
				noInitialRun: true,
				locateFile: (filename: string) => {
					if (filename === 'wllama.wasm') {
						return `${this.#assets.runtimeWasmUrl}?t=${this.#runtimeCacheBust}`;
					}
					return filename;
				},
				print: (text: string) => this.#logger.log?.(text),
				printErr: (text: string) => (this.#logger.info ?? this.#logger.log)?.(text),
				onAbort: (reason: unknown) => reject(new Error(String(reason))),
				onRuntimeInitialized: () => {
					if (!rawGlobal.Module) {
						reject(new Error('The raw runtime initialized without exposing Module.'));
						return;
					}

					resolve(rawGlobal.Module);
				}
			} as unknown as RuntimeModule;

			rawGlobal.Module = moduleConfig;

			const script = document.createElement('script');
			script.src = `${this.#assets.runtimeScriptUrl}?t=${this.#runtimeCacheBust}`;
			script.async = true;
			script.onerror = () =>
				reject(new Error(`Failed to load ${this.#assets.runtimeScriptUrl}.`));
			document.head.appendChild(script);
		});

		patchMemfs(this.#module);
		return this.#module;
	}

	async #ccall(
		identifier: string,
		returnType: string | null,
		argTypes: string[] = [],
		args: unknown[] = []
	): Promise<unknown> {
		const module = await this.init();
		return module.ccall(identifier, returnType, argTypes, args, { async: true });
	}

	async #action(
		name: string,
		message: Record<string, unknown> & { _name: GlueMessageName }
	): Promise<Record<string, unknown>> {
		const module = await this.init();
		const encoded = glueSerialize(message);
		const inputPtr = (await this.#ccall('wllama_malloc', 'number', ['number', 'number'], [
			encoded.byteLength,
			0
		])) as number;

		const heap = getHeapU8(module);
		new Uint8Array(heap.buffer, inputPtr, encoded.byteLength).set(encoded);

		const outputPtr = (await this.#ccall('wllama_action', 'number', ['string', 'number'], [
			name,
			inputPtr
		])) as number;

		const outputHeap = getHeapU8(module);
		const outputLength = new Uint32Array(outputHeap.buffer, inputPtr, 1)[0];
		const outputBuffer = new Uint8Array(outputLength);
		outputBuffer.set(new Uint8Array(outputHeap.buffer, outputPtr, outputLength));
		return glueDeserialize(outputBuffer);
	}

	async #start(): Promise<void> {
		if (this.#runtimeStarted) {
			return;
		}

		const raw = (await this.#ccall('wllama_start', 'string')) as string;
		const parsed = JSON.parse(raw) as { success: boolean };
		if (!parsed.success) {
			throw new Error(`wllama_start failed: ${raw}`);
		}

		this.#runtimeStarted = true;
	}

	async #ensureModelFileFromResponse(
		response: Response,
		progressCallback?: (progress: InferenceLoadProgress) => void
	): Promise<void> {
		await this.init();
		if (this.#modelLoadedToHeap) {
			return;
		}

		const createDataFile =
			rawGlobal.FS_createDataFile ??
			safeModuleProp<RawFilesystem['createDataFile']>(this.#module, 'FS_createDataFile') ??
			getFS(this.#module).createDataFile?.bind(getFS(this.#module));

		if (!createDataFile) {
			throw new Error('FS_createDataFile is not reachable from the raw runtime.');
		}

		try {
			createDataFile('/models', this.#modelFileName, new Uint8Array(0), true, true, true);
		} catch {
			// The file entry can already exist if the runtime is reused in the same page.
		}

		const contentLength = Number(response.headers.get('content-length') ?? '0');
		if (response.body && Number.isFinite(contentLength) && contentLength > 0) {
			const file = heapfsAlloc(this.#module as RuntimeModule, this.#modelFileName, contentLength);
			const reader = response.body.getReader();
			let offset = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				if (!value) {
					continue;
				}

				heapfsWrite(this.#module as RuntimeModule, file.id, value, offset);
				offset += value.byteLength;
				progressCallback?.({
					loaded: offset,
					total: contentLength
				});
			}

			if (offset !== contentLength) {
				throw new Error(`Model download length mismatch: ${offset} != ${contentLength}.`);
			}
		} else {
			const bytes = new Uint8Array(await response.arrayBuffer());
			const file = heapfsAlloc(this.#module as RuntimeModule, this.#modelFileName, bytes.byteLength);
			heapfsWrite(this.#module as RuntimeModule, file.id, bytes, 0);
			progressCallback?.({
				loaded: bytes.byteLength,
				total: bytes.byteLength
			});
		}

		this.#modelLoadedToHeap = true;
	}

	async loadModelFromResponse(response: Response, config: RawQ1LoadConfig): Promise<void> {
		await this.#ensureModelFileFromResponse(response, config.progressCallback);
		await this.#start();
		this.#setWebgpuDispatchTuning(config.dispatchPlan.load);

		const loadResult = (await this.#action('load', {
			_name: 'load_req',
			model_paths: [`models/${this.#modelFileName}`],
			n_ctx_auto: false,
			use_mmap: true,
			use_mlock: false,
			n_gpu_layers: config.nGpuLayers,
			seed: 0,
			n_ctx: config.nCtx,
			n_threads: config.nThreads,
			embeddings: false,
			offload_kqv: config.offloadKqv,
			n_batch: config.nBatch,
			n_seq_max: 1,
			pooling_type: null,
			rope_scaling_type: null,
			rope_freq_base: null,
			rope_freq_scale: null,
			yarn_ext_factor: null,
			yarn_attn_factor: null,
			yarn_beta_fast: null,
			yarn_beta_slow: null,
			yarn_orig_ctx: null,
			cache_type_k: null,
			cache_type_v: null,
			flash_attn: null,
			swa_full: true
		})) as unknown as RawQ1LoadResponse;

		if (!loadResult.success) {
			throw new Error(`Raw Q1 load failed for ${this.#modelUrl}.`);
		}

		this.#loadedContextInfo = loadResult;
		this.#eogTokens = new Set(loadResult.list_tokens_eog);
		this.#addBosToken = loadResult.add_bos_token;
		this.#bosToken = loadResult.token_bos;
	}

	async exit(): Promise<void> {
		if (this.#runtimeStarted) {
			const raw = (await this.#ccall('wllama_exit', 'string')) as string;
			const parsed = JSON.parse(raw) as { success: boolean };
			if (!parsed.success) {
				throw new Error(`wllama_exit failed: ${raw}`);
			}
		}

		this.#runtimeStarted = false;
		this.#loadedContextInfo = null;
		this.#eogTokens = new Set();
		this.#addBosToken = false;
		this.#bosToken = null;
		this.#modelLoadedToHeap = false;
		this.#setWebgpuDispatchTuning(null);
		this.#module = null;
	}

	#setWebgpuDispatchTuning(config: RawQ1WebgpuDispatchTuning | null): void {
		if (config) {
			rawGlobal.__q1WebgpuDispatchTuning = {
				submitBatchSize: Math.max(1, Math.floor(config.submitBatchSize)),
				paramBufferLimit: Math.max(1, Math.floor(config.paramBufferLimit))
			};
			return;
		}

		delete rawGlobal.__q1WebgpuDispatchTuning;
	}

	#throwIfAborted(abortSignal?: AbortSignal): void {
		if (abortSignal?.aborted) {
			throw createAbortError();
		}
	}

	async #samplingInit(sampling: SamplingConfig): Promise<void> {
		const result = (await this.#action('sampling_init', {
			_name: 'sint_req',
			mirostat: null,
			mirostat_tau: null,
			mirostat_eta: null,
			temp: sampling.temp,
			top_p: sampling.top_p,
			top_k: sampling.top_k,
			penalty_last_n: 64,
			penalty_repeat: sampling.penalty_repeat ?? 1,
			penalty_freq: 0,
			penalty_present: 0,
			dynatemp_range: null,
			dynatemp_exponent: null,
			samplers_sequence: null,
			grammar: null,
			n_prev: 64,
			n_probs: 0,
			min_p: null,
			typical_p: null,
			typ_p: null,
			logit_bias_toks: [],
			logit_bias_vals: [],
			tokens: []
		})) as { success: boolean };

		if (!result.success) {
			throw new Error('sampling_init failed.');
		}
	}

	async #tokenize(text: string): Promise<number[]> {
		const result = (await this.#action('tokenize', {
			_name: 'tokn_req',
			text,
			special: true
		})) as { success: boolean; tokens: number[] };

		if (!result.success) {
			throw new Error('tokenize failed.');
		}

		return result.tokens;
	}

	async #kvClear(): Promise<void> {
		const result = (await this.#action('kv_clear', { _name: 'kvcc_req' })) as {
			success: boolean;
		};

		if (!result.success) {
			throw new Error('kv_clear failed.');
		}
	}

	async #samplingAccept(tokens: number[]): Promise<void> {
		const result = (await this.#action('sampling_accept', {
			_name: 'sacc_req',
			tokens
		})) as { success: boolean };

		if (!result.success) {
			throw new Error('sampling_accept failed.');
		}
	}

	async #decode(tokens: number[]): Promise<void> {
		const result = (await this.#action('decode', {
			_name: 'deco_req',
			tokens,
			skip_logits: false
		})) as { message: string; success: boolean };

		if (!result.success) {
			throw new Error(`decode failed: ${result.message}`);
		}
	}

	async #sample(): Promise<{ piece: Uint8Array; token: number }> {
		const result = (await this.#action('sampling_sample', {
			_name: 'ssam_req'
		})) as { success: boolean; piece: Uint8Array; token: number };

		if (!result.success) {
			throw new Error('sampling_sample failed.');
		}

		return {
			piece: result.piece,
			token: result.token
		};
	}

	async #preparePrompt(prompt: string, abortSignal?: AbortSignal): Promise<void> {
		this.#throwIfAborted(abortSignal);
		await this.#kvClear();

		this.#throwIfAborted(abortSignal);
		let promptTokens = await this.#tokenize(prompt);
		if (this.#addBosToken && this.#bosToken !== null && promptTokens[0] !== this.#bosToken) {
			promptTokens = [this.#bosToken, ...promptTokens];
		}

		this.#throwIfAborted(abortSignal);
		await this.#samplingAccept(promptTokens);

		this.#throwIfAborted(abortSignal);
		await this.#decode(promptTokens);
	}

	async completePrompt(
		prompt: string,
		sampling: SamplingConfig,
		handlers: InferenceCompletionHandlers = {},
		options: RawQ1CompletionOptions
	): Promise<string> {
		if (!this.#loadedContextInfo) {
			throw new Error('The raw Q1 runtime is not loaded.');
		}

		this.#throwIfAborted(options.abortSignal);
		const decoder = new TextDecoder();
		let reply = '';

		try {
			await this.#samplingInit(sampling);

			this.#setWebgpuDispatchTuning(options.dispatchPlan.prefill);
			await this.#preparePrompt(prompt, options.abortSignal);

			this.#setWebgpuDispatchTuning(options.dispatchPlan.firstToken);
			for (let index = 0; index < options.maxTokens; index += 1) {
				this.#throwIfAborted(options.abortSignal);

				const sample = await this.#sample();
				if (this.#eogTokens.has(sample.token)) {
					break;
				}

				const chunk = decoder.decode(sample.piece, { stream: true });
				reply += chunk;
				handlers.onTokenDecoded?.();
				if (chunk) {
					handlers.onToken?.(chunk);
				}

				if (index === 0) {
					this.#setWebgpuDispatchTuning(options.dispatchPlan.decode);
				}

				this.#throwIfAborted(options.abortSignal);
				await this.#samplingAccept([sample.token]);
				this.#throwIfAborted(options.abortSignal);
				await this.#decode([sample.token]);
			}

			reply += decoder.decode();
			return reply;
		} finally {
			this.#setWebgpuDispatchTuning(null);
		}
	}
}
