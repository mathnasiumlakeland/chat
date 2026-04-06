import { describe, expect, it } from 'vitest';
import { filterByLeafNodeId, findDescendantMessages, findLeafNode } from './branching';

function createMessage(overrides: Partial<DatabaseMessage> & Pick<DatabaseMessage, 'id'>): DatabaseMessage {
	return {
		id: overrides.id,
		convId: overrides.convId ?? 'conv-1',
		type: overrides.type ?? 'text',
		timestamp: overrides.timestamp ?? 0,
		role: overrides.role ?? 'assistant',
		content: overrides.content ?? '',
		parent: overrides.parent ?? null,
		children: overrides.children ?? [],
		status: overrides.status ?? 'done',
		model: overrides.model,
		error: overrides.error,
		extra: overrides.extra,
		thinking: overrides.thinking,
		reasoningContent: overrides.reasoningContent,
		toolCalls: overrides.toolCalls,
		toolCallId: overrides.toolCallId,
		timings: overrides.timings
	};
}

describe('branching utilities', () => {
	it('stops traversing parent cycles when filtering by leaf node', () => {
		const messages = [
			createMessage({
				id: 'root',
				type: 'root',
				role: 'system',
				timestamp: 0,
				parent: 'assistant',
				children: ['user']
			}),
			createMessage({
				id: 'user',
				role: 'user',
				timestamp: 1,
				parent: 'root',
				children: ['assistant'],
				content: 'hello'
			}),
			createMessage({
				id: 'assistant',
				role: 'assistant',
				timestamp: 2,
				parent: 'user',
				children: ['root'],
				content: 'hi'
			})
		];

		expect(filterByLeafNodeId(messages, 'assistant', true).map((message) => message.id)).toEqual([
			'root',
			'user',
			'assistant'
		]);
	});

	it('stops traversing child cycles when finding a leaf node', () => {
		const messages = [
			createMessage({
				id: 'user',
				role: 'user',
				timestamp: 1,
				children: ['assistant'],
				content: 'hello'
			}),
			createMessage({
				id: 'assistant',
				role: 'assistant',
				timestamp: 2,
				parent: 'user',
				children: ['user'],
				content: 'hi'
			})
		];

		expect(findLeafNode(messages, 'user')).toBe('assistant');
	});

	it('deduplicates descendants when child pointers loop', () => {
		const messages = [
			createMessage({
				id: 'root',
				type: 'root',
				role: 'system',
				timestamp: 0,
				children: ['user']
			}),
			createMessage({
				id: 'user',
				role: 'user',
				timestamp: 1,
				parent: 'root',
				children: ['assistant'],
				content: 'hello'
			}),
			createMessage({
				id: 'assistant',
				role: 'assistant',
				timestamp: 2,
				parent: 'user',
				children: ['user'],
				content: 'hi'
			})
		];

		expect(findDescendantMessages(messages, 'root')).toEqual(['user', 'assistant']);
	});
});
