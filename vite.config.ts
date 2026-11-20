import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { CSP_DIRECTIVES } from './src/lib/pure/security-headers';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// The Content-Security-Policy, with a nonce on every inline script SvelteKit renders and on
			// app.html's own. The hook adds the Flow PT site at run time (src/hooks.server.ts).
			csp: { mode: 'auto', directives: CSP_DIRECTIVES }
		})
	],
	// 5173 and 5191 up belong to the siblings (docs/development.md). sg-bids takes 5181.
	server: { port: 5181, strictPort: true },
	preview: { port: 5181, strictPort: true },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
