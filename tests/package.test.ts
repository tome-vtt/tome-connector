import { describe, expect, it, vi } from 'vitest';

import type { Note } from '../src/recognizers/note';
import { parseFeat } from '../src/recognizers/compendium/feat';
import {
	assemblePackage,
	describeCounts,
	isEmpty,
	packageKeyFrom,
} from '../src/recognizers/compendium/package';

// The real parser, wrapped so one test can make it throw.
vi.mock('../src/recognizers/compendium/feat', async (importOriginal) => {
	const real = await importOriginal<typeof import('../src/recognizers/compendium/feat')>();
	return { ...real, parseFeat: vi.fn(real.parseFeat) };
});

const srdSource =
	"*Source: Player's Handbook (2024) p. 185. Available in the <span title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*";

function note(
	path: string,
	cssClass: string,
	body: string,
	extraTags: string[] = [],
): Note {
	return {
		path,
		content: body,
		frontmatter: { cssclasses: [cssClass], tags: ['ttrpg-cli/compendium/src/5e/xphb', ...extraTags] },
	};
}

const species = note(
	'CLI/races/aasimar-xphb.md',
	'json5e-race',
	`# Aasimar\n${srdSource}\n\n- **Size**: Medium\n- **Speed**: 30 ft.\n\n## Traits\n\n### Darkvision\n\nYou see.\n\n## Description\n\nCelestial blood.`,
);

const background = note(
	'CLI/backgrounds/soldier-xphb.md',
	'json5e-background',
	`# Soldier\n${srdSource}\n\n- **Ability Scores.** Strength, Dexterity, Constitution\n- **Skill Proficiencies.** Athletics\n- **Equipment.** A spear\n\nYou fought.`,
);

const feat = note(
	'CLI/feats/alert-xphb.md',
	'json5e-feat',
	`# Alert\n${srdSource}\n\nYou gain the following benefits.\n\n**Initiative Proficiency.** You add your bonus.`,
	['ttrpg-cli/feat'],
);

const spell = note(
	'CLI/spells/fireball-xphb.md',
	'json5e-spell',
	`# Fireball\n${srdSource}\n\n- **Casting time:** 1 Action\n- **Range:** 150 feet\n- **Components:** V, S\n- **Duration:** Instantaneous\n\nIt explodes.`,
	['ttrpg-cli/spell/level/3rd-level', 'ttrpg-cli/spell/school/evocation'],
);

describe('assemblePackage', () => {
	/**
	 * The four fixtures are SRD-marked, which the default now skips - see the test
	 * below. The assertions here are about sorting, prefill and reporting rather
	 * than about that cut, so they opt in.
	 */
	const report = assemblePackage([species, background, feat, spell], 'my-books', {
		includeSrdContent: true,
	});

	it('sorts each type into its own list', () => {
		expect(report.counts).toEqual({ species: 1, backgrounds: 1, feats: 1, spells: 1, subclasses: 0, items: 0 });
		expect(report.package.species[0]?.name).toBe('Aasimar');
		expect(report.package.backgrounds[0]?.name).toBe('Soldier');
		expect(report.package.feats[0]?.name).toBe('Alert');
		expect(report.package.spells[0]?.name).toBe('Fireball');
	});

	/**
	 * The difference between a package written for a newer Tome being refused and
	 * being read wrong - `Srd2024SnapshotBase.FormatVersion`, which the server
	 * checks against its own before it reads anything.
	 */
	it('declares the format version', () => {
		expect(report.package.formatVersion).toBe(1);
		expect(report.package.documentKey).toBe('my-books');
	});

	it('prefills the licence and the attribution from the source lines', () => {
		expect(report.suggested.license).toBe('CC-BY-4.0');
		expect(report.suggested.attribution).toBe("Player's Handbook (2024)");
	});

	/**
	 * One book note is enough to make the whole package unshareable, and the licence
	 * goes blank rather than staying on the previous answer.
	 */
	it('withdraws the licence suggestion when any note is book content', () => {
		const withBook = assemblePackage(
			[species, note('CLI/feats/x.md', 'json5e-feat', '# X\n*Source: Ghosts of Saltmarsh*\n\nProse.', ['ttrpg-cli/feat'])],
			'mixed',
		);

		expect(withBook.sources.allSrd).toBe(false);
		expect(withBook.suggested.license).toBeNull();
		expect(withBook.package.license).toBeNull();
	});

	/**
	 * A preview that omits what it cannot handle reads as one that did not find it,
	 * so the types with no parser are counted rather than dropped.
	 */
	it('counts the types it cannot yet import', () => {
		const withCreatures = assemblePackage(
			[
				species,
				note('CLI/bestiary/goblin.md', 'json5e-monster', '# Goblin'),
				note('CLI/bestiary/orc.md', 'json5e-monster', '# Orc'),
			],
			'k',
			{ includeSrdContent: true },
		);

		expect(withCreatures.unsupported).toEqual({ creature: 2 });
		expect(withCreatures.counts.species).toBe(1);
	});

	/**
	 * A book's gear travels with the book, as the content source's `items`. Its magic
	 * items do not: Tome keeps those in a catalogue of their own that a content source
	 * cannot add to, so they are counted as not included rather than dropped.
	 */
	it('puts equipment in the package and counts magic items as not included', () => {
		const rope = note(
			'CLI/items/silk-rope-xphb.md',
			'json5e-item',
			"# Silk Rope\n*Adventuring gear*\n\n- **Cost**: 10 gp\n- **Weight**: 5.0 lbs.\n\nStrong and light.\n\n*Source: Player's Handbook (2024) p. 228*",
			['ttrpg-cli/item/rarity/none'],
		);
		const cloak = note(
			'CLI/items/cloak-of-elvenkind-xdmg.md',
			'json5e-item',
			"# Cloak of Elvenkind\n*Wondrous item, uncommon (requires attunement)*\n\nYou are hard to see.\n\n*Source: Dungeon Master's Guide (2024) p. 255*",
			['ttrpg-cli/item/rarity/uncommon'],
		);

		const withItems = assemblePackage([rope, cloak], 'k');

		expect(withItems.package.items).toEqual([
			{
				key: 'silk-rope-xphb',
				name: 'Silk Rope',
				desc: 'Strong and light.',
				category: 'adventuring-gear',
				cost: 10,
				weight: 5,
			},
		]);
		expect(withItems.package.weapons).toEqual([]);
		expect(withItems.package.armor).toEqual([]);
		expect(withItems.counts.items).toBe(1);
		expect(withItems.unsupported).toEqual({ 'magic-item': 1 });
		expect(describeCounts(withItems.unsupported)).toBe('1 magic item');
		expect(isEmpty(withItems)).toBe(false);
	});

	/**
	 * A book's weapon arrives with its stats in the package's `weapons` list and the item
	 * pointing at it, under Tome's own `weapon` category, so the builder can attack with
	 * it rather than listing a stat-less piece of gear.
	 */
	it('puts a weapon note in the weapons list, with the item pointing at it', () => {
		const glaive = note(
			'CLI/items/starfall-glaive-tdcsr.md',
			'json5e-item',
			[
				'# Starfall Glaive',
				'*Martial weapon*',
				'',
				'- **Damage**:',
				'  - One-handed: 1d8 slashing',
				'  - Two-handed: 1d10 slashing',
				'- **Properties**: [Reach](3-Mechanics/CLI/rules/item-properties.md#Reach), [Versatile](3-Mechanics/CLI/rules/item-properties.md#Versatile), [Special](3-Mechanics/CLI/rules/item-properties.md#Special)',
				'- **Cost**: 20 gp',
				'- **Weight**: 6.0 lbs.',
				'',
				'Forged from a fallen star.',
				'',
				"*Source: Tal'Dorei Campaign Setting Reborn p. 1*",
			].join('\n'),
			['ttrpg-cli/item/rarity/none'],
		);
		const dart = note(
			'CLI/items/glass-dart-tdcsr.md',
			'json5e-item',
			"# Glass Dart\n*Simple weapon*\n\n- **Damage**: 1d4 piercing\n- **Range**: 20/60\n- **Properties**: [Finesse](rules/item-properties.md#Finesse), [Thrown](rules/item-properties.md#Thrown)\n- **Cost**: 5 cp\n\nIt shatters.\n\n*Source: Tal'Dorei Campaign Setting Reborn p. 2*",
			['ttrpg-cli/item/rarity/none'],
		);

		const report = assemblePackage([glaive, dart], 'k');

		expect(report.package.items).toEqual([
			{
				key: 'starfall-glaive-tdcsr',
				name: 'Starfall Glaive',
				desc: 'Forged from a fallen star.',
				category: 'weapon',
				cost: 20,
				weight: 6,
				weapon: 'starfall-glaive-tdcsr',
			},
			{
				key: 'glass-dart-tdcsr',
				name: 'Glass Dart',
				desc: 'It shatters.',
				category: 'weapon',
				cost: 0.05,
				weight: null,
				weapon: 'glass-dart-tdcsr',
			},
		]);
		expect(report.package.weapons).toEqual([
			{
				key: 'starfall-glaive-tdcsr',
				name: 'Starfall Glaive',
				damageDice: '1d8',
				damageType: 'slashing',
				range: 0,
				longRange: 0,
				distanceUnit: null,
				isSimple: false,
				isImprovised: false,
				// `Special` is not a property Tome has, so it is left off rather than dangling.
				properties: [
					{ property: 'srd-2024_reach-wp', detail: null },
					{ property: 'srd-2024_versatile-wp', detail: '1d10' },
				],
			},
			{
				key: 'glass-dart-tdcsr',
				name: 'Glass Dart',
				damageDice: '1d4',
				damageType: 'piercing',
				range: 20,
				longRange: 60,
				distanceUnit: null,
				isSimple: true,
				isImprovised: false,
				properties: [
					{ property: 'srd-2024_finesse-wp', detail: null },
					{ property: 'srd-2024_thrown-wp', detail: 'Range 20/60' },
				],
			},
		]);
		expect(report.package.armor).toEqual([]);
	});

	/** Armour and shields arrive with what the Armour Class calculation needs. */
	it('puts armour and shield notes in the armour list, with the item pointing at it', () => {
		const coat = note(
			'CLI/items/dragonscale-coat-tdcsr.md',
			'json5e-item',
			"# Dragonscale Coat\n*Medium armor*\n\n- **Armor Class**: 14 + Dex modifier (max of +2)\n- **Strength**: Requires 13 STR.\n- **Stealth**: The wearer has disadvantage on Stealth (DEX) checks.\n- **Cost**: 400 gp\n- **Weight**: 25.0 lbs.\n\nScales overlap.\n\n*Source: Tal'Dorei Campaign Setting Reborn p. 3*",
			['ttrpg-cli/item/rarity/none'],
		);
		const jerkin = note(
			'CLI/items/silk-jerkin-tdcsr.md',
			'json5e-item',
			"# Silk Jerkin\n*Light armor*\n\n- **Armor Class**: 11 + Dex modifier\n- **Cost**: 50 gp\n\n*Source: Tal'Dorei Campaign Setting Reborn p. 3*",
			['ttrpg-cli/item/rarity/none'],
		);
		const buckler = note(
			'CLI/items/oak-buckler-tdcsr.md',
			'json5e-item',
			"# Oak Buckler\n*Armor ([shield](3-Mechanics/CLI/items/shield-xphb.md))*\n\n- **Armor Class**: 2\n- **Cost**: 10 gp\n- **Weight**: 6.0 lbs.\n\n*Source: Tal'Dorei Campaign Setting Reborn p. 4*",
			['ttrpg-cli/item/rarity/none'],
		);

		const report = assemblePackage([coat, jerkin, buckler], 'k');

		expect(report.package.items.map((item) => [item.key, item.category, item.armor])).toEqual([
			['dragonscale-coat-tdcsr', 'armor', 'dragonscale-coat-tdcsr'],
			['silk-jerkin-tdcsr', 'armor', 'silk-jerkin-tdcsr'],
			['oak-buckler-tdcsr', 'armor', 'oak-buckler-tdcsr'],
		]);
		expect(report.package.armor).toEqual([
			{
				key: 'dragonscale-coat-tdcsr',
				name: 'Dragonscale Coat',
				acBase: 14,
				acAddDexMod: true,
				acCapDexMod: 2,
				strengthScoreRequired: 13,
				grantsStealthDisadvantage: true,
			},
			{
				key: 'silk-jerkin-tdcsr',
				name: 'Silk Jerkin',
				acBase: 11,
				acAddDexMod: true,
				acCapDexMod: null,
				strengthScoreRequired: null,
				grantsStealthDisadvantage: false,
			},
			{
				key: 'oak-buckler-tdcsr',
				name: 'Oak Buckler',
				acBase: 2,
				acAddDexMod: false,
				acCapDexMod: null,
				strengthScoreRequired: null,
				grantsStealthDisadvantage: false,
			},
		]);
		expect(report.package.weapons).toEqual([]);
	});

	/** A bow's range rides on its ammunition property, as the shipped catalogue writes it. */
	it('gives an ammunition weapon its range', () => {
		const bow = note(
			'CLI/items/elm-bow-tdcsr.md',
			'json5e-item',
			"# Elm Bow\n*Martial weapon*\n\n- **Damage**: 1d8 piercing\n- **Range**: 150/600\n- **Properties**: [Ammunition](rules/item-properties.md#Ammunition), [Heavy](rules/item-properties.md#Heavy)\n- **Cost**: 50 gp\n\n*Source: Tal'Dorei Campaign Setting Reborn p. 5*",
			['ttrpg-cli/item/rarity/none'],
		);

		const [weapon] = assemblePackage([bow], 'k').package.weapons;

		expect(weapon?.range).toBe(150);
		expect(weapon?.longRange).toBe(600);
		expect(weapon?.properties).toEqual([
			{ property: 'srd-2024_ammunition-wp', detail: 'Range 150/600' },
			{ property: 'srd-2024_heavy-wp', detail: null },
		]);
	});

	/** A field left blank is read as blank, never as the number on the line after it. */
	it('does not read a blank strength line from the next line', () => {
		const plate = note(
			'CLI/items/odd-plate-tdcsr.md',
			'json5e-item',
			"# Odd Plate\n*Heavy armor*\n\n- **Armor Class**: 17\n- **Strength**:\n- **Cost**: 900 gp\n\n*Source: Tal'Dorei Campaign Setting Reborn p. 6*",
			['ttrpg-cli/item/rarity/none'],
		);

		const [armor] = assemblePackage([plate], 'k').package.armor;

		expect(armor?.acBase).toBe(17);
		expect(armor?.acAddDexMod).toBe(false);
		expect(armor?.strengthScoreRequired).toBeNull();
	});

	/** Tome ships the SRD's gear, so an SRD-marked item is left out like any other kind. */
	it('leaves out SRD equipment unless asked', () => {
		const rope = note(
			'CLI/items/rope-xphb.md',
			'json5e-item',
			`# Rope\n*Adventuring gear*\n\n- **Cost**: 1 gp\n\nTie a knot.\n\n${srdSource}`,
			['ttrpg-cli/item/rarity/none'],
		);

		const skipped = assemblePackage([rope], 'k');
		expect(skipped.alreadyShipped).toBe(1);
		expect(skipped.counts.items).toBe(0);
		expect(assemblePackage([rope], 'k', { includeSrdContent: true }).counts.items).toBe(1);
	});

	/** One oddly named picture must not stop a whole book's import. */
	it('imports equipment whose picture path has a stray percent sign', () => {
		const flyer = note(
			'CLI/items/sale-flyer-xphb.md',
			'json5e-item',
			"# Sale Flyer\n*Adventuring gear*\n\n![](img/50%off.png)\n\nHalf price.\n\n*Source: Player's Handbook (2024) p. 228*",
			['ttrpg-cli/item/rarity/none'],
		);

		const report = assemblePackage([flyer], 'k');
		expect(report.counts.items).toBe(1);
		expect(report.failed).toEqual([]);
	});

	/** A vault holds session notes and daily notes; those are not a failure. */
	it('ignores notes that are not compendium entries', () => {
		const withNoise = assemblePackage(
			[species, { path: 'Journal/2026-08-14.md', content: '# Session 12', frontmatter: null }],
			'k',
			{ includeSrdContent: true },
		);

		expect(withNoise.failed).toEqual([]);
		expect(withNoise.counts.species).toBe(1);
	});

	/** And an index note is a listing, not a thing that failed to parse. */
	it('ignores index notes', () => {
		const withIndex = assemblePackage(
			[species, note('CLI/races/races.md', 'json5e-index', '# Index of Races\n\n- [Aasimar](./aasimar-xphb.md)')],
			'k',
		);

		expect(withIndex.failed).toEqual([]);
	});

	/**
	 * The one thing that must not be silent. A note the scanner said was a species
	 * and the parser could not read is a bug in the parser, and hiding it turns a
	 * 391-spell import into a 388-spell one that looks complete.
	 */
	it('reports a recognised note that will not parse', () => {
		const broken = assemblePackage(
			[note('CLI/races/broken.md', 'json5e-race', '# Broken\n\nNo size and no traits.')],
			'k',
		);

		expect(broken.failed).toEqual(['CLI/races/broken.md']);
		expect(broken.counts.species).toBe(0);
	});

	it('reports a note whose parser throws and still assembles the rest', () => {
		vi.mocked(parseFeat).mockImplementationOnce(() => {
			throw new Error('boom');
		});

		const report = assemblePackage([feat, spell], 'k', { includeSrdContent: true });

		expect(report.failed).toEqual(['CLI/feats/alert-xphb.md']);
		expect(report.counts.spells).toBe(1);
	});

	/**
	 * The default that decides what an import is worth. Tome ships SRD 5.2 and every
	 * campaign composes on top of it, so importing the SRD again gives a campaign two
	 * of everything - and overriding instead would be worse, since the shipped spells
	 * carry damage and saving-throw data this parser deliberately does not scrape.
	 *
	 * The four fixtures at the top are all SRD-marked, so the default leaves the
	 * package empty. That is the correct answer for a compendium that is entirely
	 * SRD: there is nothing in it Tome does not already have.
	 */
	it('leaves out SRD content by default, because Tome already ships it', () => {
		const skipped = assemblePackage([species, background, feat, spell], 'k');

		expect(skipped.alreadyShipped).toBe(4);
		expect(isEmpty(skipped)).toBe(true);
	});

	it('keeps content that is not SRD-marked', () => {
		const own = note('CLI/feats/homebrew.md', 'json5e-feat', '# Homebrew\n\nMy own feat.', [
			'ttrpg-cli/feat',
		]);

		const mixed = assemblePackage([spell, own], 'k');

		expect(mixed.counts.feats).toBe(1);
		expect(mixed.counts.spells).toBe(0);
		expect(mixed.alreadyShipped).toBe(1);
	});

	/** The escape hatch: someone who wants their own text over the shipped catalogue. */
	it('includes SRD content when asked', () => {
		const forced = assemblePackage([species, background, feat, spell], 'k', {
			includeSrdContent: true,
		});

		expect(forced.counts).toEqual({ species: 1, backgrounds: 1, feats: 1, spells: 1, subclasses: 0, items: 0 });
		expect(forced.alreadyShipped).toBe(0);
	});

	it('names the books in the package source', () => {
		expect(report.package.source).toBe("Player's Handbook (2024)");
	});

	it('falls back to a name when a note has no title', () => {
		const untitled = assemblePackage(
			[note('CLI/feats/savage-attacker-xphb.md', 'json5e-feat', 'You strike hard.', ['ttrpg-cli/feat'])],
			'k',
		);

		// The source suffix is dropped, so the filename reads as the printed name.
		expect(untitled.package.feats[0]?.name).toBe('Savage Attacker');
	});
});

describe('describeCounts', () => {
	it('reads as a sentence, zeroes left out', () => {
		expect(describeCounts({ spells: 391, feats: 1, species: 0 })).toBe('391 spells, 1 feat');
	});

	/** The reason the nouns are a table rather than an appended `s`. */
	it('does not pluralise species', () => {
		expect(describeCounts({ species: 10 })).toBe('10 species');
		expect(describeCounts({ species: 1 })).toBe('1 species');
	});

	it.each([
		[{ class: 12 }, '12 classes'],
		[{ 'optional-feature': 58 }, '58 optional features'],
	])('describes %o', (counts, expected) => {
		expect(describeCounts(counts)).toBe(expected);
	});

	it('is empty when nothing was found', () => {
		expect(describeCounts({ spells: 0 })).toBe('');
	});
});

describe('packageKeyFrom', () => {
	/**
	 * Must satisfy the manifest's key rule, or a folder called "CLI Output"
	 * prefills a key the form immediately refuses.
	 */
	it.each([
		['CLI Output', 'cli-output'],
		["Player's Handbook (2024)", 'player-s-handbook-2024'],
		['already-fine', 'already-fine'],
	])('%s -> %s', (name, expected) => {
		expect(packageKeyFrom(name)).toBe(expected);
	});

	it.each([[''], ['   '], ['!!!']])('falls back for %o', (name) => {
		expect(packageKeyFrom(name)).toBe('my-compendium');
	});
});

describe('isEmpty', () => {
	it('is true when nothing was found', () => {
		expect(isEmpty(assemblePackage([], 'k'))).toBe(true);
	});

	it('is false once anything parsed', () => {
		expect(isEmpty(assemblePackage([species], 'k', { includeSrdContent: true }))).toBe(false);
	});
});


