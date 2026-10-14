/**
 * What kind of thing a `ttrpg-convert-cli` note is.
 *
 * The CLI stamps `cssclasses: json5e-<type>` on everything it writes, which makes
 * the type a stated fact rather than something to sniff out of the body - no
 * heuristics, no folder-name guessing, and it keeps working when someone files
 * their vault differently.
 *
 * Pure and `obsidian`-free.
 */

/** Everything the scanner can tell apart. Parsers exist for a subset. */
export type CliNoteType =
	| 'creature'
	| 'legendary-group'
	| 'object'
	| 'vehicle'
	| 'species'
	| 'background'
	| 'feat'
	| 'optional-feature'
	| 'spell'
	| 'item'
	| 'class'
	| 'subclass'
	| 'index';

/**
 * Tag prefixes that name a note's type, checked before `cssclasses`.
 *
 * **The tags outlast the classes.** A `ttrpg-convert-cli` upgrade moved every
 * creature from `cssclasses: json5e-monster` to `json5e-object` - the same class
 * a siege weapon carries - while leaving `ttrpg-cli/monster/type/aberration`
 * exactly where it was. A vault regenerated with the newer version therefore has
 * 891 creatures that the class alone reads as objects, or as nothing.
 *
 * Two of these are distinctions `cssclasses` never drew at all: an eldritch
 * invocation shares `json5e-feat` with a feat, and a subclass shares
 * `json5e-class` with its parent.
 */
const BY_TAG_PREFIX: [string, CliNoteType][] = [
	// Before the creature prefix it sits inside. A legendary group is the lair
	// actions and regional effects shared by a family of monsters - 143 notes in a
	// full library, with no statblock in any of them. Tagged under `monster/` and
	// classed `json5e-note`, so reading the tag alone counts them as creatures and
	// a preview promises 4,033 where 3,890 can actually be sent.
	['ttrpg-cli/monster/legendary-group', 'legendary-group'],
	['ttrpg-cli/monster/', 'creature'],
	['ttrpg-cli/object/', 'object'],
	['ttrpg-cli/vehicle/', 'vehicle'],
	['ttrpg-cli/optional-feature/', 'optional-feature'],
	['ttrpg-cli/subclass/', 'subclass'],
];

const BY_CSS_CLASS: Record<string, CliNoteType> = {
	// Kept although the current CLI no longer writes it: an older vault is still a
	// vault, and a stale class costs nothing beside a tag that wins anyway.
	'json5e-monster': 'creature',
	'json5e-race': 'species',
	'json5e-background': 'background',
	'json5e-feat': 'feat',
	'json5e-spell': 'spell',
	'json5e-item': 'item',
	'json5e-class': 'class',
	'json5e-vehicle': 'vehicle',
	// A folder listing. `json5e-note` sits beside it on the same note, and on the
	// several hundred prose notes that are not compendium entries at all.
	'json5e-index': 'index',
};

/** Frontmatter values arrive as a list, a bare string, or missing. */
export function asStrings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
	return [];
}

/**
 * The note's type, or null when it is not a compendium entry.
 *
 * **Tags first, then `cssclasses`.** The class is the more obvious signal and the
 * less durable one: it drew no distinction between a feat and an eldritch
 * invocation or between a class and its subclass, and a CLI upgrade then moved
 * every creature onto the class a siege weapon already used. The tags said the
 * same thing throughout. See {@link BY_TAG_PREFIX}.
 *
 * The class still decides for the six types no tag names - species, background,
 * feat, spell, item, class - and still catches an older vault whose creatures are
 * `json5e-monster`.
 */
export function cliNoteType(frontmatter: Record<string, unknown> | null): CliNoteType | null {
	if (frontmatter === null) return null;

	const tags = asStrings(frontmatter['tags']);
	const classes = asStrings(frontmatter['cssclasses']);

	// An index is an index whatever else it claims to be, and it is the one type
	// with no tag of its own.
	if (classes.includes('json5e-index')) return 'index';

	for (const [prefix, type] of BY_TAG_PREFIX) {
		if (tags.some((tag) => tag.startsWith(prefix))) return type;
	}

	for (const cssClass of classes) {
		const type = BY_CSS_CLASS[cssClass];
		if (type !== undefined) return type;
	}

	return null;
}

/**
 * The types there is a parser for today.
 *
 * **`subclass` but not `class`.** All twelve base classes in a generated compendium
 * are SRD content that Tome already ships, level tables and all; what a conversion
 * adds is the subclasses the SRD does not license. So a subclass is imported as a
 * patch to its parent class and the class note itself is never read - which also
 * means never parsing the malformed progression table. See `subclass.ts`.
 */
const IMPORTABLE = new Set<CliNoteType>([
	'species',
	'background',
	'feat',
	'spell',
	'subclass',
]);

/**
 * Whether this note can be turned into content-package data yet.
 *
 * Separate from {@link cliNoteType} so that a scan can report "142 spells, not
 * yet supported" rather than saying nothing about them - a preview that omits
 * what it cannot handle reads as a preview that did not find it.
 */
export function isImportable(type: CliNoteType | null): boolean {
	return type !== null && IMPORTABLE.has(type);
}
