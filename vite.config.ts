import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { CSP_DIRECTIVES } from './src/lib/pure/security-headers';

export default defineConfig(({ mode }) => ({
	// The public pages' origin, for canonical URLs, the share image and the sitemap: `PUBLIC_SITE_URL`
	// from the env or `.env*`, read once at build. `$lib/site-url` falls back to the hosted demo.
	define: { __SITE_URL__: JSON.stringify(loadEnv(mode, process.cwd(), 'PUBLIC_').PUBLIC_SITE_URL ?? '') },
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
	// Agents work in git worktrees under `.claude/`. Watching them reloads the page on every write.
	server: { port: 5181, strictPort: true, watch: { ignored: ['**/.claude/**'] } },
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
}));
