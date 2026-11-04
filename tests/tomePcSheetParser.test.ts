import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanCell, findTable, parsePcSheet, splitSections, stripFrontmatter } from '../src/tomePcSheetParser';

/**
 * A trimmed copy of a real D&D Beyond export (Zabadun Stoneheart, a level 3
 * dwarf barbarian) - a martial character, so no Spells, Equipment or Features
 * sections exist at all. That absence is the point: the exporter omits an empty
 * section rather than writing an empty one.
 */
const MARTIAL_NOTE = `---
name: Zabadun Stoneheart
race: Dwarf
class: Barbarian 3
level: 3
---

# Zabadun Stoneheart

## Core Stats

| HP | AC | Speed | Initiative | Proficiency Bonus |
|:---:|:---:|:---:|:---:|:---:|
| 43 / 43 | 19 | 30 ft | +2 | +2 |

## Saving Throws

| STR | DEX | CON | INT | WIS | CHA |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **+7** ✓ <span style="color:#22c55e;font-weight:700;">▲A</span> | +2 <span style="color:#22c55e;font-weight:700;">▲A</span> | **+5** ✓ <span style="color:#22c55e;font-weight:700;">▲A</span> | +1 <span style="color:#22c55e;font-weight:700;">▲A</span> | +1 <span style="color:#22c55e;font-weight:700;">▲A</span> | +1 <span style="color:#22c55e;font-weight:700;">▲A</span> |

## Skills

| Skill | Stat | Bonus |
|:---|:---:|:---:|
| Acrobatics ✓ | DEX | +4 <span style="color:#9ca3af;">–N</span> |
| Arcana | INT | +1 <span style="color:#9ca3af;">–N</span> |
| Athletics ★ | STR | +9 <span style="color:#9ca3af;">–N</span> |
| Perception ✓ | WIS | +3 <span style="color:#9ca3af;">–N</span> |

## Proficiencies & Languages

**Languages:** Common, Dwarvish, Goblin

**Armor:** Light Armor, Medium Armor

**Weapons:** Simple Weapons, Martial Weapons

## Currency

| CP | SP | EP | GP | PP |
|:---:|:---:|:---:|:---:|:---:|
| 10 | 54 | 0 | 66 | 0 |

## Actions & Attacks

| Name | ATK Bonus | Damage | Range | Notes |
|:---|:---:|:---|:---:|:---|
| ⚔️ Unarmed Strike | +7 | 6 | 5 ft | Bludgeoning |

## Session Notes

*Add your notes here.*
`;

/** The caster half of the same exporter: spells by level, equipment, and features with sub-headings. */
const CASTER_NOTE = `## Equipment

| Item                    | Qty | Equipped |  Weight  |
| :---------------------- | :-: | :------: | :------: |
| Dagger                  |  1  |    —     | 1.0 lbs  |
| Backpack                |  1  |    ✓     | 5.0 lbs  |
| Rations                 | 10  |    —     | 20.0 lbs |

## Actions & Attacks

| Name              | ATK Bonus | Damage | Range  | Notes       |
| :---------------- | :-------: | :----- | :----: | :---------- |
| ⚔️ Unarmed Strike |    +2     | 1      |  5 ft  | Bludgeoning |
| ✨ Sorcerous Burst |    +3     | —      | 120 ft | Evocation   |
|                   |           |        |        |             |

## Features & Traits

### Racial Traits

**Darkvision**
You have Darkvision with a range of 60 feet.

**Size**
You are Medium (about 5&ndash;6 feet tall).

### Feats

**Magic Initiate (Wizard)**
Origin Feat

You gain the following benefits.

## Spells

### Cantrips

| Spell | School | Cast Time | Range | Conc. | Prepared |
|:---|:---|:---|:---|:---:|:---:|
| **Sorcerous Burst** | Evocation | 1 Action | 120 ft | — | — |
| **Ray of Frost** | Evocation | 1 Action | 60 ft | — | — |
| **Ray of Frost** | Evocation | 1 Action | 60 ft | — | — |

### 1st Level

| Spell | School | Cast Time | Range | Conc. | Prepared |
|:---|:---|:---|:---|:---:|:---:|
| **Shield** | Abjuration | 1 Reaction | 0 ft | — | ✓ |
`;

describe('stripFrontmatter', () => {
	it('drops a leading frontmatter block', () => {
		expect(stripFrontmatter('---\nname: X\n---\n# Title\n')).toBe('# Title\n');
	});

	it('leaves a note with no frontmatter alone', () => {
		expect(stripFrontmatter('# Title\n')).toBe('# Title\n');
	});
});

describe('cleanCell', () => {
	it('drops a span with its contents, so advantage markers never read as values', () => {
		expect(cleanCell('+4 <span style="color:#9ca3af;">–N</span>')).toBe('+4');
	});

	it('decodes html entities', () => {
		expect(cleanCell('5&ndash;6 feet')).toBe('5–6 feet');
	});

	it('removes bold markers', () => {
		expect(cleanCell('**+7** ✓')).toBe('+7 ✓');
	});
});

describe('findTable', () => {
	it('drops an all-empty trailing row', () => {
		const table = findTable([
			'| A | B |',
			'|:--|:--|',
			'| 1 | 2 |',
			'|   |   |',
		]);
		expect(table?.rows).toEqual([['1', '2']]);
	});

	it('returns null when there is no separator row', () => {
		expect(findTable(['| A | B |', '| 1 | 2 |'])).toBeNull();
	});
});

describe('splitSections', () => {
	it('nests h3 subsections under their h2', () => {
		const sections = splitSections(CASTER_NOTE);
		const spells = sections.find((section) => section.title === 'Spells');
		expect(spells?.subsections.map((sub) => sub.title)).toEqual(['Cantrips', '1st Level']);
	});
});

describe('parsePcSheet - martial character', () => {
	const sheet = parsePcSheet(MARTIAL_NOTE);

	it('reads initiative, the one Core Stats value frontmatter lacks', () => {
		expect(sheet.initiative).toBe(2);
	});

	it('reads all six saves with their proficiency', () => {
		expect(sheet.saves).toEqual([
			{ ability: 'STR', bonus: 7, proficient: true },
			{ ability: 'DEX', bonus: 2, proficient: false },
			{ ability: 'CON', bonus: 5, proficient: true },
			{ ability: 'INT', bonus: 1, proficient: false },
			{ ability: 'WIS', bonus: 1, proficient: false },
			{ ability: 'CHA', bonus: 1, proficient: false },
		]);
	});

	it('separates expertise from plain proficiency', () => {
		expect(sheet.skills).toContainEqual({
			name: 'Athletics',
			ability: 'STR',
			bonus: 9,
			proficient: true,
			expertise: true,
		});
		expect(sheet.skills).toContainEqual({
			name: 'Acrobatics',
			ability: 'DEX',
			bonus: 4,
			proficient: true,
			expertise: false,
		});
	});

	it('keeps unproficient skills, which is what makes a passive score correct', () => {
		expect(sheet.skills.find((skill) => skill.name === 'Arcana')).toEqual({
			name: 'Arcana',
			ability: 'INT',
			bonus: 1,
			proficient: false,
			expertise: false,
		});
	});

	it('reads the labelled proficiency lines', () => {
		expect(sheet.languages).toBe('Common, Dwarvish, Goblin');
		expect(sheet.armorProficiencies).toBe('Light Armor, Medium Armor');
		expect(sheet.weaponProficiencies).toBe('Simple Weapons, Martial Weapons');
	});

	it('reads currency', () => {
		expect(sheet.currency).toEqual({ cp: 10, sp: 54, ep: 0, gp: 66, pp: 0 });
	});

	it('strips the emoji badge from an attack name', () => {
		expect(sheet.attacks).toEqual([
			{ name: 'Unarmed Strike', attackBonus: '+7', damage: '6', range: '5 ft', notes: 'Bludgeoning' },
		]);
	});

	it('returns empty lists for the sections a martial character has none of', () => {
		expect(sheet.spells).toEqual([]);
		expect(sheet.equipment).toEqual([]);
		expect(sheet.features).toEqual([]);
	});
});

describe('parsePcSheet - caster', () => {
	const sheet = parsePcSheet(CASTER_NOTE);

	it('files spells under the level of their sub-heading', () => {
		expect(sheet.spells.map((spell) => [spell.name, spell.level])).toEqual([
			['Sorcerous Burst', 0],
			['Ray of Frost', 0],
			['Shield', 1],
		]);
	});

	it('deduplicates a spell the exporter listed twice', () => {
		expect(sheet.spells.filter((spell) => spell.name === 'Ray of Frost')).toHaveLength(1);
	});

	it('reads the prepared tick', () => {
		expect(sheet.spells.find((spell) => spell.name === 'Shield')?.prepared).toBe(true);
		expect(sheet.spells.find((spell) => spell.name === 'Sorcerous Burst')?.prepared).toBe(false);
	});

	it('keeps features under the sub-heading they were listed beneath', () => {
		expect(sheet.features).toEqual([
			{ category: 'Racial Traits', name: 'Darkvision', desc: 'You have Darkvision with a range of 60 feet.' },
			{ category: 'Racial Traits', name: 'Size', desc: 'You are Medium (about 5–6 feet tall).' },
			{
				category: 'Feats',
				name: 'Magic Initiate (Wizard)',
				desc: 'Origin Feat\n\nYou gain the following benefits.',
			},
		]);
	});

	it('reads equipment quantities and the equipped tick', () => {
		expect(sheet.equipment).toEqual([
			{ name: 'Dagger', quantity: 1, weight: '1.0 lbs', equipped: false },
			{ name: 'Backpack', quantity: 1, weight: '5.0 lbs', equipped: true },
			{ name: 'Rations', quantity: 10, weight: '20.0 lbs', equipped: false },
		]);
	});

	it('drops the exporter\'s blank trailing attack row', () => {
		expect(sheet.attacks.map((attack) => attack.name)).toEqual([
			'Unarmed Strike',
			'Sorcerous Burst',
		]);
	});

	it('omits an absent currency table rather than inventing an empty purse', () => {
		expect(sheet.currency).toBeUndefined();
	});
});

/**
 * Radnads, the D&D Beyond note the connector sent in the 2026-10-27 test run
 * (Sorcerer 2, Charisma 17, proficiency +2). The exporter writes each spell
 * row's ATK Bonus as the casting ability's modifier alone (+3), so its spell
 * attack bonus of +5 has to be worked out here.
 */
describe('parsePcSheet - spell attack rows', () => {
	const radnads = readFileSync(join(import.meta.dirname, 'fixtures', 'connector-run-fixture-radnads.md'), 'utf8');
	const attacks = parsePcSheet(radnads).attacks;
	const bonusOf = (name: string) => attacks.find((attack) => attack.name === name)?.attackBonus;

	it('gives a spell row the proficiency bonus plus its casting ability modifier', () => {
		expect(bonusOf('Sorcerous Burst')).toBe('+5');
		expect(bonusOf('Acid Splash')).toBe('+5');
		expect(bonusOf('Shocking Grasp')).toBe('+5');
		expect(bonusOf('Chill Touch')).toBe('+5');
	});

	it('keeps the bonus the note gives a weapon row', () => {
		expect(bonusOf('Unarmed Strike')).toBe('+2');
	});

	it('works the bonus out from the row itself, so a feat spell keeps its own ability', () => {
		// Magic Initiate cast with Intelligence (+1) beside a Charisma class spell (+3).
		const note = `## Core Stats

| HP | AC | Speed | Initiative | Proficiency Bonus |
|:---:|:---:|:---:|:---:|:---:|
| 14 / 14 | 10 | 30 ft | +0 | +2 |

## Actions & Attacks

| Name | ATK Bonus | Damage | Range | Notes |
| :--- | :---: | :--- | :---: | :--- |
| ✨ Sorcerous Burst | +3 | — | 120 ft | Evocation |
| ✨ Fire Bolt | +1 | 1d10 | 120 ft | Evocation |

## Spells

### Cantrips

| Spell | School | Cast Time | Range | Conc. | Prepared |
|:---|:---|:---|:---|:---:|:---:|
| **Sorcerous Burst** | Evocation | 1 Action | 120 ft | — | — |
| **Fire Bolt** | Evocation | 1 Action | 120 ft | — | — |
`;
		expect(parsePcSheet(note).attacks.map((attack) => [attack.name, attack.attackBonus])).toEqual([
			['Sorcerous Burst', '+5'],
			['Fire Bolt', '+3'],
		]);
	});
});
