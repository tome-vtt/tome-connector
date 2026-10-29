/**
 * Turns a `ttrpg-convert-cli` species note into the character builder's shape.
 *
 * The note is prose, but template-written prose: a bold-labelled field list under
 * the title, then `## Traits` with one `###` per trait, then `## Description`.
 * All ten in the corpus follow it exactly.
 *
 * Pure and `obsidian`-free; the caller supplies the note's text and frontmatter.
 */

import {
	capitalise,
	labelMap,
	parseSections,
	preamble,
	sectionsAtLevel,
	slug,
	titleOf,
} from '../labelledMarkdown';
import { stripMarkdownFromString } from '../../tomeMarkdownSanitizer';

/** Mirrors the server's `Srd2024Trait`. */
export interface SpeciesTrait {
	key: string;
	name: string;
	desc: string;
	type: string | null;
	order: number;
}

/** Mirrors the server's `Srd2024Species`. */
export interface Species {
	key: string;
	name: string;
	desc: string;
	size: string | null;
	sizeDetail: string | null;
	speed: number | null;
	speedDetail: string | null;
	subspeciesOf: string | null;
	grants: Record<string, never>;
	lineages: never[];
	traits: SpeciesTrait[];
}


/**
 * The size word the builder branches on, out of a sentence that may offer a
 * choice.
 *
 * "Small or Medium" is common - 29 of the 156 species in a full conversion. The
 * model holds one value, so this takes the larger: a character defaulting to
 * Medium and being changed down is the ordinary case, and it is the size most of
 * those species are played at. The sentence is kept whole in `sizeDetail`, which
 * is what the sheet prints.
 *
 * Null when the source names no size at all. The Verdan's is "Varies", it being
 * the one species that grows a category mid-career, and inventing a value for it
 * would be worse than leaving the sheet to print the word.
 */
export function readSize(detail: string | undefined): string | null {
	if (!detail) return null;
	const text = detail.toLowerCase();
	for (const size of ['gargantuan', 'huge', 'large', 'medium', 'small', 'tiny']) {
		if (text.includes(size)) return capitalise(size);
	}
	return null;
}

/** `"30 ft."` -> 30. Null when there is no number to find. */
export function readSpeed(detail: string | undefined): number | null {
	if (!detail) return null;
	const match = /(\d+)/.exec(detail);
	return match?.[1] ? parseInt(match[1], 10) : null;
}

function sectionBody(markdown: string, title: string): string {
	const section = parseSections(markdown).find(
		(entry) => entry.level === 2 && entry.title.toLowerCase() === title,
	);
	return section ? stripMarkdownFromString(section.body) : '';
}

/**
 * The `###` traits, in the order the note lists them.
 *
 * Taken from the whole note rather than from inside `## Traits`, because that is
 * the only level-3 heading the CLI emits - `## Description` has none - and
 * scoping to the parent would mean re-parsing its body.
 */
function readTraits(markdown: string): SpeciesTrait[] {
	return sectionsAtLevel(markdown, 3).map((section, index) => ({
		key: slug(section.title),
		name: section.title,
		desc: stripMarkdownFromString(section.body),
		// `SIZE` and `SPEED` mark the two traits the SRD generator lifts values
		// out of. The CLI states those as fields instead, so nothing here is
		// either, and saying so is more honest than guessing from the title.
		type: null,
		order: index + 1,
	}));
}

/**
 * Reads a species, or null when the note is not one.
 *
 * @param key
 *   The stable handle, normally the note's filename stem. Passed in rather than
 *   derived from the name so that two species called "Elf" from different books
 *   stay distinct - the CLI's filenames carry the source suffix and the titles do
 *   not.
 *
 * **Grants are deliberately empty.** `Srd2024SpeciesGrants` carries a free skill
 * choice, an origin feat, a hit-point bonus and a lineage trait, and the SRD
 * catalogue gets all four from a hand-authored table because the source prose
 * does not state them structurally. The CLI output does not either: Elf's
 * lineages are a markdown table inside a trait's prose, and Human's origin feat
 * is a sentence. An imported species therefore arrives with its traits, size and
 * speed correct and grants nothing automatically. Guessing would be worse - a
 * species that silently hands out the wrong proficiency is harder to notice than
 * one that hands out none.
 */
export function parseSpecies(
	markdown: string,
	key: string,
	fallbackName: string,
): Species | null {
	const fields = labelMap(preamble(markdown));
	const traits = readTraits(markdown);

	// A species note always states a size, and a note with neither a size nor a
	// single trait is not one however it is labelled.
	const sizeDetail = fields.get('size') ?? null;
	if (sizeDetail === null && traits.length === 0) return null;

	const speedDetail = fields.get('speed') ?? null;

	return {
		key,
		name: titleOf(markdown, fallbackName),
		desc: sectionBody(markdown, 'description'),
		size: readSize(sizeDetail ?? undefined),
		sizeDetail,
		speed: readSpeed(speedDetail ?? undefined),
		speedDetail,
		subspeciesOf: null,
		grants: {},
		lineages: [],
		traits,
	};
}
