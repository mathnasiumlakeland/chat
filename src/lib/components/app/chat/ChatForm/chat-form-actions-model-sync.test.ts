import { describe, expect, it } from 'vitest';
import { resolveChatFormModelSelection } from './chat-form-actions-model-sync';

const OPTIONS = [
	{ id: 'bonsai-1.7b', model: 'prism-ml/Bonsai-1.7B-gguf', name: 'Bonsai 1.7B', capabilities: [] },
	{ id: 'bonsai-4b', model: 'prism-ml/Bonsai-4B-gguf', name: 'Bonsai 4B', capabilities: [] }
];

describe('resolveChatFormModelSelection', () => {
	it('does not reselect the conversation model when it is already active', () => {
		expect(
			resolveChatFormModelSelection({
				conversationModel: 'prism-ml/Bonsai-1.7B-gguf',
				currentSelectedModelId: 'bonsai-1.7b',
				isRouter: true,
				loadedModelIds: [],
				options: OPTIONS
			})
		).toBeNull();
	});

	it('selects the conversation model when it differs from the current selection', () => {
		expect(
			resolveChatFormModelSelection({
				conversationModel: 'prism-ml/Bonsai-4B-gguf',
				currentSelectedModelId: 'bonsai-1.7b',
				isRouter: true,
				loadedModelIds: [],
				options: OPTIONS
			})
		).toBe('bonsai-4b');
	});

	it('falls back to the first loaded model when no selection exists', () => {
		expect(
			resolveChatFormModelSelection({
				conversationModel: null,
				currentSelectedModelId: null,
				isRouter: true,
				loadedModelIds: ['prism-ml/Bonsai-4B-gguf'],
				options: OPTIONS
			})
		).toBe('bonsai-4b');
	});

	it('does nothing when router fallback is not needed', () => {
		expect(
			resolveChatFormModelSelection({
				conversationModel: null,
				currentSelectedModelId: 'bonsai-1.7b',
				isRouter: true,
				loadedModelIds: ['prism-ml/Bonsai-4B-gguf'],
				options: OPTIONS
			})
		).toBeNull();
	});
});
