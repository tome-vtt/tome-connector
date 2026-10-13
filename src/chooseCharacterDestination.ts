import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';

import type TomeConnectorPlugin from './main';
import { loadCampaigns, rememberCampaign, type TomeCampaign } from './tomeCampaigns';
import {
	destinationOptions,
	encodeDestination,
	initialDestinationValue,
	parseDestination,
	type CharacterDestination,
} from './characterDestination';

/**
 * The destination picker for "Import as PC to Tome" - the one send that can go somewhere other
 * than a campaign.
 *
 * <b>Its own modal rather than an option added to {@link chooseCampaign}.</b> That one is shared
 * by seven other send paths (images, encounters, folders, maps, statblocks, props), none of
 * which has a vault to send to, so a vault entry there would be a wrong option on six menus.
 * Generalising `CampaignSelectModal` instead is the same leak one step removed: its
 * `CampaignChoice` means "a non-empty campaign list and a chosen id", and loosening that to
 * "a list that may be only the vault" is how the vault option gets back onto the others.
 *
 * The decision itself lives in `characterDestination.ts`, which imports no `obsidian` and is
 * therefore the half the tests can reach.
 */
class CharacterDestinationModal extends Modal {
	private selected: string;
	private confirmed = false;

	constructor(
		app: App,
		private readonly campaigns: readonly TomeCampaign[],
		initial: string,
		private readonly onChoose: (value: string | null) => void,
	) {
		super(app);
		this.selected = initial;
	}

	override onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl('h3', { text: 'Import as PC to Tome' });

		new Setting(this.contentEl)
			.setName('Send to')
			.setDesc('My Characters is your own shelf - the character travels with you between tables.')
			.addDropdown((dropdown) => {
				for (const option of destinationOptions(this.campaigns)) {
					dropdown.addOption(option.value, option.label);
				}
				dropdown.setValue(this.selected).onChange((value) => {
					this.selected = value;
				});
			});

		const buttons = this.contentEl.createDiv({ cls: 'tome-connector-sync-buttons' });
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		buttons.createEl('button', { text: 'Send', cls: 'mod-cta' }).addEventListener('click', () => {
			this.confirmed = true;
			this.close();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onChoose(this.confirmed ? this.selected : null);
	}
}

/**
 * Asks where the character should go, and remembers the answer.
 *
 * Returns null when the user cancelled, or when the campaign list could not be fetched at all -
 * which `loadCampaigns` has already explained. An *empty* list is not a refusal: it means the
 * account has no campaigns, and the picker then offers My Characters alone. That case used to
 * be a dead end, since the shared campaign picker treats it as "create one in Tome first".
 */
export async function chooseCharacterDestination(
	plugin: TomeConnectorPlugin,
): Promise<CharacterDestination | null> {
	const campaigns = await loadCampaigns(plugin);
	if (campaigns === null) return null;

	const initial = initialDestinationValue(campaigns, {
		destination: plugin.settings.characterDestination,
		campaignId: plugin.settings.campaignId,
	});

	const value = await new Promise<string | null>((resolve) => {
		new CharacterDestinationModal(plugin.app, campaigns, initial, resolve).open();
	});
	if (value === null) return null;

	const destination = parseDestination(value);
	await rememberDestination(plugin, destination);
	return destination;
}

/**
 * Persists the choice. A campaign also updates `campaignId` through the shared helper, so the
 * other six senders open on the campaign this one was last pointed at - which is what they did
 * before this picker existed.
 */
async function rememberDestination(
	plugin: TomeConnectorPlugin,
	destination: CharacterDestination,
): Promise<void> {
	const remembered = encodeDestination(destination);
	if (plugin.settings.characterDestination !== remembered) {
		plugin.settings.characterDestination = remembered;
		await plugin.saveSettings();
	}
	if (destination.kind === 'campaign') {
		await rememberCampaign(plugin, destination.campaignId);
	}
}
