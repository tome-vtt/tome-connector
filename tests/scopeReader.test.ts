import { describe, expect, it } from 'vitest';

import { describeScope, readScope, syncTagHint, type NoteSource } from '../src/scopeReader';

/**
 * A vault in memory. The Obsidian adapter (`vaultNotes.ts`) answers the same three
 * questions from `app.vault` and the metadata cache; everything that decides which
 * notes a scope holds is on this side of the seam.
 */
function vault(notes: Record<string, string[]>): NoteSource & { reads: string[] } {
	const reads: string[] = [];
	return {
		reads,
		paths: () => Object.keys(notes),
		tags: (path) => notes[path] ?? [],
		read: (path) => {
			reads.push(path);
			return Promise.resolve({ path, content: `text of ${path}`, frontmatter: { tags: notes[path] } });
		},
	};
}

const notes = vault({
	'Maps/Keep.md': ['#tome'],
	'Maps/Dungeon/Level 1.md': [],
	'Maps Archive/Old Keep.md': ['#tome'],
	'Bestiary/Goblin.md': ['#tome/creatures'],
	'Session 1.md': [],
});

const paths = async (scope: Parameters<typeof readScope>[1]): Promise<string[]> =>
	(await readScope(notes, scope)).map((note) => note.path);

const folder = (path: string) => ({ kind: 'folder' as const, folder: { path, name: path.split('/').pop() ?? path } });

describe('readScope', () => {
	it('reads every note in the vault', async () => {
		expect(await paths({ kind: 'vault' })).toEqual([
			'Maps/Keep.md',
			'Maps/Dungeon/Level 1.md',
			'Maps Archive/Old Keep.md',
			'Bestiary/Goblin.md',
			'Session 1.md',
		]);
	});

	it('reads a folder and everything under it, but not a sibling that shares its prefix', async () => {
		expect(await paths(folder('Maps'))).toEqual(['Maps/Keep.md', 'Maps/Dungeon/Level 1.md']);
	});

	it('reads a nested folder', async () => {
		expect(await paths(folder('Maps/Dungeon'))).toEqual(['Maps/Dungeon/Level 1.md']);
	});

	it.each([['tome'], ['#tome']])('reads the notes carrying tag %s, exactly', async (tag) => {
		expect(await paths({ kind: 'tag', tag })).toEqual(['Maps/Keep.md', 'Maps Archive/Old Keep.md']);
	});

	it('hands back each note whole, in the order found', async () => {
		const [first] = await readScope(notes, folder('Bestiary'));
		expect(first).toEqual({
			path: 'Bestiary/Goblin.md',
			content: 'text of Bestiary/Goblin.md',
			frontmatter: { tags: ['#tome/creatures'] },
		});
	});

	it('reads only the notes in scope, and reports progress after each', async () => {
		const source = vault({ 'A/1.md': [], 'A/2.md': [], 'B/3.md': [] });
		const progress: [number, number][] = [];

		await readScope(source, folder('A'), (done, total) => progress.push([done, total]));

		expect(source.reads).toEqual(['A/1.md', 'A/2.md']);
		expect(progress).toEqual([
			[1, 2],
			[2, 2],
		]);
	});
});

describe('describeScope', () => {
	it.each([
		[folder('Maps/Dungeon'), '"Dungeon"'],
		[{ kind: 'vault' as const }, 'this vault'],
		[{ kind: 'tag' as const, tag: '#tome' }, '#tome'],
	])('%o reads as %s', (scope, expected) => {
		expect(describeScope(scope)).toBe(expected);
	});
});

describe('syncTagHint', () => {
	it.each([[''], ['   '], ['tome'], ['#tome'], ['#tome/creatures'], ['  #tome  ']])(
		'has nothing to say about %o',
		(tag) => {
			expect(syncTagHint(tag)).toBeNull();
		},
	);

	it.each([['my tag'], ['#tome creatures'], ['tome\tcreatures']])('refuses the space in %o', (tag) => {
		expect(syncTagHint(tag)).toBe('A tag cannot contain spaces.');
	});
});
