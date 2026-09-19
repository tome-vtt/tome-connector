import { describe, expect, it } from 'vitest';

import type { Note } from '../src/recognizers/note';
import {
	assemblePackage,
	describeCounts,
	isEmpty,
	packageKeyFrom,
} from '../src/recognizers/compendium/package';

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
		expect(report.counts).toEqual({ species: 1, backgrounds: 1, feats: 1, spells: 1, subclasses: 0 });
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
		const withItems = assemblePackage(
			[species, note('CLI/items/rope.md', 'json5e-item', '# Rope'), note('CLI/items/axe.md', 'json5e-item', '# Axe')],
			'k',
			{ includeSrdContent: true },
		);

		expect(withItems.unsupported).toEqual({ item: 2 });
		expect(withItems.counts.species).toBe(1);
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

		expect(forced.counts).toEqual({ species: 1, backgrounds: 1, feats: 1, spells: 1, subclasses: 0 });
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


