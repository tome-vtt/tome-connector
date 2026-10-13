import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	TomeConnectorSettings,
	TomeConnectorSettingTab,
} from './tomeConnectorSettings';
import { registerBlockSendButtons } from './blockSendButton';
import { registerCharacterContextMenu, registerCharacterSyncButton } from './syncPlayerCharacterToTome';
import { registerFolderExportMenuItem } from './syncFolderToTome';
import { registerSyncCommands } from './syncVaultCommands';
import { registerImageContextMenu } from './sendImageToTome';

export default class TomeConnectorPlugin extends Plugin {
	override settings!: TomeConnectorSettings;

	override async onload() {
		await this.loadSettings();

		this.addSettingTab(new TomeConnectorSettingTab(this.app, this));

		registerBlockSendButtons(this);
		registerCharacterSyncButton(this);
		registerCharacterContextMenu(this);
		registerFolderExportMenuItem(this);
		registerSyncCommands(this);
		registerImageContextMenu(this);
	}

	override onunload() {}

	async loadSettings() {
		const stored = (await this.loadData()) as
			| (Partial<TomeConnectorSettings> & { apiKey?: string })
			| null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);

		// Migrate a legacy plain-text apiKey (stored before SecretStorage support) into
		// Obsidian's SecretStorage, then drop it from settings.
		//
		// The removal is gated only on the legacy key existing, not on whether the migration
		// also has to seed a secret. Gating both together meant a vault that had already
		// configured a secret name - by hand, or on another device - skipped the whole branch
		// and kept the plain-text key sitting in data.json indefinitely, which is the one
		// outcome this migration exists to prevent.
		const legacyApiKey = stored?.apiKey;
		if (legacyApiKey) {
			if (!this.settings.apiKeySecretName) {
				// Deliberately still the old name: this is a key into Obsidian's
				// SecretStorage, not display text. Vaults that migrated under the
				// plugin's previous name have their secret filed under it, and
				// renaming it here would leave that secret orphaned.
				const secretName = 'vtt-connector-api-key';
				// Not awaited - setSecret is synchronous in Obsidian's API, which the
				// await-thenable lint rule enforces.
				this.app.secretStorage.setSecret(secretName, legacyApiKey);
				this.settings.apiKeySecretName = secretName;
			}

			delete (this.settings as TomeConnectorSettings & { apiKey?: string }).apiKey;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
