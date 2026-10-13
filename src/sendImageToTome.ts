import { Notice, TFile } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { IMAGE_EXTENSION } from './adventure/adventureImages';
// The body, the route and the headers are the send module's; this file keeps the menu.
import { sendWithNotice } from './obsidianSendPorts';
import { chooseCampaign } from './tomeCampaigns';

/**
 * Adds "Import image as Prop to Tome" and "Import image as Map to Tome" to
 * an image file's context menu in the File Explorer - no note, no block,
 * just the picture itself. The send module titles it by its file name;
 * there is nothing else on a bare image to draw one from.
 */
export function registerImageContextMenu(plugin: TomeConnectorPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || !IMAGE_EXTENSION.test(file.path)) return;

			menu.addItem((item) =>
				item
					.setTitle('Import image as Prop to Tome')
					.setIcon('image')
					.onClick(() => void sendImage(plugin, file, 'prop')),
			);
			menu.addItem((item) =>
				item
					.setTitle('Import image as Map to Tome')
					.setIcon('map')
					.onClick(() => void sendImage(plugin, file, 'map')),
			);
		}),
	);
}

async function sendImage(
	plugin: TomeConnectorPlugin,
	file: TFile,
	to: 'map' | 'prop',
): Promise<void> {
	try {
		const campaignId = await chooseCampaign(plugin, 'Import');
		if (campaignId === null) return;

		await sendWithNotice(plugin, { kind: 'image', path: file.path, to }, campaignId);
	} catch (error) {
		console.error('Tome Connector: failed to send image', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	}
}
