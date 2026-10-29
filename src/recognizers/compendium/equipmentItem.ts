/**
 * Turns a `ttrpg-convert-cli` item note into a piece of mundane equipment.
 *
 * **The other third.** `magicItem.ts`'s `isMagic` draws the line at the
 * `rarity/none` tag - 620 of a full library's 2,099 items - and everything on
 * this side of that line is rope, tools and rations rather than treasure.
 * Those notes go to Tome's `EquipmentItem` library instead, which is shaped
 * like `MagicItem` minus rarity/attunement and plus cost/weight. This parser
 * is only ever called once the caller already knows a note is not magic (see
 * `magicItem.ts`'s `isMagic`), so unlike `parseMagicItem` it has nothing to
 * refuse and always returns a result.
 *
 * Pure and `obsidian`-free.
 */

import { preamble, titleOf } from '../labelledMarkdown';
import { readCategory, readDescription, readImagePath, SUBTITLE } from './magicItem';

/** Mirrors the server's `EquipmentItemInputDto`, minus the fields a note cannot fill. */
export interface EquipmentItem {
	name: string;
	desc: string | null;
	category: string | null;
	/** In gold pieces. */
	cost: number | null;
	/** In pounds, per unit. */
	weight: number | null;
	/** The note's filename stem, so a re-import is recognisable as one. */
	sourceKey: string;
	imagePath: string | null;
}

const COST_LINE = /^-\s*\*\*Cost\*\*:\s*(.+)$/m;
const WEIGHT_LINE = /^-\s*\*\*Weight\*\*:\s*([\d.,]+)/m;

/** Gold-piece value of one unit in each currency the CLI prints. */
const GP_PER_UNIT: Record<string, number> = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 };
const CURRENCY_TOKEN = /([\d.,]+)\s*(cp|sp|ep|gp|pp)/gi;

/**
 * `- **Cost**: 1 gp` -> `1`. Sums every currency token rather than parsing
 * just the first, for the one note in the corpus priced as `1 sp, 5 cp`.
 */
export function readCost(text: string): number | null {
	const line = COST_LINE.exec(text)?.[1];
	if (!line) return null;

	let total = 0;
	let matched = false;
	for (const token of line.matchAll(CURRENCY_TOKEN)) {
		const amount = Number(token[1]?.replace(/,/g, ''));
		if (!Number.isFinite(amount)) continue;
		total += amount * (GP_PER_UNIT[(token[2] ?? 'gp').toLowerCase()] ?? 1);
		matched = true;
	}
	return matched ? Math.round(total * 100) / 100 : null;
}

/**
 * `- **Weight**: 5.0 lbs.` -> `5`. Null when the line is absent, which the
 * corpus does for a handful of negligible items (a candle, a piece of chalk)
 * rather than printing `0`.
 */
export function readWeight(text: string): number | null {
	const raw = WEIGHT_LINE.exec(text)?.[1];
	if (!raw) return null;
	const value = Number(raw.replace(/,/g, ''));
	return Number.isFinite(value) ? value : null;
}

/**
 * Reads a piece of equipment. Always succeeds - the caller has already
 * established the note is not magic before reaching for this.
 *
 * @param key The stable handle, normally the note's filename stem.
 */
export function parseEquipmentItem(markdown: string, key: string, fallbackName: string): EquipmentItem {
	const body = preamble(markdown);
	const subtitle = SUBTITLE.exec(body)?.[1] ?? '';

	return {
		name: titleOf(markdown, fallbackName),
		desc: readDescription(markdown),
		category: readCategory(subtitle, null),
		cost: readCost(body),
		weight: readWeight(body),
		sourceKey: key,
		imagePath: readImagePath(body),
	};
}
