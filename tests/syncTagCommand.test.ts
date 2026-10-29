import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ TFolder: class {} }));
vi.mock('../src/syncVaultToTome', () => ({ runVaultSync: vi.fn() }));
vi.mock('../src/syncFolderToTome', () => ({ runFolderExport: vi.fn() }));
vi.mock('../src/importContentSource', () => ({ runContentImport: vi.fn() }));
vi.mock('../src/adventure/sendAdventureToTome', () => ({ runAdventureFolderImport: vi.fn() }));

import type { Command } from 'obsidian';
import { registerSyncCommands } from '../src/syncVaultCommands';
import { runVaultSync } from '../src/syncVaultToTome';

function setup(syncTag: string) {
	const commands = new Map<string, Command>();
	const openAtSyncTag = vi.fn();
	const plugin = {
		settings: { syncTag },
		settingTab: { openAtSyncTag },
		addCommand: (c: Command) => commands.set(c.id, c),
		registerEvent: vi.fn(),
		app: {
			workspace: { on: vi.fn(), onLayoutReady: vi.fn(), getActiveFile: () => null },
			metadataCache: { on: vi.fn() },
			vault: { on: vi.fn() },
		},
	};
	registerSyncCommands(plugin as never);
	return { command: commands.get('send-tagged-to-tome'), openAtSyncTag };
}

describe('send notes with the sync tag command', () => {
	beforeEach(() => vi.clearAllMocks());

	it('is always in the palette, even with no tag set', () => {
		const { command } = setup('');
		// A plain callback is always listed; a checkCallback could hide it.
		expect(command?.checkCallback).toBeUndefined();
		expect(command?.callback).toBeTypeOf('function');
	});

	it('opens the settings at the sync tag field when no tag is set', () => {
		const { command, openAtSyncTag } = setup('  ');
		command?.callback?.();
		expect(openAtSyncTag).toHaveBeenCalledOnce();
		expect(runVaultSync).not.toHaveBeenCalled();
	});

	it('sends the tagged notes when a tag is set', () => {
		const { command, openAtSyncTag } = setup('#tome');
		command?.callback?.();
		expect(runVaultSync).toHaveBeenCalledWith(expect.anything(), { kind: 'tag', tag: '#tome' });
		expect(openAtSyncTag).not.toHaveBeenCalled();
	});
});
