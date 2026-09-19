import { TFile, type App } from 'obsidian';

import { getStatblockBestiaryApi } from './fantasyStatblocksBestiary';
import type { SendPorts } from './sendModule';
import { tomeHttp } from './tomeApiClient';
import { readImageAsDataUri } from './tomeImageEmbedding';

/**
 * The production adapter for the send module's ports: the vault, Fantasy
 * Statblocks on `window`, and the Tome HTTP module over `requestUrl`.
 *
 * An image is read at the path as written first, exactly as before the send
 * module existed, so a request that worked then is byte-for-byte the same now.
 * Only when that fails is it resolved as a link from the note it is in - which
 * is what makes `image: [[Goblin.png]]` work.
 */
export function obsidianSendPorts(app: App, downscale: boolean): SendPorts {
	return {
		readImage: async (reference, sourcePath, kind) => {
			try {
				return await readImageAsDataUri(app, reference, kind, downscale);
			} catch (error) {
				const file = app.metadataCache.getFirstLinkpathDest(reference, sourcePath);
				if (!file) throw error;
				return readImageAsDataUri(app, file.path, kind, downscale);
			}
		},
		bestiary: getStatblockBestiaryApi,
		postJson: tomeHttp.postJson,
		setFrontmatter: async (path, key, value) => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`${path} is no longer in the vault.`);
			await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				frontmatter[key] = value;
			});
		},
	};
}
