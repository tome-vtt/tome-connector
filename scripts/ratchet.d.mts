/**
 * Types for `ratchet.mjs`.
 *
 * The implementation is plain ESM rather than TypeScript because the scripts run
 * under bare `node` from an npm script, with no build step of their own — and it
 * must not live in `src`, which esbuild bundles into `main.js` and ships to every
 * user. This declaration is what lets `tests/ratchet.test.ts` import it without
 * typescript-eslint treating every call as untyped.
 */

export interface RatchetOptions {
	/** What each entry measures now, keyed however the caller keys it. */
	sizes: Map<string, number>;
	/** What was agreed, as read from the baseline JSON. */
	baseline: Record<string, number>;
	/** The lint rule's threshold. */
	limit: number;
	/** How far an entry may shrink before the baseline must be re-recorded. */
	slack: number;
	/** What one entry is called in a sentence, e.g. `'file'`. */
	noun: string;
	/** The command that re-records, quoted back to the reader on failure. */
	updateCommand: string;
}

/** Complaints, in the order found. Empty when the ratchet holds. */
export function compareToBaseline(options: RatchetOptions): string[];
