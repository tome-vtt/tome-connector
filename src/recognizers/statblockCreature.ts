/**
 * Turns a Fantasy Statblocks creature into the body Tome's
 * `AddNonPlayerCharacter` binds: `ImportNonPlayerCharacterDto`.
 *
 * **The rules travel in one named bag, and only there.** Everything that is a
 * D&D 5e stat block goes inside `dnd5e`, a Pathfinder one inside `pf2e`, and
 * the top level carries only what belongs to no system - the name, the picture,
 * the id. The server refuses a body carrying any of the flat 5e fields a
 * connector before 1.1.0 sent (`size`, `ac`, `hp`, `cr` and the rest) with a 400
 * coded `connector.outdated`, whatever else the body carries - so a Pathfinder
 * creature copying its size or hit points out beside `pf2e` is refused too. The
 * server derives the board's vitals from the bag itself.
 *
 * Every key is the server's own camelCase spelling, matching the generated
 * schema, rather than relying on ASP.NET's case-insensitive binding.
 *
 * A pure module with no `obsidian` import, deliberately: the plugin's own rule -
 * stated in the headers of `tomeBaseUrl.ts` and `tomeChapterPlan.ts` - is that
 * logic worth testing gets its own file, because `obsidian` cannot resolve under
 * vitest. All of this mapping previously lived inside `syncNpcStatblockToTome.ts`
 * beside the DOM handling and so had no tests at all.
 *
 * The field vocabulary is Fantasy Statblocks', which is also what
 * `ttrpg-convert-cli` writes. Where the two differ the CLI is the reference,
 * because that is where the volume is.
 */

import { stripMarkdownFromString } from '../tomeMarkdownSanitizer';
import { isPf2eCreature, mapToPf2eCreature, type Pf2eCreature } from './pf2eCreature';
import { existingTomeId } from '../tomeIdWriteBack';

/** The server's `NamedAbility`, in the casing its record pins. */
export interface NamedAbility {
	name: string;
	desc: string;
}

/**
 * The server's `Dnd5eCreature` - the `dnd5e` bag - field for field, as its
 * `JsonPropertyName` attributes pin them. `darkvisionFeet` is the one field left
 * off: no Fantasy Statblocks block states it as a number.
 */
export interface Dnd5eCreature {
	size?: string;
	type?: string;
	subtype?: string;
	alignment?: string;
	ac: number;
	hp: string;
	hitDice?: string;
	speed?: string;
	stats?: number[];
	abilitySaves: NamedAbility[];
	proficientSkills: NamedAbility[];
	damageVulnerabilities?: string;
	damageResistances?: string;
	damageImmunities?: string;
	conditionImmunities?: string;
	senses?: string;
	languages?: string;
	cr?: string;
	spells: string[];
	traits: NamedAbility[];
	actions: NamedAbility[];
	legendaryActions: NamedAbility[];
	bonusActions: NamedAbility[];
	reactions: NamedAbility[];
}

/**
 * `ImportNonPlayerCharacterDto`, the whole of what the endpoint reads. Exactly
 * one of the two bags is filled; the server refuses a body carrying both.
 */
export interface NpcPayload {
	id?: string;
	image: string;
	name: string;
	dnd5e?: Dnd5eCreature;
	pf2e?: Pf2eCreature;
}

/* -------------------------------------------------------------------------
 * Coercion. Fantasy Statblocks is permissive about types; the server is not.
 * ---------------------------------------------------------------------- */

/**
 * Extracts a leading integer from a value that may be a number or a string like
 * `"15 (natural armor)"`. Returns undefined when there is no integer to find.
 */
export function toIntSafe(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === 'string') {
		const match = value.match(/-?\d+/);
		if (match) return parseInt(match[0], 10);
	}
	return undefined;
}

/** Stringifies without `Object`'s `"[object Object]"` fallback. */
export function toStringSafe(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return undefined;
}

/** `[STR, DEX, CON, INT, WIS, CHA]`, or undefined if it is not six numbers. */
export function toStatsArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) return undefined;
	if (!value.every((entry): entry is number => typeof entry === 'number')) {
		return undefined;
	}
	return value;
}

function toNamedAbility(entry: unknown): NamedAbility | null {
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
		return null;
	}
	const record = entry as Record<string, unknown>;
	const name = record.name ?? record.Name;
	const desc = record.desc ?? record.Desc;
	if (typeof name !== 'string' || name.trim() === '') return null;
	return { name, desc: typeof desc === 'string' ? desc : '' };
}

export function toNamedAbilityList(value: unknown): NamedAbility[] {
	if (!Array.isArray(value)) return [];
	const result: NamedAbility[] = [];
	for (const entry of value) {
		const converted = toNamedAbility(entry);
		if (converted) result.push(converted);
	}
	return result;
}

/* -------------------------------------------------------------------------
 * Normalisers for the shapes Fantasy Statblocks uses and the server does not.
 * ---------------------------------------------------------------------- */

/** `hp` may be `58` or `"58 (9d10+9)"`; the server wants one type. */
export function normalizeHp(value: unknown): unknown {
	return typeof value === 'number' ? String(value) : value;
}

/**
 * `"Goblin (Reskinned)"` -> `"Goblin"`.
 *
 * The CLI suffixes every name with its source, e.g.
 * `"Aberrant Spirit (Beholderkin) (XPHB)"`, so this also strips that - which is
 * wanted, but note it takes the sub-name with it. That is the existing
 * behaviour and libraries key on name, so two sources' Goblins collapse onto
 * one entry rather than becoming `Goblin (XMM)` and `Goblin (XPHB)`.
 */
export function normalizeName(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	return value
		.replace(/\s*\([^)]*\)/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * `{dexterity: 7}` -> `{name: "Dexterity", desc: "+7"}`, matching the shape
 * `skillsaves` already uses. Anything else passes through untouched.
 */
export function normalizeSaveEntry(entry: unknown): unknown {
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
		return entry;
	}

	const record = entry as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== 1) return entry;

	const ability = keys[0];
	if (ability === undefined) return entry;
	const modifier = record[ability];
	if (typeof modifier !== 'number') return entry;

	return {
		name: ability.charAt(0).toUpperCase() + ability.slice(1),
		desc: modifier >= 0 ? `+${modifier}` : `${modifier}`,
	};
}

export function normalizeSaves(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	return value.map(normalizeSaveEntry);
}

/** As above, minus the `null` placeholders Fantasy Statblocks leaves for unused slots. */
export function normalizeSkillSaves(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	return value
		.filter((entry) => entry !== null && entry !== undefined)
		.map(normalizeSaveEntry);
}

/* -------------------------------------------------------------------------
 * Resolution
 * ---------------------------------------------------------------------- */

/**
 * Whether a block carries enough of its own data to be sent without consulting
 * the bestiary.
 *
 * **This is what lets the connector work with Fantasy Statblocks switched off.**
 * `ttrpg-convert-cli` writes fully self-contained statblocks, so the common case
 * needs no plugin at all. A block that is only `monster: Goblin` does not, and
 * cannot be rescued - it contains almost nothing.
 *
 * `stats` is the test rather than `name`, because every block has a name and
 * only a real statblock has six ability scores.
 *
 * A Pathfinder block carries six ability *modifiers* under `attributes` instead, and
 * `isPf2eCreature` is the same test said in that vocabulary. Both count, because a
 * Pathfinder note that stands alone is no more in need of the bestiary than a D&D one.
 */
export function hasInlineStats(record: Record<string, unknown>): boolean {
	return toStatsArray(record.stats) !== undefined || isPf2eCreature(record);
}

/**
 * Merges bestiary data under a block's own fields, then normalises the shapes
 * that differ from the server's. Local fields win, mirroring how Fantasy
 * Statblocks itself resolves a `monster:` reference.
 *
 * `base` is null when there is no bestiary to consult, in which case the block
 * stands alone.
 */
export function mergeCreature(
	base: Record<string, unknown> | null,
	local: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = base ? { ...base, ...local } : { ...local };

	if ('hp' in merged) merged.hp = normalizeHp(merged.hp);
	if ('name' in merged) merged.name = normalizeName(merged.name);
	if ('saves' in merged) merged.saves = normalizeSaves(merged.saves);
	if ('skillsaves' in merged) merged.skillsaves = normalizeSkillSaves(merged.skillsaves);

	return merged;
}

/* -------------------------------------------------------------------------
 * Mapping
 * ---------------------------------------------------------------------- */

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Fields the server's model has no home for, folded into `Traits` rather than
 * dropped.
 *
 * The alternative was silence: `gear` alone appears on 131 of the CLI's 667
 * creatures, and a knight arriving with no plate armour recorded anywhere is a
 * worse outcome than a trait called "Gear". Each is a real thing a GM reads at
 * the table, and a trait is where they will look for it.
 */
function extraTraits(record: Record<string, unknown>): NamedAbility[] {
	const extras: NamedAbility[] = [];

	if (Array.isArray(record.gear)) {
		const gear = record.gear
			.filter((entry): entry is string => typeof entry === 'string')
			.map(stripMarkdownFromString)
			.filter((entry) => entry !== '');
		if (gear.length > 0) {
			extras.push({ name: 'Gear', desc: gear.join(', ') });
		}
	}

	for (const [key, label] of [
		['regional_effects', 'Regional Effects'],
		['lair_actions', 'Lair Actions'],
	] as const) {
		for (const entry of toNamedAbilityList(record[key])) {
			extras.push({ name: `${label}: ${entry.name}`, desc: entry.desc });
		}
	}

	return extras;
}

/**
 * Legendary actions, with the preamble the CLI stores separately restored to
 * the front of the list. Without it the list reads as a set of options with no
 * statement of how many the creature may take.
 */
function legendaryActions(record: Record<string, unknown>): NamedAbility[] {
	const actions = toNamedAbilityList(record.legendary_actions);
	const description = optionalString(record.legendary_description);
	if (!description || actions.length === 0) return actions;
	return [{ name: 'Legendary Actions', desc: description }, ...actions];
}


/**
 * A 5e stat block as the `dnd5e` bag, dropping the fields the server does not
 * model (`layout`, `fage_stats`, `bestiary`, `modifier`, `source`).
 */
export function mapToDnd5eCreature(record: Record<string, unknown>): Dnd5eCreature {
	return {
		size: optionalString(record.size),
		type: optionalString(record.type),
		subtype: optionalString(record.subtype),
		alignment: optionalString(record.alignment),
		// `ac` on 618 of the CLI's creatures, `ac_class` on 138 - a summon's AC is
		// a formula ("11 + the spell's level"), and the leading integer is the
		// best single number available for a field the server types as an int.
		ac: toIntSafe(record.ac) ?? toIntSafe(record.ac_class) ?? 0,
		hp: toStringSafe(record.hp) ?? '',
		hitDice: optionalString(record.hit_dice),
		speed: optionalString(record.speed),
		stats: toStatsArray(record.stats),
		abilitySaves: toNamedAbilityList(record.saves),
		proficientSkills: toNamedAbilityList(record.skillsaves),
		damageVulnerabilities: optionalString(record.damage_vulnerabilities),
		damageResistances: optionalString(record.damage_resistances),
		damageImmunities: optionalString(record.damage_immunities),
		conditionImmunities: optionalString(record.condition_immunities),
		senses: optionalString(record.senses),
		languages: optionalString(record.languages),
		cr: toStringSafe(record.cr),
		spells: Array.isArray(record.spells)
			? record.spells.filter((entry): entry is string => typeof entry === 'string')
			: [],
		traits: [...toNamedAbilityList(record.traits), ...extraTraits(record)],
		actions: toNamedAbilityList(record.actions),
		legendaryActions: legendaryActions(record),
		bonusActions: toNamedAbilityList(record.bonus_actions),
		reactions: toNamedAbilityList(record.reactions),
	};
}

/**
 * Maps a resolved creature onto `ImportNonPlayerCharacterDto`.
 *
 * A Pathfinder creature is a different stat block, not a differently-filled one, so
 * which bag it travels in is decided here, once: `pf2e` for a block written against
 * the Pathfinder layout, `dnd5e` for everything else. Nothing of either stat block is
 * copied out to the top level - not even the size, armour class, hit points or level
 * the board and the library draw. The server stamps those from the bag, and a body
 * carrying them flat is refused as coming from an out-of-date connector.
 */
export function mapToNpcPayload(record: Record<string, unknown>): NpcPayload {
	const image = optionalString(record.image) ?? '';
	let payload: NpcPayload;
	if (isPf2eCreature(record)) {
		const pf2e: Pf2eCreature = mapToPf2eCreature(record);
		payload = { image, name: pf2e.name, pf2e };
	} else {
		payload = { image, name: optionalString(record.name) ?? '', dnd5e: mapToDnd5eCreature(record) };
	}

	// The source `id` is often Fantasy Statblocks' own, which is not a GUID.
	const id = existingTomeId(record);
	if (id !== undefined) payload.id = id;

	return payload;
}
