import { describe, expect, it } from 'vitest';

import {
	hasShippedClass,
	parentClassKey,
	parentClassSlug,
	raiseEarlyFeatures,
	parseSubclass,
	toClassPatches,
	unreachableFeatures,
	type ParsedSubclass,
} from '../src/recognizers/compendium/subclass';

/** A parsed subclass belonging to the named class, with nothing else in it. */
function subclassOf(className: string): ParsedSubclass {
	return {
		classKey: parentClassKey(className),
		className,
		subclass: { key: 'k', name: 'K', desc: '', features: [], levels: [] },
	};
}

/** `classes/barbarian-xphb-path-of-the-world-tree-xphb.md`, trimmed but structurally exact. */
const worldTree = `---
cssclasses:
- json5e-class
tags:
- ttrpg-cli/compendium/src/5e/xphb
- ttrpg-cli/subclass/barbarian/world-tree
---
# Path of the World Tree
*[Barbarian](./barbarian-xphb.md): Barbarian Subclass*
*Source: Player's Handbook (2024) p. 56*

> [!tldr] Class and Feature Progression
>
> <table class="class-progression">
> <thead>
> <tr class="class-progression"><th class"level">Level</th><th class"pb">PB</th><th class"feature">Features</th></tr>
> </thead><tbody>
> <tr class="class-progression"><td class"level">3rd</td><td class"pb">+2</td><td class"feature"><a href='#Vitality of the Tree (Level 3)' class='internal-link'>Vitality of the Tree</a></td></tr>
> <tr class="class-progression"><td class"level">6th</td><td class"pb">+3</td><td class"feature"></td></tr>
> </tbody></table>

^class-progression


*Trace the Roots and Branches of the Multiverse*

Barbarians who follow the Path of the World Tree connect with the cosmic tree Yggdrasil through their Rage.

## Subclass Features

### Vitality of the Tree (Level 3)

Your Rage taps into the life force of the World Tree.

**Vitality Surge.** When you activate your Rage, you gain [Temporary Hit Points](3-Mechanics/CLI/rules/variant-rules/temporary-hit-points-xphb.md).

### Branches of the Tree (Level 6)

You can call on the World Tree's branches.

### Travel Along the Tree (Level 14)

Your connection deepens.`;

const frontmatter = {
	cssclasses: ['json5e-class'],
	tags: ['ttrpg-cli/compendium/src/5e/xphb', 'ttrpg-cli/subclass/barbarian/world-tree'],
};

describe('parentClassSlug', () => {
	it('reads the class out of the subclass tag', () => {
		expect(parentClassSlug(frontmatter)).toBe('barbarian');
	});

	it.each([
		[null],
		[{}],
		[{ tags: ['ttrpg-cli/class'] }],
		[{ tags: 'ttrpg-cli/compendium/src/5e/xphb' }],
	])('is null for %o', (input) => {
		expect(parentClassSlug(input)).toBeNull();
	});

	it('accepts tags written as a bare string', () => {
		expect(parentClassSlug({ tags: 'ttrpg-cli/subclass/wizard/evoker' })).toBe('wizard');
	});
});

describe('parentClassKey', () => {
	/**
	 * The one place this format leaks the server's own naming, and it is load-bearing:
	 * a patch that does not collide with the shipped key adds nothing, because the
	 * server drops a subclass patch whose class it does not recognise.
	 */
	it('is the shipped catalogue key for the class', () => {
		expect(parentClassKey('barbarian')).toBe('srd-2024_barbarian');
	});
});

describe('parseSubclass', () => {
	const parsed = parseSubclass(worldTree, frontmatter, 'world-tree-xphb', 'World Tree');

	it('names the subclass and its parent class', () => {
		expect(parsed?.subclass.name).toBe('Path of the World Tree');
		expect(parsed?.classKey).toBe('srd-2024_barbarian');
		expect(parsed?.className).toBe('Barbarian');
	});

	/**
	 * The heading states the level, so nothing here opens the progression table -
	 * which is written with malformed attributes and positional value columns, and is
	 * the one parse in this corpus where a misread is silently wrong.
	 */
	it('reads each feature and the level from its heading', () => {
		expect(parsed?.subclass.features.map((feature) => feature.name)).toEqual([
			'Vitality of the Tree',
			'Branches of the Tree',
			'Travel Along the Tree',
		]);
		expect(parsed?.subclass.levels.map((level) => level.level)).toEqual([3, 6, 14]);
	});

	/** The level rows point at the features by key, which is how the builder resolves them. */
	it('points each level at the feature it grants', () => {
		expect(parsed?.subclass.levels[0]?.gains).toEqual([
			{ feature: 'world-tree-xphb_vitality-of-the-tree', detail: null },
		]);
		expect(parsed?.subclass.features[0]?.parent).toBe('world-tree-xphb');
	});

	/** A subclass adds no column to the class table, so it carries none. */
	it('carries no columns', () => {
		expect(parsed?.subclass.levels.every((level) => Object.keys(level.columns).length === 0)).toBe(
			true,
		);
	});

	it('keeps the feature text, links flattened', () => {
		expect(parsed?.subclass.features[0]?.desc).toContain('life force of the World Tree');
		expect(parsed?.subclass.features[0]?.desc).toContain('Temporary Hit Points');
		expect(parsed?.subclass.features[0]?.desc).not.toContain('](3-Mechanics');
	});

	/**
	 * The progression table lives in a `> [!tldr]` callout, so every line of it is
	 * quoted - which is what makes dropping it a filter rather than an HTML parse.
	 */
	it('keeps the table, the source line and the parent subtitle out of the description', () => {
		expect(parsed?.subclass.desc).toContain('cosmic tree Yggdrasil');
		for (const leak of ['class-progression', '<table', 'Source:', 'Barbarian Subclass', '^class']) {
			expect(parsed?.subclass.desc).not.toContain(leak);
		}
	});

	it('returns null for a note with no subclass tag', () => {
		expect(parseSubclass(worldTree, { tags: ['ttrpg-cli/class'] }, 'k', 'K')).toBeNull();
	});

	it('returns null for a note with no levelled features', () => {
		const bare = parseSubclass('# X\n\n## Subclass Features\n\n### Something\n\nProse.', frontmatter, 'k', 'K');

		expect(bare).toBeNull();
	});

	/**
	 * A heading with no level cannot be placed on the class table, so it is left out
	 * rather than guessed at - and the ones that do carry a level keep their own,
	 * which is what would break if the level were looked up by position afterwards.
	 */
	it('skips an unlevelled heading without shifting the others', () => {
		const mixed = parseSubclass(
			'# X\n\n## Subclass Features\n\n### Preamble\n\nNot a feature.\n\n### Real Feature (Level 7)\n\nIs one.',
			frontmatter,
			'k',
			'K',
		);

		expect(mixed?.subclass.features.map((feature) => feature.name)).toEqual(['Real Feature']);
		expect(mixed?.subclass.levels).toEqual([
			{ level: 7, gains: [{ feature: 'k_real-feature', detail: null }], columns: {} },
		]);
	});

	/** Two features at one level share a row, because the builder reads gains as a list. */
	it('puts two features at the same level in one row', () => {
		const twin = parseSubclass(
			'# X\n\n### One (Level 3)\n\nA.\n\n### Two (Level 3)\n\nB.',
			frontmatter,
			'k',
			'K',
		);

		expect(twin?.subclass.levels).toHaveLength(1);
		expect(twin?.subclass.levels[0]?.gains).toHaveLength(2);
	});
});

describe('hasShippedClass', () => {
	it.each([['barbarian'], ['wizard'], ['warlock']])('%s is one Tome has', (name) => {
		expect(hasShippedClass(subclassOf(name))).toBe(true);
	});

	/**
	 * Tasha's brings the Artificer, which is not in the SRD and so not in Tome. The
	 * server drops a patch for a class it does not recognise, deliberately - so the
	 * connector has to know too, or the subclasses vanish with no explanation.
	 */
	it('is false for a class the SRD does not license', () => {
		expect(hasShippedClass(subclassOf('artificer'))).toBe(false);
	});
});

describe('unreachableFeatures', () => {
	/**
	 * The real case, from `cleric-xphb-knowledge-domain.md`: a 2014 subclass the CLI
	 * files under the 2024 Cleric, with a feature at level 1 because a 2014 cleric
	 * chose its domain at level 1. A 2024 character picks a subclass at 3, and the
	 * builder grants a subclass row only on reaching that level - so the level 1
	 * feature is never handed out.
	 */
	it('finds a feature that arrives before the subclass is chosen', () => {
		const knowledge = parseSubclass(
			'# Knowledge Domain\n\n### Blessings of Knowledge (Level 1)\n\nYou learn two languages.\n\n### Visions of the Past (Level 17)\n\nYou see.',
			{ tags: ['ttrpg-cli/subclass/cleric/knowledge'] },
			'knowledge',
			'Knowledge Domain',
		);

		expect(unreachableFeatures(knowledge!)).toEqual([1]);
	});

	it('is empty for a subclass that starts at level 3', () => {
		const parsed = parseSubclass(worldTree, frontmatter, 'k', 'K');

		expect(unreachableFeatures(parsed!)).toEqual([]);
	});
});

describe('raiseEarlyFeatures', () => {
	/** `cleric-xphb-knowledge-domain.md`: Domain Spells at 3, but a feature at 1. */
	const knowledge = parseSubclass(
		'# Knowledge Domain\n\n### Blessings of Knowledge (Level 1)\n\nTwo languages.\n\n### Domain Spells (Level 3)\n\nSpells.\n\n### Read Thoughts (Level 6)\n\nMinds.',
		{ tags: ['ttrpg-cli/subclass/cleric/knowledge'] },
		'knowledge',
		'Knowledge Domain',
	)!;

	const raised = raiseEarlyFeatures(knowledge);

	/**
	 * The level 1 row folds into the level 3 one rather than becoming a second row
	 * at 3 - the builder reads a level's gains as a list, and two rows for one level
	 * would leave whichever it found second unreachable all over again.
	 */
	it('folds the early row into the level the subclass is chosen at', () => {
		expect(raised.subclass.levels.map((level) => level.level)).toEqual([3, 6]);
		expect(raised.subclass.levels[0]?.gains.map((gain) => gain.feature)).toEqual([
			'knowledge_blessings-of-knowledge',
			'knowledge_domain-spells',
		]);
	});

	/** In level order, so a domain's opening feature still reads before what followed it. */
	it('keeps the features in the order the book granted them', () => {
		expect(unreachableFeatures(raised)).toEqual([]);
		expect(raised.subclass.features.map((f) => f.key)).toEqual(
			knowledge.subclass.features.map((f) => f.key),
		);
	});

	it('names the real source level and handles an empty description', () => {
		const two = parseSubclass(
			'# X\n\n### One (Level 2)\n\n### Two (Level 6)\n\nB.',
			{ tags: ['ttrpg-cli/subclass/cleric/x'] },
			'x',
			'X',
		)!;

		expect(raiseEarlyFeatures(two).subclass.features[0]?.desc).toBe(
			'(Moved from level 2 to level 3 on import.)',
		);
	});

	it('notes the move in the text of moved features only', () => {
		const features = raised.subclass.features;
		expect(features[0]?.desc).toBe('Two languages.\n\n(Moved from level 1 to level 3 on import.)');
		expect(features[1]).toEqual(knowledge.subclass.features[1]);
		expect(features[2]).toEqual(knowledge.subclass.features[2]);
	});

	it('leaves the later levels alone', () => {
		expect(raised.subclass.levels[1]).toEqual(knowledge.subclass.levels[2]);
	});

	/** Nothing to move means nothing changes, not a rebuilt object with the same values. */
	it('returns a subclass that starts at 3 untouched', () => {
		const parsed = parseSubclass(worldTree, frontmatter, 'k', 'K')!;

		expect(raiseEarlyFeatures(parsed)).toBe(parsed);
	});

	/** A subclass with no level 3 row at all gains one rather than losing the feature. */
	it('creates the level 3 row when there was not one', () => {
		const early = parseSubclass(
			'# X\n\n### One (Level 1)\n\nA.\n\n### Two (Level 6)\n\nB.',
			{ tags: ['ttrpg-cli/subclass/cleric/x'] },
			'x',
			'X',
		)!;

		expect(raiseEarlyFeatures(early).subclass.levels.map((level) => level.level)).toEqual([3, 6]);
	});

	/** Both pre-3 levels collapse into the same row, not into two. */
	it('folds levels 1 and 2 together', () => {
		const both = parseSubclass(
			'# X\n\n### One (Level 1)\n\nA.\n\n### Two (Level 2)\n\nB.',
			{ tags: ['ttrpg-cli/subclass/cleric/x'] },
			'x',
			'X',
		)!;
		const out = raiseEarlyFeatures(both);

		expect(out.subclass.levels).toHaveLength(1);
		expect(out.subclass.levels[0]?.gains).toHaveLength(2);
	});
});

describe('toClassPatches', () => {
	const patch = (classKey: string, key: string): ParsedSubclass => ({
		classKey,
		className: 'Barbarian',
		subclass: { key, name: key, desc: '', features: [], levels: [] },
	});

	it('groups subclasses under their class', () => {
		const patches = toClassPatches([
			patch('srd-2024_barbarian', 'world-tree'),
			patch('srd-2024_barbarian', 'zealot'),
			{ ...patch('srd-2024_bard', 'dance'), className: 'Bard' },
		]);

		expect(patches).toHaveLength(2);
		expect(patches[0]?.subclasses.map((entry) => entry.key)).toEqual(['world-tree', 'zealot']);
	});

	/**
	 * No levels and no features is what tells the server this is a patch: keep the
	 * shipped class whole and layer these subclasses in. A fuller entry would replace
	 * a working Barbarian with whatever this parser managed to read.
	 */
	it('emits a patch, not a class', () => {
		const single = toClassPatches([patch('srd-2024_barbarian', 'world-tree')])[0];

		expect(Object.keys(single ?? {}).sort()).toEqual(['key', 'name', 'subclasses']);
	});

	it('is empty for nothing', () => {
		expect(toClassPatches([])).toEqual([]);
	});
});
