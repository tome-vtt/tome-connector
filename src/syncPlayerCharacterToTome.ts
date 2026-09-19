import { MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { obsidianSendPorts } from './obsidianSendPorts';
import { sendCharacterToTome } from './sendModule';
import { noticeResult } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { chooseCharacterDestination } from './chooseCharacterDestination';

// Frontmatter property that gates whether the button is shown at all. Its
// presence is taken as confirmation that this note is a D&D Beyond character
// sheet.
const REQUIRED_PROPERTY = 'dndbeyond_id';

const BUTTON_ICON = 'upload-cloud';
const BUTTON_TITLE = 'Import as PC to Tome';
const SENDING_ICON = 'loader';
const SENDING_TITLE = 'Sending…';

// Tracks the action button (if any) currently shown on each markdown view,
// so it can be added/removed as the active file's frontmatter changes.
const actionButtons = new WeakMap<MarkdownView, HTMLElement>();

/**
 * Registers the per-note "Import as PC to Tome" action button that appears in
 * a markdown view's title bar whenever the note's frontmatter has a
 * `dndbeyond_id` property.
 */
export function registerCharacterSyncButton(plugin: TomeConnectorPlugin): void {
	const refreshAllViews = () => {
		for (const leaf of plugin.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) {
				refreshView(plugin, leaf.view);
			}
		}
	};

	plugin.registerEvent(
		plugin.app.workspace.on('file-open', () => refreshAllViews()),
	);
	plugin.registerEvent(
		plugin.app.workspace.on('active-leaf-change', () => refreshAllViews()),
	);
	plugin.registerEvent(
		plugin.app.metadataCache.on('changed', (file) => {
			for (const leaf of plugin.app.workspace.getLeavesOfType('markdown')) {
				if (
					leaf.view instanceof MarkdownView &&
					leaf.view.file?.path === file.path
				) {
					refreshView(plugin, leaf.view);
				}
			}
		}),
	);

	plugin.app.workspace.onLayoutReady(() => refreshAllViews());
}

/**
 * Adds "Import as PC to Tome" to a D&D Beyond character note's context menu
 * in the File Explorer - the same send {@link handleClick} runs from the
 * title-bar button, offered from the file tree the way a folder's import
 * and export entries are.
 */
export function registerCharacterContextMenu(plugin: TomeConnectorPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || !hasDndBeyondId(plugin, file)) return;

			menu.addItem((item) =>
				item
					.setTitle(BUTTON_TITLE)
					.setIcon(BUTTON_ICON)
					.onClick(() => void handleMenuClick(plugin, file)),
			);
		}),
	);
}

function hasDndBeyondId(plugin: TomeConnectorPlugin, file: TFile): boolean {
	const value: unknown =
		plugin.app.metadataCache.getFileCache(file)?.frontmatter?.[
			REQUIRED_PROPERTY
		];
	if (value === undefined || value === null) return false;
	if (typeof value === 'string') return value.trim() !== '';
	if (typeof value === 'number') return true;
	return false;
}

function refreshView(plugin: TomeConnectorPlugin, view: MarkdownView): void {
	const file = view.file;
	const shouldShow = file !== null && hasDndBeyondId(plugin, file);
	const existing = actionButtons.get(view);

	if (shouldShow && !existing) {
		const button = view.addAction(BUTTON_ICON, BUTTON_TITLE, () => {
			void handleClick(plugin, view, button);
		});
		actionButtons.set(view, button);
	} else if (!shouldShow && existing) {
		existing.remove();
		actionButtons.delete(view);
	}
}

/**
 * Sends a D&D Beyond note through the send module - the one send path shared by the
 * title-bar button and the context menu item.
 */
async function sendCharacter(plugin: TomeConnectorPlugin, file: TFile): Promise<void> {
	const destination = await chooseCharacterDestination(plugin);
	if (destination === null) return;

	const result = await sendCharacterToTome(
		obsidianSendPorts(plugin.app, plugin.settings.downscaleImages),
		{
			path: file.path,
			frontmatter: plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {},
			// `cachedRead` rather than `read`: the body is only being parsed, and
			// the cache is already warm for the note the user is looking at.
			content: await plugin.app.vault.cachedRead(file),
		},
		{ baseUrl: plugin.settings.baseUrl, apiKey: getApiKey(plugin) },
		destination,
	);
	noticeResult(result);
}

async function handleMenuClick(plugin: TomeConnectorPlugin, file: TFile): Promise<void> {
	try {
		await sendCharacter(plugin, file);
	} catch (error) {
		console.error('Tome Connector: failed to send character', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	}
}

async function handleClick(
	plugin: TomeConnectorPlugin,
	view: MarkdownView,
	button: HTMLElement,
): Promise<void> {
	const file = view.file;
	if (!file) return;

	button.setAttribute('aria-disabled', 'true');
	setIcon(button, SENDING_ICON);
	button.setAttribute('aria-label', SENDING_TITLE);

	try {
		await sendCharacter(plugin, file);
	} catch (error) {
		console.error('Tome Connector: failed to send character', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	} finally {
		button.removeAttribute('aria-disabled');
		setIcon(button, BUTTON_ICON);
		button.setAttribute('aria-label', BUTTON_TITLE);
	}
}
