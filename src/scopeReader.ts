import type { Note } from './recognizers/note';

/**
 * Which notes a bulk run reads - a folder, the whole vault, or the sync tag - and
 * the reading of them.
 *
 * The vault sync and the content-source import read a whole scope through
 * {@link readScope}; the adventure scan reads the one note a link points at through
 * the same {@link NoteSource}. Either way a note arrives as a {@link Note}. Pure and
 * `obsidian`-free: `vaultNotes.ts` adapts Obsidian's vault to a `NoteSource`, so
 * which notes a scope holds is decided (and tested) on this side of the seam.
 */

export type SyncScope =
	/** `TFolder` fits; only its path and name are read. */
	| { kind: 'folder'; folder: { path: string; name: string } }
	| { kind: 'vault' }
	| { kind: 'tag'; tag: string };

/** The vault, as the scope reader needs it. */
export interface NoteSource {
	/** Every markdown note's path. */
	paths(): string[];
	/** A note's tags, frontmatter and inline, each with its `#`. */
	tags(path: string): string[];
	/** Throws when there is no note at `path`. */
	read(path: string): Promise<Note>;
}

export function describeScope(scope: SyncScope): string {
	switch (scope.kind) {
		case 'folder':
			return `"${scope.folder.name}"`;
		case 'vault':
			return 'this vault';
		case 'tag':
			return scope.tag;
	}
}

function pathsInScope(notes: NoteSource, scope: SyncScope): string[] {
	const all = notes.paths();

	switch (scope.kind) {
		case 'vault':
			return all;
		case 'folder': {
			// `startsWith` on the folder path plus a separator, so `Maps` does not
			// also collect `Maps Archive`.
			const prefix = `${scope.folder.path}/`;
			return all.filter((path) => path === scope.folder.path || path.startsWith(prefix));
		}
		case 'tag': {
			const wanted = scope.tag.startsWith('#') ? scope.tag : `#${scope.tag}`;
			return all.filter((path) => notes.tags(path).includes(wanted));
		}
	}
}

/** Every note in scope, read in order, with a count after each. */
export async function readScope(
	notes: NoteSource,
	scope: SyncScope,
	onProgress?: (done: number, total: number) => void,
): Promise<Note[]> {
	const paths = pathsInScope(notes, scope);
	const read: Note[] = [];

	for (const [index, path] of paths.entries()) {
		read.push(await notes.read(path));
		onProgress?.(index + 1, paths.length);
	}

	return read;
}

/**
 * What to say beneath the sync-tag setting, or null when the tag is usable.
 *
 * Here beside the tag rule it describes, rather than with the commands, so the
 * settings tab can import it without importing the sync along with it.
 */
export function syncTagHint(tag: string): string | null {
	return /\s/.test(tag.trim()) ? 'A tag cannot contain spaces.' : null;
}
