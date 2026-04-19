import { SvelteMap } from 'svelte/reactivity';
import type { ModelOption } from '$lib/types/models';

export interface ModelItem {
	option: ModelOption;
	flatIndex: number;
}

export interface OrgGroup {
	orgName: string | null;
	items: ModelItem[];
}

export interface GroupedModelOptions {
	loaded: ModelItem[];
	available: OrgGroup[];
}

export function groupModelOptions(
	options: ModelOption[],
	isModelLoaded: (model: string) => boolean
): GroupedModelOptions {
	// Loaded models
	const loaded: ModelItem[] = [];
	for (let i = 0; i < options.length; i++) {
		if (isModelLoaded(options[i].model)) {
			loaded.push({ option: options[i], flatIndex: i });
		}
	}

	const loadedModelIds = new Set(loaded.map((item) => item.option.model));
	// Available models grouped by org (excluding loaded models)
	const available: OrgGroup[] = [];
	const orgGroups = new SvelteMap<string, ModelItem[]>();
	for (let i = 0; i < options.length; i++) {
		const option = options[i];
		if (loadedModelIds.has(option.model)) continue;

		const key = option.parsedId?.orgName ?? '';
		if (!orgGroups.has(key)) orgGroups.set(key, []);
		orgGroups.get(key)!.push({ option, flatIndex: i });
	}

	for (const [orgName, items] of orgGroups) {
		available.push({ orgName: orgName || null, items });
	}

	return { loaded, available };
}
