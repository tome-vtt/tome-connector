/**
 * A ratchet on the functions that are already too long: they may shrink, and they may not grow.
 *
 * A ratchet for `max-lines-per-function`. Five functions were over
 * the 50-line limit when this was added, so switching the rule on in `eslint.config.mts` would
 * either have failed the build outright or arrived with five disables attached - a rule defeated
 * before it ran. A baseline lets it go on now and hold the line, instead of waiting on five
 * refactors that were never going to be scheduled.
 *
 * It earned that immediately: `findSendables` was written at 67 lines in the same session and the
 * ratchet refused it, so it was split rather than baselined.
 *
 * **The rule is enabled here rather than in the shared config**, deliberately. `npm run lint` runs
 * eslint with `--max-warnings=0`; a rule that five functions violate cannot live there until they
 * are fixed. This script turns it on for its own run, so the policy is enforced without making the
 * ordinary lint pass unusable. When the last baseline entry goes, move the rule into the config and
 * delete this file.
 *
 * The comparison is `ratchet.mjs`, tested in `tests/ratchet.test.ts`.
 *
 * ESLint does the counting. Reimplementing function-boundary detection and the rule's
 * `skipBlankLines`/`skipComments` semantics would give two numbers that disagree at the edges, and
 * the one in the error message would be the one nobody could reproduce.
 *
 * Usage:
 *   node scripts/verify-function-sizes.mjs            # check (what `npm run lint` runs)
 *   node scripts/verify-function-sizes.mjs --update   # record the current sizes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { ESLint } from 'eslint';
import { compareToBaseline } from './ratchet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'function-size-baseline.json');

/** Matches the client's `max-lines-per-function`, and must keep matching it. */
const LIMIT = 50;

/** How far a function may shrink before the baseline has to be refreshed. */
const SLACK = 10;

const RULE = 'max-lines-per-function';

/**
 * Runs eslint over `src` with only this rule on, and returns `file::function -> lines`.
 *
 * The key includes the function name because a file routinely has several over the limit, and a
 * per-file total would let one grow by exactly as much as another shrank.
 */
async function measure() {
	const eslint = new ESLint({
		cwd: root,
		overrideConfig: {
			rules: {
				[RULE]: ['warn', { max: LIMIT, skipBlankLines: true, skipComments: true }]
			}
		}
	});

	const results = await eslint.lintFiles(['src/**/*.ts']);
	const sizes = new Map();

	for (const result of results) {
		const path = relative(root, result.filePath).split(sep).join('/');
		for (const message of result.messages) {
			if (message.ruleId !== RULE) continue;

			// "Function 'x' has too many lines (67). Maximum allowed is 50."
			const lines = /\((\d+)\)/.exec(message.message)?.[1];
			const name = /^(?:Async function|Function|Arrow function|Method|Static method)\s+'([^']+)'/
				.exec(message.message)?.[1];
			if (!lines) continue;

			sizes.set(`${path}::${name ?? `line ${message.line}`}`, Number(lines));
		}
	}

	return sizes;
}

const sizes = await measure();

if (process.argv.includes('--update')) {
	const recorded = Object.fromEntries([...sizes].sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(baselinePath, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8');
	const names = Object.keys(recorded);
	console.log(`Recorded ${names.length} function${names.length === 1 ? '' : 's'} over ${LIMIT} lines:`);
	for (const name of names) {
		console.log(`  ${String(recorded[name]).padStart(4)}  ${name}`);
	}
	process.exit(0);
}

let baseline;
try {
	baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
	console.error(
		'Function size baseline not found or unreadable at scripts/function-size-baseline.json.\n' +
			'  Run: node scripts/verify-function-sizes.mjs --update\n'
	);
	process.exit(1);
}

const failures = compareToBaseline({
	sizes,
	baseline,
	limit: LIMIT,
	slack: SLACK,
	noun: 'function',
	updateCommand: 'node scripts/verify-function-sizes.mjs --update'
});

if (failures.length) {
	console.error('Function size verification failed:\n');
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	console.error(
		`\n  ${LIMIT} lines is the same limit the Angular client runs. The list below it shrinks;\n` +
			'  nothing joins it by accident.\n'
	);
	process.exit(1);
}

const tracked = Object.keys(baseline).length;
console.log(
	`Function sizes OK - ${tracked} function${tracked === 1 ? '' : 's'} over ${LIMIT} lines, none grown.`
);
