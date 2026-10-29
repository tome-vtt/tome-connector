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

/** Opens a folder's menu and returns what the plugin put on it. */
function openFolderMenu(): FakeMenu {
	const handlers: ((menu: FakeMenu, file: unknown) => void)[] = [];
	const plugin = {
		settings: { syncTag: '' },
		addCommand: vi.fn(),
		registerEvent: vi.fn(),
		app: { workspace: { on: (_: string, h: (typeof handlers)[number]) => handlers.push(h) } },
	};
	registerSyncCommands(plugin as never);
	const menu = fakeMenu();
	for (const h of handlers) h(menu, new TFolder());
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
		menu.clicks[1]?.();
		expect(runContentImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'folder' }));
	});
});
