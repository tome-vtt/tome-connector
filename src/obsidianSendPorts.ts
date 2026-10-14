import { TFile, type App } from 'obsidian';

import { getStatblockBestiaryApi } from './fantasyStatblocksBestiary';
import type TomeConnectorPlugin from './main';
import { sendBlockToTome, sendToTome, type ModuleSendable, type SendPorts, type SourceBlock } from './sendModule';
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
			await app.fileManager.processFrontMatter(noteAt(app, path), (frontmatter: Record<string, unknown>) => {
				frontmatter[key] = value;
			});
		},
		readNote: async (path) => {
			const file = noteAt(app, path);
			return {
				frontmatter: app.metadataCache.getFileCache(file)?.frontmatter ?? {},
				// `cachedRead` rather than `read`: the body is only being parsed, and
				// the cache is already warm for the note the user is looking at.
				content: await app.vault.cachedRead(file),
			};
		},
		editNote: async (path, edit) => {
			await app.vault.process(noteAt(app, path), edit);
		},
	};
}

function noteAt(app: App, path: string): TFile {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error(`${path} is no longer in the vault.`);
	return file;
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

/** {@link sendWithNotice} for a code block: Tome's id is written into `block` before the one Notice. */
export async function sendBlockWithNotice(
	plugin: TomeConnectorPlugin,
	sendable: ModuleSendable,
	campaignId: string,
	block: SourceBlock,
): Promise<void> {
	const result = await sendBlockToTome(
		obsidianSendPorts(plugin.app, plugin.settings.downscaleImages),
		sendable,
		{ baseUrl: plugin.settings.baseUrl, apiKey: getApiKey(plugin), campaignId },
		block,
	);
	noticeResult(result);
}
