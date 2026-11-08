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

import { asRecord } from '../../shared';
import { extractFencedBlocks } from '../markdownBlocks';

const USES_LANGUAGE = 'tome-uses';

const COSTS = ['action', 'attack', 'bonus', 'reaction', 'none'] as const;
const REFILLS = ['none', 'one', 'all'] as const;
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
	(list as readonly unknown[]).includes(value);

export type UsesCount =
	| { fixed: number }
	| { proficiency: true }
	| { modifier: (typeof ABILITIES)[number] }
	| { perLevel: number }
	| { unlimited: true };

export interface UsesTier {
	from: number;
	count: UsesCount;
	shortRest: (typeof REFILLS)[number];
}

/** Mirrors the server's declared feature uses (ADR-0016). */
export interface FeatureUses {
	cost: (typeof COSTS)[number];
	summary: string;
	tiers: UsesTier[];
}

const inRange = (value: unknown, low: number, high: number): value is number =>
	Number.isInteger(value) && (value as number) >= low && (value as number) <= high;

function isCount(value: unknown): value is UsesCount {
	const count = asRecord(value);
	if (count === null) return false;
	const kinds = Object.keys(count);
	if (kinds.length !== 1) return false;
	const amount = count[kinds[0]!];
	switch (kinds[0]) {
		case 'fixed':
		case 'perLevel':
			return inRange(amount, 1, 99);
		case 'proficiency':
		case 'unlimited':
			return amount === true;
		case 'modifier':
			return isOneOf(ABILITIES, amount);
		default:
			return false;
	}
}

/** One tier with only the fields Tome reads, or null when Tome would refuse it. */
function toTier(value: unknown): UsesTier | null {
	const { from, count, shortRest } = asRecord(value) ?? {};
	if (!inRange(from, 1, 20) || !isCount(count) || !isOneOf(REFILLS, shortRest)) return null;
	return { from, count, shortRest };
}

/** Checks a parsed block against ADR-0016, with its tiers put in level order. */
function toUses(value: unknown): FeatureUses | null {
	const { cost, summary, tiers } = asRecord(value) ?? {};
	if (!isOneOf(COSTS, cost) || typeof summary !== 'string' || summary.trim() === '') return null;
	if (!Array.isArray(tiers) || tiers.length === 0) return null;

	const read = tiers.map(toTier);
	if (read.some((tier) => tier === null)) return null;
	const sorted = (read as UsesTier[]).sort((a, b) => a.from - b.from);
	if (sorted.some((tier, index) => index > 0 && tier.from === sorted[index - 1]!.from)) return null;
	return { cost, summary, tiers: sorted };
}

/**
 * The feature's text without its `tome-uses` block, and the uses the block states.
 *
 * @throws When the block is not one Tome would accept, or there is more than one.
 */
export function readFeatureUses(
	body: string,
	featureName: string,
): { body: string; uses: FeatureUses | null } {
	const blocks = extractFencedBlocks(body).filter((block) => block.language === USES_LANGUAGE);
	if (blocks.length === 0) return { body, uses: null };
	const refused = new Error(`The ${USES_LANGUAGE} block under ${featureName} is not one Tome accepts.`);
	if (blocks.length > 1) throw refused;
	const block = blocks[0]!;

	let uses: FeatureUses | null = null;
	try {
		uses = toUses(JSON.parse(block.source));
	} catch {
		// Not JSON: refused below, like a block of the wrong shape.
	}
	if (uses === null) throw refused;

	const lines = body.split(/\r?\n/);
	// The opening fence, the block's lines and the closing fence.
	lines.splice(block.startLine, block.source.split('\n').length + 2);
	return { body: lines.join('\n'), uses };
}
