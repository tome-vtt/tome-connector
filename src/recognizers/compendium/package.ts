/**
 * Assembles parsed compendium notes into the package the server imports.
 *
 * The point of the whole Phase 2 exercise: someone points the connector at their
 * `ttrpg-convert-cli` output and the translation happens on their machine, so
 * nobody has to learn the package format. What comes out here is exactly the
 * `Srd2024CharacterSnapshot` that `POST /api/ContentSources/import` reads - the
 * same shape the four snapshots embedded in the server are written in.
 *
 * Pure and `obsidian`-free; the caller supplies the notes.
 */

import { noteName, type Note } from '../note';
import { cliNoteType, isImportable, type CliNoteType } from './cliNote';
import { parseBackground, type Background } from './background';
import { parseFeat, type Feat } from './feat';
import { parseSpecies, type Species } from './species';
import { parseSpell, type Spell } from './spell';
import {
	hasShippedClass,
	parseSubclass,
	raiseEarlyFeatures,
	toClassPatches,
	unreachableFeatures,
	type ParsedSubclass,
	type Subclass,
} from './subclass';

/** A class entry that adds subclasses without redefining the class. */
export interface ClassPatch {
	key: string;
	name: string;
	subclasses: Subclass[];
}
import {
	readSourceLine,
	suggestedAttribution,
	suggestedLicense,
	summariseSources,
	type NoteSource,
	type SourceSummary,
} from './sourceLine';

/**
 * The document the server reads.
 *
 * `formatVersion` is the server's `Srd2024SnapshotBase.FormatVersion`, and stating
 * it is the difference between a package written for a newer Tome being refused
 * and being read wrong. 1 is the shape as it stands.
 */
export interface ContentPackage {
	formatVersion: number;
	documentKey: string;
	license: string | null;
	source: string;
	species: Species[];
	backgrounds: Background[];
	feats: Feat[];
	spells: Spell[];
	/**
	 * Class *patches*, not classes: each carries a key, a name and subclasses, and no
	 * levels or features. That shape is what tells the server to keep its own class
	 * whole and layer these subclasses into it. See `subclass.ts`.
	 */
	classes: ClassPatch[];
}

/** What a scan found, including what it could not use. */
export interface PackageReport {
	package: ContentPackage;
	/** How many of each type went in. */
	counts: Record<string, number>;
	/** Types recognised but with no parser - `955 items` rather than silence. */
	unsupported: Record<string, number>;
	/** Notes whose type was right but which would not parse, by path. */
	failed: string[];
	/** How many were left out as content Tome already ships. See {@link AssembleOptions}. */
	alreadyShipped: number;
	/**
	 * Subclasses left out because Tome has no such class - the Artificer's, most
	 * likely. The server drops these anyway; naming them is the difference between
	 * content that is missing and content that vanished.
	 */
	orphanedSubclasses: string[];
	/**
	 * Subclasses carrying a feature below the level a subclass is chosen at, which
	 * the builder can never grant. 2014 subclasses filed under a 2024 class.
	 */
	unreachableSubclasses: string[];
	sources: SourceSummary;
	/** The manifest fields to prefill, from the source lines. */
	suggested: { license: string | null; attribution: string | null };
}

export interface AssembleOptions {
	/**
	 * Whether to include notes the source line marks as SRD content.
	 *
	 * **Off by default, and that is the important default.** Tome ships SRD 5.2 in
	 * the assembly and every campaign composes on top of it, so importing the SRD
	 * again does not add anything - it *doubles* things. A campaign with both would
	 * offer two Fireballs, because `Compose` resolves collisions by key and the two
	 * keys genuinely differ.
	 *
	 * Overriding rather than duplicating would be worse still: the shipped spells
	 * carry `damageRoll`, `savingThrowAbility`, `attackRoll` and the per-slot
	 * `castingOptions` rows, and this parser deliberately reads none of them out of
	 * prose. Replacing 317 shipped spells with scraped ones would cost the table its
	 * automation to gain nothing.
	 *
	 * The counts say this is exactly the right cut. In the reference corpus the
	 * notes marked "Available in the SRD" number 339 spells, 17 feats, 4 backgrounds
	 * and 9 species - which is, to the entry, what the shipped catalogue holds. So
	 * the source line answers both questions at once: whether the content may be
	 * shared, and whether Tome already has it. What is left is the 74 spells, 60
	 * feats, 16 backgrounds and 1 species that are genuinely new.
	 *
	 * Turn it on to import your own text over the shipped catalogue anyway - which
	 * is what a key collision is *for*.
	 */
	includeSrdContent?: boolean;

	/**
	 * Whether to move subclass features that arrive before level 3 up to it.
	 *
	 * Off by default. See {@link raiseEarlyFeatures}: it is what a 2014-to-2024
	 * conversion conventionally does, and it is still a rules judgement rather than
	 * something the source states, so the person importing makes it. In a full
	 * library this affects 32 subclasses, all of them Cleric domains.
	 */
	raiseEarlySubclassFeatures?: boolean;
}

/** The title-cased name to fall back on when a note has no `# Title`. */
function nameFor(key: string): string {
	return key
		.replace(/-[a-z]{3,5}$/, '')
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

interface Parsed {
	type: CliNoteType;
	value: Species | Background | Feat | Spell | ParsedSubclass;
	source: NoteSource;
}

function parseNote(note: Note, type: CliNoteType): Parsed | null {
	const key = noteName(note.path);
	const name = nameFor(key);

	const value =
		type === 'species'
			? parseSpecies(note.content, key, name)
			: type === 'background'
				? parseBackground(note.content, key, name)
				: type === 'feat'
					? parseFeat(note.content, key, name)
					: type === 'spell'
						? parseSpell(note.content, note.frontmatter, key, name)
						: type === 'subclass'
							? parseSubclass(note.content, note.frontmatter, key, name)
							: null;

	return value === null ? null : { type, value, source: readSourceLine(note.content) };
}

/**
 * Reads a pile of notes into one package.
 *
 * Notes that are not compendium entries are ignored silently - a vault holds
 * session notes and maps as well - but a note of a *recognised* type that fails to
 * parse is reported by path, because that is a bug in a parser and hiding it turns
 * a 391-spell import into a 388-spell one that looks complete.
 *
 * @param documentKey
 *   The package's own key, which the server uses to tell one import from a re-import
 *   of the same thing.
 */
interface Sorted {
	parsed: Parsed[];
	unsupported: Record<string, number>;
	failed: string[];
	alreadyShipped: number;
}

/** Reads every note and puts it in one of the four buckets. */
function sortNotes(notes: Note[], options: AssembleOptions): Sorted {
	const out: Sorted = { parsed: [], unsupported: {}, failed: [], alreadyShipped: 0 };

	for (const note of notes) {
		const type = cliNoteType(note.frontmatter);
		if (type === null || type === 'index') continue;

		if (!isImportable(type)) {
			out.unsupported[type] = (out.unsupported[type] ?? 0) + 1;
			continue;
		}

		const result = parseNote(note, type);
		if (result === null) {
			out.failed.push(note.path);
			continue;
		}

		// Counted before the parse is discarded, so the modal can say how much was
		// left out rather than reporting a smaller compendium than the folder holds.
		if (result.source.srd && options.includeSrdContent !== true) {
			out.alreadyShipped += 1;
			continue;
		}

		out.parsed.push(result);
	}

	return out;
}

/** `Path of the World Tree (Barbarian)`, for a report a person reads. */
function describeAll(entries: ParsedSubclass[]): string[] {
	return entries.map((entry) => `${entry.subclass.name} (${entry.className})`);
}

/**
 * The class patches, with the early-feature choice applied.
 *
 * Only the subclasses whose parent Tome actually has: the server drops a patch for
 * a class it does not recognise, so sending one would be a silent loss where the
 * report is a stated one.
 */
function toPatches(subclasses: ParsedSubclass[], options: AssembleOptions): ClassPatch[] {
	const attachable = subclasses.filter(hasShippedClass);
	return toClassPatches(
		options.raiseEarlySubclassFeatures === true ? attachable.map(raiseEarlyFeatures) : attachable,
	);
}

export function assemblePackage(
	notes: Note[],
	documentKey: string,
	options: AssembleOptions = {},
): PackageReport {
	const { parsed, unsupported, failed, alreadyShipped } = sortNotes(notes, options);
	const sources = summariseSources(parsed.map((entry) => entry.source));
	const of = <T>(type: CliNoteType): T[] =>
		parsed.filter((entry) => entry.type === type).map((entry) => entry.value as T);

	const species = of<Species>('species');
	const backgrounds = of<Background>('background');
	const feats = of<Feat>('feat');
	const spells = of<Spell>('spell');

	const subclasses = of<ParsedSubclass>('subclass');
	const attachable = subclasses.filter(hasShippedClass);
	const classes = toPatches(subclasses, options);

	return {
		package: {
			formatVersion: 1,
			documentKey,
			license: suggestedLicense(sources),
			// Not a URL: the server's `Source` is "the exact source revision, so a
			// snapshot can always be reproduced", and for a vault import the honest
			// answer is which books it was generated from.
			source: sources.books.join('; ') || 'ttrpg-convert-cli',
			species,
			backgrounds,
			feats,
			spells,
			classes,
		},
		counts: {
			species: species.length,
			backgrounds: backgrounds.length,
			feats: feats.length,
			spells: spells.length,
			// The subclasses, not the patches: "36 subclasses" is what was found, and
			// "9 classes" would be a count of the envelopes they arrived in.
			subclasses: attachable.length,
		},
		unsupported,
		failed,
		alreadyShipped,
		orphanedSubclasses: describeAll(subclasses.filter((entry) => !hasShippedClass(entry))),
		unreachableSubclasses: describeAll(
			attachable.filter((entry) => unreachableFeatures(entry).length > 0),
		),
		sources,
		suggested: {
			license: suggestedLicense(sources),
			attribution: suggestedAttribution(sources),
		},
	};
}

/** Whether a package has anything in it. An empty import is a no-op worth refusing. */
export function isEmpty(report: PackageReport): boolean {
	return Object.values(report.counts).every((count) => count === 0);
}

/**
 * Singular and plural for every type a scan can report.
 *
 * `species` is the same either way, which is the reason this is a table rather
 * than an `s`.
 */
const TYPE_NOUNS: Record<string, [string, string]> = {
	species: ['species', 'species'],
	backgrounds: ['background', 'backgrounds'],
	feats: ['feat', 'feats'],
	spells: ['spell', 'spells'],
	subclasses: ['subclass', 'subclasses'],
	creature: ['creature', 'creatures'],
	'legendary-group': ['legendary group', 'legendary groups'],
	object: ['object', 'objects'],
	vehicle: ['vehicle', 'vehicles'],
	item: ['item', 'items'],
	class: ['class', 'classes'],
	subclass: ['subclass', 'subclasses'],
	'optional-feature': ['optional feature', 'optional features'],
};

/** `{spells: 391, feats: 1}` -> `391 spells, 1 feat`. Zeroes are left out. */
export function describeCounts(counts: Record<string, number>): string {
	return Object.entries(counts)
		.filter(([, count]) => count > 0)
		.map(([type, count]) => {
			const nouns = TYPE_NOUNS[type] ?? [type, type];
			return `${count} ${nouns[count === 1 ? 0 : 1]}`;
		})
		.join(', ');
}

/**
 * A package key from a folder or tag name, so the field is rarely edited.
 *
 * Must satisfy `validateManifest`'s key rule, which is the point of it: a folder
 * called "CLI Output" would otherwise prefill a key the form immediately refuses.
 */
export function packageKeyFrom(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'my-compendium'
	);
}
