/**
 * Turns a `ttrpg-convert-cli` background note into the character builder's shape.
 *
 * The most useful of the four compendium types to import, because it is the one
 * whose mechanics the source actually states. A species' grants are buried in
 * prose; a background prints its ability scores, its skills, its tool and its
 * origin feat as labelled fields, so an imported background arrives able to do
 * something rather than merely be read.
 *
 * Pure and `obsidian`-free.
 */

import { FIELD_LINE, labelMap, preamble, proseBody, titleOf } from '../labelledMarkdown';

/** Mirrors the server's `Srd2024EquipmentOption`. */
export interface EquipmentOption {
	option: string;
	text: string;
}

/** Mirrors the server's `Srd2024Background`. */
export interface Background {
	key: string;
	name: string;
	desc: string;
	abilityScores: string[];
	abilityScoresDetail: string | null;
	skillProficiencies: string[];
	skillProficienciesDetail: string | null;
	toolProficiency: string | null;
	feat: string | null;
	equipment: string | null;
	startingEquipment: EquipmentOption[];
	benefits: never[];
}

/** The three-letter keys the builder indexes abilities by. */
export const ABILITIES: Record<string, string> = {
	strength: 'str',
	dexterity: 'dex',
	constitution: 'con',
	intelligence: 'int',
	wisdom: 'wis',
	charisma: 'cha',
};

/**
 * `"Strength, Dexterity, Constitution"` -> `["str", "dex", "con"]`.
 *
 * Anything that is not one of the six is dropped rather than passed through: the
 * builder looks these up by key, and a stray "Choose one" would sit in the list
 * as an ability that does not exist.
 */
export function readAbilities(detail: string | undefined): string[] {
	if (!detail) return [];
	return detail
		.split(/[,;]|\band\b/)
		.map((part) => ABILITIES[part.trim().toLowerCase()])
		.filter((key): key is string => key !== undefined);
}

/** `"Athletics, Intimidation"` -> `["Athletics", "Intimidation"]`, names as printed. */
export function readList(detail: string | undefined): string[] {
	if (!detail) return [];
	return detail
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
}

/**
 * Splits the lettered equipment packages out of the sentence the book prints.
 *
 * Written as `Choose A or B: (A) Spear, Shortbow, …, 14 GP; or (B) 50 GP`. The
 * options are kept as prose rather than resolved to item keys, for the reason the
 * SRD snapshot keeps its own that way: the sentence includes quantities, coin and
 * parenthetical asides ("Gaming Set (same as above)"), and pretending otherwise
 * would mean inventing structure the source does not have.
 *
 * A background with no lettered choice yields a single unlettered option, so a
 * caller never has to handle "sometimes a list, sometimes a string".
 */
export function readEquipmentOptions(detail: string | undefined): EquipmentOption[] {
	if (!detail) return [];

	const matches = [...detail.matchAll(/\(([A-Z])\)\s*/g)];
	if (matches.length === 0) {
		return [{ option: '', text: detail.trim() }];
	}

	const options: EquipmentOption[] = [];
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (!match?.[1] || match.index === undefined) continue;

		const from = match.index + match[0].length;
		const next = matches[index + 1];
		const to = next?.index ?? detail.length;

		const text = detail
			.slice(from, to)
			// The separator between packages, left behind by slicing at the next
			// letter: "…, 14 GP; or " before "(B)".
			.replace(/[;,]?\s*(?:or)?\s*$/i, '')
			.trim();

		if (text !== '') options.push({ option: match[1], text });
	}

	return options;
}

/**
 * The prose under the field list, which is the background's description.
 *
 * Taken from the preamble with the labelled lines removed rather than from a
 * `## Description` section, because backgrounds do not have one - unlike species,
 * they put the description straight after the fields. Some non-2024 backgrounds
 * add sections of their own ("Suggested Characteristics", "Feature: Steady");
 * those are left out, being flavour tables rather than the description.
 */
export function readDescription(markdown: string): string {
	return proseBody(markdown, [FIELD_LINE]);
}

/**
 * Reads a background, or null when the note is not one.
 *
 * @param key The stable handle, normally the note's filename stem.
 */
export function parseBackground(
	markdown: string,
	key: string,
	fallbackName: string,
): Background | null {
	const fields = labelMap(preamble(markdown));

	// Every background states its ability scores. A note with none of the three
	// defining fields is not one, whatever it is filed under.
	const abilityScoresDetail = fields.get('ability scores') ?? null;
	const skillDetail =
		fields.get('skill proficiencies') ?? fields.get('skill proficiency') ?? null;
	if (abilityScoresDetail === null && skillDetail === null) return null;

	const equipment = fields.get('equipment') ?? null;

	return {
		key,
		name: titleOf(markdown, fallbackName),
		desc: readDescription(markdown),
		abilityScores: readAbilities(abilityScoresDetail ?? undefined),
		abilityScoresDetail,
		skillProficiencies: readList(skillDetail ?? undefined),
		skillProficienciesDetail: skillDetail,
		// Singular and plural both appear across the twenty-one.
		toolProficiency:
			fields.get('tool proficiency') ?? fields.get('tool proficiencies') ?? null,
		// The printed feat *name*, not a key - which is what the server expects, and
		// what it resolves through the catalogue's by-name lookup.
		feat: fields.get('feat') ?? null,
		equipment,
		startingEquipment: readEquipmentOptions(equipment ?? undefined),
		// The SRD catalogue's `Benefits` are generated from structured upstream
		// data that the CLI's prose does not carry.
		benefits: [],
	};
}
