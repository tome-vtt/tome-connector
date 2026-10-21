import { describe, expect, it } from 'vitest';

import {
	parseSpell,
	readCastingTime,
	readComponents,
	readDuration,
	readLevel,
	readRange,
	readReactionCondition,
} from '../src/recognizers/compendium/spell';

/** `spells/fireball-xphb.md`, trimmed to one class tag per kind but structurally exact. */
const fireball = `---
cssclasses:
- json5e-spell
tags:
- ttrpg-cli/compendium/src/5e/xphb
- ttrpg-cli/spell/class/bard
- ttrpg-cli/spell/class/sorcerer
- ttrpg-cli/spell/class/wizard
- ttrpg-cli/spell/level/3rd-level
- ttrpg-cli/spell/school/evocation
- ttrpg-cli/spell/subclass/evoker
classes:
- Bard
- Cleric (Light Domain)
- Wizard
---
# Fireball
*3rd-level, Evocation*
![](3-Mechanics/CLI/spells/img/fireball.webp#right)

- **Casting time:** 1 Action
- **Range:** 150 feet
- **Components:** V, S, M (a ball of bat guano and sulfur)
- **Duration:** Instantaneous

A bright streak flashes from you to a point you choose within range and then blossoms into a fiery explosion. Each creature in a 20-foot-radius [Sphere](3-Mechanics/CLI/rules/variant-rules/sphere-area-of-effect-xphb.md) centered on that point makes a Dexterity saving throw, taking \`8d6\` Fire damage on a failed save.

**Using a Higher-Level Spell Slot.** The damage increases by \`1d6\` for each spell slot level above 3.

**Classes**: [Bard](3-Mechanics/CLI/lists/list-spells-classes-bard.md); [Wizard](3-Mechanics/CLI/lists/list-spells-classes-wizard.md)

*Source: Player's Handbook (2024) p. 274. Available in the <span title='Systems Reference Document (5.2)'>SRD</span>*`;

const frontmatter = {
	cssclasses: ['json5e-spell'],
	tags: [
		'ttrpg-cli/compendium/src/5e/xphb',
		'ttrpg-cli/spell/class/bard',
		'ttrpg-cli/spell/class/sorcerer',
		'ttrpg-cli/spell/class/wizard',
		'ttrpg-cli/spell/level/3rd-level',
		'ttrpg-cli/spell/school/evocation',
		'ttrpg-cli/spell/subclass/evoker',
	],
};

describe('readLevel', () => {
	it.each([
		[['ttrpg-cli/spell/level/3rd-level'], 3],
		[['ttrpg-cli/spell/level/1st-level'], 1],
		[['ttrpg-cli/spell/level/9th-level'], 9],
		[['ttrpg-cli/spell/level/cantrip'], 0],
	])('%o -> %o', (tags, expected) => {
		expect(readLevel(tags)).toBe(expected);
	});

	it('is null when no level tag is present', () => {
		expect(readLevel(['ttrpg-cli/spell/school/evocation'])).toBeNull();
	});
});

describe('readCastingTime', () => {
	/**
	 * The catalogue's vocabulary, which is inconsistent - words for the three
	 * action types, digits jammed against the unit for the rest - and has to be
	 * matched exactly, because the builder's filters compare against it.
	 */
	it.each([
		['1 Action', 'action'],
		['1 Bonus Action', 'bonus-action'],
		['1 Reaction', 'reaction'],
		['1 minute', '1minute'],
		['10 minutes', '10minutes'],
		['1 hour', '1hour'],
		['8 hours', '8hours'],
	])('%s -> %s', (input, expected) => {
		expect(readCastingTime(input)).toBe(expected);
	});

	/** The ritual suffix is a separate fact and would otherwise defeat the match. */
	it.each([
		['1 Action unless cast as a ritual', 'action'],
		['1 minute unless cast as a ritual', '1minute'],
	])('%s -> %s', (input, expected) => {
		expect(readCastingTime(input)).toBe(expected);
	});

	it('drops the reaction trigger', () => {
		expect(readCastingTime('1 Reaction, which you take when you are hit by an attack roll')).toBe(
			'reaction',
		);
	});
});

describe('readReactionCondition', () => {
	it('reads the clause after the comma', () => {
		expect(
			readReactionCondition('1 Reaction, which you take when you are hit by an attack roll'),
		).toBe('which you take when you are hit by an attack roll');
	});

	/** A bonus action's trigger is not a reaction condition; the catalogue has no field for it. */
	it('is null for anything that is not a reaction', () => {
		expect(readReactionCondition('1 Bonus Action, which you take after hitting a creature')).toBeNull();
		expect(readReactionCondition('1 Action')).toBeNull();
	});
});

describe('readDuration', () => {
	it('splits concentration out of the duration', () => {
		expect(readDuration('Concentration, up to 1 minute')).toEqual({
			duration: '1 minute',
			concentration: true,
		});
	});

	it.each([
		['Instantaneous', 'instantaneous'],
		['Until dispelled', 'until dispelled'],
		['8 hours', '8 hours'],
		['1 round', '1 round'],
	])('%s -> %s, not concentration', (input, expected) => {
		expect(readDuration(input)).toEqual({ duration: expected, concentration: false });
	});
});

describe('readRange', () => {
	it('reads a distance', () => {
		expect(readRange('150 feet')).toMatchObject({
			range: 150,
			rangeText: '150 feet',
			rangeUnit: 'feet',
			shapeType: null,
		});
	});

	it.each([['Self'], ['Touch'], ['Sight'], ['Unlimited'], ['Special']])(
		'reads %s as range 0 with no unit',
		(input) => {
			expect(readRange(input)).toMatchObject({ range: 0, rangeText: input, rangeUnit: null });
		},
	);

	/**
	 * `Self (15-foot Cone)` is one field carrying two facts, and the catalogue
	 * keeps them apart. Reading it is not prose-mining - the parenthetical is a
	 * stated field, unlike the damage sentence two paragraphs down.
	 */
	it('splits an area of effect out of a self range', () => {
		expect(readRange('Self (15-foot Cone)')).toEqual({
			range: 0,
			rangeText: 'Self',
			rangeUnit: null,
			shapeType: 'cone',
			shapeSize: 15,
			shapeSizeUnit: 'feet',
		});
	});

	it.each([
		['Self (30-foot Emanation)', 'emanation', 30],
		['Self (60-foot Line)', 'line', 60],
		['Self (30-foot Sphere)', 'sphere', 30],
	])('reads %s', (input, shapeType, shapeSize) => {
		expect(readRange(input)).toMatchObject({ shapeType, shapeSize, rangeText: 'Self' });
	});

	it('is empty for nothing', () => {
		expect(readRange(undefined).range).toBeNull();
	});
});

describe('readComponents', () => {
	it('reads the three components and the material', () => {
		expect(readComponents('V, S, M (a ball of bat guano and sulfur)')).toEqual({
			verbal: true,
			somatic: true,
			material: true,
			materialSpecified: 'a ball of bat guano and sulfur',
			materialConsumed: false,
		});
	});

	it('reads a spell with no material component', () => {
		expect(readComponents('V, S')).toMatchObject({
			verbal: true,
			somatic: true,
			material: false,
			materialSpecified: null,
		});
	});

	it('reads a somatic-only spell', () => {
		expect(readComponents('S')).toMatchObject({ verbal: false, somatic: true, material: false });
	});

	/** The phrase the books use, and the only thing separating a component you keep from one you spend. */
	it('notices a consumed material', () => {
		expect(
			readComponents('V, S, M (a diamond worth 300+ GP, which the spell consumes)'),
		).toMatchObject({ materialConsumed: true });
	});
});

describe('parseSpell', () => {
	const parsed = parseSpell(fireball, frontmatter, 'fireball-xphb', 'Fireball');

	/**
	 * Compared field by field against `srd-2024-characters.json`'s own Fireball,
	 * which was generated from structured data rather than scraped. Everything the
	 * parser claims to read agrees with it.
	 */
	it('agrees with the SRD catalogue on every field it reads', () => {
		expect(parsed).toMatchObject({
			name: 'Fireball',
			level: 3,
			school: 'evocation',
			castingTime: 'action',
			duration: 'instantaneous',
			range: 150,
			rangeText: '150 feet',
			rangeUnit: 'feet',
			concentration: false,
			ritual: false,
			verbal: true,
			somatic: true,
			material: true,
			materialSpecified: 'a ball of bat guano and sulfur',
			higherLevel: 'The damage increases by 1d6 for each spell slot level above 3.',
		});
	});

	/**
	 * The `spell/class/*` tags, not the `classes:` frontmatter - which lists
	 * "Cleric (Light Domain)" because a subclass is handed the spell, and the
	 * builder's question is whether a cleric can learn it.
	 */
	it('takes the class list from the tags, not the frontmatter', () => {
		expect(parsed?.classes).toEqual(['bard', 'sorcerer', 'wizard']);
	});

	/** Fields, subtitle, portrait, scaling line, Classes footer and Source all removed. */
	it('takes the description from the prose alone', () => {
		expect(parsed?.desc).toContain('A bright streak flashes');
		expect(parsed?.desc).toContain('8d6 Fire damage');
		for (const leak of [
			'Casting time',
			'3rd-level, Evocation',
			'fireball.webp',
			'Higher-Level',
			'list-spells-classes',
			'Source:',
		]) {
			expect(parsed?.desc).not.toContain(leak);
		}
	});

	it('reads a ritual and a concentration duration', () => {
		const alarm = parseSpell(
			'# Alarm\n\n- **Casting time:** 1 minute unless cast as a ritual\n- **Duration:** Concentration, up to 8 hours',
			{ tags: ['ttrpg-cli/spell/level/1st-level'] },
			'alarm',
			'Alarm',
		);

		expect(alarm).toMatchObject({
			ritual: true,
			castingTime: '1minute',
			concentration: true,
			duration: '8 hours',
		});
	});

	it('reads a cantrip upgrade as the scaling text', () => {
		const bolt = parseSpell(
			'# Fire Bolt\n\n- **Casting time:** 1 Action\n- **Duration:** Instantaneous\n\nYou hurl a mote.\n\n**Cantrip Upgrade.** The damage increases at level 5.',
			{ tags: ['ttrpg-cli/spell/level/cantrip'] },
			'fire-bolt',
			'Fire Bolt',
		);

		expect(bolt?.level).toBe(0);
		expect(bolt?.higherLevel).toBe('The damage increases at level 5.');
	});

	it('drops the frontmatter from the description of a note with no headings', () => {
		const untitled = parseSpell(
			'---\ncssclasses: json5e-spell\n---\n- **Casting time:** 1 Action\n- **Duration:** Instantaneous\n\nYou hurl a mote.',
			null,
			'k',
			'Fallback',
		);

		expect(untitled?.desc).toBe('You hurl a mote.');
	});

	it('returns null for a note that states no spell fields', () => {
		expect(parseSpell('# Spells\n\nA list.', null, 'spells', 'Spells')).toBeNull();
	});

	it('reads without frontmatter, losing only what the tags carry', () => {
		const bare = parseSpell(fireball, null, 'k', 'Fireball');

		expect(bare?.castingTime).toBe('action');
		expect(bare?.level).toBeNull();
		expect(bare?.classes).toEqual([]);
	});
});
