import type { RuntimeKind, SamplingPreset } from './runtime';

export type ModelLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelCatalogEntry {
	id: string;
	spaceModelId?: string;
	displayName: string;
	hfRepo: string;
	hfFilename: string;
	runtimeKind: RuntimeKind;
	format: string;
	cacheSizeBytes: number;
	loadedSizeBytes: number;
	contextTokens: number;
	status: 'ready' | 'coming-soon';
	defaultSampling: SamplingPreset;
}

export interface ModelStateRecord {
	id: 'default';
	selectedModelId: string | null;
	loadState: ModelLoadState;
	lastUsedAt: number | null;
	lastError: string | null;
}

export interface ParsedModelId {
	raw: string;
	orgName: string | null;
	modelName: string | null;
	params: string | null;
	activatedParams: string | null;
	quantization: string | null;
	tags: string[];
}

export interface ModelModalities {
	vision: boolean;
	audio: boolean;
}

export interface ModelOption {
	id: string;
	name: string;
	model: string;
	description?: string;
	capabilities: string[];
	modalities?: ModelModalities;
	details?: Record<string, unknown>;
	meta?: Record<string, unknown>;
	parsedId?: ParsedModelId;
	aliases?: string[];
	tags?: string[];
}

export interface ModalityCapabilities {
	hasVision: boolean;
	hasAudio: boolean;
}
