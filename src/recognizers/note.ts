/**
 * A note as every scanner takes it: where it is, what it says, and Obsidian's
 * parsed frontmatter. Pure and `obsidian`-free - `scopeReader.ts` produces these,
 * and the note scan and the compendium package both read them.
 */
/** Says what a reader skipped or changed, so the send results can list it. */
export type Warn = (message: string) => void;

export interface Note {
	/** Vault-relative path. */
	path: string;
	content: string;
	/** Obsidian's parsed frontmatter, or null. */
	frontmatter: Record<string, unknown> | null;
}

/**
 * The note's filename without `.md` - a creature's label when its block does not
 * name itself, and the key of a compendium entry (the CLI's own stable handle).
 *
 * A filename with no stem (`Notes/.md`) falls back to the whole path, so nothing
 * downstream is ever named the empty string.
 */
export function noteName(path: string): string {
	const stem = (path.split(/[\\/]/).pop() ?? '').replace(/\.md$/i, '');
	return stem === '' ? path : stem;
}
