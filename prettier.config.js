/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-tailwindcss'],
	overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }],
	// Must point at the real Tailwind entry (tech.md 4: app.css holds `@import "tailwindcss"` + @theme).
	// A missing path here is not a soft warning: prettier-plugin-tailwindcss throws ENOENT while
	// parsing, so `prettier --check .` errors on every file and the CI lint gate can never go green.
	tailwindStylesheet: './src/app.css'
};

export default config;
