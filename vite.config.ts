import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const crossOriginHeaders = {
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'cross-origin'
};

function applyCrossOriginHeaders(
	_req: unknown,
	res: {
		setHeader: (name: string, value: string) => void;
	},
	next: () => void
) {
	for (const [name, value] of Object.entries(crossOriginHeaders)) {
		res.setHeader(name, value);
	}

	next();
}

const crossOriginIsolationPlugin = {
	name: 'cross-origin-isolation',
	configureServer(server: { middlewares: { use: (handler: typeof applyCrossOriginHeaders) => void } }) {
		server.middlewares.use(applyCrossOriginHeaders);
	},
	configurePreviewServer(server: {
		middlewares: { use: (handler: typeof applyCrossOriginHeaders) => void };
	}) {
		server.middlewares.use(applyCrossOriginHeaders);
	}
};

export default defineConfig({
	plugins: [crossOriginIsolationPlugin, tailwindcss(), sveltekit()],
	server: {
		headers: crossOriginHeaders
	},
	preview: {
		headers: crossOriginHeaders
	},
	resolve: {
		alias: {
			'katex-fonts': resolve('node_modules/katex/dist/fonts')
		},
		...(process.env.VITEST
			? {
					conditions: ['browser']
				}
			: {})
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.{test,spec}.{ts,js,svelte}'],
		exclude: ['llama.cpp/**']
	}
});
