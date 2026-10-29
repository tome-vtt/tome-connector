import type TomeConnectorPlugin from './main';
import { hasSendableFence } from './recognizers/noteScan';

/**
 * Paths of the notes whose text holds a statblock, encounter or map fence.
 *
 * A `file-menu` handler is synchronous and the metadata cache does not say which
 * language a code block is in, so the answer has to be known before the menu opens.
 * Kept fresh from `changed`, which hands over the note's text, and filled once on
 * layout ready for notes indexed in an earlier session.
 */
export function watchSendableFences(plugin: TomeConnectorPlugin): ReadonlySet<string> {
	const { metadataCache, vault, workspace } = plugin.app;
	const paths = new Set<string>();
	// Notes `changed` has already reported, so the layout-ready read never overwrites newer text.
	const reported = new Set<string>();
	const update = (path: string, text: string) => {
		if (hasSendableFence(text)) paths.add(path);
		else paths.delete(path);
	};

	plugin.registerEvent(
		metadataCache.on('changed', (file, text) => {
			reported.add(file.path);
			update(file.path, text);
		}),
	);
	plugin.registerEvent(vault.on('delete', (file) => paths.delete(file.path)));
	plugin.registerEvent(
		vault.on('rename', (file, oldPath) => {
			if (paths.delete(oldPath)) paths.add(file.path);
		}),
	);

	// ponytail: reads only notes the cache files a code section in, so a fence Obsidian
	// files inside a list is missed until the note is next edited.
	workspace.onLayoutReady(async () => {
		for (const file of vault.getMarkdownFiles()) {
			const sections = metadataCache.getFileCache(file)?.sections;
			if (!sections?.some((section) => section.type === 'code')) continue;
			try {
				const text = await vault.cachedRead(file);
				if (!reported.has(file.path) && vault.getFileByPath(file.path)) update(file.path, text);
			} catch {
				// Deleted or unreadable since the list was taken: nothing to offer.
			}
		}
	});

	return paths;
}
