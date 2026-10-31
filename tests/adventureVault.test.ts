import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
	class TAbstractFile {
		constructor(public path: string) {}
		get name(): string {
			return this.path.split('/').pop()!;
		}
	}
	class TFile extends TAbstractFile {
		extension = 'md';
	}
	class TFolder extends TAbstractFile {
		children: TAbstractFile[] = [];
	}
	return { TFile, TFolder, normalizePath: (p: string) => p, parseYaml: () => null, getAllTags: () => [] };
});

import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { buildAdventurePlan } from '../src/adventure/adventureVault';

const sizes: Record<string, { width: number; height: number }> = {
	'res://art/scene.png': { width: 400, height: 300 },
	'res://art/dungeon.png': { width: 2400, height: 1600 },
};

/** Stands in for the browser's `<img>`: reports the size the header would give, or fails to load. */
class FakeImage {
	naturalWidth = 0;
	naturalHeight = 0;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	set src(url: string) {
		const size = sizes[url];
		queueMicrotask(() => {
			if (!size) return this.onerror?.();
			this.naturalWidth = size.width;
			this.naturalHeight = size.height;
			this.onload?.();
		});
	}
}

function adventureFolder(content: string): { app: App; folder: TFolder } {
	const folder = new (TFolder as unknown as new (path: string) => TFolder)('Adventure');
	const note = new (TFile as unknown as new (path: string) => TFile)('Adventure/01 Hall.md');
	folder.children = [note];
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => (path === note.path ? note : null),
			cachedRead: async () => content,
			adapter: { getResourcePath: (path: string) => `res://${path}` },
		},
		metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
	};
	return { app: app as unknown as App, folder };
}

describe('building the adventure plan', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('guesses a large landscape illustration is a map and never picks it as the cover', async () => {
		vi.stubGlobal('Image', FakeImage);
		// Picks the last of the pool, which is the dungeon until the size guess removes it.
		vi.spyOn(Math, 'random').mockReturnValue(0.99);
		const { app, folder } = adventureFolder('# Hall\n\n![Scene](art/scene.png)\n\n![Dungeon](art/dungeon.png)');

		const plan = await buildAdventurePlan(app, folder);

		expect(plan.images.map((image) => [image.dmPath, image.chosen.to])).toEqual([
			['art/scene.png', 'Prop'],
			['art/dungeon.png', 'Map'],
		]);
		expect(plan.coverKey).toBe('art/scene.png');
	});

	it('keeps an illustration that cannot be loaded as a prop', async () => {
		vi.stubGlobal('Image', FakeImage);
		const { app, folder } = adventureFolder('# Hall\n\n![Missing](art/missing.png)\n\n![Dungeon](art/dungeon.png)');

		const plan = await buildAdventurePlan(app, folder);

		expect(plan.images.map((image) => image.chosen.to)).toEqual(['Prop', 'Map']);
	});

	it('reports progress while the illustrations are checked', async () => {
		vi.stubGlobal('Image', FakeImage);
		const { app, folder } = adventureFolder('# Hall\n\n![Scene](art/scene.png)\n\n![Dungeon](art/dungeon.png)');
		const progress: [number, number][] = [];

		await buildAdventurePlan(app, folder, (done, total) => progress.push([done, total]));

		expect(progress).toEqual([
			[1, 2],
			[2, 2],
		]);
	});
});
