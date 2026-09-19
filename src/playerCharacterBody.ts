/**
 * The body a D&D Beyond character note is sent as - `PlayerCharacterInputDto`, which both
 * destinations bind: a campaign's `AddPlayerCharacter` and the account shelf's vault import.
 *
 * **The sheet travels in the `dnd5e` bag, and only there.** The top level carries what
 * belongs to no rule set - the name, the gender, the picture and the D&D Beyond id both
 * endpoints upsert on. Everything the sheet says goes into `dnd5e`, spelt as the server's
 * `Dnd5eCharacter` pins it. A body carrying any of the flat fields a connector before 1.1.0
 * sent (`species`, `hpMax`, `str` and the rest) is refused with a 400 coded
 * `connector.outdated`, even beside a valid bag.
 *
 * What is deliberately *not* sent is as much the contract as what is: `alias` and
 * `isFavorite` are Tome's own, and leaving them off is what lets a re-send keep them.
 *
 * Pure and `obsidian`-free - the send path in `syncPlayerCharacterToTome.ts` reads the note,
 * and this decides what the server is handed, so `tests/requestBodies.test.ts` can pin it.
 */

import { CLASSES_PROPERTY, classesFromFrontmatter, type PcClassPayload } from './pcClassLine';
import { toIntSafe, toStringSafe } from './recognizers/statblockCreature';
import type { PcSheet } from './tomePcSheetParser';

/**
 * Every frontmatter property {@link playerCharacterBody} reads, in the exporter's names - and
 * so the only ones the send path lets through. `tests/playerCharacterBody.test.ts` fails when
 * the mapper reads a key missing here, which would otherwise send nothing, silently.
 */
export const PLAYER_CHARACTER_PROPERTIES = [
	'name',
	'race',
	'class',
	'level',
	'background',
	'alignment',
	'gender',
	'xp',
	'hp_max',
	'hp_current',
	'hp_temp',
	'ac',
	'speed',
	'proficiency_bonus',
	'str',
	'dex',
	'con',
	'int',
	'wis',
	'cha',
	'dndbeyond_id',
	'image',
	// Optional, and not something the exporter writes: one entry per class with its own
	// level, for a character with more than one. Without it the server reads the classes
	// out of `class` itself - see `pcClassLine`.
	CLASSES_PROPERTY,
] as const;

/**
 * The server's `Dnd5eCharacter`, as far as a D&D Beyond note fills it. The note body's half
 * is {@link PcSheet}, already in the bag's casing; the frontmatter's half is declared here.
 */
export interface Dnd5eCharacter extends PcSheet {
	species: string;
	class: string;
	level: number;
	/** Left off when the note has no `classes` property, so the server reads them off `class`. */
	classes?: PcClassPayload[];
	background?: string;
	alignment?: string;
	xp?: number;
	hpMax: number;
	hpCurrent: number;
	hpTemp?: number;
	/**
	 * Left off when the note states none. The server reads absence as "unstated": a create
	 * takes its default armour class and an update keeps the stored one, where a `0` would be
	 * written as a real armour class of zero.
	 */
	ac?: number;
	speed: number;
	proficiencyBonus: number;
	str: number;
	dex: number;
	con: number;
	int: number;
	wis: number;
	cha: number;
}

/** `PlayerCharacterInputDto`, minus the fields that are Tome's to set rather than the note's. */
export interface PlayerCharacterBody {
	name: string;
	gender?: string;
	dndBeyondId?: number;
	/** A `data:` URI by the time this is built - `resolveImagePaths` swaps the path for bytes. */
	image?: string;
	dnd5e: Dnd5eCharacter;
}

/**
 * Maps a note's frontmatter (using the exporter's lowercase/snake_case names) and the
 * structured data parsed out of its body onto the body.
 *
 * Where the two overlap the frontmatter wins - it is typed YAML rather than a formatted
 * table cell, so `ac: 19` is a safer read than `| 19 |`. `initiative` is the one value the
 * body has and frontmatter does not.
 */
export function playerCharacterBody(frontmatter: Record<string, unknown>, sheet: PcSheet): PlayerCharacterBody {
	// The sheet's whole numbers the server types as a plain `int`, so an absent one is 0.
	const whole = (key: string): number => toIntSafe(frontmatter[key]) ?? 0;

	return {
		name: toStringSafe(frontmatter.name) ?? '',
		gender: toStringSafe(frontmatter.gender),
		dndBeyondId: toIntSafe(frontmatter.dndbeyond_id),
		image: toStringSafe(frontmatter.image),
		dnd5e: {
			...sheet,
			species: toStringSafe(frontmatter.race) ?? '',
			class: toStringSafe(frontmatter.class) ?? '',
			level: whole('level'),
			classes: classesFromFrontmatter(frontmatter),
			background: toStringSafe(frontmatter.background),
			alignment: toStringSafe(frontmatter.alignment),
			xp: toIntSafe(frontmatter.xp),
			hpMax: whole('hp_max'),
			hpCurrent: whole('hp_current'),
			hpTemp: toIntSafe(frontmatter.hp_temp),
			ac: toIntSafe(frontmatter.ac),
			speed: whole('speed'),
			proficiencyBonus: whole('proficiency_bonus'),
			str: whole('str'),
			dex: whole('dex'),
			con: whole('con'),
			int: whole('int'),
			wis: whole('wis'),
			cha: whole('cha'),
		},
	};
}
