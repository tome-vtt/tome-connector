/**
 * Turns a `ttrpg-convert-cli` spell note into the character builder's shape.
 *
 * The most structured of the prose types and the largest: 391 of them, all
 * written to one template, with level, school and class list stated in the tags
 * rather than left in the text.
 *
 * Pure and `obsidian`-free.
 */

import {
	FIELD_LINE,
	labelMap,
	parseLabelledValues,
	preamble,
	proseBody,
	titleOf,
} from '../labelledMarkdown';
import { asStrings } from './cliNote';

/** Mirrors the server's `Srd2024Spell`, minus the fields prose cannot give. */
export interface Spell {
	key: string;
	name: string;
	desc: string;
	level: number | null;
	school: string | null;
	castingTime: string | null;
	reactionCondition: string | null;
	duration: string | null;
	concentration: boolean;
	ritual: boolean;
	range: number | null;
	rangeText: string | null;
	rangeUnit: string | null;
	shapeType: string | null;
	shapeSize: number | null;
	shapeSizeUnit: string | null;
	verbal: boolean;
	somatic: boolean;
	material: boolean;
	materialSpecified: string | null;
	materialConsumed: boolean;
	higherLevel: string | null;
	/**
	 * Base class slugs - `wizard`, `sorcerer` - not catalogue keys. The keys depend
	 * on the package the classes end up in, which the assembler knows and this does
	 * not.
	 */
	classes: string[];
}

const TAG_PREFIX = 'ttrpg-cli/spell/';

function tagValues(tags: string[], kind: string): string[] {
	const prefix = `${TAG_PREFIX}${kind}/`;
	return tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
}

/** `3rd-level` -> 3, `cantrip` -> 0. */
export function readLevel(tags: string[]): number | null {
	const value = tagValues(tags, 'level')[0];
	if (value === undefined) return null;
	if (value === 'cantrip') return 0;

	const match = /^(\d+)/.exec(value);
	return match?.[1] ? parseInt(match[1], 10) : null;
}

/**
 * The casting time, in the vocabulary the catalogue already uses.
 *
 * Which is an odd one - `action`, `bonus-action`, `reaction`, but `1minute` and
 * `10minutes` with no separator - and has to be matched exactly rather than
 * tidied, because it is what the builder's filters compare against.
 *
 * Everything after a comma is the reaction's trigger, and `unless cast as a
 * ritual` is the ritual flag; both are stripped here and read separately.
 */
export function readCastingTime(detail: string | undefined): string | null {
	if (!detail) return null;

	const bare = detail
		.replace(/\s+unless cast as a ritual\s*$/i, '')
		.split(',')[0]
		// Plant Growth is `1 Action (Overgrowth)` - it has two casting times and the
		// CLI keeps the one it can name. The mode is not part of the time.
		?.replace(/\s*\([^)]*\)\s*$/, '')
		.trim()
		.toLowerCase();
	if (!bare) return null;

	if (/^1 action$/.test(bare)) return 'action';
	if (/^1 bonus action$/.test(bare)) return 'bonus-action';
	if (/^1 reaction$/.test(bare)) return 'reaction';

	// `1 minute` -> `1minute`, `10 minutes` -> `10minutes`.
	const timed = /^(\d+)\s+(minutes?|hours?|days?|rounds?)$/.exec(bare);
	return timed ? `${timed[1]}${timed[2]}` : bare;
}

/** `1 Reaction, which you take when you are hit` -> the clause after the comma. */
export function readReactionCondition(detail: string | undefined): string | null {
	if (!detail || !/^1 reaction/i.test(detail.trim())) return null;

	const comma = detail.indexOf(',');
	return comma === -1 ? null : detail.slice(comma + 1).trim() || null;
}

export interface Duration {
	duration: string | null;
	concentration: boolean;
}

/** `Concentration, up to 1 minute` is one field carrying two facts. */
export function readDuration(detail: string | undefined): Duration {
	if (!detail) return { duration: null, concentration: false };

	const match = /^concentration,\s*up to\s+(.+)$/i.exec(detail.trim());
	return {
		duration: (match?.[1] ?? detail).trim().toLowerCase(),
		concentration: match !== null,
	};
}

export interface Range {
	range: number | null;
	rangeText: string | null;
	rangeUnit: string | null;
	shapeType: string | null;
	shapeSize: number | null;
	shapeSizeUnit: string | null;
}

const SHAPES = ['cone', 'cube', 'cylinder', 'emanation', 'line', 'sphere'];

const FEET_PER_MILE = 5280;

/**
 * Distances are stored in feet, whatever the book printed.
 *
 * The catalogue's `rangeUnit` is only ever `feet` or nothing - Meteor Swarm's
 * mile is 5280 and Project Image's five hundred are 2,640,000 - so a range left
 * as `1` with a `miles` unit sorts a mile-range spell below a 30-foot one. The
 * printed text is kept whole in `rangeText`, including the CLI's own `1 miles`.
 */
function toFeet(value: number, unit: string): number {
	return /mile/i.test(unit) ? value * FEET_PER_MILE : value;
}

/**
 * The range, and the area of effect when the range states one.
 *
 * `Self (15-foot Cone)` is one field carrying both: the catalogue keeps the range
 * as a bare `Self` and files the cone under `shapeType`/`shapeSize`, so the
 * parenthetical is split out rather than left in the text. It is a stated field
 * rather than a sentence, which is why reading it is not the prose-mining that
 * damage and saving throws would be.
 *
 * `Self`, `Touch`, `Sight`, `Unlimited` and `Special` are all range 0 with no
 * unit, matching what the catalogue does with them.
 */
export function readRange(detail: string | undefined): Range {
	const empty: Range = {
		range: null,
		rangeText: null,
		rangeUnit: null,
		shapeType: null,
		shapeSize: null,
		shapeSizeUnit: null,
	};
	if (!detail) return empty;

	const text = detail.trim();
	const shape = /^(.*?)\s*\((\d+)-(foot|mile)\s+(\w+)\)\s*$/i.exec(text);
	const bare = (shape?.[1] ?? text).trim();

	const shapeName = shape?.[4]?.toLowerCase();
	const area = shape
		? {
				shapeType: shapeName && SHAPES.includes(shapeName) ? shapeName : null,
				shapeSize: toFeet(parseInt(shape[2] ?? '', 10), shape[3] ?? ''),
				shapeSizeUnit: 'feet',
			}
		: { shapeType: null, shapeSize: null, shapeSizeUnit: null };

	const distance = /^(\d+)\s+(feet|foot|miles?)$/i.exec(bare);
	if (distance?.[1]) {
		return {
			range: toFeet(parseInt(distance[1], 10), distance[2] ?? ''),
			rangeText: bare,
			rangeUnit: 'feet',
			...area,
		};
	}

	return { range: 0, rangeText: bare, rangeUnit: null, ...area };
}

export interface Components {
	verbal: boolean;
	somatic: boolean;
	material: boolean;
	materialSpecified: string | null;
	materialConsumed: boolean;
}

/** `V, S, M (a ball of bat guano and sulfur)`. */
export function readComponents(detail: string | undefined): Components {
	const material = /\bM\b/.test(detail ?? '');
	const specified = /\bM\s*\(([\s\S]+)\)\s*$/.exec(detail ?? '')?.[1]?.trim() ?? null;

	return {
		verbal: /\bV\b/.test(detail ?? ''),
		somatic: /\bS\b/.test(detail ?? ''),
		material,
		materialSpecified: specified,
		// "which the spell consumes" - the phrase the books use, and the only thing
		// separating a component you keep from one you spend.
		materialConsumed: specified !== null && /consume/i.test(specified),
	};
}

/**
 * The scaling text, written under one of two headings depending on the level.
 *
 * The catalogue also carries `castingOptions` - the damage at each slot level,
 * one row per level - which is generated from structured upstream data. Prose
 * states the rule ("increases by 1d6 for each slot level above 3") and not the
 * table, so an imported spell has the sentence and no rows.
 */
export function readHigherLevel(markdown: string): string | null {
	const found = parseLabelledValues(markdown).find(
		(entry) =>
			entry.label === 'using a higher-level spell slot' || entry.label === 'cantrip upgrade',
	);
	return found?.value.trim() || null;
}

/** The spell's text: the body, minus the fields, the scaling line and the footers. */
function readDescription(markdown: string): string {
	// Every field, the scaling line and the `**Classes**:` footer are all
	// bold-labelled, so one filter removes the lot. The `*3rd-level, Evocation*`
	// subtitle is dropped too, which the tags already state.
	return proseBody(markdown, [FIELD_LINE, /^\s*\*(?:cantrip|\d+(?:st|nd|rd|th)-level)\b/i]);
}

/**
 * Reads a spell, or null when the note is not one.
 *
 * **What the CLI cannot give.** `Srd2024Spell` also carries `attackRoll`,
 * `savingThrowAbility`, `damageRoll`, `damageTypes`, `targetCount`, `targetType`
 * and the per-slot `castingOptions` rows. Those come from structured upstream
 * data; in a CLI note they exist only as sentences ("makes a Dexterity saving
 * throw", "taking 8d6 Fire damage"). Mining them out of prose is the one thing
 * this parser deliberately does not do - the same rule species' grants follow -
 * because a spell that auto-rolls the wrong save is harder to notice than one
 * that rolls nothing. Everything above is read from a field, a tag or a
 * parenthetical, all of which the source states outright.
 *
 * @param key The stable handle, normally the note's filename stem.
 */
export function parseSpell(
	markdown: string,
	frontmatter: Record<string, unknown> | null,
	key: string,
	fallbackName: string,
): Spell | null {
	const fields = labelMap(preamble(markdown));
	const castingDetail = fields.get('casting time');

	// A spell note always states a casting time and a duration.
	if (castingDetail === undefined && !fields.has('duration')) return null;

	const tags = asStrings(frontmatter?.['tags']);
	const { duration, concentration } = readDuration(fields.get('duration'));

	return {
		key,
		name: titleOf(markdown, fallbackName),
		desc: readDescription(markdown),
		level: readLevel(tags),
		school: tagValues(tags, 'school')[0] ?? null,
		castingTime: readCastingTime(castingDetail),
		reactionCondition: readReactionCondition(castingDetail),
		duration,
		concentration,
		ritual: /unless cast as a ritual/i.test(castingDetail ?? ''),
		...readRange(fields.get('range')),
		...readComponents(fields.get('components')),
		higherLevel: readHigherLevel(markdown),
		// The `spell/class/*` tags, not the `classes:` frontmatter: the latter mixes
		// in subclass grants ("Cleric (Light Domain)") and the builder's question is
		// whether a wizard can learn this, not whether some subclass is handed it.
		classes: tagValues(tags, 'class').sort(),
	};
}
