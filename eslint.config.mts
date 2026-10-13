import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		// Build-time Node scripts, like the two above: not part of the plugin
		// bundle and not covered by tsconfig's project service.
		'scripts',
		// Agent hooks and skills: Node scripts with their own self-tests.
		'.claude',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// The same guardrails the Angular client runs under, for the same reasons.
		// Both are run with `--max-warnings=0`, so `warn` here means "fails the
		// build, and reads as a size problem rather than a correctness one" - the
		// severity is about how it reports, not whether it blocks.
		files: ['src/**/*.ts'],
		rules: {
			// `error` and `warn` survive: a plugin has no server log to fall back on,
			// and every one of the sixteen here is reporting a genuine failure to a
			// user who has just pressed a button. `log` is debugging left behind.
			'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
			'max-lines': ['warn', { max: 700, skipBlankLines: false, skipComments: false }],

			// `max-lines-per-function` is enforced by `scripts/verify-function-sizes.mjs`
			// rather than from here, at the same limit of 50 the client uses.
			// Five functions are over it today, so having it in this config would
			// either fail `--max-warnings=0` outright or arrive with five disables
			// attached. The script enables the rule for its own run and holds those
			// five to their current size, so the limit applies to new code
			// immediately. Move it here and delete the script when the list empties.
		},
	},
	{
		// The rule lower-cases every product name it meets: it wants "send to tome"
		// and "your tome server". Tome is a proper noun, and it appears in most
		// user-facing string in the plugin, so per-line disables would be noise.
		// Sentence case is still the house style for everything that is not a name.
		files: ['src/**/*.ts'],
		rules: {
			'obsidianmd/ui/sentence-case': 'off',
		},
	},
	{
		// Tests are never bundled into main.js, so the rules that exist to keep
		// the shipped plugin loadable on mobile do not apply to them. The size
		// rules are off for the reason the client turns them off for specs: a
		// `describe` is itself a function, and a thorough suite is legitimately long.
		files: ['tests/**/*.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'max-lines': 'off',
			'max-lines-per-function': 'off',
		},
	},
);
