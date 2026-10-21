import { describe, expect, it } from 'vitest';

import {
	isMagic,
	parseMagicItem,
	readAttunement,
	readCategory,
	readImagePath,
	readRarity,
} from '../src/recognizers/compendium/magicItem';

/** `items/bag-of-holding-xdmg.md`, trimmed but structurally exact. */
const bagOfHolding = `---
cssclasses:
- json5e-item
tags:
- ttrpg-cli/compendium/src/5e/xdmg
- ttrpg-cli/item/rarity/uncommon
---
# Bag of Holding
*Wondrous item, uncommon*
![](3-Mechanics/CLI/items/img/bag-of-holding.webp#right)

- **Weight**: 5.0 lbs.

This bag has an interior space considerably larger than its outside dimensions. Retrieving an item from the bag requires a [Utilize](3-Mechanics/CLI/rules/actions.md#Utilize) action.

If the bag is overloaded, pierced, or torn, it is destroyed.

*Source: Dungeon Master's Guide (2024) p. 234. Available in the <span title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*`;

const magicFrontmatter = {
	cssclasses: ['json5e-item'],
	tags: ['ttrpg-cli/compendium/src/5e/xdmg', 'ttrpg-cli/item/rarity/uncommon'],
};

/** `items/abacus-phb.md`: adventuring gear, which the magic item library is not for. */
const abacus = `---
cssclasses:
- json5e-item
tags:
- ttrpg-cli/item/gear/
- ttrpg-cli/item/rarity/none
---
# Abacus
*Adventuring gear*

- **Cost**: 2 gp
- **Weight**: 2.0 lbs.

*Source: Player's Handbook p. 150*`;

const mundaneFrontmatter = {
	cssclasses: ['json5e-item'],
	tags: ['ttrpg-cli/item/gear/', 'ttrpg-cli/item/rarity/none'],
};

describe('readRarity', () => {
	it.each([
		[['ttrpg-cli/item/rarity/uncommon'], 'uncommon'],
		[['ttrpg-cli/item/rarity/very-rare'], 'very-rare'],
		[['ttrpg-cli/item/rarity/none'], 'none'],
	])('%o -> %s', (tags, expected) => {
		expect(readRarity({ tags })).toBe(expected);
	});

	/**
	 * Null and `none` are different answers - "the note does not say" against "the
	 * book says it has none" - and `isMagic` needs both.
	 */
	it('is null when there is no rarity tag', () => {
		expect(readRarity({ tags: ['ttrpg-cli/item/gear/'] })).toBeNull();
		expect(readRarity(null)).toBeNull();
	});
});

describe('isMagic', () => {
	it.each([['uncommon'], ['legendary'], ['artifact'], ['common']])('%s is magic', (rarity) => {
		expect(isMagic({ tags: [`ttrpg-cli/item/rarity/${rarity}`] })).toBe(true);
	});

	/** The line between treasure and rope, and the CLI draws it on 620 of 2,099 notes. */
	it('is false for adventuring gear', () => {
		expect(isMagic(mundaneFrontmatter)).toBe(false);
	});

	/** Magic items whose rarity the book will not fix are still magic items. */
	it.each([['unknown'], ['varies']])('%s is still magic', (rarity) => {
		expect(isMagic({ tags: [`ttrpg-cli/item/rarity/${rarity}`] })).toBe(true);
	});

	/** Guessing would put a coil of rope in the magic item library. */
	it('is false when the note states no rarity at all', () => {
		expect(isMagic({ tags: [] })).toBe(false);
		expect(isMagic(null)).toBe(false);
	});
});

describe('readAttunement', () => {
	it('reads a bare requirement', () => {
		expect(readAttunement('Wondrous item, rare (requires attunement)')).toEqual({
			requiresAttunement: true,
			attunementDetail: null,
		});
	});

	/** The detail is the condition alone; the flag already carries the rest. */
	it('reads the condition when there is one', () => {
		expect(readAttunement('Ring, legendary (requires attunement by a Druid)')).toEqual({
			requiresAttunement: true,
			attunementDetail: 'by a Druid',
		});
	});

	it('is false when nothing is required', () => {
		expect(readAttunement('Wondrous item, uncommon')).toEqual({
			requiresAttunement: false,
			attunementDetail: null,
		});
	});

	/**
	 * The condition can hold brackets of its own, and stopping at the first `)` cut
	 * it mid-sentence - the Black Crystal Tablet lost the word "skill" and kept half
	 * a URL instead. The closing bracket is found by counting now.
	 */
	it('reads a condition containing a link', () => {
		const detail = readAttunement(
			'Wondrous item, legendary (requires attunement by a creature that has proficiency in the [Arcana](3-Mechanics/CLI/rules/skills.md#Arcana) skill)',
		);

		expect(detail).toEqual({
			requiresAttunement: true,
			attunementDetail: 'by a creature that has proficiency in the Arcana skill',
		});
	});

	it('reads a condition containing a bracketed aside', () => {
		const detail = readAttunement('Weapon (any sword), rare (requires attunement by a Dwarf (or a Duergar))');

		expect(detail.attunementDetail).toBe('by a Dwarf (or a Duergar)');
	});
});

describe('readCategory', () => {
	it.each([
		['Wondrous item, uncommon', 'Wondrous item'],
		['Potion, rare', 'Potion'],
		['Treasure (art object), common', 'Treasure (art object)'],
	])('%s -> %s', (subtitle, expected) => {
		expect(readCategory(subtitle, 'uncommon')).toBe(expected);
	});

	/** `Armor ([shield](...))` - the link is flattened rather than left as markdown. */
	it('flattens a link inside the category', () => {
		const category = readCategory(
			'Armor ([shield](3-Mechanics/CLI/items/shield-xphb.md)), rare (requires attunement)',
			'rare',
		);

		expect(category).toBe('Armor (shield)');
	});

	it('drops the attunement clause from a category-less subtitle', () => {
		expect(readCategory('Rare (requires attunement)', 'rare')).toBeNull();
	});

	it('is null for an empty subtitle', () => {
		expect(readCategory('', null)).toBeNull();
	});
});

describe('readImagePath', () => {
	/**
	 * `#right` is Obsidian's alignment hint, not part of the filename - a path that
	 * keeps it resolves to nothing, which would have cost every item its art.
	 */
	it('strips the alignment anchor', () => {
		expect(readImagePath('![](3-Mechanics/CLI/items/img/bag-of-holding.webp#right)')).toBe(
			'3-Mechanics/CLI/items/img/bag-of-holding.webp',
		);
	});

	it('reads a plain embed', () => {
		expect(readImagePath('![](img/rope.png)')).toBe('img/rope.png');
	});

	/** A hand-written note is as likely to use wikilink form as markdown. */
	it('reads a wikilink embed', () => {
		expect(readImagePath('![[img/staff.webp]]')).toBe('img/staff.webp');
	});

	it('decodes an escaped path', () => {
		expect(readImagePath('![](img/bag%20of%20holding.webp)')).toBe('img/bag of holding.webp');
	});

	it.each([['# Just a title'], [''], ['Not an ![inline](link) embed']])(
		'is null for %o',
		(markdown) => {
			expect(readImagePath(markdown)).toBeNull();
		},
	);
});

describe('parseMagicItem', () => {
	const parsed = parseMagicItem(bagOfHolding, magicFrontmatter, 'bag-of-holding-xdmg', 'Bag');

	it('reads every field the library holds', () => {
		expect(parsed).toMatchObject({
			name: 'Bag of Holding',
			rarity: 'uncommon',
			category: 'Wondrous item',
			requiresAttunement: false,
			attunementDetail: null,
			sourceKey: 'bag-of-holding-xdmg',
			imagePath: '3-Mechanics/CLI/items/img/bag-of-holding.webp',
		});
	});

	/** A path, not bytes - this module is pure, and reading a file needs the vault. */
	it('carries the art as a path for the sender to resolve', () => {
		expect(parsed?.imagePath).not.toContain('#right');
		expect(parsed?.imagePath).not.toContain('data:');
	});

	it('has no image path when the note has no art', () => {
		const plain = parseMagicItem(
			'# Thing\n*Wondrous item, rare*\n\nIt does things.',
			{ tags: ['ttrpg-cli/item/rarity/rare'] },
			'thing',
			'Thing',
		);

		expect(plain?.imagePath).toBeNull();
	});

	/** `very-rare` is a tag; `very rare` is what the books print and the library shows. */
	it('prints the rarity as the books write it', () => {
		const veryRare = parseMagicItem(
			'# Thing\n*Wondrous item, very rare*\n\nIt does things.',
			{ tags: ['ttrpg-cli/item/rarity/very-rare'] },
			'thing',
			'Thing',
		);

		expect(veryRare?.rarity).toBe('very rare');
	});

	it('takes the rules text and nothing else', () => {
		expect(parsed?.desc).toContain('interior space considerably larger');
		expect(parsed?.desc).toContain('Utilize action');
		for (const leak of ['Wondrous item,', 'Weight', 'bag-of-holding.webp', 'Source:']) {
			expect(parsed?.desc).not.toContain(leak);
		}
	});

	/** The whole reason for the rarity check: gear is not treasure. */
	it('returns null for adventuring gear', () => {
		expect(parseMagicItem(abacus, mundaneFrontmatter, 'abacus-phb', 'Abacus')).toBeNull();
	});

	it('reads an attuned item', () => {
		const ring = parseMagicItem(
			'# Ring of Spell Storing\n*Ring, rare (requires attunement by a Wizard)*\n\nIt stores spells.',
			{ tags: ['ttrpg-cli/item/rarity/rare'] },
			'ring',
			'Ring',
		);

		expect(ring).toMatchObject({
			category: 'Ring',
			requiresAttunement: true,
			attunementDetail: 'by a Wizard',
		});
	});

	/**
	 * A magic item with no rules text is odd but real - the art objects and
	 * gemstones are priced treasure rather than described items. Null rather than
	 * an empty string, which is what the server stores for "not given".
	 */
	it('leaves the description null when the note has no prose', () => {
		const gem = parseMagicItem(
			'# Diamond\n*Treasure (gemstone), common*\n\n- **Cost**: 5,000 gp',
			{ tags: ['ttrpg-cli/item/rarity/common'] },
			'diamond',
			'Diamond',
		);

		expect(gem?.desc).toBeNull();
		expect(gem?.category).toBe('Treasure (gemstone)');
	});

	it('falls back to the given name when the note has no title', () => {
		const untitled = parseMagicItem('*Wondrous item, rare*\n\nProse.', magicFrontmatter, 'k', 'Fallback');

		expect(untitled?.name).toBe('Fallback');
	});

	it('drops the frontmatter from the description of a note with no headings', () => {
		const untitled = parseMagicItem(
			'---\ncssclasses: json5e-item\n---\n*Wondrous item, rare*\n\nProse.',
			magicFrontmatter,
			'k',
			'Fallback',
		);

		expect(untitled?.desc).toBe('Prose.');
	});
});
