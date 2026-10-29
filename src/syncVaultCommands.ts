import { TFile, TFolder, type Menu, type MenuItem } from 'obsidian';

import { declaresStatblock } from './recognizers/noteScan';

import type TomeConnectorPlugin from './main';
import { runAdventureFolderImport } from './adventure/sendAdventureToTome';
import { runContentImport } from './importContentSource';
import { referenceMenuEntry } from './syncFolderToTome';
import { runVaultSync } from './syncVaultToTome';

/**
 * The command-palette and context-menu entry points for a bulk sync.
 *
 * **The plugin registered no commands at all before this.** Everything was a
 * button on a rendered block or a folder right-click, which meant nothing was
 * reachable from the palette, nothing could be given a hotkey, and there was no
 * way to act on more than one thing at a time.
 *
 * Kept apart from `syncVaultToTome.ts` so that file stays about scanning and
 * sending rather than about how it gets started.
 */
export function registerSyncCommands(plugin: TomeConnectorPlugin): void {
	registerSendCommands(plugin);
	registerImportCommands(plugin);
	registerFolderMenu(plugin);
	registerNoteMenu(plugin);
}

/**
 * A command on the active note's folder. `checkCallback` so the command hides itself
 * when there is no active note to take a folder from, rather than appearing and then
 * complaining.
 */
function folderCommand(
	plugin: TomeConnectorPlugin,
	id: string,
	name: string,
	run: (folder: TFolder) => Promise<void>,
): void {
	plugin.addCommand({
		id,
		name,
		checkCallback: (checking: boolean) => {
			const folder = plugin.app.workspace.getActiveFile()?.parent;
			if (!folder) return false;
			if (!checking) void run(folder);
			return true;
		},
	});
}

/** Sending notes to the libraries: one request per creature, encounter or map. */
function registerSendCommands(plugin: TomeConnectorPlugin): void {
	plugin.addCommand({
		id: 'send-vault-to-tome',
		name: 'Send everything in this vault to Tome',
		callback: () => {
			void runVaultSync(plugin, { kind: 'vault' });
		},
	});

	folderCommand(plugin, 'send-folder-to-tome', 'Send the current note’s folder to Tome', (folder) =>
		runVaultSync(plugin, { kind: 'folder', folder }),
	);

	plugin.addCommand({
		id: 'send-tagged-to-tome',
		name: 'Send notes with the sync tag to Tome',
		callback: () => {
			const tag = plugin.settings.syncTag.trim();
			if (tag === '') plugin.settingTab.openAtSyncTag();
			else void runVaultSync(plugin, { kind: 'tag', tag });
		},
	});
}

/** Importing a compendium as a ruleset: one request for the lot. */
function registerImportCommands(plugin: TomeConnectorPlugin): void {
	folderCommand(
		plugin,
		'import-content-source-from-folder',
		'Import the current note’s folder as a content source',
		(folder) => runContentImport(plugin, { kind: 'folder', folder }),
	);

	plugin.addCommand({
		id: 'import-content-source-from-vault',
		name: 'Import this vault as a content source',
		callback: () => {
			void runContentImport(plugin, { kind: 'vault' });
		},
	});

	folderCommand(
		plugin,
		'import-adventure-from-folder',
		'Import the current note’s folder as a Storybook adventure',
		(folder) => runAdventureFolderImport(plugin, folder),
	);
}

// Obsidian's Menu API has a working but untyped submenu.
type SubmenuItem = MenuItem & { setSubmenu(): Menu };

/**
 * One "Tome" entry on a folder's menu, opening a submenu of the four imports.
 * Which entries apply is not decidable without scanning the folder, so all show;
 * grouping keeps the top-level menu to a single line. Each names what it sends:
 * "Import Library items to Tome" scans every note and fans each one out to
 * whichever library it belongs in, where the others turn the whole folder into
 * a single row in one library.
 */
function registerFolderMenu(plugin: TomeConnectorPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFolder)) return;

			const entries: [string, string, (folder: TFolder) => Promise<void>][] = [
				...referenceMenuEntry(plugin),
				['Import Library items to Tome', 'upload-cloud', (folder) => runVaultSync(plugin, { kind: 'folder', folder })],
				['Import as a Tome content source', 'book-open', (folder) => runContentImport(plugin, { kind: 'folder', folder })],
				['Import as a Tome Storybook adventure', 'book-marked', (folder) => runAdventureFolderImport(plugin, folder)],
			];
			menu.addItem((top) => {
				top.setTitle('Tome').setIcon('upload-cloud');
				const sub = (top as SubmenuItem).setSubmenu();
				for (const [title, icon, run] of entries) {
					sub.addItem((item) => {
						item.setTitle(title).setIcon(icon).onClick(() => void run(file));
					});
				}
			});
		}),
	);
}

/**
 * "Send this note to Tome" on a note that may hold a statblock, encounter or map block.
 *
 * `file-menu` handlers are synchronous and the metadata cache does not say which
 * language a code block is in, so the check is frontmatter declaring a statblock or
 * any fenced code block. ponytail: a note with only an unrelated code block still
 * shows the item, and the confirm dialog then says there is nothing to send.
 */
function registerNoteMenu(plugin: TomeConnectorPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			const cache = plugin.app.metadataCache.getFileCache(file);
			const mayHoldBlock =
				declaresStatblock(cache?.frontmatter ?? null) ||
				cache?.sections?.some((section) => section.type === 'code');
			if (!mayHoldBlock) return;

			menu.addItem((item) => {
				item.setTitle('Send this note to Tome')
					.setIcon('upload-cloud')
					// A folder scope whose path is the note's own path reads just that note.
					.onClick(() => void runVaultSync(plugin, { kind: 'folder', folder: file }));
			});
		}),
	);
}
