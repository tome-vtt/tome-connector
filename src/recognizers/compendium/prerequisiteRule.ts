/**
 * Turns a feat's prerequisite text into the rule Tome's level-up checks.
 *
 * Tome refuses any feat that has prerequisite text and no rule, so without this
 * every imported feat with a prerequisite is greyed out.
 *
 * Pure and `obsidian`-free.
 */

import { ABILITIES } from './background';

/** Mirrors the server's `Srd2024PrerequisiteRule`; every key is written, as the SRD snapshot does. */
export interface PrerequisiteRule {
	kind: 'all' | 'any' | 'level' | 'ability' | 'feature';
	minimum: number | null;
	/** `str`, `dex`, `con`, `int`, `wis` or `cha`. */
	ability: string | null;
	/** A class feature's name, as Tome matches it: `Spellcasting`, `Fighting Style`. */
	feature: string | null;
	children: PrerequisiteRule[];
}

const ABILITY = '(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)';
const LEVEL_CLAUSE = /^(\d+)(?:st|nd|rd|th)(?:\s*[;,]\s*|$)/;
const ABILITY_CLAUSE = new RegExp(`^(${ABILITY}(?:,? (?:or )?${ABILITY})*) (\\d+) or higher$`);
// Capitalised letters and spaces, as Tome names a feature, so a long-form "When
// Gaining the Level 2 Paladin "Fighting Style" Feature" is not read as a feature
// named after the sentence.
const FEATURE_CLAUSE = /^([A-Z][A-Za-z ]*?) [Ff]eature$/;
// Where a whole alternative starts again with its own level: `... or 4th; ...`,
// `...; 4th; ...` and `...; or 4th; ...`.
const ALTERNATIVE_BREAK = /(?:\s*;\s*(?:or\s+)?|\s+or\s+)(?=\d+(?:st|nd|rd|th))/;

function node(kind: PrerequisiteRule['kind'], fields: Partial<PrerequisiteRule>): PrerequisiteRule {
	return { kind, minimum: null, ability: null, feature: null, children: [], ...fields };
}

/** One rule as is; several joined by `kind`. */
function join(kind: 'all' | 'any', rules: PrerequisiteRule[]): PrerequisiteRule {
	return rules.length === 1 ? rules[0]! : node(kind, { children: rules });
}

function readClause(clause: string): PrerequisiteRule | null {
	const ability = ABILITY_CLAUSE.exec(clause);
	if (ability) {
		const minimum = Number(ability[2]);
		const names = ability[1]!.match(new RegExp(ABILITY, 'g'))!;
		return join(
			'any',
			names.map((name) => node('ability', { ability: ABILITIES[name.toLowerCase()]!, minimum })),
		);
	}
	const feature = FEATURE_CLAUSE.exec(clause);
	if (feature) {
		return join(
			'any',
			feature[1]!.split(' or ').map((name) => node('feature', { feature: name.trim() })),
		);
	}
	return null;
}

/** One alternative: an optional level clause, then `;`-separated clauses, all required. */
function readAlternative(alternative: string): PrerequisiteRule | null {
	let rest = alternative.trim();
	// An empty alternative would read as an empty `all`, which every character meets.
	if (rest === '') return null;
	const rules: PrerequisiteRule[] = [];
	const level = LEVEL_CLAUSE.exec(rest);
	if (level) {
		rules.push(node('level', { minimum: Number(level[1]) }));
		rest = rest.slice(level[0].length);
	}
	for (const clause of rest === '' ? [] : rest.split(';')) {
		const rule = readClause(clause.trim());
		if (rule === null) return null;
		rules.push(rule);
	}
	return join('all', rules);
}

/**
 * The rule for the CLI's wording of a prerequisite - `4th; Charisma 13 or higher`,
 * `4th; Strength or Dexterity 13 or higher`, `19th; Spellcasting or Pact Magic
 * feature`, `Fighting Style Feature`, or whole alternatives such as `4th; Strength
 * 13 or higher or 4th; Dexterity 13 or higher` - or null when any clause is in a
 * shape this does not read (armor training, the long-form fighting styles, homebrew).
 *
 * All or nothing: a rule that dropped the clause it could not read would let a
 * character who does not qualify take the feat. Null keeps today's behaviour,
 * where Tome shows the text and refuses the feat.
 */
export function readPrerequisiteRule(prerequisite: string | null): PrerequisiteRule | null {
	const alternatives = (prerequisite?.trim() ?? '').split(ALTERNATIVE_BREAK);
	const rules: PrerequisiteRule[] = [];
	for (const alternative of alternatives) {
		const rule = readAlternative(alternative);
		if (rule === null) return null;
		// A level alone beside other alternatives is a misread (`4th; 4th; ...`), and
		// would let any character of that level through.
		if (alternatives.length > 1 && rule.kind === 'level') return null;
		rules.push(rule);
	}
	return join('any', rules);
}
