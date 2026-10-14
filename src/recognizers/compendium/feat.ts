/**
 * Turns a `ttrpg-convert-cli` feat note into the character builder's shape.
 *
 * The simplest of the four: a prerequisite line, some prose, and the feat's
 * benefits as bold-labelled paragraphs.
 *
 * Pure and `obsidian`-free.
 */

import { FIELD_LINE, parseLabelledValues, proseBody, slug, titleOf } from '../labelledMarkdown';
import { readSourceLine } from './sourceLine';

/** Mirrors the server's `Srd2024Benefit`. */
export interface Benefit {
	key: string;
	name: string;
	desc: string;
	type: string | null;
}

/** Mirrors the server's `Srd2024Feat`. */
export interface Feat {
	key: string;
	name: string;
	desc: string;
	/** `Origin`, `General`, `Fighting Style` or `Epic Boon` - see {@link readType}. */
	type: string | null;
	prerequisite: string | null;
	benefits: Benefit[];
}

/** Labels that are the feat's own fields rather than one of its benefits. */
const FIELD_LABELS = new Set(['prerequisite', 'prerequisites', 'source']);

/**
 * The feat's category, read out of its prerequisite.
 *
 * `Srd2024Feat.Type` is what lets a level 1 character be offered a different list
 * from a level 4 one, so a feat without it is a feat the builder cannot place.
 * The CLI does not state it - every feat is tagged `ttrpg-cli/feat` and nothing
 * else - but it does not need to, because in the 2024 rules the category *is* the
 * prerequisite:
 *
 * | Prerequisite            | Type           |
 * |-------------------------|----------------|
 * | (none)                  | Origin         |
 * | `4th`                   | General        |
 * | `19th`                  | Epic Boon      |
 * | mentions Fighting Style | Fighting Style |
 *
 * That is a reading of what the source says, not an inference from what it omits,
 * and on the 2024 Player's Handbook it partitions exactly: 43 General, 12 Epic
 * Boon, 12 Fighting Style, and the 10 with no prerequisite are precisely the ten
 * origin feats the book lists.
 *
 * The level check is a word-boundary match on the ordinal so that "Level 2 Ranger
 * Fighting Style" - one of the two long-form fighting style prerequisites - is not
 * read as a General feat. Fighting Style is therefore tested first.
 *
 * @param is2024
 *   Whether the note came from a 2024 book. **The no-prerequisite rule is only
 *   true there.** Origin feats do not exist in the 2014 rules, where a feat is
 *   just a feat and none of them carries a level prerequisite - so applying the
 *   table to a 2014 vault files Dungeon Delver, Linguist and Martial Adept as
 *   origin feats and offers them to a level 1 character. A vault built from the
 *   whole `ttrpg-convert-cli` source map holds both editions at once, so this is
 *   the ordinary case rather than an edge one. Anything not from 2024 gets no
 *   category, which means the builder does not offer it at all - the right answer
 *   for a 2014 feat in a 2024 character builder, and a visible absence rather
 *   than a silent misplacement.
 */
export function readType(prerequisite: string | null, is2024: boolean): string | null {
	if (!is2024) return null;
	if (prerequisite === null || prerequisite.trim() === '') return 'Origin';
	if (/fighting style/i.test(prerequisite)) return 'Fighting Style';
	if (/\b19th\b/.test(prerequisite)) return 'Epic Boon';
	if (/\b4th\b/.test(prerequisite)) return 'General';
	// A prerequisite in some shape the 2024 books do not use - homebrew, most
	// likely. Left unset rather than guessed at, for the reason above.
	return null;
}

/**
 * The feat's benefits: the bold-labelled paragraphs after the intro.
 *
 * A feat writes `**Initiative Proficiency.** When you roll…` in exactly the shape
 * a species writes a stat, which is why `parseLabelledValues` returns everything
 * and the caller decides. Here the decision is the inverse of the species one -
 * the labelled lines are the content, and the two field labels are the exception.
 */
export function readBenefits(markdown: string): Benefit[] {
	return parseLabelledValues(markdown)
		.filter((entry) => !FIELD_LABELS.has(entry.label))
		.filter((entry) => entry.value.trim() !== '')
		.map((entry, index) => ({
			// Numbered as the SRD catalogue numbers its own, so two benefits sharing
			// a label cannot collide - which they do upstream, where both of Alert's
			// benefits key on `initative-proficiency`.
			key: `${index + 1}-${slug(entry.label)}`,
			// Title-cased from the normalised label, since the label carries the
			// display name and normalising lower-cased it.
			name: entry.label.replace(/\b\w/g, (character) => character.toUpperCase()),
			desc: entry.value,
			type: null,
		}));
}

/**
 * The prose that is not a benefit and not a field - "You gain the following
 * benefits.", and the body of a feat that has no labelled benefits at all.
 */
export function readDescription(markdown: string): string {
	return proseBody(markdown, [FIELD_LINE]);
}

/**
 * Reads a feat, or null when the note has nothing in it.
 *
 * Unlike a species - whose grants the source never states - a feat imports whole:
 * name, description, prerequisite, benefits and, through {@link readType}, the
 * category the builder files it under. Compare `parseFeat` on `feats/alert-xphb.md`
 * against the SRD catalogue's own Alert and the two agree field for field, which
 * is what `feat.test.ts` asserts.
 *
 * @param key The stable handle, normally the note's filename stem.
 */
export function parseFeat(markdown: string, key: string, fallbackName: string): Feat | null {
	const prerequisite =
		parseLabelledValues(markdown).find(
			(entry) => entry.label === 'prerequisite' || entry.label === 'prerequisites',
		)?.value ?? null;

	const benefits = readBenefits(markdown);
	const desc = readDescription(markdown);
	if (desc === '' && benefits.length === 0) return null;


	return {
		key,
		name: titleOf(markdown, fallbackName),
		desc,
		// The source line dates the note: 2024 books print "(2024)" in the title and
		// the 2014 ones print no year at all.
		type: readType(prerequisite, readSourceLine(markdown).year === 2024),
		prerequisite,
		benefits,
	};
}
