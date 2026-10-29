import { describe, expect, it } from 'vitest';
import { parseAdventure } from '../src/adventure/adventureParser';
import { suggestMapsBySize } from '../src/adventure/adventureImageSuggestions';
import { summariseImport } from '../src/adventure/adventureReviewRows';

function adventure(content = '![Hall](art/hall.png)') {
	return parseAdventure({ folder: 'test', title: 'Test', summary: null, chapters: [{ title: 'Hall', content }] });
}

describe('size-based image suggestions before review', () => {
	it.each([
		[1000, 600, 'Map'], [2400, 1600, 'Map'],
		[999, 600, 'Prop'], [1600, 599, 'Prop'],
		[1200, 1200, 'Prop'], [1200, 1800, 'Prop'], [0, 0, 'Prop'],
	] as const)('suggests %s × %s as %s', async (width, height, to) => {
		const plan = adventure();
		await suggestMapsBySize(plan, async () => ({ width, height }));
		expect(plan.images[0]?.suggested.to).toBe(to);
		expect(plan.images[0]?.chosen.to).toBe(to);
	});

	it('allows a guessed map to be changed for sending', async () => {
		const plan = adventure();
		await suggestMapsBySize(plan, async () => ({ width: 1600, height: 1000 }));
		expect(summariseImport(plan)).toBe('This will create 1 map, 1 adventure.');
		plan.images[0]!.chosen = { to: 'Prop' };
		expect(summariseImport(plan)).toBe('This will create 1 prop, 1 adventure.');
		plan.images[0]!.chosen = { to: 'skip' };
		expect(summariseImport(plan)).toBe('This will create 1 adventure.');
	});

	it('respects explicit props and existing map signals', async () => {
		const plan = adventure('> [!prop]\n> ![Art](art/hall.png)\n\n![Map](art/tiny.png)');
		await suggestMapsBySize(plan, async () => ({ width: 1600, height: 1000 }));
		expect(plan.images.map((image) => image.chosen.to)).toEqual(['Prop', 'Map']);
	});

	it('respects an explicit prop even after an earlier ordinary mention', async () => {
		const plan = adventure('![Hall](art/hall.png)\n\n> [!prop]\n> ![Hall](art/hall.png)');
		await suggestMapsBySize(plan, async () => ({ width: 1600, height: 1000 }));
		expect(plan.images).toHaveLength(1);
		expect(plan.images[0]?.chosen.to).toBe('Prop');
	});

	it('keeps unreadable images as props and continues with later images', async () => {
		const plan = adventure('![Missing](art/missing.png)\n\n![Hall](art/hall.png)');
		await suggestMapsBySize(plan, async (path) => {
			if (path.endsWith('missing.png')) throw new Error('Cannot decode image');
			return { width: 1600, height: 1000 };
		});
		expect(plan.images.map((image) => image.chosen.to)).toEqual(['Prop', 'Map']);
	});
});
