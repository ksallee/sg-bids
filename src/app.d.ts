// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** `PUBLIC_SITE_URL` at build, or empty (`vite.config.ts`). Read through `$lib/site-url`. */
	const __SITE_URL__: string;
}

export {};
