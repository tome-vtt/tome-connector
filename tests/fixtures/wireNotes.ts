/**
 * One note of every kind the connector sends with a rules record in it, as the tools that
 * write them lay them out - `ttrpg-convert-cli` for the creature and the compendium items,
 * Fantasy Statblocks' own Pathfinder layout for the Pathfinder creature, the D&D Beyond
 * exporter for the character.
 *
 * `requestBodies.test.ts` pins every body built from them against the server's contract.
 * They are also what 1.1.0 was checked with against a running Tome server. A live check sends
 * them through the send module with real ports, as `everyBody()` in the test does with the
 * in-memory ones - so "the bodies the tests pinned" and "the bodies the server accepted" stay
 * the same bodies.
 */

import { parse as parseYaml } from 'yaml';

import type { Note } from '../../src/recognizers/note';

/** `bestiary/aberration/githyanki-knight-xmm.md`, trimmed - gear, saves, a bonus action. */
export const GITHYANKI_KNIGHT_NOTE = `---
statblock: inline
---
# Githyanki Knight

\`\`\`statblock
layout: Basic 5e Layout
name: Githyanki Knight (XMM)
size: Medium
type: aberration
subtype: gith
alignment: Lawful Evil
ac: 18
hp: 117
hit_dice: 18d8 + 36
modifier: 5
stats: [16, 14, 15, 14, 14, 15]
speed: 30 ft.
saves:
  - constitution: 5
  - intelligence: 5
  - wisdom: 5
skillsaves:
  - perception: 5
  - null
gear:
  - "[plate armor](3-Mechanics/CLI/items/plate-armor-xphb.md)"
damage_resistances: psychic
senses: passive Perception 12
languages: Common, Gith
cr: "8"
traits:
  - name: Psionic Defense
    desc: The githyanki's mind cannot be read against its will.
actions:
  - name: Multiattack
    desc: The githyanki makes three Silver Sword attacks.
bonus_actions:
  - name: Misty Step (2/Day)
    desc: The githyanki casts Misty Step.
reactions:
  - name: Parry
    desc: The githyanki adds 3 to its AC against one melee attack.
source: [XMM]
\`\`\`
`;

/** A Goblin Warrior against Fantasy Statblocks' \`Pathfinder 2e Creature Layout.json\`. */
export const GOBLIN_WARRIOR_NOTE = `# Goblin Warrior

\`\`\`statblock
layout: Pathfinder 2e Creature Layout
name: Goblin Warrior
level: Creature -1
rarity: Common
size: small
traits: [goblin, humanoid]
modifier: 2
senses: darkvision
languages: Common, Goblin
skills:
  - Acrobatics: "+5"
  - Athletics: "+2"
  - Stealth: "+5"
attributes:
  - str: 0
  - dex: 3
  - con: 1
  - int: 0
  - wis: 0
  - cha: 1
items: [dogslicer, leather armor]
ac: 16
acNote: 14 when off-guard
saves:
  - fort: "+5"
  - ref: "+7"
  - will: "+3"
hp: 6
immunities: fire
weaknesses: cold iron 2
speed: 25 feet, climb 15 feet
abilities_top:
  - name: Darkvision
    desc: Sees in the dark.
abilities_mid:
  - name: Goblin Scuttle
    desc: Step in reaction to an ally moving nearby.
abilities_bot:
  - name: Sneak Attack
    desc: Deals extra damage to an off-guard target.
attacks:
  - name: Melee
    desc: dogslicer +8 (agile, backstabber, finesse), Damage 1d6+1 slashing
  - name: Ranged
    desc: shortbow +8 (deadly d10, range increment 60 feet)
sourcebook: Pathfinder Monster Core
\`\`\`
`;

/** \`items/bag-of-holding-xdmg.md\`, trimmed but structurally exact. */
export const BAG_OF_HOLDING_NOTE = `---
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

This bag has an interior space considerably larger than its outside dimensions.

If the bag is overloaded, pierced, or torn, it is destroyed.

*Source: Dungeon Master's Guide (2024) p. 234*`;

/** \`items/cloak-of-protection-xdmg.md\` - the attunement arm of the subtitle. */
export const CLOAK_OF_PROTECTION_NOTE = `---
cssclasses:
- json5e-item
tags:
- ttrpg-cli/item/rarity/uncommon
---
# Cloak of Protection
*Wondrous item, uncommon (requires attunement)*

You gain a +1 bonus to Armor Class and saving throws while you wear this cloak.

*Source: Dungeon Master's Guide (2024) p. 255*`;

/** \`items/rope-xphb.md\`, trimmed but structurally exact - gear, so equipment. */
export const ROPE_NOTE = `---
cssclasses:
- json5e-item
tags:
- ttrpg-cli/item/gear/
- ttrpg-cli/item/rarity/none
---
# Rope
*Adventuring gear*

- **Cost**: 1 gp
- **Weight**: 5.0 lbs.

As a Utilize action, you can tie a knot with Rope if you succeed on a DC 10 Dexterity check.

*Source: Player's Handbook (2024) p. 228*`;

/** \`spells/fireball-xphb.md\`, trimmed to one class tag per kind but structurally exact. */
export const FIREBALL_NOTE = `---
cssclasses:
- json5e-spell
tags:
- ttrpg-cli/compendium/src/5e/xphb
- ttrpg-cli/spell/class/sorcerer
- ttrpg-cli/spell/class/wizard
- ttrpg-cli/spell/level/3rd-level
- ttrpg-cli/spell/school/evocation
---
# Fireball
*3rd-level, Evocation*

- **Casting time:** 1 Action
- **Range:** 150 feet
- **Components:** V, S, M (a ball of bat guano and sulfur)
- **Duration:** Instantaneous

A bright streak flashes from you to a point you choose within range and then blossoms into a fiery explosion.

**Using a Higher-Level Spell Slot.** The damage increases by 1d6 for each spell slot level above 3.

*Source: Player's Handbook (2024) p. 274*`;

/** \`spells/shield-xphb.md\` - a reaction with its trigger, and a ranged-self spell. */
export const SHIELD_NOTE = `---
cssclasses:
- json5e-spell
tags:
- ttrpg-cli/spell/class/wizard
- ttrpg-cli/spell/level/1st-level
- ttrpg-cli/spell/school/abjuration
---
# Shield
*1st-level, Abjuration*

- **Casting time:** 1 Reaction, which you take when you are hit by an attack roll or targeted by the Magic Missile spell
- **Range:** Self
- **Components:** V, S
- **Duration:** 1 round

An imperceptible barrier of magical force protects you.

*Source: Player's Handbook (2024) p. 316*`;

/**
 * A D&D Beyond export - Zabadun Stoneheart, a level 3 dwarf barbarian - with the caster
 * sections of another export appended, so one note carries every table the parser reads.
 */
export const ZABADUN_NOTE = `---
name: Zabadun Stoneheart
race: Dwarf
class: Barbarian 3
level: 3
background: Soldier
alignment: Chaotic Good
gender: Male
xp: 900
hp_max: 43
hp_current: 40
hp_temp: 0
ac: 19
speed: 30
proficiency_bonus: 2
str: 20
dex: 14
con: 16
int: 8
wis: 12
cha: 10
dndbeyond_id: 123456789
---

# Zabadun Stoneheart

## Core Stats

| HP | AC | Speed | Initiative | Proficiency Bonus |
|:---:|:---:|:---:|:---:|:---:|
| 43 / 43 | 19 | 30 ft | +2 | +2 |

## Saving Throws

| STR | DEX | CON | INT | WIS | CHA |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **+7** ✓ | +2 | **+5** ✓ | +1 | +1 | +1 |

## Skills

| Skill | Stat | Bonus |
|:---|:---:|:---:|
| Acrobatics ✓ | DEX | +4 |
| Arcana | INT | +1 |
| Athletics ★ | STR | +9 |
| Perception ✓ | WIS | +3 |

## Proficiencies & Languages

**Languages:** Common, Dwarvish, Goblin

**Armor:** Light Armor, Medium Armor

**Weapons:** Simple Weapons, Martial Weapons

**Tools:** Smith's Tools

## Currency

| CP | SP | EP | GP | PP |
|:---:|:---:|:---:|:---:|:---:|
| 10 | 54 | 0 | 66 | 0 |

## Actions & Attacks

| Name | ATK Bonus | Damage | Range | Notes |
|:---|:---:|:---|:---:|:---|
| ⚔️ Unarmed Strike | +7 | 6 | 5 ft | Bludgeoning |
| ⚔️ Greataxe | +7 | 1d12+5 | 5 ft | Slashing |

## Equipment

| Item | Qty | Equipped | Weight |
| :--- | :-: | :------: | :----: |
| Greataxe | 1 | ✓ | 7.0 lbs |
| Rations | 10 | — | 20.0 lbs |

## Features & Traits

### Racial Traits

**Darkvision**
You have Darkvision with a range of 120 feet.

### Class Features

**Rage**
You can imbue yourself with a primal power called Rage.

## Spells

### Cantrips

| Spell | School | Cast Time | Range | Conc. | Prepared |
|:---|:---|:---|:---|:---:|:---:|
| **Thaumaturgy** | Transmutation | 1 Action | 30 ft | — | — |
`;

/**
 * The same character sent with a \`classes\` property naming each class on its own - the one
 * frontmatter key the exporter does not write, so it gets a body of its own.
 */
export const MULTICLASS_FRONTMATTER: Record<string, unknown> = {
	name: 'Brannoc Vey',
	race: 'Half-Elf',
	class: 'Fighter 3 / Wizard 2',
	level: 5,
	classes: ['Fighter (Champion) 3', { class: 'Wizard', level: 2 }],
	dndbeyond_id: 987654321,
};

/** Splits a note into Obsidian's cached frontmatter and its text, the way `noteScan` is handed one. */
export function noteInput(path: string, content: string): Note {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
	const frontmatter = match?.[1] ? (parseYaml(match[1]) as Record<string, unknown>) : null;
	return { path, content, frontmatter };
}

/** The frontmatter of a note, or an empty record when it has none. */
export function frontmatterOf(content: string): Record<string, unknown> {
	return noteInput('note.md', content).frontmatter ?? {};
}

/** The YAML parser `findSendables` takes as a seam - the real one, since these are real notes. */
export function yamlParser(source: string): unknown {
	return parseYaml(source) as unknown;
}
