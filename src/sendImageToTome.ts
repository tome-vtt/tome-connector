import { Notice, TFile } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { IMAGE_EXTENSION } from './adventure/adventureImages';
import { sendJsonToTome } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { TomeImageKind } from './tomeImageDownscale';
import { readImageAsDataUri } from './tomeImageEmbedding';
import { TOME_ROUTES } from './routes';
import { chooseCampaign } from './tomeCampaigns';

/**
 * Adds "Import image as Prop to Tome" and "Import image as Map to Tome" to
 * an image file's context menu in the File Explorer - no note, no block,
 * just the picture itself. `file.basename` (Obsidian's own name-minus-
 * extension) is the title; there is nothing else on a bare image to draw
 * one from.
 */
export function registerImageContextMenu(plugin: TomeConnectorPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || !IMAGE_EXTENSION.test(file.path)) return;

			menu.addItem((item) =>
				item
					.setTitle('Import image as Prop to Tome')
					.setIcon('image')
					.onClick(() => void sendImage(plugin, file, TOME_ROUTES.addProp, 'token')),
			);
			menu.addItem((item) =>
				item
					.setTitle('Import image as Map to Tome')
					.setIcon('map')
					.onClick(() => void sendImage(plugin, file, TOME_ROUTES.addMap, 'map')),
			);
		}),
	);
}

async function sendImage(
	plugin: TomeConnectorPlugin,
	file: TFile,
	route: string,
	kind: TomeImageKind,
): Promise<void> {
	try {
		const campaignId = await chooseCampaign(plugin, 'Import');
		if (campaignId === null) return;

		const payload = {
			title: file.basename,
			image: await readImageAsDataUri(
				plugin.app,
				file.path,
				kind,
				plugin.settings.downscaleImages,
			),
		};
		await sendJsonToTome(
			plugin.settings.baseUrl,
			route,
			JSON.stringify(payload),
			getApiKey(plugin),
			campaignId,
		);
	} catch (error) {
		console.error('Tome Connector: failed to send image', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	}
}
