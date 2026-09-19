import { hasInlineStats, mergeCreature } from './recognizers/statblockCreature';

/**
 * Access to the Fantasy Statblocks bestiary, and the rule for when it is needed.
 *
 * Its own module because two callers now want it — the per-block button and the
 * vault scanner — and because it touches `window`, which keeps it out of the pure
 * recognizers that vitest can reach. The shape decisions it depends on live in
 * `recognizers/statblockCreature.ts` and are tested there.
 */

export interface StatblockBestiaryApi {
	getCreatureFromBestiary(name: string): Record<string, unknown> | null;
}

/**
 * The plugin's API if it is installed and enabled, or null.
 *
 * Fantasy Statblocks assigns its API instance directly to
 * `window.FantasyStatblocks`, exposing `getCreatureFromBestiary` on it — not
 * behind a further `getBestiary()` call, which returns the raw creature `Map`.
 */
export function getStatblockBestiaryApi(): StatblockBestiaryApi | null {
	const globalWindow = window as unknown as {
		FantasyStatblocks?: StatblockBestiaryApi;
	};
	try {
		return globalWindow.FantasyStatblocks ?? null;
	} catch {
		return null;
	}
}

/**
 * Resolves a parsed statblock into a full creature record.
 *
 * Three cases, in this order:
 *
 * 1. **The block carries its own stats.** Parse it and go — no plugin needed,
 *    which is what lets a vault of `ttrpg-convert-cli` output work with Fantasy
 *    Statblocks switched off, since the CLI writes self-contained statblocks. The
 *    bestiary is still merged underneath when present, because it may hold fields
 *    the block omits.
 * 2. **No inline stats, bestiary available.** Look up by `monster:` if that is
 *    what the block is, otherwise by its own `name` — Fantasy Statblocks adds
 *    every block to the bestiary under its name unless `bestiary: false`.
 * 3. **No inline stats, no bestiary.** Throw, naming both the creature and the
 *    plugin. This case cannot be rescued: `monster: Goblin` contains nothing to
 *    send, and inventing an empty creature would be worse than refusing.
 *
 * This used to throw whenever the plugin was absent, including in case 1.
 *
 * `bestiary` is passed in - {@link getStatblockBestiaryApi} in the plugin, a
 * plain object in the tests - so this never reaches for `window` itself.
 */
export function resolveCreatureData(
	parsed: unknown,
	bestiary: StatblockBestiaryApi | null,
): Record<string, unknown> {
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('Statblock is not a valid object.');
	}

	const root = parsed as Record<string, unknown>;
	const monsterName = root.monster;
	const isReference = typeof monsterName === 'string' && monsterName.trim() !== '';
	const lookupName = isReference ? monsterName : root.name;
	const selfSufficient = hasInlineStats(root);

	if (typeof lookupName !== 'string' || lookupName.trim() === '') {
		throw new Error(
			selfSufficient
				? 'Statblock is missing a "name".'
				: 'Statblock is missing a "name" (or "monster") field needed to look it up in the bestiary.',
		);
	}

	if (!bestiary) {
		if (selfSufficient) return mergeCreature(null, root);
		throw new Error(
			`This block references "${lookupName}" from your bestiary rather than containing its ` +
				'stats, so it needs the Fantasy Statblocks plugin installed and enabled.',
		);
	}

	const base = bestiary.getCreatureFromBestiary(lookupName);
	if (!base) {
		if (selfSufficient) return mergeCreature(null, root);
		throw new Error(`Couldn't find "${lookupName}" in the Fantasy Statblocks bestiary.`);
	}

	return mergeCreature(base, root);
}
