import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
	TFolder: class {},
	TFile: class {},
	Platform: { isDesktopApp: true },
}));
vi.mock('../src/syncVaultToTome', () => ({ runVaultSync: vi.fn() }));
vi.mock('../src/syncFolderToTome', () => ({ runFolderExport: vi.fn() }));
vi.mock('../src/importContentSource', () => ({ runContentImport: vi.fn() }));
vi.mock('../src/adventure/sendAdventureToTome', () => ({ runAdventureFolderImport: vi.fn() }));

import { TFile } from 'obsidian';
import { registerSyncCommands } from '../src/syncVaultCommands';
import { runVaultSync } from '../src/syncVaultToTome';

const note = (path: string) => Object.assign(new TFile(), { path, extension: 'md' });

type Handler = (...args: unknown[]) => unknown;

const STATBLOCK = ['~~~statblock', 'name: Goblin', '~~~'].join('\n');
const DATAVIEW = ['~~~dataview', 'LIST', '~~~'].join('\n');

/**
 * A plugin whose app records each event handler by name, so a test can fire the
 * events Obsidian would and then open a file's menu.
 */
function setup(files: { file: TFile; read: () => Promise<string> }[] = []) {
	const handlers = new Map<string, Handler[]>();
	const live = new Set(files.map(({ file }) => file.path));
	let layoutReady: () => Promise<void> = async () => {};
	const on = (name: string, handler: Handler) => {
		handlers.set(name, [...(handlers.get(name) ?? []), handler]);
	};
	const plugin = {
		settings: { syncTag: '' },
		addCommand: vi.fn(),
		registerEvent: vi.fn(),
		app: {
			workspace: {
				on,
				onLayoutReady: (run: () => Promise<void>) => (layoutReady = run),
				getActiveFile: () => null,
			},
			// Every given note is one the cache files a code section in.
			metadataCache: { on, getFileCache: () => ({ sections: [{ type: 'code' }] }) },
			vault: {
				on,
				getMarkdownFiles: () => files.map(({ file }) => file),
				cachedRead: (file: TFile) => files.find((f) => f.file === file)!.read(),
				getFileByPath: (path: string) => (live.has(path) ? {} : null),
			},
		},
	};
	registerSyncCommands(plugin as never);

	const fire = (name: string, ...args: unknown[]) => {
		if (name === 'delete') live.delete((args[0] as { path: string }).path);
		handlers.get(name)?.forEach((h) => h(...args));
	};
	const menuTitles = (file: TFile) => {
		const titles: string[] = [];
		const item = { setTitle: (t: string) => (titles.push(t), item), setIcon: () => item, onClick: () => item };
		fire('file-menu', { addItem: (build: (i: typeof item) => void) => build(item) }, file);
		return titles;
	};
	return { fire, menuTitles, startUp: () => layoutReady() };
}

describe('"Send this note to Tome" on a note\'s menu', () => {
	it('shows on a note with a statblock fence and not on one with only dataview', () => {
		const { fire, menuTitles } = setup();
		const goblin = note('Goblin.md');
		const index = note('Index.md');
		fire('changed', goblin, STATBLOCK);
		fire('changed', index, DATAVIEW);

		expect(menuTitles(goblin)).toContain('Send this note to Tome');
		expect(menuTitles(index)).not.toContain('Send this note to Tome');
	});

	it('hides once the fence is edited away', () => {
		const { fire, menuTitles } = setup();
		const goblin = note('Goblin.md');
		fire('changed', goblin, STATBLOCK);
		fire('changed', goblin, 'Just prose now.');

		expect(menuTitles(goblin)).not.toContain('Send this note to Tome');
	});

	it('follows a renamed note and forgets a deleted one', () => {
		const { fire, menuTitles } = setup();
		const goblin = note('Goblin.md');
		fire('changed', goblin, STATBLOCK);
		const renamed = note('Monsters/Goblin.md');
		fire('rename', renamed, 'Goblin.md');

		expect(menuTitles(renamed)).toContain('Send this note to Tome');
		expect(menuTitles(goblin)).not.toContain('Send this note to Tome');

		fire('delete', renamed);
		expect(menuTitles(renamed)).not.toContain('Send this note to Tome');
	});

	it('sends just that note', () => {
		const { fire } = setup();
		const goblin = note('Goblin.md');
		fire('changed', goblin, STATBLOCK);
		const item = { setTitle: () => item, setIcon: () => item, onClick: (run: () => void) => (run(), item) };
		fire('file-menu', { addItem: (build: (i: typeof item) => void) => build(item) }, goblin);

		expect(runVaultSync).toHaveBeenCalledWith(expect.anything(), { kind: 'note', note: goblin });
	});
});

/** A read that finishes only when the test says, so events can arrive while it runs. */
function heldRead() {
	let finish: (text: string) => void = () => {};
	const promise = new Promise<string>((resolve) => (finish = resolve));
	return { read: () => promise, finish };
}

describe('"Send this note to Tome" for notes indexed in an earlier session', () => {
	it('shows on a note with a statblock fence once the layout is ready', async () => {
		const goblin = note('Goblin.md');
		const { menuTitles, startUp } = setup([{ file: goblin, read: () => Promise.resolve(STATBLOCK) }]);

		expect(menuTitles(goblin)).not.toContain('Send this note to Tome');
		await startUp();

		expect(menuTitles(goblin)).toContain('Send this note to Tome');
	});

	it('keeps an edit reported while the startup read runs over the older text', async () => {
		const goblin = note('Goblin.md');
		const held = heldRead();
		const { fire, menuTitles, startUp } = setup([{ file: goblin, read: held.read }]);

		const started = startUp();
		fire('changed', goblin, 'Just prose now.');
		held.finish(STATBLOCK);
		await started;

		expect(menuTitles(goblin)).not.toContain('Send this note to Tome');
	});

	it('leaves out a note deleted while the startup read runs', async () => {
		const goblin = note('Goblin.md');
		const held = heldRead();
		const { fire, menuTitles, startUp } = setup([{ file: goblin, read: held.read }]);

		const started = startUp();
		fire('delete', goblin);
		held.finish(STATBLOCK);
		await started;

		expect(menuTitles(goblin)).not.toContain('Send this note to Tome');
	});
});
