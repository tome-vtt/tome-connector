import { TFile, type App } from 'obsidian';

import { getStatblockBestiaryApi } from './fantasyStatblocksBestiary';
import type TomeConnectorPlugin from './main';
import { sendToTome, type ModuleSendable, type SendPorts } from './sendModule';
import { noticeResult, tomeHttp } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { readImageAsDataUri } from './tomeImageEmbedding';

/**
 * The production adapter for the send module's ports: the vault, Fantasy
 * Statblocks on `window`, and the Tome HTTP module over `requestUrl`.
 *
 * An image is read at the path as written first, exactly as before the send
 * module existed, so a request that worked then is byte-for-byte the same now.
 * Only when that fails is it resolved as a link from the note it is in - which
 * is what makes `image: [[Goblin.png]]` work, wherever in the vault the file is.
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

/**
 * One send from a button or a menu: the plugin's settings as the destination, one
 * Notice for how it went, and the id on success or null.
 */
export async function sendWithNotice(
	plugin: TomeConnectorPlugin,
	sendable: ModuleSendable,
	campaignId: string,
): Promise<string | null> {
	const result = await sendToTome(
		obsidianSendPorts(plugin.app, plugin.settings.downscaleImages),
		sendable,
		{ baseUrl: plugin.settings.baseUrl, apiKey: getApiKey(plugin), campaignId },
	);
	return noticeResult(result);
}
