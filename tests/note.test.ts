import { describe, expect, it } from 'vitest';

import { noteName } from '../src/recognizers/note';

/**
 * The note scan (a creature's label when its block has no name) and the
 * compendium package (every entry's key) both name a note by its filename. They
 * used to do it with two helpers that disagreed at the edges; these pin the one.
 */
describe('noteName', () => {
	it.each([
		['Bestiary/Goblin.md', 'Goblin'],
		['Goblin.md', 'Goblin'],
		['A/B/The Old Keep.md', 'The Old Keep'],
		['CLI/races/aasimar-xphb.md', 'aasimar-xphb'],
		['CLI\\races\\elf-xphb.md', 'elf-xphb'],
		['Bestiary/Goblin.MD', 'Goblin'],
		['Notes/Goblin.md.bak', 'Goblin.md.bak'],
	])('%s -> %s', (path, expected) => {
		expect(noteName(path)).toBe(expected);
	});

	/**
	 * A filename that is nothing but the extension has no stem. An empty name
	 * would become an empty label in the preview and an empty key in a package,
	 * so the whole path stands in: odd, but findable.
	 */
	it.each([['Notes/.md'], ['.md'], ['Notes/']])('falls back to the whole path for %s', (path) => {
		expect(noteName(path)).toBe(path);
	});
});
