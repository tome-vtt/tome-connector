import { describe, expect, it } from 'vitest';

import { classifyCliPath, findLinks, findWikiLinks, flattenLinks } from '../src/adventure/adventureLinks';

describe('classifyCliPath', () => {
	it('classifies a link with a stray % in its path', () => {
		expect(classifyCliPath('3-Mechanics/CLI/items/50%off-xdmg.md')).toEqual({ kind: 'item' });
	});

	it('classifies a bestiary link', () => {
		expect(classifyCliPath('3-Mechanics/CLI/bestiary/goblin-xphb.md')).toEqual({ kind: 'bestiary' });
	});

	it('classifies an items link', () => {
		expect(classifyCliPath('3-Mechanics/CLI/items/bag-of-holding-xdmg.md')).toEqual({ kind: 'item' });
	});

	it('has nowhere for a rules link, a spell link, or an unrelated path to go', () => {
		expect(classifyCliPath('3-Mechanics/CLI/rules/skills-xphb.md')).toEqual({ kind: 'none' });
		expect(classifyCliPath('3-Mechanics/CLI/spells/fireball-xphb.md')).toEqual({ kind: 'none' });
		expect(classifyCliPath('3-Mechanics/CLI/adventures/other-book.md')).toEqual({ kind: 'none' });
		expect(classifyCliPath('some/other/vault/path.md')).toEqual({ kind: 'none' });
	});

	it('ignores a heading anchor and decodes a percent-encoded path', () => {
		expect(classifyCliPath('3-Mechanics/CLI/bestiary/goblin-xphb.md#Actions')).toEqual({ kind: 'bestiary' });
		expect(classifyCliPath('3-Mechanics%2FCLI%2Fbestiary%2Fgoblin.md')).toEqual({ kind: 'bestiary' });
	});
});

describe('findLinks', () => {
	it('finds a link and reports its offsets', () => {
		const markdown = 'Beware the [Goblin](3-Mechanics/CLI/bestiary/goblin-xphb.md) ahead.';
		const links = findLinks(markdown);

		expect(links).toHaveLength(1);
		expect(links[0]?.text).toBe('Goblin');
		expect(links[0]?.path).toBe('3-Mechanics/CLI/bestiary/goblin-xphb.md');
		expect(markdown.slice(links[0]?.start, links[0]?.end)).toBe(
			'[Goblin](3-Mechanics/CLI/bestiary/goblin-xphb.md)',
		);
	});

	it('does not pick up an image embed', () => {
		const markdown = '![Goblin art](3-Mechanics/CLI/bestiary/img/goblin.webp)';
		expect(findLinks(markdown)).toHaveLength(0);
	});

	it('finds two links back to back with nothing but a space between them', () => {
		const markdown = '[A](a.md) [B](b.md)';
		const links = findLinks(markdown);
		expect(links.map((link) => link.text)).toEqual(['A', 'B']);
	});
});

describe('flattenLinks', () => {
	it('keeps a stray % in a link or image path as written', () => {
		const result = flattenLinks('[Coupon](3-Mechanics/CLI/items/50%off-xdmg.md) ![Sale](img/50%off.png)');

		expect(result.text).toBe('Coupon Sale');
		expect(result.entities).toEqual([{ key: '3-Mechanics/CLI/items/50%off-xdmg.md', label: 'Coupon', kind: 'item' }]);
		expect(result.imageRefs.map((ref) => ref.image)).toEqual(['img/50%off.png']);
	});

	it('decodes a valid escape in a link or image path', () => {
		const result = flattenLinks('[Coupon](3-Mechanics/CLI/items/half%20off-xdmg.md) ![Sale](img/half%20off.png)');

		expect(result.entities.map((entity) => entity.key)).toEqual(['3-Mechanics/CLI/items/half off-xdmg.md']);
		expect(result.imageRefs.map((ref) => ref.image)).toEqual(['img/half off.png']);
	});

	it('flattens a resolvable link and records a ref for it', () => {
		const markdown = 'Beware the [Goblin](3-Mechanics/CLI/bestiary/goblin-xphb.md) ahead.';
		const result = flattenLinks(markdown);

		expect(result.text).toBe('Beware the Goblin ahead.');
		expect(result.refs).toEqual([{ entity: '3-Mechanics/CLI/bestiary/goblin-xphb.md', text: 'Goblin', start: 11, end: 17 }]);
		expect(result.entities).toEqual([
			{ key: '3-Mechanics/CLI/bestiary/goblin-xphb.md', label: 'Goblin', kind: 'bestiary' },
		]);
	});

	it('flattens an unresolvable link to plain text with no ref', () => {
		const markdown = 'See [Prone](3-Mechanics/CLI/rules/conditions-xphb.md) for details.';
		const result = flattenLinks(markdown);

		expect(result.text).toBe('See Prone for details.');
		expect(result.refs).toEqual([]);
		expect(result.entities).toEqual([]);
	});

	it('flattens several links in one pass, keeping offsets correct as the string shifts', () => {
		const markdown =
			'The [Goblin](3-Mechanics/CLI/bestiary/goblin-xphb.md) guards a [Bag of Holding](3-Mechanics/CLI/items/bag-of-holding-xdmg.md).';
		const result = flattenLinks(markdown);

		expect(result.text).toBe('The Goblin guards a Bag of Holding.');
		expect(result.refs).toHaveLength(2);
		for (const ref of result.refs) {
			expect(result.text.slice(ref.start, ref.end)).toBe(ref.text);
		}
	});

	it('leaves text with no links untouched', () => {
		expect(flattenLinks('Nothing to see here.')).toEqual({
			text: 'Nothing to see here.',
			refs: [],
			entities: [],
			imageRefs: [],
		});
	});

	it('flattens an image embed to its alt text and records where it landed', () => {
		const result = flattenLinks('Before ![A portrait](art/npc.png#center) after.');

		expect(result.text).toBe('Before A portrait after.');
		expect(result.imageRefs).toEqual([{ image: 'art/npc.png', text: 'A portrait', start: 7, end: 17 }]);
		expect(result.refs).toEqual([]);
	});

	it('flattens a wikilink embed to its alias', () => {
		const result = flattenLinks('![[maps/room-1.png|Room 1]]');
		expect(result.text).toBe('Room 1');
		expect(result.imageRefs[0]?.image).toBe('maps/room-1.png');
	});

	it('keeps offsets correct when an embed and a link share a block', () => {
		const result = flattenLinks(
			'![Map](maps/room.webp) The [Goblin](3-Mechanics/CLI/bestiary/goblin-xphb.md) waits.',
		);

		expect(result.text).toBe('Map The Goblin waits.');
		expect(result.text.slice(result.imageRefs[0]?.start, result.imageRefs[0]?.end)).toBe('Map');
		expect(result.text.slice(result.refs[0]?.start, result.refs[0]?.end)).toBe('Goblin');
	});

	it('flattens a wikilink to its display text and records it as an unknown candidate', () => {
		const result = flattenLinks('Beware [[Goblin Boss]] ahead.');

		expect(result.text).toBe('Beware Goblin Boss ahead.');
		expect(result.entities).toEqual([{ key: 'Goblin Boss', label: 'Goblin Boss', kind: 'unknown' }]);
	});

	it('uses a wikilink alias as the display text but the target as the key', () => {
		const result = flattenLinks('Beware [[NPCs/Goblin Boss.md|the boss]] ahead.');

		expect(result.text).toBe('Beware the boss ahead.');
		expect(result.entities).toEqual([{ key: 'NPCs/Goblin Boss.md', label: 'the boss', kind: 'unknown' }]);
	});

	it('treats a wikilink as a candidate regardless of its target, unlike a markdown link', () => {
		// The same non-CLI path that a plain markdown link (tested above, "some/other/vault/path.md")
		// classifies `none` for - a wikilink is a candidate no matter what its target looks like,
		// which is the whole point: a hand author's own vault has no CLI folder convention to read.
		const result = flattenLinks('[[some/other/vault/path]]');
		expect(result.entities).toEqual([{ key: 'some/other/vault/path', label: 'some/other/vault/path', kind: 'unknown' }]);
	});

	it('does not mistake a wikilink image embed for a plain wikilink', () => {
		const result = flattenLinks('![[maps/room-1.png|Room 1]] and [[Goblin Boss]].');

		expect(result.imageRefs).toEqual([{ image: 'maps/room-1.png', text: 'Room 1', start: 0, end: 6 }]);
		expect(result.entities).toEqual([{ key: 'Goblin Boss', label: 'Goblin Boss', kind: 'unknown' }]);
	});
});

describe('findWikiLinks', () => {
	it('finds a bare wikilink, using the target as its own display text, with correct offsets', () => {
		const markdown = 'Beware [[Goblin Boss]] ahead.';
		const links = findWikiLinks(markdown);

		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({ target: 'Goblin Boss', display: 'Goblin Boss' });
		expect(markdown.slice(links[0]?.start, links[0]?.end)).toBe('[[Goblin Boss]]');
	});

	it('prefers the alias over the target as the display text', () => {
		const links = findWikiLinks('[[Goblin Boss|the boss]]');
		expect(links[0]).toMatchObject({ target: 'Goblin Boss', display: 'the boss' });
	});

	it('drops a heading anchor from the target', () => {
		const links = findWikiLinks('[[Goblin Boss#Lair]]');
		expect(links[0]?.target).toBe('Goblin Boss');
	});

	it('never matches an image embed', () => {
		expect(findWikiLinks('![[maps/room.png]]')).toEqual([]);
	});
});
