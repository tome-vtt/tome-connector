/**
 * Turns a `ttrpg-convert-cli` subclass note into a patch for its parent class.
 *
 * **Subclasses, not classes.** All twelve base classes in a generated compendium are
 * SRD content, which Tome already ships with its level tables, features and spell
 * progressions intact. What a conversion actually adds is the other thirty-six
 * subclasses - the ones the SRD does not license, one per class being all it allows.
 * So this reads a subclass and leaves the class alone.
 *
 * That is also what avoids the worst parse in the corpus. A class note states its
 * progression as an HTML table with malformed attributes (`<td class"level">`), empty
 * cells written as U+23E4, and value columns identified only by position - and a
 * misread row silently gives a character the wrong spell slots. A **subclass** states
 * everything twice: once in that table, and once as `### Feature Name (Level 3)`
 * headings. All 261 feature headings in the reference corpus carry the level, without
 * exception, so this reads the headings and never opens the table.
 *
 * Pure and `obsidian`-free.
 */

import { asStrings } from './cliNote';
import { parseSections, proseBody, slug, titleCase, titleOf } from '../labelledMarkdown';
import { stripMarkdownFromString } from '../../tomeMarkdownSanitizer';

/** Mirrors the server's `Srd2024SubclassFeature`. */
export interface SubclassFeature {
	key: string;
	name: string;
	desc: string;
	featureType: string | null;
	parent: string;
}

/** Mirrors the server's `Srd2024ClassLevel`, of which a subclass uses only the gains. */
export interface SubclassLevel {
	level: number;
	gains: { feature: string; detail: string | null }[];
	columns: Record<string, never>;
}

/** Mirrors the server's `Srd2024Subclass`. */
export interface Subclass {
	key: string;
	name: string;
	desc: string;
	features: SubclassFeature[];
	levels: SubclassLevel[];
}

/**
 * A subclass and the class it belongs to.
 *
 * `classKey` is the *shipped* catalogue's key for the parent, because a patch only
 * reaches the class it is meant for by colliding with it. See {@link parentClassKey}.
 */
export interface ParsedSubclass {
	classKey: string;
	className: string;
	subclass: Subclass;
}

/**
 * The prefix the shipped 2024 catalogue keys its entries with.
 *
 * Hardcoding it is the one place this package format leaks the server's own naming,
 * and it is load-bearing: a patch that does not collide with `srd-2024_barbarian`
 * adds nothing, because the server drops a subclass patch whose class it does not
 * recognise. `cliCorpus.test.ts` checks all twelve against the real snapshot rather
 * than trusting this comment.
 */
const SHIPPED_PREFIX = 'srd-2024_';

/**
 * The twelve classes Tome ships, which are the only ones a patch can attach to.
 *
 * Hardcoded because the connector cannot ask, and fixed because this is the SRD
 * 5.2 class list rather than a Tome decision. It matters for the books beyond the
 * core three: Tasha's brings the Artificer, whose subclasses have no class here to
 * hang on, and the server *drops* a patch for a class it does not recognise. Left
 * unlisted they would vanish without explanation; listed, the import can say so.
 *
 * `cliCorpus.test.ts` checks this against the real snapshot rather than trusting
 * it.
 */
export const SHIPPED_CLASSES: readonly string[] = [
	'barbarian',
	'bard',
	'cleric',
	'druid',
	'fighter',
	'monk',
	'paladin',
	'ranger',
	'rogue',
	'sorcerer',
	'warlock',
	'wizard',
];

/**
 * The level every 2024 class chooses its subclass at.
 *
 * A subclass feature below it can never be granted: the builder hands out a
 * subclass's row when the character *reaches* that level, and at levels 1 and 2
 * there is no subclass yet. That is not hypothetical - the 2014 subclasses the CLI
 * files under the 2024 classes have features at levels 1 and 2, because in those
 * rules a cleric chose a domain at level 1.
 */
export const SUBCLASS_LEVEL = 3;

const SUBCLASS_TAG = /^ttrpg-cli\/subclass\/([^/]+)\//;

/** `### Vitality of the Tree (Level 3)` - the name and the level, in one heading. */
const FEATURE_HEADING = /^(.*?)\s*\(Level\s+(\d+)\)\s*$/i;

/**
 * The parent class, from `ttrpg-cli/subclass/<class>/<subclass>`.
 *
 * The tag rather than the `*[Barbarian](./barbarian-xphb.md): Barbarian Subclass*`
 * subtitle, because the tag is already the join the CLI publishes and the subtitle is
 * prose that happens to contain a link.
 */
export function parentClassSlug(frontmatter: Record<string, unknown> | null): string | null {
	for (const tag of asStrings(frontmatter?.['tags'])) {
		const match = SUBCLASS_TAG.exec(tag);
		if (match?.[1]) return match[1];
	}
	return null;
}

/** `barbarian` -> `srd-2024_barbarian`, the key the patch has to collide with. */
export function parentClassKey(classSlug: string): string {
	return `${SHIPPED_PREFIX}${slug(classSlug)}`;
}

/** Whether Tome has a class for this patch to attach to. See {@link SHIPPED_CLASSES}. */
export function hasShippedClass(parsed: ParsedSubclass): boolean {
	return SHIPPED_CLASSES.includes(parsed.classKey.slice(SHIPPED_PREFIX.length));
}

/**
 * The features a 2024 character could never be granted, because they arrive before
 * the level a subclass is chosen at.
 *
 * Reported rather than silently fixed. The person importing decides, through
 * {@link raiseEarlyFeatures} - which is offered rather than applied because moving
 * a feature is a rules judgement, not a parse.
 */
export function unreachableFeatures(parsed: ParsedSubclass): number[] {
	return parsed.subclass.levels
		.map((level) => level.level)
		.filter((level) => level < SUBCLASS_LEVEL);
}

/**
 * Moves the unreachable features up to the level the subclass is chosen at.
 *
 * **What a conversion does, and still a judgement.** A 2014 cleric chose its domain
 * at level 1 and got Domain Spells straight away; the 2024 Cleric chooses at 3. Every
 * official 2024 domain grants its opening features at 3, so raising them is the
 * conventional reading rather than an invention - but it *is* a reading, and the
 * source does not say it. So this is a choice the import offers, defaulting to off,
 * beside the count of what it would affect.
 *
 * The alternative to both is worse in each direction: left alone the features never
 * arrive, and dropped they are gone from a book the user owns.
 *
 * Rows below the threshold collapse into the one at it, keeping their features in
 * level order so a domain's opening feature still reads before the one that followed
 * it. Nothing else moves.
 */
export function raiseEarlyFeatures(parsed: ParsedSubclass): ParsedSubclass {
	if (unreachableFeatures(parsed).length === 0) return parsed;

	const early = parsed.subclass.levels.filter((level) => level.level < SUBCLASS_LEVEL);
	const rest = parsed.subclass.levels.filter((level) => level.level >= SUBCLASS_LEVEL);
	const atThreshold = rest.find((level) => level.level === SUBCLASS_LEVEL);

	const raised = {
		level: SUBCLASS_LEVEL,
		gains: [...early.flatMap((level) => level.gains), ...(atThreshold?.gains ?? [])],
		columns: {} as Record<string, never>,
	};

	return {
		...parsed,
		subclass: {
			...parsed.subclass,
			levels: [raised, ...rest.filter((level) => level.level !== SUBCLASS_LEVEL)].sort(
				(a, b) => a.level - b.level,
			),
		},
	};
}

/**
 * The description: the tagline and prose between the progression table and the
 * features.
 *
 * The table lives in a `> [!tldr]` callout, so every one of its lines is quoted -
 * which is what makes dropping it a one-line filter rather than an HTML parse.
 */
export function readDescription(markdown: string): string {
	return proseBody(markdown, [
		// The callout holding the progression table, and its block anchor.
		/^\s*>/,
		/^\s*\^/,
		// `*[Barbarian](...): Barbarian Subclass*` - the parent, which the tag states.
		/^\s*\*\[[^\]]+\]\([^)]*\):/,
	]);
}

/**
 * The `### Name (Level N)` features, each carrying the level its heading stated.
 *
 * The level travels *with* the feature rather than being looked up again later. The
 * two are read from one heading and separating them means re-parsing and lining up by
 * index, which drifts the moment a heading is skipped - and a drifted level is the
 * silent wrong answer this whole approach exists to avoid.
 */
function readFeatures(
	markdown: string,
	subclassKey: string,
): { feature: SubclassFeature; level: number }[] {
	const found: { feature: SubclassFeature; level: number }[] = [];

	for (const section of parseSections(markdown)) {
		if (section.level !== 3) continue;

		const heading = FEATURE_HEADING.exec(section.title);
		const name = heading?.[1]?.trim();
		const level = parseInt(heading?.[2] ?? '', 10);
		// A `###` under a subclass that does not state a level is not a feature the
		// builder can place, so it is left out rather than guessed at.
		if (!name || !Number.isFinite(level)) continue;

		found.push({
			level,
			feature: {
				key: `${subclassKey}_${slug(name)}`,
				name,
				desc: stripMarkdownFromString(section.body).trim(),
				// The shipped catalogue leaves this null on subclass features too;
				// nothing in the prose distinguishes one kind of feature from another.
				featureType: null,
				parent: subclassKey,
			},
		});
	}

	return found;
}

/**
 * One row per level that grants something, which is what a shipped subclass looks
 * like - no `columns`, because a subclass adds no column to the class table.
 *
 * Two features at the same level share a row rather than producing two, since the
 * builder reads a level's `gains` as a list.
 */
function readLevels(entries: { feature: SubclassFeature; level: number }[]): SubclassLevel[] {
	const byLevel = new Map<number, SubclassLevel>();

	for (const { feature, level } of entries) {
		const row = byLevel.get(level) ?? { level, gains: [], columns: {} };
		row.gains.push({ feature: feature.key, detail: null });
		byLevel.set(level, row);
	}

	return [...byLevel.values()].sort((a, b) => a.level - b.level);
}

/**
 * Reads a subclass, or null when the note is not one.
 *
 * @param key The stable handle, normally the note's filename stem.
 */
export function parseSubclass(
	markdown: string,
	frontmatter: Record<string, unknown> | null,
	key: string,
	fallbackName: string,
): ParsedSubclass | null {
	const classSlug = parentClassSlug(frontmatter);
	if (classSlug === null) return null;

	const entries = readFeatures(markdown, key);
	if (entries.length === 0) return null;


	return {
		classKey: parentClassKey(classSlug),
		className: titleCase(classSlug),
		subclass: {
			key,
			name: titleOf(markdown, fallbackName),
			desc: readDescription(markdown),
			features: entries.map((entry) => entry.feature),
			levels: readLevels(entries),
		},
	};
}

/**
 * Groups parsed subclasses into the class patches a package carries.
 *
 * Each patch is a class entry with **no levels and no features**, which is what tells
 * the server to keep the shipped class whole and layer these subclasses into it
 * rather than replacing it. Sending a fuller entry would replace a working Barbarian
 * with whatever this parser managed to read.
 */
export function toClassPatches(
	parsed: ParsedSubclass[],
): { key: string; name: string; subclasses: Subclass[] }[] {
	const byClass = new Map<string, { key: string; name: string; subclasses: Subclass[] }>();

	for (const entry of parsed) {
		const patch = byClass.get(entry.classKey) ?? {
			key: entry.classKey,
			name: entry.className,
			subclasses: [],
		};
		patch.subclasses.push(entry.subclass);
		byClass.set(entry.classKey, patch);
	}

	return [...byClass.values()];
}
