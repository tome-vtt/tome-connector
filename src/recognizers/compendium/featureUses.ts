/**
 * A feature's uses, as the author states them in a `tome-uses` block under the feature.
 *
 * The shape and its rules are TomeVTT's ADR-0016 ("imported features declare their
 * uses"): Tome never reads a count out of prose, so the package has to carry it. The
 * block is the ADR's JSON as written, so an author can copy the example and change
 * the numbers. Nothing here reads the prose either: a feature with no block gets no
 * uses, and Tome falls back to its own table.
 *
 * A block Tome would refuse throws, naming the feature, rather than being dropped:
 * the package builder then leaves the note out and lists it, where sending it would
 * have the whole import refused.
 *
 * Pure and `obsidian`-free.
 */

import { findFencedBlock } from '../markdownBlocks';

export const USES_LANGUAGE = 'tome-uses';

export type UsesCount =
	| { fixed: number }
	| { proficiency: true }
	| { modifier: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' }
	| { perLevel: number }
	| { unlimited: true };

export interface UsesTier {
	from: number;
	count: UsesCount;
	shortRest: 'none' | 'one' | 'all';
}

/** Mirrors the server's declared feature uses (ADR-0016). */
export interface FeatureUses {
	cost: 'action' | 'attack' | 'bonus' | 'reaction' | 'none';
	summary: string;
	tiers: UsesTier[];
}

const COSTS = ['action', 'attack', 'bonus', 'reaction', 'none'];
const REFILLS = ['none', 'one', 'all'];
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const inRange = (value: unknown, low: number, high: number): boolean =>
	Number.isInteger(value) && (value as number) >= low && (value as number) <= high;

function isCount(count: unknown): count is UsesCount {
	if (!isRecord(count)) return false;
	const kinds = Object.keys(count);
	if (kinds.length !== 1) return false;
	const value = count[kinds[0]!];
	switch (kinds[0]) {
		case 'fixed':
		case 'perLevel':
			return inRange(value, 1, 99);
		case 'proficiency':
		case 'unlimited':
			return value === true;
		case 'modifier':
			return ABILITIES.includes(value as string);
		default:
			return false;
	}
}

function isTier(tier: unknown): tier is UsesTier {
	return (
		isRecord(tier) &&
		inRange(tier['from'], 1, 20) &&
		isCount(tier['count']) &&
		REFILLS.includes(tier['shortRest'] as string)
	);
}

/** Checks a parsed block against ADR-0016, with its tiers put in level order. */
function toUses(block: unknown): FeatureUses | null {
	if (!isRecord(block)) return null;
	const { cost, summary, tiers } = block;
	if (!COSTS.includes(cost as string) || typeof summary !== 'string') return null;
	if (!Array.isArray(tiers) || tiers.length === 0 || !tiers.every(isTier)) return null;

	const sorted = [...tiers].sort((a, b) => a.from - b.from);
	if (sorted.some((tier, index) => index > 0 && tier.from === sorted[index - 1]!.from)) return null;
	return { cost: cost as FeatureUses['cost'], summary, tiers: sorted };
}

/**
 * The feature's text without its `tome-uses` block, and the uses the block states.
 *
 * @throws When the block is not one Tome would accept.
 */
export function readFeatureUses(
	body: string,
	featureName: string,
): { body: string; uses: FeatureUses | null } {
	const block = findFencedBlock(body, USES_LANGUAGE);
	if (block === null) return { body, uses: null };

	let uses: FeatureUses | null = null;
	try {
		uses = toUses(JSON.parse(block.source));
	} catch {
		// Not JSON: reported below with the shape errors.
	}
	if (uses === null) throw new Error(`The ${USES_LANGUAGE} block under ${featureName} is not one Tome accepts.`);

	const lines = body.split(/\r?\n/);
	// The opening fence, the block's lines and the closing fence.
	lines.splice(block.startLine, block.source.split('\n').length + 2);
	return { body: lines.join('\n'), uses };
}
