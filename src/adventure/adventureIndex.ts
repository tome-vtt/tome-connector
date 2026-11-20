/**
 * Reads a `ttrpg-convert-cli` adventure folder's index note, or falls back to
 * filename order for a hand-authored folder that has none.
 *
 * **Filename order is wrong for chapters, in general.** `10-epilogue.md` sorts
 * before `2-goblin-arrows.md` on every filesystem, so a folder listing cannot
 * give the reading order on its own. The index note the CLI writes alongside
 * every adventure states it explicitly - `# Index of <Title>` followed by one
 * link per chapter, in the right order - which is why it is read at all
 * rather than just globbing the folder.
 *
 * A hand author has no reason to know that format exists, so
 * {@link orderByFilenamePrefix} recovers the same ordering from a leading
 * number - `01 - `, `02.`, `03)` - which *is* discoverable: it is what a
 * person reaches for unprompted when a folder needs a reading order at all.
 *
 * Pure and `obsidian`-free.
 */

import { safeDecode } from '../shared';

export interface AdventureIndexEntry {
	title: string;
	/** Vault-relative filename of the chapter note, decoded. */
	file: string;
}

export interface AdventureIndex {
	title: string;
	entries: AdventureIndexEntry[];
}

const TITLE_LINE = /^#\s+Index of\s+(.+?)\s*$/m;

/** `- [Chapter 1: Goblin Arrows](./1-chapter-1.md)`, the `./` optional. */
const ENTRY_LINE = /^-\s*\[([^\]]+)\]\((?:\.\/)?([^)]+)\)\s*$/;

/** Null when this note is not an index - the caller reports that rather than guessing. */
export function parseAdventureIndex(markdown: string): AdventureIndex | null {
	const titleMatch = TITLE_LINE.exec(markdown);
	if (!titleMatch?.[1]) return null;

	const entries: AdventureIndexEntry[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const entry = ENTRY_LINE.exec(line);
		if (!entry?.[1] || !entry[2]) continue;
		entries.push({ title: entry[1].trim(), file: safeDecode(entry[2].trim()) });
	}

	return { title: titleMatch[1].trim(), entries };
}

/**
 * `01 - `, `02.`, `03)`, `04-` - one to three digits, then at least one of
 * space/period/dash/close-paren, greedily consuming a run of them so
 * `"01 - Arrival"` loses the whole `"01 - "` rather than just the digits.
 *
 * **Capped at three digits, not left open-ended.** A four-digit run is
 * indistinguishable from a title that happens to start with a year -
 * `1984 Curse of the Crimson Throne` - so the cap is what keeps that title
 * whole rather than being misread as chapter one thousand nine hundred and
 * eighty-four: with the digit group capped at three, `\d{1,3}` can only ever
 * consume `198`, and the separator class does not include `4`, so the whole
 * match fails and the title is left untouched. No real adventure folder
 * needs a thousand chapters.
 */
const FILENAME_PREFIX = /^(\d{1,3})[\s.\-)]+(.*)$/;

function stripMdExtension(filename: string): string {
	return filename.replace(/\.md$/i, '');
}

/**
 * Chapter reading order recovered from filenames alone, for a folder with no
 * index note.
 *
 * Every prefixed filename sorts by its number, ascending; anything with no
 * recognisable prefix sorts after all of those, alphabetically among itself -
 * an author who forgot a prefix on one note should not lose the whole import,
 * only its position in the tightest ordering the folder can support.
 */
export function orderByFilenamePrefix(filenames: readonly string[]): string[] {
	const withOrder = filenames.map((file) => {
		const match = FILENAME_PREFIX.exec(stripMdExtension(file));
		return { file, order: match?.[1] ? Number(match[1]) : null };
	});

	const numbered = withOrder
		.filter((entry): entry is { file: string; order: number } => entry.order !== null)
		.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
	const unnumbered = withOrder
		.filter((entry) => entry.order === null)
		.sort((a, b) => a.file.localeCompare(b.file));

	return [...numbered, ...unnumbered].map((entry) => entry.file);
}

/** The text of a `# Heading` on the first non-blank line, or null if there isn't one. */
function firstH1(content: string): string | null {
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === '') continue;
		const match = /^#\s+(.+?)\s*$/.exec(trimmed);
		return match?.[1]?.trim() || null;
	}
	return null;
}

/**
 * A chapter title for the filename-order fallback: the note's own `# ` heading
 * when it opens with one, or its filename with the numeric prefix and `.md`
 * stripped otherwise. Never the empty string - a note named only `01.md` with
 * no heading falls back to its own stripped stem, digits included.
 */
export function fallbackChapterTitle(filename: string, content: string): string {
	const heading = firstH1(content);
	if (heading) return heading;

	const stem = stripMdExtension(filename);
	const match = FILENAME_PREFIX.exec(stem);
	const title = match?.[2]?.trim();
	return title && title !== '' ? title : stem;
}
