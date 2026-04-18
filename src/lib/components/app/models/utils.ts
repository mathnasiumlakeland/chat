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

export function filterModelOptions(options: ModelOption[], searchTerm: string): ModelOption[] {
	const term = searchTerm.trim().toLowerCase();
	if (!term) return options;

	return options.filter(
		(option) =>
			option.model.toLowerCase().includes(term) ||
			option.name?.toLowerCase().includes(term) ||
			option.aliases?.some((alias: string) => alias.toLowerCase().includes(term)) ||
			option.tags?.some((tag: string) => tag.toLowerCase().includes(term))
	);
}

export function groupModelOptions(
	filteredOptions: ModelOption[],
	isModelLoaded: (model: string) => boolean
): GroupedModelOptions {
	// Loaded models
	const loaded: ModelItem[] = [];
	for (let i = 0; i < filteredOptions.length; i++) {
		if (isModelLoaded(filteredOptions[i].model)) {
			loaded.push({ option: filteredOptions[i], flatIndex: i });
		}
	}

	const loadedModelIds = new Set(loaded.map((item) => item.option.model));
	// Available models grouped by org (excluding loaded models)
	const available: OrgGroup[] = [];
	const orgGroups = new SvelteMap<string, ModelItem[]>();
	for (let i = 0; i < filteredOptions.length; i++) {
		const option = filteredOptions[i];
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
