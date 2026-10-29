import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ isDesktopApp: true }));
vi.mock('obsidian', () => ({ TFile: class {}, TFolder: class {}, Platform: platform }));
vi.mock('../src/syncVaultToTome', () => ({ runVaultSync: vi.fn() }));
vi.mock('../src/syncFolderToTome', () => ({ runFolderExport: vi.fn() }));
vi.mock('../src/importContentSource', () => ({ runContentImport: vi.fn() }));
vi.mock('../src/adventure/sendAdventureToTome', () => ({ runAdventureFolderImport: vi.fn() }));

import { TFolder } from 'obsidian';
import { registerSyncCommands } from '../src/syncVaultCommands';
import { runContentImport } from '../src/importContentSource';
import { runVaultSync } from '../src/syncVaultToTome';
import { runFolderExport } from '../src/syncFolderToTome';
import { runAdventureFolderImport } from '../src/adventure/sendAdventureToTome';

interface FakeMenu {
	titles: string[];
	clicks: (() => void)[];
	submenus: FakeMenu[];
	addItem(cb: (item: unknown) => void): FakeMenu;
}

function fakeMenu(): FakeMenu {
	const menu: FakeMenu = {
		titles: [],
		clicks: [],
		submenus: [],
		addItem(cb) {
			const item = {
				setTitle: (t: string) => (menu.titles.push(t), item),
				setIcon: () => item,
				onClick: (f: () => void) => (menu.clicks.push(f), item),
				setSubmenu: () => {
					const sub = fakeMenu();
					menu.submenus.push(sub);
					return sub;
				},
			};
			cb(item);
			return menu;
		},
	};
	return menu;
}

const folder = new TFolder();

/** Opens a folder's menu and returns what the plugin put on it. */
function openFolderMenu(): FakeMenu {
	const handlers: ((menu: FakeMenu, file: unknown) => void)[] = [];
	const plugin = {
		settings: { syncTag: '' },
		addCommand: vi.fn(),
		registerEvent: vi.fn(),
		app: {
			workspace: { on: (_: string, h: (typeof handlers)[number]) => handlers.push(h), onLayoutReady: vi.fn() },
			metadataCache: { on: vi.fn() },
			vault: { on: vi.fn() },
		},
	};
	registerSyncCommands(plugin as never);
	const menu = fakeMenu();
	for (const h of handlers) h(menu, folder);
	return menu;
}

describe('the folder menu', () => {
	beforeEach(() => vi.clearAllMocks());

	it('groups the four Tome entries under one submenu on desktop', () => {
		platform.isDesktopApp = true;
		const menu = openFolderMenu();
		expect(menu.titles).toEqual(['Tome']);
		expect(menu.submenus[0]?.titles).toEqual([
			'Import as a Tome Reference',
			'Import Library items to Tome',
			'Import as a Tome content source',
			'Import as a Tome Storybook adventure',
		]);
	});

	it('lists the three mobile imports flat on mobile, where submenus do not open', () => {
		platform.isDesktopApp = false;
		const menu = openFolderMenu();
		expect(menu.submenus).toEqual([]);
		expect(menu.titles).toEqual([
			'Import Library items to Tome',
			'Import as a Tome content source',
			'Import as a Tome Storybook adventure',
		]);
	});

	it('runs the matching import with the folder for each desktop entry', () => {
		platform.isDesktopApp = true;
		const clicks = openFolderMenu().submenus[0]?.clicks ?? [];
		expect(clicks).toHaveLength(4);

		clicks[0]?.();
		expect(runFolderExport).toHaveBeenCalledWith(expect.anything(), folder);
		clicks[1]?.();
		expect(runVaultSync).toHaveBeenCalledWith(expect.anything(), { kind: 'folder', folder });
		clicks[2]?.();
		expect(runContentImport).toHaveBeenCalledWith(expect.anything(), { kind: 'folder', folder });
		clicks[3]?.();
		expect(runAdventureFolderImport).toHaveBeenCalledWith(expect.anything(), folder);
	});

	it('runs the matching import with the folder for each mobile entry', () => {
		platform.isDesktopApp = false;
		const { clicks } = openFolderMenu();
		expect(clicks).toHaveLength(3);

		clicks[0]?.();
		expect(runVaultSync).toHaveBeenCalledWith(expect.anything(), { kind: 'folder', folder });
		clicks[1]?.();
		expect(runContentImport).toHaveBeenCalledWith(expect.anything(), { kind: 'folder', folder });
		clicks[2]?.();
		expect(runAdventureFolderImport).toHaveBeenCalledWith(expect.anything(), folder);
		expect(runFolderExport).not.toHaveBeenCalled();
	});
});
