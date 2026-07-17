import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// No exclude for *.svelte.{test,spec}.*: the scaffolder pairs that pattern with a
					// second, browser-environment project, and we run unit tests only (tech.md 14
					// exempts primitive markup). Left in place it matched no project at all, so such a
					// file would be collected by nothing and pass the gate without ever running.
					include: ['src/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
