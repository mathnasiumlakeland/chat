import type { ModelOption } from '$lib/types/models';

interface ResolveChatFormModelSelectionArgs {
	conversationModel: string | null;
	currentSelectedModelId: string | null;
	isRouter: boolean;
	loadedModelIds: string[];
	options: ModelOption[];
}

export function resolveChatFormModelSelection({
	conversationModel,
	currentSelectedModelId,
	isRouter,
	loadedModelIds,
	options
}: ResolveChatFormModelSelectionArgs): string | null {
	if (conversationModel) {
		const matchingOption = options.find((model) => model.model === conversationModel);
		if (!matchingOption || matchingOption.id === currentSelectedModelId) {
			return null;
		}

		return matchingOption.id;
	}

	if (!isRouter || currentSelectedModelId || loadedModelIds.length === 0) {
		return null;
	}

	const firstLoadedOption = options.find((model) => loadedModelIds.includes(model.model));
	return firstLoadedOption?.id ?? null;
}
