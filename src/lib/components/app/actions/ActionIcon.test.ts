import { render, fireEvent, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionIconTestHarness from './ActionIconTestHarness.svelte';

describe('ActionIcon', () => {
	it('invokes the provided click handler when wrapped by a tooltip trigger', async () => {
		const onclick = vi.fn();

		render(ActionIconTestHarness, {
			props: {
				onclick
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

		expect(onclick).toHaveBeenCalledTimes(1);
	});
});
