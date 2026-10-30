import { describe, expect, it } from 'vitest';

import { parseFeat, readBenefits, readDescription, readType } from '../src/recognizers/compendium/feat';
import { readPrerequisiteRule } from '../src/recognizers/compendium/prerequisiteRule';

/** `feats/alert-xphb.md`, verbatim. */
const alert = `---
cssclasses:
- json5e-feat
tags:
- ttrpg-cli/compendium/src/5e/xphb
- ttrpg-cli/feat
---
# Alert
*Source: Player's Handbook (2024) p. 200. Available in the <span title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*

You gain the following benefits.

**Initiative Proficiency.** When you roll [Initiative](3-Mechanics/CLI/rules/variant-rules/initiative-xphb.md), you can add your [Proficiency Bonus](3-Mechanics/CLI/rules/variant-rules/proficiency-xphb.md) to the roll.

**Initiative Swap.** Immediately after you roll [Initiative](3-Mechanics/CLI/rules/variant-rules/initiative-xphb.md), you can swap your [Initiative](3-Mechanics/CLI/rules/variant-rules/initiative-xphb.md) with the [Initiative](3-Mechanics/CLI/rules/variant-rules/initiative-xphb.md) of one willing ally in the same combat. You can't make this swap if you or the ally has the [Incapacitated](3-Mechanics/CLI/rules/conditions.md#Incapacitated) condition.`;

/** `feats/archery-xphb.md`: a prerequisite, and no labelled benefits at all. */
const archery = `# Archery
*Source: Player's Handbook (2024) p. 209*

**Prerequisite**: Fighting Style Feature

You gain a +2 bonus to attack rolls you make with Ranged weapons.`;

describe('readType', () => {
	/**
	 * The four categories, each read from what the prerequisite says rather than
	 * from anything the CLI tags. See the table on `readType`.
	 */
	it.each([
		[null, 'Origin'],
		['', 'Origin'],
		['4th', 'General'],
		['4th, Proficiency with heavy armor', 'General'],
		['19th', 'Epic Boon'],
		['19th; Spellcasting or Pact Magic feature', 'Epic Boon'],
		['Fighting Style Feature', 'Fighting Style'],
	])('%o -> %s', (prerequisite, expected) => {
		expect(readType(prerequisite, true)).toBe(expected);
	});

	/**
	 * Two of the twelve fighting styles write their prerequisite the long way, and
	 * it contains a level. Reading the level first would file them as General and
	 * offer a paladin's fighting style to any level 4 character.
	 */
	it('reads a long-form fighting style prerequisite as Fighting Style, not General', () => {
		expect(readType('When Gaining the Level 2 Paladin "Fighting Style" Feature', true)).toBe(
			'Fighting Style',
		);
	});

	/**
	 * Homebrew. Left unset on purpose: a feat with no category is visibly missing
	 * from the builder, whereas one defaulted to Origin is silently offered at
	 * level 1.
	 */
	it('is null for a prerequisite the 2024 books do not use', () => {
		expect(readType('Strength 13 or higher', true)).toBeNull();
	});

	/**
	 * **Origin feats do not exist in the 2014 rules**, where a feat is just a feat
	 * and none of them carries a level prerequisite. So the no-prerequisite rule
	 * cannot be applied outside 2024 - doing so filed Dungeon Delver, Linguist and
	 * Martial Adept as origin feats, which offers them to a level 1 character.
	 *
	 * A vault built from the whole `ttrpg-convert-cli` source map holds both
	 * editions at once, so this is the ordinary case rather than an edge one.
	 */
	it.each([[null], [''], ['4th'], ['Fighting Style Feature']])(
		'gives a 2014 feat no category, whatever its prerequisite (%o)',
		(prerequisite) => {
			expect(readType(prerequisite, false)).toBeNull();
		},
	);
});

/** Nodes in the server's `Srd2024PrerequisiteRule` shape, every key written. */
const level = (minimum: number) => ({ kind: 'level', minimum, ability: null, feature: null, children: [] });
const ability = (key: string, minimum: number) => ({ kind: 'ability', minimum, ability: key, feature: null, children: [] });
const feature = (name: string) => ({ kind: 'feature', minimum: null, ability: null, feature: name, children: [] });
const all = (...children: unknown[]) => ({ kind: 'all', minimum: null, ability: null, feature: null, children });
const any = (...children: unknown[]) => ({ kind: 'any', minimum: null, ability: null, feature: null, children });

describe('readPrerequisiteRule', () => {
	/**
	 * The CLI's wording of the 2024 Player's Handbook prerequisites, turned into
	 * the rule Tome's level-up checks. The SRD catalogue writes the same rules for
	 * "Level 4+", "Fighting Style Feature" and "Level 4+, Strength or Dexterity 13+".
	 */
	it.each([
		['4th', level(4)],
		['19th', level(19)],
		['Fighting Style Feature', feature('Fighting Style')],
		['4th; Charisma 13 or higher', all(level(4), ability('cha', 13))],
		['4th; Strength or Dexterity 13 or higher', all(level(4), any(ability('str', 13), ability('dex', 13)))],
		[
			'4th; Intelligence, Wisdom, or Charisma 13 or higher',
			all(level(4), any(ability('int', 13), ability('wis', 13), ability('cha', 13))),
		],
		['4th; Spellcasting or Pact Magic feature', all(level(4), any(feature('Spellcasting'), feature('Pact Magic')))],
		['19th; Spellcasting or Pact Magic feature', all(level(19), any(feature('Spellcasting'), feature('Pact Magic')))],
		['Strength 13 or higher', ability('str', 13)],
	])('%o', (prerequisite, expected) => {
		expect(readPrerequisiteRule(prerequisite)).toEqual(expected);
	});

	/**
	 * A clause the connector cannot read leaves the whole feat unruled: a rule that
	 * dropped the clause would let a character who does not qualify take the feat.
	 */
	it.each([
		[null],
		[''],
		['4th, Proficiency with heavy armor'],
		['4th; Medium Armor Training'],
		['spellcasting feature'],
		['When Gaining the Level 2 Paladin "Fighting Style" Feature'],
	])('is null for a prerequisite it cannot read (%o)', (prerequisite) => {
		expect(readPrerequisiteRule(prerequisite)).toBeNull();
	});
});

describe('readBenefits', () => {
	it('reads the bold-labelled paragraphs, links flattened', () => {
		const benefits = readBenefits(alert);

		expect(benefits.map((benefit) => benefit.name)).toEqual([
			'Initiative Proficiency',
			'Initiative Swap',
		]);
		expect(benefits[0]?.desc).toBe(
			'When you roll Initiative, you can add your Proficiency Bonus to the roll.',
		);
	});

	/** The prerequisite is written in the same shape as a benefit but is a field. */
	it('does not mistake the prerequisite for a benefit', () => {
		expect(readBenefits(archery)).toEqual([]);
	});

	/**
	 * Upstream numbers these, and upstream needs to: the SRD catalogue's own Alert
	 * has both benefits keyed `initative-proficiency`, so a consumer indexing by
	 * key loses one of them.
	 */
	it('gives colliding labels distinct keys', () => {
		const benefits = readBenefits('**Boon.** One.\n\n**Boon.** Two.');

		expect(benefits.map((benefit) => benefit.key)).toEqual(['1-boon', '2-boon']);
	});
});

describe('parseFeat', () => {
	const parsed = parseFeat(alert, 'alert-xphb', 'Alert');

	/**
	 * The oracle. `srd-2024-characters.json` carries its own Alert, generated from
	 * structured upstream data; this one is scraped from prose. If scraping the
	 * template is sound they agree on every field but the key, and that equality is
	 * the whole premise of Phase 2.
	 */
	it('agrees with the SRD catalogue field for field', () => {
		expect(parsed).toEqual({
			key: 'alert-xphb',
			name: 'Alert',
			desc: 'You gain the following benefits.',
			type: 'Origin',
			prerequisite: null,
			prerequisiteRule: null,
			benefits: [
				{
					key: '1-initiative-proficiency',
					name: 'Initiative Proficiency',
					desc: 'When you roll Initiative, you can add your Proficiency Bonus to the roll.',
					type: null,
				},
				{
					key: '2-initiative-swap',
					name: 'Initiative Swap',
					desc: "Immediately after you roll Initiative, you can swap your Initiative with the Initiative of one willing ally in the same combat. You can't make this swap if you or the ally has the Incapacitated condition.",
					type: null,
				},
			],
		});
	});

	it('keeps the source line out of the description', () => {
		expect(parsed?.desc).not.toContain('Source:');
		expect(parsed?.desc).not.toContain('Player’s Handbook');
	});

	it('reads a feat whose whole body is description', () => {
		const parsedArchery = parseFeat(archery, 'archery-xphb', 'Archery');

		expect(parsedArchery?.prerequisite).toBe('Fighting Style Feature');
		expect(parsedArchery?.type).toBe('Fighting Style');
		expect(parsedArchery?.benefits).toEqual([]);
		expect(parsedArchery?.desc).toBe(
			'You gain a +2 bonus to attack rolls you make with Ranged weapons.',
		);
	});

	it('sends a level 4, Charisma 13 prerequisite as a rule Tome checks', () => {
		const actor = parseFeat(
			"# Actor\n*Source: Player's Handbook (2024) p. 202*\n\n**Prerequisite**: 4th; Charisma 13 or higher\n\n**Impersonation.** You can mimic.",
			'actor-xphb',
			'Actor',
		);

		expect(actor?.prerequisite).toBe('4th; Charisma 13 or higher');
		expect(actor?.prerequisiteRule).toEqual(all(level(4), ability('cha', 13)));
	});

	it('falls back to the given name when the note has no title', () => {
		expect(parseFeat('You are tough.', 'k', 'Fallback')?.name).toBe('Fallback');
	});

	/**
	 * The edition comes from the source line: 2024 books print "(2024)" in the
	 * title and the 2014 ones print no year. A 2014 feat therefore imports with its
	 * text and no category, which is what keeps it out of a 2024 builder.
	 */
	it('gives a 2014 feat no category', () => {
		const dungeonDelver = parseFeat(
			"# Dungeon Delver\n*Source: Player's Handbook p. 166*\n\nYou are alert to hidden traps.",
			'dungeon-delver',
			'Dungeon Delver',
		);

		expect(dungeonDelver?.name).toBe('Dungeon Delver');
		expect(dungeonDelver?.desc).toContain('hidden traps');
		expect(dungeonDelver?.type).toBeNull();
	});

	/** A note with no source line at all is not assumed to be 2024 either. */
	it('gives a feat with no source line no category', () => {
		expect(parseFeat('# Homebrew\n\nYou are special.', 'k', 'K')?.type).toBeNull();
	});

	it('returns null for a note with neither prose nor benefits', () => {
		expect(parseFeat('# Feats\n', 'feats', 'Feats')).toBeNull();
	});
});

/**
 * `readDescription` goes through the shared `proseBody`. Blank-line runs collapse
 * to one, as they did before the readers were shared: `stripMarkdownFromString`
 * collapses them either way. A note with no headings is read whole, minus its
 * frontmatter, as the pre-consolidation reader did.
 */
describe('readDescription', () => {
	it('collapses three or more newlines to one blank line', () => {
		expect(readDescription('# Odd\n\nFirst.\n\n\n\n\nSecond.')).toBe('First.\n\nSecond.');
	});

	it('reads the whole note, without frontmatter, when it has no headings', () => {
		expect(
			readDescription(
				'---\ncssclasses: json5e-feat\n---\nYou are special.\n\n\n**Prerequisite**: None\n\nReally.',
			),
		).toBe('You are special.\n\nReally.');
	});
});
