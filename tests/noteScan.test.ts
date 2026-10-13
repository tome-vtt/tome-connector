import { describe, expect, it } from 'vitest';

import type { Note } from '../src/recognizers/note';
import { declaresStatblock, findSendables, summarise } from '../src/recognizers/noteScan';

/**
 * A stub parser rather than a real one.
 *
 * `findSendables` takes the YAML parser as a seam so it never imports `obsidian`,
 * and that seam is what lets this test drive detection directly. Parsing YAML is
 * Obsidian's job and is not what this module decides; what it decides is which
 * blocks are sendable, what kind each is, and which of two overlapping sources
 * wins. Pulling in a YAML library would test somebody else's code and make these
 * cases harder to read.
 */
function stubParser(blocks: Record<string, unknown>): (source: string) => unknown {
	return (source: string) => {
		const key = source.trim();
		if (!(key in blocks)) throw new Error(`unexpected block: ${key}`);
		return blocks[key];
	};
}

function note(content: string, frontmatter: Record<string, unknown> | null = null): Note {
	return { path: 'Bestiary/Goblin.md', content, frontmatter };
}

const goblinStats = { name: 'Goblin', stats: [8, 14, 10, 10, 8, 8], ac: 15 };

describe('declaresStatblock', () => {
	/** The CLI writes `inline`, not `true`. Reading only `true` would miss all 667. */
	it.each([
		['inline', true],
		[true, true],
		['true', true],
		[false, false],
		['false', false],
		[undefined, false],
		[null, false]
	])('reads %o as %o', (value, expected) => {
		expect(declaresStatblock(value === undefined ? {} : { statblock: value })).toBe(expected);
	});

	it('is false with no frontmatter at all', () => {
		expect(declaresStatblock(null)).toBe(false);
	});
});

describe('findSendables', () => {
	it('finds a creature in a statblock fence', () => {
		const found = findSendables(
			note('```statblock\nSTATS\n```'),
			stubParser({ STATS: goblinStats })
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ kind: 'creature', label: 'Goblin', block: goblinStats });
	});

	/**
	 * The CLI writes both: a fence holding the real stats, and `statblock: inline`
	 * in frontmatter pointing at it. Reading both would import all 667 twice.
	 */
	it('does not also take the frontmatter when a statblock fence is present', () => {
		const found = findSendables(
			note('```statblock\nSTATS\n```', { statblock: 'inline', name: 'Goblin' }),
			stubParser({ STATS: goblinStats })
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ kind: 'creature', block: goblinStats });
	});

	it('takes the creature from frontmatter when there is no fence', () => {
		const found = findSendables(
			note('# Goblin\n\nJust prose.', { statblock: true, ...goblinStats }),
			stubParser({})
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ kind: 'creature', label: 'Goblin' });
	});

	it('ignores frontmatter that declares a statblock but carries no creature', () => {
		expect(findSendables(note('# X', { statblock: true, name: 'X' }), stubParser({}))).toEqual([]);
	});

	/**
	 * Included even though it cannot be resolved without the bestiary: whether
	 * that is available is the sender's problem to report per item, not a reason
	 * to leave it out of the count and have the total quietly disagree.
	 */
	it('includes a bare bestiary reference', () => {
		const found = findSendables(
			note('```statblock\nREF\n```'),
			stubParser({ REF: { monster: 'Goblin' } })
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.label).toBe('Goblin');
	});

	it('finds encounters and both map fences', () => {
		const content = [
			'```encounter',
			'ENC',
			'```',
			'```leaflet',
			'LEAF',
			'```',
			'```zoommap',
			'ZOOM',
			'```'
		].join('\n');

		const found = findSendables(
			note(content),
			stubParser({
				ENC: { name: 'Ambush', creatures: ['Goblin'] },
				LEAF: { image: '[[Keep.jpg]]' },
				ZOOM: { image: 'Assets/Cave.jpg' }
			})
		);

		expect(found.map((s) => s.kind)).toEqual(['encounter', 'map', 'map']);
		expect(found.map((s) => s.label)).toEqual(['Ambush', 'Keep', 'Cave']);
	});

	/** A location note with a map and the encounter that happens there is ordinary. */
	it('finds several sendables in one note', () => {
		const found = findSendables(
			note('```leaflet\nLEAF\n```\n\n```encounter\nENC\n```'),
			stubParser({ LEAF: { image: 'Keep.jpg' }, ENC: { name: 'Ambush' } })
		);

		expect(found).toHaveLength(2);
	});

	it('skips a block whose YAML will not parse', () => {
		const parser = (source: string): unknown => {
			if (source.trim() === 'BAD') throw new Error('bad yaml');
			return { name: 'Ambush' };
		};

		const found = findSendables(note('```statblock\nBAD\n```\n```encounter\nOK\n```'), parser);

		expect(found).toHaveLength(1);
		expect(found[0]?.kind).toBe('encounter');
	});

	it('ignores fences it does not recognise', () => {
		expect(
			findSendables(note('```dataview\nQ\n```'), stubParser({ Q: { x: 1 } }))
		).toEqual([]);
	});

	it('finds nothing in a plain note', () => {
		expect(findSendables(note('# Session 4\n\nThey went north.'), stubParser({}))).toEqual([]);
	});

	it('falls back to the note name when a block does not name itself', () => {
		const found = findSendables(
			{ path: 'Bestiary/Old Goblin.md', content: '```statblock\nS\n```', frontmatter: null },
			stubParser({ S: { stats: [8, 14, 10, 10, 8, 8] } })
		);

		expect(found[0]?.label).toBe('Old Goblin');
	});

	const itemNote = (content: string, tags: string[]): Note =>
		note(content, { cssclasses: ['json5e-item'], tags });

	it('finds a magic item note', () => {
		const found = findSendables(
			itemNote('# Bag of Holding\n*Wondrous item, uncommon*\n\nHolds things.', ['ttrpg-cli/item/rarity/uncommon']),
			stubParser({})
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ kind: 'magicItem', label: 'Bag of Holding' });
	});

	/** `rarity/none` is the CLI's way of saying "mundane" - the equipment library's twin case. */
	it('finds an equipment item note when the item is not magic', () => {
		const found = findSendables(
			itemNote('# Rope\n*Adventuring gear*\n\n- **Cost**: 1 gp\n- **Weight**: 5.0 lbs.', ['ttrpg-cli/item/rarity/none']),
			stubParser({})
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ kind: 'equipmentItem', label: 'Rope' });
	});

	it('never counts one item note as both magic and equipment', () => {
		const found = findSendables(
			itemNote('# Bag of Holding\n*Wondrous item, uncommon*\n\nHolds things.', ['ttrpg-cli/item/rarity/uncommon']),
			stubParser({})
		);

		expect(found.filter((s) => s.kind === 'magicItem' || s.kind === 'equipmentItem')).toHaveLength(1);
	});

	it('finds a spell note and keeps its structured fields', () => {
		const found = findSendables(
			note([
				'# Fireball',
				'**Casting Time**: 1 Action',
				'**Range**: 150 feet',
				'**Components**: V, S, M (a tiny ball of bat guano)',
				'**Duration**: Instantaneous',
				'',
				'A bright streak flashes from your pointing finger.'
			].join('\n'), {
				cssclasses: ['json5e-spell'],
				tags: ['ttrpg-cli/spell/level/3rd-level', 'ttrpg-cli/spell/school/evocation']
			}),
			stubParser({})
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			kind: 'spell',
			label: 'Fireball',
			spell: { name: 'Fireball', level: 3, school: 'evocation', range: 150 }
		});
	});
});

describe('summarise', () => {
	it('counts by kind', () => {
		const counts = summarise([
			{ kind: 'creature', path: 'a', label: 'A', block: {} },
			{ kind: 'creature', path: 'b', label: 'B', block: {} },
			{ kind: 'map', path: 'c', label: 'C', map: { title: 'C', image: 'c.png' } }
		]);

		expect(counts).toEqual({
			creature: 2,
			encounter: 0,
			map: 1,
			magicItem: 0,
			equipmentItem: 0,
			spell: 0,
		});
	});
});
