import { getModelCatalogEntry } from '$lib/constants/models';
import type { ModelCatalogEntry } from '$lib/types/models';

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';
const LEGACY_GGUF_CACHE_NAME = 'bonsai-model-cache-v1';
const PENDING_MODEL_CACHE_PURGE_KEY = 'pending-model-cache-purge-v1';

export const MODEL_IDLE_EVICTION_MS = 5 * 60 * 1000;

export type PendingModelCachePurge = {
	modelId: string;
	requestedAt: number;
};

function isCacheStorageAvailable(): boolean {
	return typeof caches !== 'undefined';
}

function isLocalStorageAvailable(): boolean {
	return typeof localStorage !== 'undefined';
}

function getCacheName(entry: ModelCatalogEntry): string {
	return entry.runtimeKind === 'gguf-wasm' ? LEGACY_GGUF_CACHE_NAME : TRANSFORMERS_CACHE_NAME;
}

function getCacheKeyPrefixes(entry: ModelCatalogEntry): string[] {
	return [`https://huggingface.co/${entry.hfRepo}/resolve/`];
}

async function openCache(cacheName: string): Promise<Cache | null> {
	if (!isCacheStorageAvailable()) {
		return null;
	}

	try {
		return await caches.open(cacheName);
	} catch {
		return null;
	}
}

export async function purgeCachedModelArtifacts(entry: ModelCatalogEntry): Promise<number> {
	const cache = await openCache(getCacheName(entry));
	if (!cache) {
		return 0;
	}

	const prefixes = getCacheKeyPrefixes(entry);
	const requests = await cache.keys();
	let deletedEntries = 0;

	for (const request of requests) {
		if (!prefixes.some((prefix) => request.url.startsWith(prefix))) {
			continue;
		}

		if (await cache.delete(request)) {
			deletedEntries += 1;
		}
	}

	return deletedEntries;
}

export async function purgeCachedModelArtifactsForModelId(modelId: string): Promise<number> {
	const entry = getModelCatalogEntry(modelId);
	if (!entry) {
		return 0;
	}

	return purgeCachedModelArtifacts(entry);
}

export function readPendingModelCachePurge(): PendingModelCachePurge | null {
	if (!isLocalStorageAvailable()) {
		return null;
	}

	try {
		const raw = localStorage.getItem(PENDING_MODEL_CACHE_PURGE_KEY);
		if (!raw) {
			return null;
		}

		const parsed = JSON.parse(raw);
		if (
			!parsed ||
			typeof parsed !== 'object' ||
			typeof parsed.modelId !== 'string' ||
			typeof parsed.requestedAt !== 'number'
		) {
			return null;
		}

		return {
			modelId: parsed.modelId,
			requestedAt: parsed.requestedAt
		};
	} catch {
		return null;
	}
}

export function writePendingModelCachePurge(purge: PendingModelCachePurge): void {
	if (!isLocalStorageAvailable()) {
		return;
	}

	try {
		localStorage.setItem(PENDING_MODEL_CACHE_PURGE_KEY, JSON.stringify(purge));
	} catch {
		// Ignore quota/storage errors. The direct purge attempt can still proceed.
	}
}

export function clearPendingModelCachePurge(): void {
	if (!isLocalStorageAvailable()) {
		return;
	}

	try {
		localStorage.removeItem(PENDING_MODEL_CACHE_PURGE_KEY);
	} catch {
		// Ignore storage errors.
	}
}
