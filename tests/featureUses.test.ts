import { describe, expect, it, vi } from 'vitest';

import type { Note } from '../src/recognizers/note';
import { assemblePackage } from '../src/recognizers/compendium/package';

/** The block TomeVTT's ADR-0016 gives for Portent, word for word. */
const PORTENT_USES = {
	cost: 'none',
	summary: 'Replace a d20 roll with a foretelling roll.',
	tiers: [
		{ from: 3, count: { fixed: 2 }, shortRest: 'none' },
		{ from: 14, count: { fixed: 3 }, shortRest: 'none' },
	],
};

function diviner(portentBody: string): Note {
	return {
		path: 'CLI/classes/wizard-xphb-diviner-xphb.md',
		frontmatter: {
			cssclasses: ['json5e-class'],
			tags: ['ttrpg-cli/compendium/src/5e/xphb', 'ttrpg-cli/subclass/wizard/diviner'],
		},
		content: `# Diviner
*[Wizard](./wizard-xphb.md): Wizard Subclass*
*Source: Player's Handbook (2024) p. 179*

*Learn the Secrets of the Multiverse*

## Subclass Features

### Portent (Level 3)

${portentBody}

### Expert Divination (Level 6)

Casting Divination spells comes so easily to you.`,
	};
}

const portentProse =
	'Glimpses of the future begin to press on your awareness. Whenever you finish a Long Rest, roll two d20s.';

function featuresOf(note: Note) {
	const report = assemblePackage([note], 'my-books');
	return { report, features: report.package.classes[0]?.subclasses[0]?.features ?? [] };
}

describe('a feature whose note states its uses', () => {
	it('carries the block ADR-0016 shows for Portent', () => {
		const { features } = featuresOf(
			diviner(`${portentProse}

\`\`\`tome-uses
${JSON.stringify(PORTENT_USES, null, 2)}
\`\`\``),
		);

		expect(features[0]?.name).toBe('Portent');
		expect(features[0]?.uses).toEqual(PORTENT_USES);
	});

	it('keeps the block out of the feature text', () => {
		const { features } = featuresOf(
			diviner(`${portentProse}\n\n\`\`\`tome-uses\n${JSON.stringify(PORTENT_USES)}\n\`\`\``),
		);

		expect(features[0]?.desc).toBe(portentProse);
	});

	it('puts tiers in increasing level order, since Tome refuses any other', () => {
		const reversed = { ...PORTENT_USES, tiers: [...PORTENT_USES.tiers].reverse() };
		const { features } = featuresOf(
			diviner(`${portentProse}\n\n\`\`\`tome-uses\n${JSON.stringify(reversed)}\n\`\`\``),
		);

		expect(features[0]?.uses?.tiers.map((tier) => tier.from)).toEqual([3, 14]);
	});

	it('accepts every count kind the ADR names', () => {
		const counts = [
			{ fixed: 1 },
			{ proficiency: true },
			{ modifier: 'wis' },
			{ perLevel: 5 },
			{ unlimited: true },
		];
		const uses = {
			cost: 'bonus',
			summary: 'Every kind.',
			tiers: counts.map((count, index) => ({ from: index + 1, count, shortRest: 'one' })),
		};
		const { features } = featuresOf(
			diviner(`\`\`\`tome-uses\n${JSON.stringify(uses)}\n\`\`\``),
		);

		expect(features[0]?.uses).toEqual(uses);
	});
});

describe('a feature whose note states nothing', () => {
	it('carries no uses block at all', () => {
		const { features } = featuresOf(diviner(portentProse));

		expect(features).toHaveLength(2);
		for (const feature of features) expect(feature).not.toHaveProperty('uses');
	});
});

describe('a uses block Tome would refuse', () => {
	it.each([
		['is not JSON', '{ cost: none'],
		['has an unknown cost', JSON.stringify({ ...PORTENT_USES, cost: 'free' })],
		['has no summary', JSON.stringify({ cost: 'none', tiers: PORTENT_USES.tiers })],
		['has no tiers', JSON.stringify({ ...PORTENT_USES, tiers: [] })],
		[
			'has two tiers at one level',
			JSON.stringify({ ...PORTENT_USES, tiers: [PORTENT_USES.tiers[0], PORTENT_USES.tiers[0]] }),
		],
		[
			'starts a tier past level 20',
			JSON.stringify({ ...PORTENT_USES, tiers: [{ from: 21, count: { fixed: 2 }, shortRest: 'none' }] }),
		],
		[
			'has an unknown refill',
			JSON.stringify({ ...PORTENT_USES, tiers: [{ from: 3, count: { fixed: 2 }, shortRest: 'some' }] }),
		],
		[
			'has an unknown count kind',
			JSON.stringify({ ...PORTENT_USES, tiers: [{ from: 3, count: { column: 'Rages' }, shortRest: 'none' }] }),
		],
		[
			'has a fixed count out of range',
			JSON.stringify({ ...PORTENT_USES, tiers: [{ from: 3, count: { fixed: 100 }, shortRest: 'none' }] }),
		],
		[
			'has a count with two kinds',
			JSON.stringify({ ...PORTENT_USES, tiers: [{ from: 3, count: { fixed: 2, proficiency: true }, shortRest: 'none' }] }),
		],
		[
			'names an unknown ability',
			JSON.stringify({ ...PORTENT_USES, tiers: [{ from: 3, count: { modifier: 'luck' }, shortRest: 'none' }] }),
		],
	])('leaves the subclass out and names its note when the block %s', (_, block) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const note = diviner(`${portentProse}\n\n\`\`\`tome-uses\n${block}\n\`\`\``);

		const { report } = featuresOf(note);

		expect(report.failed).toEqual([note.path]);
		expect(report.package.classes).toEqual([]);
		expect(String(error.mock.calls[0]?.[1])).toContain('Portent');
		error.mockRestore();
	});
});
