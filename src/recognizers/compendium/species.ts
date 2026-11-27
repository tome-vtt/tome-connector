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
	HEADING,
	labelMap,
	parseSections,
	preamble,
	sectionsAtLevel,
	slug,
	titleOf,
	type Section,
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

/** Mirrors the server's `Srd2024Lineage`, less the speed and spells a note never states. */
export interface SpeciesLineage {
	key: string;
	name: string;
	desc: string;
}

/** Mirrors the server's `Srd2024SpeciesGrants`, of which a note states only the lineage trait. */
export interface SpeciesGrants {
	lineageTrait?: string;
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
	grants: SpeciesGrants;
	lineages: SpeciesLineage[];
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
 * The `###` traits, in the order the note lists them, numbered from 1.
 *
 * The caller takes them from the whole note rather than from inside `## Traits`, because that is
 * the only level-3 heading the CLI emits - `## Description` has none - and
 * scoping to the parent would mean re-parsing its body.
 */
function readTraits(sections: Section[]): SpeciesTrait[] {
	return sections.map((section, index) => ({
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

const LINEAGE_TRAIT = /\blineage\b/i;

/** A section's text before its first sub-heading. */
function leadText(body: string): string {
	const lines = body.split(/\r?\n/);
	const end = lines.findIndex((line) => HEADING.test(line));
	return (end < 0 ? lines : lines.slice(0, end)).join('\n').trim();
}

/**
 * Splits a lineage trait's options out of the traits.
 *
 * The options are the trait's own `####` sub-sections, or else the run of `###`
 * traits straight after it whose whole names its text gives ("a Mulgore Tauren,
 * a Highmountain Tauren or a Taunka"); the first trait it does not name ends the
 * run, so "lineage" never matches an `Age` trait.
 * A lineage trait that sets no option apart - the 2024 Elf's table - stays a
 * plain trait, because Tome never reads a choice out of feature text.
 */
function splitLineages(sections: Section[]): {
	traits: Section[];
	lineages: Section[];
	lineageTrait: string | null;
} {
	const at = sections.findIndex((section) => LINEAGE_TRAIT.test(section.title));
	const named = sections[at];
	if (!named) return { traits: sections, lineages: [], lineageTrait: null };

	const nested = sectionsAtLevel(named.body, 4);
	const names = (section: Section): boolean =>
		new RegExp(`\\b${section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(named.body);
	const after = sections.slice(at + 1);
	const run = after.findIndex((section) => !names(section));
	const lineages = nested.length > 0 ? nested : run < 0 ? after : after.slice(0, run);
	if (lineages.length === 0) return { traits: sections, lineages: [], lineageTrait: null };

	const traits = sections
		.filter((section) => !lineages.includes(section))
		.map((section) => (section === named ? { ...section, body: leadText(section.body) } : section));
	return { traits, lineages, lineageTrait: named.title };
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
 * **Grants are deliberately empty, bar a lineage trait.** `Srd2024SpeciesGrants`
 * carries a free skill choice, an origin feat, a hit-point bonus and a lineage
 * trait, and the SRD catalogue gets all four from a hand-authored table because
 * the source prose does not state them structurally. The CLI output does not either: Elf's
 * lineages are a markdown table inside a trait's prose, and Human's origin feat
 * is a sentence. An imported species therefore arrives with its traits, size and
 * speed correct and grants nothing automatically. Guessing would be worse - a
 * species that silently hands out the wrong proficiency is harder to notice than
 * one that hands out none. The one exception is a lineage trait whose options
 * the note sets apart under their own headings (`splitLineages`): those go out
 * as `lineages` and `grants.lineageTrait`, so the builder asks for one instead of
 * listing them all as features.
 */
export function parseSpecies(
	markdown: string,
	key: string,
	fallbackName: string,
): Species | null {
	const fields = labelMap(preamble(markdown));
	const split = splitLineages(sectionsAtLevel(markdown, 3));
	const traits = readTraits(split.traits);

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
		grants: split.lineageTrait === null ? {} : { lineageTrait: split.lineageTrait },
		lineages: split.lineages.map((section) => ({
			key: slug(section.title),
			name: section.title,
			desc: stripMarkdownFromString(section.body),
		})),
		traits,
	};
}
