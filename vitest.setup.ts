import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

if (typeof globalThis.localStorage?.getItem !== 'function') {
	const storage = new Map<string, string>();

	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			},
			removeItem: (key: string) => {
				storage.delete(key);
			},
			clear: () => {
				storage.clear();
			}
		},
		configurable: true
	});
}

Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false
	})
});

Object.defineProperty(window, 'requestAnimationFrame', {
	writable: true,
	value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)
});

Object.defineProperty(window, 'cancelAnimationFrame', {
	writable: true,
	value: (handle: number) => window.clearTimeout(handle)
});

class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

globalThis.ResizeObserver = ResizeObserver;

afterEach(() => {
	cleanup();
});
