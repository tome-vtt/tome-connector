/**
 * Reads the two prose shapes `ttrpg-convert-cli` uses for everything that is not
 * a monster: a bold-labelled definition list, and `##`/`###` sections.
 *
 * Only monsters get a structured statblock fence. Species, backgrounds, feats,
 * spells and items are prose - but prose written by a template, which is what
 * makes it worth parsing at all. The same four fields appear in the same order
 * in all 392 spells because a generator put them there.
 *
 * Pure and `obsidian`-free, so vitest can reach it.
 */

import { stripMarkdownFromString } from '../tomeMarkdownSanitizer';

/**
 * The label separator moves around, and it moves around *by content type*:
 *
 * | Written as        | Seen in                  |
 * |-------------------|--------------------------|
 * | `- **Label**: v`  | species, items           |
 * | `- **Label.** v`  | backgrounds              |
 * | `- **Label:** v`  | spells                   |
 * | `**Label**: v`    | feats, and spells' Classes |
 *
 * So the bullet is optional and the punctuation may sit inside or outside the
 * bold. Anchored to the start of a line to avoid matching bold text mid-sentence.
 */
const LABELLED_LINE = /^[ \t]*(?:[-*+][ \t]+)?\*\*([^*]+?)\*\*[ \t]*:?[ \t]*(.*)$/;

/**
 * The note without its YAML frontmatter.
 *
 * Callers hand these functions a note's whole text, frontmatter included - that is
 * what Obsidian's `read` returns and what `findSendables` passes around. The
 * frontmatter is data the caller reads separately, so leaving it in the body means
 * `cssclasses: json5e-feat` arrives as the first line of a feat's description. A
 * YAML comment would also read as an h1.
 *
 * Only a block at the very start counts, so a `---` rule in the body survives.
 */
export function withoutFrontmatter(markdown: string): string {
	return /^---\r?\n/.test(markdown)
		? markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
		: markdown;
}

/** `Casting time:` and `Ability Scores.` both normalise to a bare lower-case label. */
export function normaliseLabel(label: string): string {
	return label
		.replace(/[.:]\s*$/, '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

export interface LabelledValue {
	/** Normalised, so callers can look up `casting time` whatever the source wrote. */
	label: string;
	/** Markdown flattened to plain text - the CLI links every skill and item. */
	value: string;
}

/**
 * Every bold-labelled line, in order.
 *
 * **Not every one of these is a field.** A species writes its traits in the same
 * shape as its stats (`- **Storm's Thunder (Storm Giant).**`), and a feat writes
 * its benefits that way too. Callers pick the labels they know rather than
 * treating the whole list as data, which is why this returns all of them instead
 * of trying to be clever about which are which.
 */
export function parseLabelledValues(markdown: string): LabelledValue[] {
	const found: LabelledValue[] = [];

	for (const line of withoutFrontmatter(markdown).split(/\r?\n/)) {
		const match = LABELLED_LINE.exec(line);
		if (!match) continue;

		const label = normaliseLabel(match[1] ?? '');
		if (label === '') continue;

		found.push({ label, value: stripMarkdownFromString(match[2] ?? '').trim() });
	}

	return found;
}

/** The labelled lines as a lookup. First wins, so a later trait cannot shadow a field. */
export function labelMap(markdown: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const { label, value } of parseLabelledValues(markdown)) {
		if (!map.has(label)) map.set(label, value);
	}
	return map;
}

export interface Section {
	/** 2 for `##`, 3 for `###`. */
	level: number;
	title: string;
	/** Everything up to the next heading of the same level or higher. */
	body: string;
}

export const HEADING =/^(#{1,6})[ \t]+(.+?)[ \t]*$/;

/**
 * Splits on ATX headings.
 *
 * A section's body runs to the next heading at the same level *or shallower*, so
 * a species' `## Traits` contains its `### Darkvision` rather than ending at it.
 * Callers that want the traits ask for the level-3 sections; callers that want
 * the whole block ask for the level-2 one.
 */
export function parseSections(markdown: string): Section[] {
	const lines = withoutFrontmatter(markdown).split(/\r?\n/);
	const sections: Section[] = [];
	const open: { section: Section; body: string[] }[] = [];

	const close = (downTo: number): void => {
		while (open.length > 0 && (open[open.length - 1]?.section.level ?? 0) >= downTo) {
			const entry = open.pop();
			if (entry) entry.section.body = entry.body.join('\n').trim();
		}
	};

	for (const line of lines) {
		const heading = HEADING.exec(line);
		if (heading) {
			const level = (heading[1] ?? '').length;
			close(level);
			// The heading goes to whatever is still open - its ancestors - before the
			// new section is pushed, so `## Traits` keeps the `### Darkvision` line
			// and not just the prose underneath it. Appending after the push would
			// give the section its own title as the first line of its body.
			for (const entry of open) entry.body.push(line);

			const section: Section = { level, title: (heading[2] ?? '').trim(), body: '' };
			sections.push(section);
			open.push({ section, body: [] });
			continue;
		}

		// Every open section gets the line, so a parent keeps its children's text.
		for (const entry of open) entry.body.push(line);
	}

	close(0);
	return sections;
}

/** The sections at one level, e.g. the `###` traits under a species' `## Traits`. */
export function sectionsAtLevel(markdown: string, level: number): Section[] {
	return parseSections(markdown).filter((section) => section.level === level);
}

/**
 * Everything before the first heading.
 *
 * Where the CLI puts a note's field list: the `- **Size**:` lines sit under the
 * title and above `## Traits`, so reading the whole note would also collect the
 * trait names, which are written in the same shape.
 */
export function preamble(markdown: string): string {
	const lines = withoutFrontmatter(markdown).split(/\r?\n/);
	const out: string[] = [];
	let seenTitle = false;

	for (const line of lines) {
		const heading = HEADING.exec(line);
		if (heading) {
			// The `# Name` title is not a section boundary; the first `##` is.
			if (!seenTitle && (heading[1] ?? '').length === 1) {
				seenTitle = true;
				continue;
			}
			break;
		}
		out.push(line);
	}

	return out.join('\n').trim();
}

/** The note's first-level title, or the fallback (usually the file name) when it has none. */
export function titleOf(markdown: string, fallback: string): string {
	const title = parseSections(markdown).find((section) => section.level === 1)?.title;
	return title?.trim() || fallback;
}

/** A bold-labelled field line, which is data rather than prose. */
export const FIELD_LINE = /^[ \t]*(?:[-*+][ \t]+)?\*\*/;

/**
 * A note's prose: the preamble (or the whole note when it has no headings), minus
 * the source lines and images, with runs of blank lines collapsed.
 *
 * `extraSkip` names the lines this note type also drops, such as its field lines.
 */
export function proseBody(markdown: string, extraSkip: RegExp[] = []): string {
	const body = parseSections(markdown).length > 0 ? preamble(markdown) : withoutFrontmatter(markdown);
	const skip = [/^\s*\*Source:/, /^\s*!\[/, ...extraSkip];

	const lines = body.split(/\r?\n/).filter((line) => !skip.some((pattern) => pattern.test(line)));

	return stripMarkdownFromString(lines.join('\n'))
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Lower-case, hyphenated, safe as a lookup key and stable across imports. */
export function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function capitalise(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Each word capitalised and rejoined with spaces: `dark-elf` -> `Dark Elf`. */
export function titleCase(value: string, separator: string | RegExp = '-'): string {
	return value.split(separator).map(capitalise).join(' ');
}
