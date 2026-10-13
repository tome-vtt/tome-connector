import { TFile, getAllTags } from 'obsidian';
import type { App } from 'obsidian';

import type { NoteSource } from './scopeReader';

/**
 * The vault as a {@link NoteSource}: the Obsidian side of the scope reader.
 *
 * `cachedRead` rather than `read`: the widest scope touches every markdown file in
 * the vault, and the cache is what keeps that from being a few thousand disk reads.
 */
export function vaultNotes(app: App): NoteSource {
	return {
		paths: () => app.vault.getMarkdownFiles().map((file) => file.path),
		tags: (path) => {
			const cache = app.metadataCache.getCache(path);
			return cache ? (getAllTags(cache) ?? []) : [];
		},
		read: async (path) => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`"${path}" no longer exists in the vault.`);
			return {
				path,
				content: await app.vault.cachedRead(file),
				frontmatter: app.metadataCache.getFileCache(file)?.frontmatter ?? null,
			};
		},
	};
}
