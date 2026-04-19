import {
	DynamicCache,
	InterruptableStoppingCriteria,
	type PreTrainedTokenizer,
	TextStreamer,
	pipeline
} from '@huggingface/transformers';
import type { InferenceMessage, SamplingConfig } from '$lib/types/runtime';

type WorkerLoadMessage = {
	type: 'load';
	requestId: number;
	data: {
		modelKey: string;
	};
};

type WorkerGenerateMessage = {
	type: 'generate';
	requestId: number;
	data: {
		maxNewTokens: number;
		messages: InferenceMessage[];
		sampling: SamplingConfig;
	};
};

type WorkerMessage =
	| WorkerLoadMessage
	| WorkerGenerateMessage
	| {
			type: 'interrupt';
			requestId: number;
	  }
	| {
			type: 'reset';
	  };

type GeneratedMessage = {
	content?: string;
};

type GeneratedChatOutput = {
	generated_text?: GeneratedMessage[];
};

type TextGenerationPipeline = ((
	messages: InferenceMessage[],
	options: Record<string, unknown>
) => Promise<GeneratedChatOutput[]>) & {
	tokenizer: PreTrainedTokenizer & ((text: string) => Record<string, unknown>);
	model: {
		generate: (inputs: Record<string, unknown>) => Promise<unknown>;
	};
};

const pipelineInstances = new Map<string, Promise<TextGenerationPipeline>>();
const stoppingCriteria = new InterruptableStoppingCriteria();

let activeModelKey: string | null = null;
let interruptedRequestId: number | null = null;

type ProgressInfo = {
	status?: string;
	progress?: number;
	loaded?: number;
	total?: number;
};

const SPACE_DTYPE = 'q2f16' as const;
const SPACE_MODEL_REPOS = {
	'1.7b': 'onnx-community/Ternary-Bonsai-1.7B-ONNX',
	'4b': 'onnx-community/Ternary-Bonsai-4B-ONNX',
	'8b': 'onnx-community/Ternary-Bonsai-8B-ONNX'
} as const;

type SpaceModelKey = keyof typeof SPACE_MODEL_REPOS;

function postMessage(message: Record<string, unknown>) {
	self.postMessage(message);
}

function resolveSpaceModelRepo(modelKey: string): string {
	const modelRepo = SPACE_MODEL_REPOS[modelKey as SpaceModelKey];
	if (!modelRepo) {
		throw new Error(`Unknown Bonsai WebGPU model: ${modelKey}`);
	}

	return modelRepo;
}

function createGenerator(
	modelKey: string,
	progressCallback?: (info: ProgressInfo) => void
): Promise<TextGenerationPipeline> {
	if (!pipelineInstances.has(modelKey)) {
		pipelineInstances.set(
			modelKey,
			pipeline('text-generation', resolveSpaceModelRepo(modelKey), {
				device: 'webgpu',
				dtype: SPACE_DTYPE,
				progress_callback: progressCallback
			}) as Promise<TextGenerationPipeline>
		);
	}

	return pipelineInstances.get(modelKey)!;
}

function createGenerateError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}

	return new Error(String(error));
}

async function warmModel(generator: TextGenerationPipeline): Promise<void> {
	const inputs = generator.tokenizer('a');
	await generator.model.generate({
		...inputs,
		max_new_tokens: 1
	});
}

async function load(message: WorkerLoadMessage): Promise<void> {
	const {
		requestId,
		data: { modelKey }
	} = message;
	activeModelKey = modelKey;

	postMessage({
		requestId,
		status: 'loading',
			data: 'Loading model'
	});

	const generator = await createGenerator(modelKey, (info) => {
		if (info.status !== 'progress_total') {
			return;
		}

		postMessage({
			requestId,
			status: 'progress_total',
			progress: Number(info.progress ?? 0),
			loaded: Number(info.loaded ?? 0),
			total: Number(info.total ?? 0)
		});
	});

	postMessage({
		requestId,
		status: 'loading',
		data: 'Compiling shaders...'
	});

	await warmModel(generator);

	postMessage({
		requestId,
		status: 'ready'
	});
}

async function generate(message: WorkerGenerateMessage): Promise<void> {
	if (!activeModelKey) {
		throw new Error('No ternary ONNX model is loaded.');
	}

	const generatorPromise = pipelineInstances.get(activeModelKey);
	if (!generatorPromise) {
		throw new Error(`The ternary pipeline for ${activeModelKey} is not initialized.`);
	}

	const generator = await generatorPromise;
	const {
		requestId,
		data: { messages, maxNewTokens }
	} = message;

	let startTime: number | undefined;
	let numTokens = 0;
	let tps: number | null = null;

	const streamer = new TextStreamer(generator.tokenizer, {
		skip_prompt: true,
		skip_special_tokens: true,
		callback_function: (output: string) => {
			postMessage({
				requestId,
				status: 'update',
				output,
				tps,
				numTokens
			});
		},
		token_callback_function: () => {
			startTime ??= performance.now();
			if (numTokens++ > 0) {
				tps = (numTokens / (performance.now() - startTime)) * 1000;
			}
		}
	});

	postMessage({
		requestId,
		status: 'start'
	});

	const pastKeyValues = new DynamicCache();
	stoppingCriteria.reset();

	try {
		const output = await generator(messages, {
			max_new_tokens: maxNewTokens,
			do_sample: false,
			streamer,
			stopping_criteria: stoppingCriteria,
			past_key_values: pastKeyValues
		});

		postMessage({
			requestId,
			status: 'complete',
			output: output[0]?.generated_text?.at(-1)?.content ?? ''
		});
	} catch (error) {
		if (interruptedRequestId === requestId) {
			postMessage({
				requestId,
				status: 'interrupted'
			});
			return;
		}

		postMessage({
			requestId,
			status: 'error',
			data: createGenerateError(error).message
		});
	} finally {
		pastKeyValues.dispose?.();
		if (interruptedRequestId === requestId) {
			interruptedRequestId = null;
		}
		stoppingCriteria.reset();
	}
}

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	try {
		switch (message.type) {
			case 'load':
				await load(message);
				break;
			case 'generate':
				await generate(message);
				break;
			case 'interrupt':
				interruptedRequestId = message.requestId;
				stoppingCriteria.interrupt();
				break;
			case 'reset':
				interruptedRequestId = null;
				stoppingCriteria.reset();
				break;
		}
	} catch (error) {
		postMessage({
			requestId: 'requestId' in message ? message.requestId : -1,
			status: 'error',
			data: createGenerateError(error).message
		});
	}
});
