/**
 * Turns a folder subtree into the flat, ordered list of things the exported
 * PDF contains: a heading for each subfolder that holds notes, and a chapter
 * for each note.
 *
 * This module is deliberately free of any `obsidian` import so the ordering
 * and heading-level rules can be unit tested. `syncFolderToTome` is
 * responsible for snapshotting a `TFolder` into the plain `FolderNode` shape
 * below.
 */

export interface PlannedNote {
	/** Vault-relative path, used as the render source path for link resolution. */
	path: string;
	/** The note's basename - becomes the chapter name in the PDF outline. */
	title: string;
}

export interface FolderNode {
	name: string;
	folders: FolderNode[];
	notes: PlannedNote[];
}

export type ExportItem =
	| { kind: 'group'; title: string; level: number }
	| { kind: 'chapter'; title: string; path: string; level: number };

/**
 * Deepest heading level a subfolder name is allowed to occupy. Clamping here
 * rather than letting depth run to 6 guarantees at least two levels stay free
 * for the notes' own headings, so a deeply nested vault produces a flatter
 * outline instead of one that silently drops entries.
 */
const MAX_GROUP_LEVEL = 3;

/** Deepest heading level a note title is allowed to occupy. See MAX_GROUP_LEVEL. */
const MAX_CHAPTER_LEVEL = 4;

/**
 * Orders names the way Obsidian's File Explorer does: case-insensitively, and
 * treating digit runs as numbers so "Chapter 2" sorts before "Chapter 10"
 * rather than after it.
 */
function compareNames(a: string, b: string): number {
	return a.localeCompare(b, undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

/**
 * True if this folder or any folder beneath it holds at least one note.
 * Attachment-only folders are extremely common (`attachments/`,
 * `_resources/`) and would otherwise contribute empty outline entries.
 */
function hasNotes(node: FolderNode): boolean {
	return node.notes.length > 0 || node.folders.some(hasNotes);
}

/**
 * Flattens `root` into the export order, assigning each item the heading
 * level it will occupy in the compiled document.
 *
 * The selected folder itself contributes no heading - it is the PDF's title -
 * so its notes are chapters at level 1, a subfolder's name is a level 1
 * heading with its notes at level 2, and so on until the clamps above.
 */
export function buildChapterPlan(root: FolderNode): ExportItem[] {
	const items: ExportItem[] = [];

	const walk = (node: FolderNode, depth: number): void => {
		if (depth > 0) {
			items.push({
				kind: 'group',
				title: node.name,
				level: Math.min(depth, MAX_GROUP_LEVEL),
			});
		}

		const chapterLevel = Math.min(depth + 1, MAX_CHAPTER_LEVEL);

		// Subfolders first, matching Obsidian's File Explorer, which is what
		// the user is looking at when they right-click.
		const children = node.folders
			.filter(hasNotes)
			.sort((a, b) => compareNames(a.name, b.name));
		for (const child of children) {
			walk(child, depth + 1);
		}

		for (const note of [...node.notes].sort((a, b) =>
			compareNames(a.title, b.title),
		)) {
			items.push({
				kind: 'chapter',
				title: note.title,
				path: note.path,
				level: chapterLevel,
			});
		}
	};

	walk(root, 0);
	return items;
}

/** Number of notes in a plan, for progress reporting and the empty-folder guard. */
export function countChapters(plan: readonly ExportItem[]): number {
	return plan.filter((item) => item.kind === 'chapter').length;
}
