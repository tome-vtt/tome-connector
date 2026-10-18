import { describe, expect, it } from 'vitest';

import {
	parseBackground,
	readAbilities,
	readEquipmentOptions,
	readDescription,
	readList,
} from '../src/recognizers/compendium/background';

/** `backgrounds/soldier-xphb.md`, verbatim - trailing hard-break spaces included. */
const soldier = `---
cssclasses:
- json5e-background
tags:
- ttrpg-cli/background
---
# Soldier
*Source: Player's Handbook (2024) p. 185. Available in the <span title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*
![](3-Mechanics/CLI/backgrounds/img/soldier.webp#right)

- **Ability Scores.** Strength, Dexterity, Constitution
- **Feat.** [Savage Attacker](3-Mechanics/CLI/feats/savage-attacker-xphb.md)
- **Skill Proficiencies.** [Athletics](3-Mechanics/CLI/rules/skills.md#Athletics), [Intimidation](3-Mechanics/CLI/rules/skills.md#Intimidation)
- **Tool Proficiency.** Choose one kind of [Gaming Set](3-Mechanics/CLI/items/gaming-set-xphb.md)
- **Equipment.** Choose A or B: (A) [Spear](3-Mechanics/CLI/items/spear-xphb.md), [Shortbow](3-Mechanics/CLI/items/shortbow-xphb.md), [20 Arrows](3-Mechanics/CLI/items/arrow-xphb.md), [Gaming Set](3-Mechanics/CLI/items/gaming-set-xphb.md) (same as above), [Healer's Kit](3-Mechanics/CLI/items/healers-kit-xphb.md), [Quiver](3-Mechanics/CLI/items/quiver-xphb.md), [Traveler's Clothes](3-Mechanics/CLI/items/travelers-clothes-xphb.md), 14 GP; or (B) 50 GP

You began training for war as soon as you reached adulthood and carry precious few memories of life before you took up arms. Battle is in your blood.`;

describe('readAbilities', () => {
	it('maps the printed names to the three-letter keys', () => {
		expect(readAbilities('Strength, Dexterity, Constitution')).toEqual(['str', 'dex', 'con']);
	});

	it.each([
		['Intelligence, Wisdom, Charisma', ['int', 'wis', 'cha']],
		['Dexterity, Intelligence and Charisma', ['dex', 'int', 'cha']],
	])('reads %s', (input, expected) => {
		expect(readAbilities(input)).toEqual(expected);
	});

	/**
	 * The builder looks these up by key, so a word that is not one of the six is
	 * dropped rather than passed through - it would otherwise sit in the list as an
	 * ability that does not exist. The printed sentence survives in the detail.
	 */
	it('drops anything that is not one of the six', () => {
		expect(readAbilities('Strength, Choose one other')).toEqual(['str']);
	});

	it.each([[undefined], ['']])('is empty for %o', (input) => {
		expect(readAbilities(input)).toEqual([]);
	});
});

describe('readList', () => {
	it('splits on commas and trims', () => {
		expect(readList('Athletics, Intimidation')).toEqual(['Athletics', 'Intimidation']);
	});

	it('is empty for nothing', () => {
		expect(readList(undefined)).toEqual([]);
	});
});

describe('readEquipmentOptions', () => {
	const options = readEquipmentOptions(
		"Choose A or B: (A) Spear, Shortbow, 20 Arrows, Gaming Set (same as above), Healer's Kit, 14 GP; or (B) 50 GP",
	);

	it('splits the lettered packages', () => {
		expect(options.map((option) => option.option)).toEqual(['A', 'B']);
		expect(options[1]?.text).toBe('50 GP');
	});

	/**
	 * The separator between packages - "…, 14 GP; or " - belongs to neither, and
	 * slicing at the next letter leaves it on the end of the one before.
	 */
	it('drops the separator from the end of a package', () => {
		expect(options[0]?.text).toBe(
			"Spear, Shortbow, 20 Arrows, Gaming Set (same as above), Healer's Kit, 14 GP",
		);
	});

	/**
	 * A parenthesised aside inside a package is not a new option. `(same as above)`
	 * is lower-case, which is what keeps the letter pattern from matching it.
	 */
	it('does not treat a parenthetical aside as a package', () => {
		expect(options).toHaveLength(2);
	});

	/** So a caller never has to handle "sometimes a list, sometimes a string". */
	it('yields one unlettered option when there is no choice', () => {
		expect(readEquipmentOptions("Herbalism Kit, Traveler's Clothes, 8 GP")).toEqual([
			{ option: '', text: "Herbalism Kit, Traveler's Clothes, 8 GP" },
		]);
	});

	it('is empty for nothing', () => {
		expect(readEquipmentOptions(undefined)).toEqual([]);
	});
});

describe('parseBackground', () => {
	const parsed = parseBackground(soldier, 'soldier-xphb', 'Soldier');

	it('reads the name from the title', () => {
		expect(parsed?.name).toBe('Soldier');
		expect(parsed?.key).toBe('soldier-xphb');
	});

	/**
	 * The reason backgrounds are the type worth importing: unlike a species, every
	 * mechanical field is stated, so an imported background arrives able to do
	 * something rather than merely be read.
	 */
	it('reads every mechanical field, keeping the printed form alongside', () => {
		expect(parsed?.abilityScores).toEqual(['str', 'dex', 'con']);
		expect(parsed?.abilityScoresDetail).toBe('Strength, Dexterity, Constitution');
		expect(parsed?.skillProficiencies).toEqual(['Athletics', 'Intimidation']);
		expect(parsed?.toolProficiency).toBe('Choose one kind of Gaming Set');
		expect(parsed?.feat).toBe('Savage Attacker');
	});

	it('splits the equipment into lettered options', () => {
		expect(parsed?.startingEquipment.map((option) => option.option)).toEqual(['A', 'B']);
		expect(parsed?.startingEquipment[1]?.text).toBe('50 GP');
	});

	/**
	 * Backgrounds have no `## Description`; the prose sits straight under the
	 * fields. So the description is the preamble minus the labelled lines, the
	 * source line and the portrait - each of which would otherwise be read as text.
	 */
	it('takes the description from the prose under the fields', () => {
		expect(parsed?.desc).toContain('You began training for war');
		expect(parsed?.desc).not.toContain('Source:');
		expect(parsed?.desc).not.toContain('Ability Scores');
		expect(parsed?.desc).not.toContain('soldier.webp');
	});

	/** Trailing double-spaces are markdown hard breaks, not part of the value. */
	it('does not keep the hard-break spaces on a field', () => {
		expect(parsed?.feat).toBe(parsed?.feat?.trim());
	});

	/** Three of the twenty-one write it plural. */
	it('accepts the plural tool label', () => {
		const plural = parseBackground(
			'# X\n\n- **Skill Proficiencies.** Arcana  \n- **Tool Proficiencies.** Two sets',
			'x',
			'X',
		);

		expect(plural?.toolProficiency).toBe('Two sets');
	});

	/**
	 * Four of the twenty-one are 2014-era backgrounds: they state skills and
	 * equipment but no ability scores and no origin feat. They import as far as
	 * they go rather than being rejected.
	 */
	it('reads a background with no ability scores or feat', () => {
		const older = parseBackground(
			'# Sailor\n\n- **Skill Proficiencies.** Athletics, Perception  \n- **Equipment.** A rope\n\nYou sailed.',
			'sailor',
			'Sailor',
		);

		expect(older?.skillProficiencies).toEqual(['Athletics', 'Perception']);
		expect(older?.abilityScores).toEqual([]);
		expect(older?.feat).toBeNull();
	});

	it('returns null for a note that states no background fields', () => {
		expect(parseBackground('# Backgrounds\n\nA list.', 'backgrounds', 'Backgrounds')).toBeNull();
	});

	it('falls back to the given name when the note has no title', () => {
		expect(parseBackground('- **Ability Scores.** Strength', 'k', 'Fallback')?.name).toBe(
			'Fallback',
		);
	});
});

/**
 * `readDescription` goes through the shared `proseBody`. Blank-line runs collapse
 * to one (wanted: it only tidies spacing), and a note with no headings is read
 * whole, minus its frontmatter, as the pre-consolidation reader did.
 */
describe('readDescription', () => {
	it('collapses three or more newlines to one blank line', () => {
		expect(readDescription('# Odd\n\nFirst.\n\n\n\n\nSecond.')).toBe('First.\n\nSecond.');
	});

	it('reads the whole note, without frontmatter, when it has no headings', () => {
		expect(
			readDescription(
				'---\ncssclasses: json5e-background\n---\n- **Ability Scores.** Strength\n\n\nYou began training for war.',
			),
		).toBe('You began training for war.');
	});
});
