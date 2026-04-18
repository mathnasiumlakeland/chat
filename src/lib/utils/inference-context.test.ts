import { describe, expect, it } from 'vitest';
import { AttachmentType } from '$lib/enums';
import { appendExtrasToInferenceContent } from './inference-context';

describe('appendExtrasToInferenceContent', () => {
	it('appends MCP resource content to the base message', () => {
		const content = appendExtrasToInferenceContent('How many students are there?', [
			{
				type: AttachmentType.MCP_RESOURCE,
				name: 'overview',
				uri: 'schema://overview',
				serverName: 'Radius Snapshot SQL',
				content: 'student table contains current students'
			}
		]);

		expect(content).toContain('How many students are there?');
		expect(content).toContain('MCP Resource: overview');
		expect(content).toContain('student table contains current students');
	});

	it('serializes attachments even when the message text is empty', () => {
		const content = appendExtrasToInferenceContent('', [
			{
				type: AttachmentType.TEXT,
				name: 'notes.txt',
				content: 'important context'
			}
		]);

		expect(content.startsWith('--- File: notes.txt ---')).toBe(true);
		expect(content).toContain('important context');
	});
});
