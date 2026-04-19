import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONFIG_LOCALSTORAGE_KEY,
	USER_OVERRIDES_LOCALSTORAGE_KEY
} from '$lib/constants/localstorage-keys';

vi.mock('$app/environment', () => ({
	browser: true
}));

describe('settingsStore system message migration', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	afterEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it('migrates a legacy blank system message to the new default', async () => {
		localStorage.setItem(
			CONFIG_LOCALSTORAGE_KEY,
			JSON.stringify({
				systemMessage: ''
			})
		);

		const { settingsStore } = await import('./settings.svelte');

		expect(settingsStore.config.systemMessage).toBe('You are ChatMATh, a friendly assistant');
		expect(JSON.parse(localStorage.getItem(CONFIG_LOCALSTORAGE_KEY) ?? '{}')).toMatchObject({
			systemMessage: 'You are ChatMATh, a friendly assistant'
		});
		expect(JSON.parse(localStorage.getItem(USER_OVERRIDES_LOCALSTORAGE_KEY) ?? '[]')).toEqual([]);
	}, 20_000);

	it('preserves an explicitly blank system message when it was saved as a user override', async () => {
		localStorage.setItem(
			CONFIG_LOCALSTORAGE_KEY,
			JSON.stringify({
				systemMessage: ''
			})
		);
		localStorage.setItem(USER_OVERRIDES_LOCALSTORAGE_KEY, JSON.stringify(['systemMessage']));

		const { settingsStore } = await import('./settings.svelte');

		expect(settingsStore.config.systemMessage).toBe('');
	}, 20_000);

	it('persists the system message override marker so an explicit blank survives reload', async () => {
		const { settingsStore } = await import('./settings.svelte');

		settingsStore.updateConfig('systemMessage', '');

		expect(JSON.parse(localStorage.getItem(USER_OVERRIDES_LOCALSTORAGE_KEY) ?? '[]')).toContain(
			'systemMessage'
		);

		vi.resetModules();

		const { settingsStore: reloadedSettingsStore } = await import('./settings.svelte');

		expect(reloadedSettingsStore.config.systemMessage).toBe('');
	});
});
