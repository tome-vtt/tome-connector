/**
 * Turns a Fantasy Statblocks **Pathfinder 2e** creature into the `pf2e` bag the Tome
 * server's `NonPlayerCharacter` carries.
 *
 * A pure module with no `obsidian` import, for the reason `statblockCreature.ts` gives.
 *
 * **The field vocabulary is not guessed.** It is the property list of the plugin's own
 * `Pathfinder 2e Creature Layout.json`, read from `javalent/fantasy-statblocks`:
 *
 *   name, level, rarity, alignment, size, traits, modifier, senses, languages, skills,
 *   attributes, items, abilities_top, ac, acNote, saves, hp, hpNote, hardness, immunities,
 *   weaknesses, resistances, abilities_mid, speed, attacks, spellcasting, abilities_bot,
 *   sourcebook, token
 *
 * Two of those are worth stating because the obvious guess is wrong either way: Perception
 * is **`modifier`**, not `perception`, and the six ability modifiers are **`attributes`**,
 * not `abilityMods` or `stats`. A mapper written from the obvious names would compile,
 * pass any test written from the same names, and map nothing at all against a real note.
 *
 * **`ttrpg-convert-cli` is not a source for these.** Its `creature2md.txt` writes a
 * Pathfinder creature as an `ad-statblock-pf2e` admonition of prose, with frontmatter
 * carrying only `obsidianUIMode`, `cssclasses`, `tags` and `aliases` - nothing mechanical.
 * So unlike the 5e half, where the CLI is the reference because that is where the volume
 * is, the only notes this can read are ones written against the plugin's own layout.
 */

import { toIntSafe, toStringSafe, type NamedAbility } from './statblockCreature';
import { stripMarkdownFromString } from '../tomeMarkdownSanitizer';
import { capitalise, slug } from './labelledMarkdown';

/** The `Pf2eCreature` bag, in the casing its `JsonPropertyName` attributes pin. */
export interface Pf2eAttributes {
	str: number;
	dex: number;
	con: number;
	int: number;
	wis: number;
	cha: number;
}

export interface Pf2eSkill {
	name: string;
	mod: number;
	note: string | null;
}

export interface Pf2eSpeed {
	type: string;
	feet: number;
}

export interface Pf2eStrike {
	name: string;
	kind: string;
	bonus: number;
	traits: string[];
	damage: { formula: string; type: string; category: string | null }[];
	text: string | null;
}

export interface Pf2eAbility {
	name: string;
	cost: string;
	category: string;
	traits: string[];
	text: string;
}

export interface Pf2eCreature {
	key: string;
	name: string;
	source: string | null;
	level: number;
	rarity: string;
	size: string;
	traits: string[];
	perception: number;
	perceptionNote: string | null;
	senses: string[];
	languages: string[];
	languagesNote: string | null;
	skills: Pf2eSkill[];
	attributes: Pf2eAttributes;
	ac: number;
	acNote: string | null;
	fortitude: number;
	reflex: number;
	will: number;
	savesNote: string | null;
	hp: number;
	hpNote: string | null;
	immunities: string[];
	weaknesses: string[];
	resistances: string[];
	speeds: Pf2eSpeed[];
	speedNote: string | null;
	strikes: Pf2eStrike[];
	abilities: Pf2eAbility[];
	spellcasting: unknown[];
	items: string[];
}

/* -------------------------------------------------------------------------
 * Recognition
 * ---------------------------------------------------------------------- */

/** The layout names the plugin ships. Matched loosely: a user may rename a copy. */
const PF2E_LAYOUT = /pathfinder\s*2e/i;

/**
 * Whether this block is a Pathfinder creature rather than a D&D one.
 *
 * `attributes` is the test that stands on its own, for the reason `hasInlineStats` uses
 * `stats`: every block has a name and only a real Pathfinder statblock has six ability
 * *modifiers* under that key. `layout` is accepted too because a block that names the
 * layout has said so outright, and because a creature resolved from the bestiary may
 * carry the layout on the note and its numbers in the bestiary entry.
 *
 * The two are deliberately not `&&`: a note that says one and not the other is still a
 * Pathfinder note, and treating it as 5e would send its `attributes` into a `stats`
 * column that means something different.
 */
export function isPf2eCreature(record: Record<string, unknown>): boolean {
	const layout = toStringSafe(record.layout);
	return (layout !== undefined && PF2E_LAYOUT.test(layout)) || toAttributes(record.attributes) !== null;
}

/* -------------------------------------------------------------------------
 * Coercion
 * ---------------------------------------------------------------------- */

/** A string, a list of strings, or a comma-separated string - all three appear in the wild. */
function toStringList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((entry) => toStringSafe(entry))
			.filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
			.map((entry) => stripMarkdownFromString(entry).trim());
	}
	const single = toStringSafe(value);
	if (single === undefined) return [];
	return single
		.split(',')
		.map((entry) => stripMarkdownFromString(entry).trim())
		.filter((entry) => entry !== '');
}

/**
 * The plugin's `saves` block type, which is what `skills`, `attributes` and `saves`
 * themselves all are. It renders either a record - `{fort: "+8"}` - or a list of
 * single-key objects, so both are read.
 */
function toKeyedValues(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	const absorb = (record: Record<string, unknown>): void => {
		for (const [key, raw] of Object.entries(record)) {
			const text = toStringSafe(raw);
			if (text !== undefined) out[key.trim().toLowerCase()] = text;
		}
	};

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
				absorb(entry as Record<string, unknown>);
			}
		}
		return out;
	}
	if (typeof value === 'object' && value !== null) {
		absorb(value as Record<string, unknown>);
	}
	return out;
}

/** The six modifiers, or null when this is not a Pathfinder block at all. */
export function toAttributes(value: unknown): Pf2eAttributes | null {
	const keyed = toKeyedValues(value);
	const read = (...names: string[]): number | undefined => {
		for (const name of names) {
			const found = toIntSafe(keyed[name]);
			if (found !== undefined) return found;
		}
		return undefined;
	};

	const attributes = {
		str: read('str', 'strength'),
		dex: read('dex', 'dexterity'),
		con: read('con', 'constitution'),
		int: read('int', 'intelligence'),
		wis: read('wis', 'wisdom'),
		cha: read('cha', 'charisma'),
	};

	// All six or none. A block carrying two of them is something else that happens to have
	// an `attributes` key, and reading it as a creature would invent four zeroes.
	return Object.values(attributes).every((entry) => entry !== undefined)
		? (attributes as Pf2eAttributes)
		: null;
}

/**
 * `Creature 1`, `1`, `-1` - the layout prints the word and a note may carry it.
 *
 * A creature with no readable level is level 0 rather than dropped: the level is the
 * library's sort axis, and a creature missing from the list is worse than one sorted low.
 */
export function toLevel(value: unknown): number {
	return toIntSafe(value) ?? 0;
}

/** `25 feet, fly 40 feet` into the speeds the server models, plus whatever is left as a note. */
export function toSpeeds(value: unknown): { speeds: Pf2eSpeed[]; note: string | null } {
	const speeds: Pf2eSpeed[] = [];
	const leftovers: string[] = [];

	for (const part of toStringList(value)) {
		// "fly 40 feet" and "25 feet" - the words before the number name the movement, and
		// their absence means walking, which is what `land` is.
		const match = /^([a-z\s]*?)\s*(\d+)\s*(?:feet|ft\.?)?$/i.exec(part.trim());
		const feet = match ? toIntSafe(match[2]) : undefined;
		if (match && feet !== undefined) {
			const type = (match[1] ?? '').trim().toLowerCase();
			speeds.push({ type: type === '' ? 'land' : type, feet });
		} else if (part.trim() !== '') {
			leftovers.push(part.trim());
		}
	}

	return { speeds, note: leftovers.length > 0 ? leftovers.join(', ') : null };
}

/** `[{name, desc}]`, which is what every `traits` block in the layout holds. */
function toEntries(value: unknown): NamedAbility[] {
	if (!Array.isArray(value)) return [];
	const out: NamedAbility[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
		const record = entry as Record<string, unknown>;
		const name = toStringSafe(record.name ?? record.Name);
		if (name === undefined || name.trim() === '') continue;
		out.push({ name: name.trim(), desc: toStringSafe(record.desc ?? record.Desc) ?? '' });
	}
	return out;
}

/**
 * The three ability slots the layout splits a creature into, kept apart.
 *
 * `abilities_top` is what a creature has before the fight - auras, senses; `abilities_mid`
 * is what it does when something happens to it; `abilities_bot` is what it does on its own
 * turn. The server models exactly that split, so nothing is flattened.
 */
const ABILITY_SLOTS = [
	['abilities_top', 'passive'],
	['abilities_mid', 'defensive'],
	['abilities_bot', 'offensive'],
] as const;

function toAbilities(record: Record<string, unknown>): Pf2eAbility[] {
	const out: Pf2eAbility[] = [];
	for (const [key, category] of ABILITY_SLOTS) {
		for (const entry of toEntries(record[key])) {
			out.push({ name: entry.name, cost: 'passive', category, traits: [], text: entry.desc });
		}
	}
	return out;
}

/**
 * A strike, read out of the prose the layout's `attacks` entries hold.
 *
 * The bonus is the first signed number - "**Melee** [one-action] jaws +12 [+7/+2]" - and
 * the whole line is kept as the text, because a Pathfinder strike's traits and effects are
 * a sentence rather than fields, and dropping what could not be parsed would lose them.
 */
export function toStrikes(value: unknown): Pf2eStrike[] {
	return toEntries(value).map((entry) => {
		const text = stripMarkdownFromString(entry.desc);
		const name = entry.name.toLowerCase();
		return {
			name: entry.name,
			kind: name.includes('ranged') ? 'ranged' : 'melee',
			bonus: toIntSafe(/[+-]\s*\d+/.exec(text)?.[0]) ?? 0,
			traits: [],
			damage: [],
			text: text.trim() === '' ? null : text.trim(),
		};
	});
}

/** `Acrobatics +5, Stealth +9` or `{acrobatics: "+5"}` - the layout's `saves` block, either shape. */
export function toSkills(value: unknown): Pf2eSkill[] {
	return Object.entries(toKeyedValues(value)).map(([name, mod]) => ({
		// Title case, because the key is however the note's author typed it and this is
		// printed on the stat block.
		name: capitalise(name),
		mod: toIntSafe(mod) ?? 0,
		note: null,
	}));
}

/* -------------------------------------------------------------------------
 * Mapping
 * ---------------------------------------------------------------------- */

/** The size words Pathfinder prints, matched out of the traits line. */
const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const RARITIES = ['common', 'uncommon', 'rare', 'unique'];

/**
 * Maps a resolved Pathfinder creature onto the `pf2e` bag.
 *
 * Everything the server has no field for is dropped rather than folded elsewhere, which is
 * the opposite of `extraTraits`' decision on the 5e side - and for a reason: that one folds
 * `gear` into a trait because there is nowhere else for it, while this shape has an `items`
 * list of its own. `hardness` is the one real loss, and it is a hazard's stat on a creature
 * layout rather than something a creature carries.
 */
export function mapToPf2eCreature(record: Record<string, unknown>): Pf2eCreature {
	const name = toStringSafe(record.name)?.trim() ?? '';
	const traits = toStringList(record.traits);
	const size = toStringSafe(record.size)?.trim().toLowerCase()
		?? traits.find((trait) => SIZES.includes(trait.toLowerCase()));
	const rarity = toStringSafe(record.rarity)?.trim().toLowerCase()
		?? traits.find((trait) => RARITIES.includes(trait.toLowerCase()));
	const saves = toKeyedValues(record.saves);
	const { speeds, note: speedNote } = toSpeeds(record.speed);

	return {
		key: slug(name),
		name,
		source: toStringSafe(record.sourcebook)?.trim() || null,
		level: toLevel(record.level),
		rarity: rarity ?? 'common',
		// Capitalised, because the stat block prints it and the server stamps the board's
		// neutral size column from it.
		size: size ? capitalise(size) : 'Medium',
		traits,
		perception: toIntSafe(record.modifier) ?? 0,
		perceptionNote: null,
		senses: toStringList(record.senses),
		languages: toStringList(record.languages),
		languagesNote: null,
		skills: toSkills(record.skills),
		attributes: toAttributes(record.attributes) ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
		ac: toIntSafe(record.ac) ?? 0,
		acNote: toStringSafe(record.acNote)?.trim() || null,
		fortitude: toIntSafe(saves.fort ?? saves.fortitude) ?? 0,
		reflex: toIntSafe(saves.ref ?? saves.reflex) ?? 0,
		will: toIntSafe(saves.will) ?? 0,
		savesNote: null,
		hp: toIntSafe(record.hp) ?? 0,
		hpNote: toStringSafe(record.hpNote)?.trim() || null,
		immunities: toStringList(record.immunities),
		weaknesses: toStringList(record.weaknesses),
		resistances: toStringList(record.resistances),
		speeds,
		speedNote,
		strikes: toStrikes(record.attacks),
		abilities: toAbilities(record),
		// Left empty rather than half-parsed. A Pathfinder spellcasting entry is ranks of
		// slots and a DC, and the layout holds it as prose; a bag with a name and no spells
		// in it would read on the stat block as a caster who has forgotten every spell.
		spellcasting: [],
		items: toStringList(record.items),
	};
}
