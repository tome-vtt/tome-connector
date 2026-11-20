import { describe, expect, it } from 'vitest';

import { fallbackChapterTitle, orderByFilenamePrefix, parseAdventureIndex } from '../src/adventure/adventureIndex';

describe('parseAdventureIndex', () => {
	it('keeps a stray % in an entry file as written', () => {
		const index = parseAdventureIndex('# Index of Sale\n\n- [Chapter 1: Half off](./1-50%off.md)\n');

		expect(index?.entries).toEqual([{ title: 'Chapter 1: Half off', file: '1-50%off.md' }]);
	});

	it('reads the title and entries in document order', () => {
		const markdown = `# Index of Lost Mine of Phandelver

- [Chapter 1: Goblin Arrows](./1-chapter-1.md)
- [Chapter 2: Cragmaw Hideout](./2-chapter-2.md)
- [Chapter 10: Epilogue](./10-epilogue.md)
`;

		const index = parseAdventureIndex(markdown);

		expect(index?.title).toBe('Lost Mine of Phandelver');
		expect(index?.entries).toEqual([
			{ title: 'Chapter 1: Goblin Arrows', file: '1-chapter-1.md' },
			{ title: 'Chapter 2: Cragmaw Hideout', file: '2-chapter-2.md' },
			{ title: 'Chapter 10: Epilogue', file: '10-epilogue.md' },
		]);
	});

	it('is why the index is read at all: filename order would put chapter 10 before chapter 2', () => {
		const markdown = `# Index of Test

- [Chapter 2](./2-chapter.md)
- [Chapter 10](./10-chapter.md)
`;
		const index = parseAdventureIndex(markdown);
		expect(index?.entries.map((entry) => entry.file)).toEqual(['2-chapter.md', '10-chapter.md']);
	});

	it('accepts an entry link without the leading ./', () => {
		const markdown = `# Index of Test

- [Chapter 1](1-chapter.md)
`;
		expect(parseAdventureIndex(markdown)?.entries).toEqual([{ title: 'Chapter 1', file: '1-chapter.md' }]);
	});

	it('returns null for a note that is not an index', () => {
		expect(parseAdventureIndex('# Chapter 1: Goblin Arrows\n\nSome prose.')).toBeNull();
	});

	it('decodes a percent-encoded filename', () => {
		const markdown = `# Index of Test

- [Chapter 1](./1-chapter%20one.md)
`;
		expect(parseAdventureIndex(markdown)?.entries[0]?.file).toBe('1-chapter one.md');
	});
});

describe('orderByFilenamePrefix', () => {
	it('orders numbered filenames by their number, not alphabetically', () => {
		const ordered = orderByFilenamePrefix(['10 - Epilogue.md', '2 - Goblin Arrows.md', '01 - Arrival.md']);
		expect(ordered).toEqual(['01 - Arrival.md', '2 - Goblin Arrows.md', '10 - Epilogue.md']);
	});

	it('accepts a dot or a close-paren as the separator, not only a dash', () => {
		const ordered = orderByFilenamePrefix(['02) The Bell Tower.md', '01. Arrival.md']);
		expect(ordered).toEqual(['01. Arrival.md', '02) The Bell Tower.md']);
	});

	it('sorts an unprefixed note after every prefixed one, rather than failing the whole import', () => {
		const ordered = orderByFilenamePrefix(['01 - Arrival.md', 'Notes.md', '02 - The Bell Tower.md']);
		expect(ordered).toEqual(['01 - Arrival.md', '02 - The Bell Tower.md', 'Notes.md']);
	});

	it('does not treat a title that starts with a real number as a prefix', () => {
		// Four digits is one more than the prefix ever matches, so this sorts as unprefixed -
		// alphabetically after every genuinely numbered chapter, not as "chapter 1984".
		const ordered = orderByFilenamePrefix(['Aftermath.md', '1984 Curse of the Crimson Throne.md', '01 - Arrival.md']);
		expect(ordered).toEqual(['01 - Arrival.md', '1984 Curse of the Crimson Throne.md', 'Aftermath.md']);
	});
});

describe('fallbackChapterTitle', () => {
	it('prefers the note\'s own first-line heading over its filename', () => {
		const title = fallbackChapterTitle('01 - Arrival.md', '# Arrival in Milbrook\n\nSome prose.');
		expect(title).toBe('Arrival in Milbrook');
	});

	it('strips the numeric prefix from the filename when there is no heading', () => {
		expect(fallbackChapterTitle('01 - Arrival in Milbrook.md', 'Some prose with no heading.')).toBe(
			'Arrival in Milbrook',
		);
	});

	it('falls back to the bare stem when the filename is only a number', () => {
		expect(fallbackChapterTitle('01.md', 'Some prose.')).toBe('01');
	});

	it('skips blank lines before finding the heading', () => {
		expect(fallbackChapterTitle('01 - Arrival.md', '\n\n# Arrival\n\nProse.')).toBe('Arrival');
	});
});
