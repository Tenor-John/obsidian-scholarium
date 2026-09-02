import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"scripts/**",
		"versions.json",
		"manifest.json",
		"package.json",
		"package-lock.json",
		"main.js",
		// Plain runtime JS (typed via its .d.ts sibling) and its node:test suite —
		// same convention as agent-canvas-demo's own .js files, not part of the
		// typed-lint surface; verified instead by `npm test`.
		"src/research-weaver-mount-state.js",
		"src/bridge-state-response.js",
		"src/__tests__/**",
	]),
);
