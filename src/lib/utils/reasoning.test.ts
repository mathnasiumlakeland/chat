import { describe, expect, it } from 'vitest';
import { splitLeadingThinkBlock } from './reasoning';

describe('splitLeadingThinkBlock', () => {
	it('removes a leading empty think block from visible content', () => {
		expect(splitLeadingThinkBlock('<think>\n</think>\n\nHello from Bonsai.')).toEqual({
			content: 'Hello from Bonsai.'
		});
	});

	it('captures non-empty thinking separately from the visible answer', () => {
		expect(splitLeadingThinkBlock('<think>\ninternal chain\n</think>\n\nVisible answer')).toEqual({
			content: 'Visible answer',
			thinking: 'internal chain'
		});
	});

	it('hides an unfinished think block while streaming', () => {
		expect(splitLeadingThinkBlock('<think>\nworking through it')).toEqual({
			content: '',
			thinking: 'working through it'
		});
	});
});
