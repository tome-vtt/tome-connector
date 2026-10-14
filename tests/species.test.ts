import { describe, expect, it } from 'vitest';

import { parseSpecies, readSize, readSpeed } from '../src/recognizers/compendium/species';
import { slug } from '../src/recognizers/labelledMarkdown';

/** `races/aasimar-xphb.md`, trimmed but structurally exact. */
const aasimar = `---
cssclasses:
- json5e-race
---
# Aasimar
*Source: Player's Handbook (2024) p. 186*
![](3-Mechanics/CLI/races/img/aasimar.webp#right)

- **Ability Scores**: None
- **Type**: humanoid
- **Size**: Small or Medium
- **Speed**: 30 ft.
- **Spellcasting**: Charisma

## Traits

### Celestial Resistance

You have [Resistance](3-Mechanics/CLI/rules/variant-rules/resistance-xphb.md) to Necrotic damage and Radiant damage.

### Darkvision

You have [Darkvision](3-Mechanics/CLI/rules/senses.md#Darkvision) with a range of 60 feet.

### Healing Hands

As a [Magic](3-Mechanics/CLI/rules/actions.md#Magic) action, you touch a creature and roll a number of d4s.

## Description

Aasimar are mortals who carry a spark of the Upper Planes within their souls.

They resemble their parents, but they live for up to 160 years.`;

describe('slug', () => {
	it.each([
		['Celestial Resistance', 'celestial-resistance'],
		["Storm's Thunder", 'storm-s-thunder'],
		['Darkvision', 'darkvision']
	])('%s -> %s', (input, expected) => {
		expect(slug(input)).toBe(expected);
	});
});

describe('readSize', () => {
	it.each([
		['Medium', 'Medium'],
		['Small', 'Small'],
		['Tiny', 'Tiny']
	])('reads %s', (input, expected) => {
		expect(readSize(input)).toBe(expected);
	});

	/**
	 * Three of the ten species offer a choice and the model holds one value, so
	 * the larger wins - defaulting to Medium and being changed down is the
	 * ordinary case. The sentence survives in sizeDetail either way.
	 */
	it('takes the larger of a choice', () => {
		expect(readSize('Small or Medium')).toBe('Medium');
	});

	it.each([[undefined], [''], ['see below']])('is null for %o', (input) => {
		expect(readSize(input)).toBeNull();
	});
});

describe('readSpeed', () => {
	it.each([
		['30 ft.', 30],
		['35 ft.', 35],
		['30 feet, fly 30 ft.', 30]
	])('%s -> %o', (input, expected) => {
		expect(readSpeed(input)).toBe(expected);
	});

	it('is null when there is no number', () => {
		expect(readSpeed('varies')).toBeNull();
	});
});

describe('parseSpecies', () => {
	const parsed = parseSpecies(aasimar, 'aasimar-xphb', 'Aasimar');

	it('reads the name from the title, not the filename', () => {
		expect(parsed?.name).toBe('Aasimar');
	});

	/**
	 * The key comes from the filename because the CLI's names drop the source
	 * suffix - two books' Elves would collide on "elf" otherwise.
	 */
	it('keeps the key it was given', () => {
		expect(parsed?.key).toBe('aasimar-xphb');
	});

	it('reads size and speed, keeping the printed form alongside', () => {
		expect(parsed?.size).toBe('Medium');
		expect(parsed?.sizeDetail).toBe('Small or Medium');
		expect(parsed?.speed).toBe(30);
		expect(parsed?.speedDetail).toBe('30 ft.');
	});

	it('takes the description from its own section', () => {
		expect(parsed?.desc).toContain('spark of the Upper Planes');
		expect(parsed?.desc).toContain('160 years');
		// Not the traits, which are a separate section.
		expect(parsed?.desc).not.toContain('Celestial Resistance');
	});

	it('reads every trait in order, with the links flattened', () => {
		expect(parsed?.traits.map((trait) => trait.name)).toEqual([
			'Celestial Resistance',
			'Darkvision',
			'Healing Hands'
		]);
		expect(parsed?.traits[1]?.desc).toBe('You have Darkvision with a range of 60 feet.');
		expect(parsed?.traits.map((trait) => trait.order)).toEqual([1, 2, 3]);
		expect(parsed?.traits[0]?.key).toBe('celestial-resistance');
	});

	/**
	 * The honest ceiling on scraping prose. Grants carry a free skill, an origin
	 * feat, a hit-point bonus and a lineage trait, and the CLI states none of them
	 * structurally - Elf's lineages are a table inside a trait's prose and Human's
	 * origin feat is a sentence. Pinned as a decision: a species that silently
	 * hands out the wrong proficiency is harder to notice than one that hands out
	 * none.
	 */
	it('grants nothing, because the source does not say what to grant', () => {
		expect(parsed?.grants).toEqual({});
		expect(parsed?.lineages).toEqual([]);
	});

	it('falls back to the given name when the note has no title', () => {
		const noTitle = parseSpecies('- **Size**: Medium\n\n## Traits\n\n### X\n\nY', 'k', 'Fallback');

		expect(noTitle?.name).toBe('Fallback');
	});

	it('reads a species with no description section', () => {
		const bare = parseSpecies('# Orc\n\n- **Size**: Medium\n\n## Traits\n\n### Adrenaline Rush\n\nYou dash.', 'orc', 'Orc');

		expect(bare?.desc).toBe('');
		expect(bare?.traits).toHaveLength(1);
	});

	it('returns null for a note with neither a size nor a trait', () => {
		expect(parseSpecies('# Notes\n\nJust prose.', 'notes', 'Notes')).toBeNull();
	});

	/** A species stating only traits is still a species; only the size is optional. */
	it('accepts a note with traits but no size', () => {
		const traitsOnly = parseSpecies('# Thing\n\n## Traits\n\n### Tough\n\nYou endure.', 'thing', 'Thing');

		expect(traitsOnly?.size).toBeNull();
		expect(traitsOnly?.traits).toHaveLength(1);
	});
});
