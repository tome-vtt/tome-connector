import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { baseUrlWarning } from './tomeBaseUrl';
import { syncTagHint } from './scopeReader';
import { downscaleWarning } from './tomeImageDownscale';

export interface TomeConnectorSettings {
	/**
	 * Origin the API routes are appended to.
	 *
	 * Defaults to the hosted service rather than to empty. An empty default made
	 * a fresh install inert - every command warned that no base URL was set - and
	 * the overwhelming majority of installs are pointing at the same host anyway.
	 * Self-hosters overwrite it, which is one edit against every other install
	 * needing one.
	 *
	 * `loadSettings` merges over `DEFAULT_SETTINGS`, so a vault that already
	 * stored a value keeps it, including a deliberately empty one.
	 */
	baseUrl: string;
	/** Name of the secret (in Obsidian's SecretStorage) that holds the API key. */
	apiKeySecretName: string;
	/** Last campaign selected in a send modal; the server remains the source of the list. */
	campaignId: string;
	/**
	 * Where the "Import as PC to Tome" picker opens: `'vault'` for the account's own shelf, or
	 * anything else for the campaign named by {@link campaignId}.
	 *
	 * Its own field rather than a sentinel written into `campaignId`, because that one is read
	 * by seven other send paths - images, encounters, folders, maps, statblocks, props - none of
	 * which has a vault to send to, and all of which need it to keep meaning "a campaign".
	 *
	 * Not on the settings tab. It is a memory of the last choice, the way `campaignId` is, and
	 * not a preference anybody would set in advance. Defaults to `'campaign'` so `loadSettings`'
	 * merge back-fills an existing install to the behaviour it already had.
	 */
	characterDestination: string;
	/**
	 * Tag that marks a note for the "send notes with the sync tag" command.
	 *
	 * Empty by default, and the command hides itself while it is - a default of
	 * `#tome` would look like a promise that tagging something does anything on
	 * its own, when nothing syncs without being asked.
	 */
	syncTag: string;
	/**
	 * Whether images are shrunk to the caps in `tomeImageDownscale` before they
	 * are uploaded.
	 *
	 * True by default, because that is what every vault did before this setting
	 * existed. `loadSettings` merges over `DEFAULT_SETTINGS`, so an install that
	 * predates the field back-fills to the behaviour it already had rather than
	 * silently changing what its next sync sends.
	 */
	downscaleImages: boolean;
}

export const DEFAULT_SETTINGS: TomeConnectorSettings = {
	baseUrl: 'https://tomegaming.com/',
	apiKeySecretName: '',
	campaignId: '',
	characterDestination: 'campaign',
	syncTag: '',
	downscaleImages: true,
};

/** Resolves the actual API key value from SecretStorage using the configured secret name. */
export function getApiKey(plugin: TomeConnectorPlugin): string {
	const secretName = plugin.settings.apiKeySecretName;
	if (!secretName) {
		return '';
	}
	return plugin.app.secretStorage.getSecret(secretName) ?? '';
}

export class TomeConnectorSettingTab extends PluginSettingTab {
	plugin: TomeConnectorPlugin;

	constructor(app: App, plugin: TomeConnectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declared rather than drawn, so every setting reaches Obsidian's settings
	 * search on 1.13 and later. `display()` is not called at all when this
	 * returns a non-empty array.
	 *
	 * **Every row uses `render` rather than a declarative `control`, and a new one
	 * must too.** Two of them have no choice - the API key field is a
	 * `SecretComponent`, and three rows carry a warning element that appears and
	 * disappears with the value - but the binding rule is the reason it applies to
	 * all of them: `display()` below skips any definition without a `render`
	 * function, so a declaratively-controlled row is an invisible one on Obsidian
	 * before 1.13, which `manifest.json` still supports. `render` keeps the
	 * behaviour exactly while still declaring the `name`, `desc` and `aliases`
	 * that search indexes, which is the whole point of the migration.
	 */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Tome base URL',
				desc: 'The base URL of your Tome server, defaulting to the hosted service at https://tomegaming.com/. Change it if you run your own. Code block payloads are posted to this base URL plus the appropriate API route when you select "Send to Tome".',
				aliases: ['server', 'url', 'endpoint', 'host'],
				render: (setting) => this.renderBaseUrl(setting),
			},
			{
				name: 'API key',
				desc: "Sent with every request in the \"X-Api-Key\" header to authenticate with your Tome server. Select or create a secret stored in Obsidian's secret storage.",
				aliases: ['secret', 'token', 'authentication', 'x-api-key'],
				render: (setting) => this.renderApiKey(setting),
			},
			{
				name: 'Sync tag',
				desc: 'Notes carrying this tag are included by the "Send notes with the sync tag to Tome" command. Leave it empty to hide that command; the folder and vault commands do not use it.',
				aliases: ['tag', 'bulk', 'scan'],
				render: (setting) => this.renderSyncTag(setting),
			},
			{
				name: 'Downscale images before sending',
				desc: 'Large pictures are shrunk to fit Tome before they are uploaded - maps to 3072px, tokens to 1024px, cover art to 1600px - and re-encoded, but only when that actually makes the file smaller. Turn this off to send your originals untouched.',
				aliases: [
					'image',
					'resize',
					'quality',
					'resolution',
					'full size',
					'original',
					'compress',
				],
				render: (setting) => this.renderDownscaleImages(setting),
			},
		];
	}

	/**
	 * The pre-1.13 path.
	 *
	 * Kept alongside {@link getSettingDefinitions} rather than replaced by it,
	 * because `manifest.json` declares `minAppVersion: 1.11.4`: on 1.13 and later
	 * Obsidian calls the definitions and ignores this, and below 1.13 it calls
	 * this and knows nothing about definitions. Delete it only when
	 * `minAppVersion` reaches 1.13.0 — until then its absence is a blank settings
	 * pane for anyone on an older build, which is what `require-display` caught.
	 *
	 * Both paths go through the same render helpers, so there is one
	 * implementation of each row and no chance of them drifting.
	 */
	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		for (const definition of this.getSettingDefinitions()) {
			if (!('render' in definition) || typeof definition.render !== 'function') {
				continue;
			}
			const setting = new Setting(containerEl)
				.setName(definition.name)
				.setDesc(definition.desc ?? '');
			definition.render(setting, this as never);
		}
	}

	/**
	 * The warning lives under the description rather than after the row, which
	 * is where it used to sit. A `render` callback owns one row, and an element
	 * appended to the container would land outside it - under the description is
	 * both inside the row and where somebody reading about the field is looking.
	 */
	private renderBaseUrl(setting: Setting): void {
		const warningEl = setting.descEl.createDiv({
			cls: 'tome-connector-transport-warning',
		});

		const showWarning = (baseUrl: string): void => {
			const warning = baseUrlWarning(baseUrl);
			warningEl.setText(warning ?? '');
			warningEl.toggleClass('tome-hidden', warning === null);
		};

		setting.addText((text) =>
			text
				.setPlaceholder('https://your-tome-server.example.com')
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.baseUrl = value.trim();
					await this.plugin.saveSettings();
					showWarning(this.plugin.settings.baseUrl);
				}),
		);

		showWarning(this.plugin.settings.baseUrl);
	}

	private renderSyncTag(setting: Setting): void {
		const warningEl = setting.descEl.createDiv({
			cls: 'tome-connector-transport-warning',
		});

		const showWarning = (tag: string): void => {
			const warning = syncTagHint(tag);
			warningEl.setText(warning ?? '');
			warningEl.toggleClass('tome-hidden', warning === null);
		};

		setting.addText((text) =>
			text
				.setPlaceholder('#tome')
				.setValue(this.plugin.settings.syncTag)
				.onChange(async (value) => {
					this.plugin.settings.syncTag = value.trim();
					await this.plugin.saveSettings();
					showWarning(this.plugin.settings.syncTag);
				}),
		);

		showWarning(this.plugin.settings.syncTag);
	}

	/**
	 * The warning here is inverted relative to the other two: those appear when a
	 * value looks wrong, this one appears when a perfectly valid choice has been
	 * made, because turning downscaling off hands the user Tome's own ceilings and
	 * one of the three ways past them is silent.
	 */
	private renderDownscaleImages(setting: Setting): void {
		const warningEl = setting.descEl.createDiv({
			cls: 'tome-connector-transport-warning tome-connector-downscale-warning',
		});

		const showWarning = (enabled: boolean): void => {
			const warning = downscaleWarning(enabled);
			warningEl.setText(warning ?? '');
			warningEl.toggleClass('tome-hidden', warning === null);
		};

		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.downscaleImages)
				.onChange(async (value) => {
					this.plugin.settings.downscaleImages = value;
					await this.plugin.saveSettings();
					showWarning(value);
				}),
		);

		showWarning(this.plugin.settings.downscaleImages);
	}

	private renderApiKey(setting: Setting): void {
		setting.addComponent((el) =>
			new SecretComponent(this.app, el)
				.setValue(this.plugin.settings.apiKeySecretName)
				.onChange(async (value) => {
					this.plugin.settings.apiKeySecretName = value;
					await this.plugin.saveSettings();
				}),
		);
	}
}

