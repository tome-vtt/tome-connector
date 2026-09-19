import { Notice, TFile, parseYaml } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TomeConnectorPlugin from './main';
// The body, the route and the headers are the send module's; this file keeps the DOM.
import { sendWithNotice } from './obsidianSendPorts';
import { unwrapWikilink } from './recognizers/map';
import { writeTomeIdToYamlBlock } from './writeTomeIdToYamlBlock';
import { chooseCampaign } from './tomeCampaigns';

const BUTTON_TEXT = 'Send to Tome';
const SENDING_TEXT = 'Sending…';

// Key the prop's name is expected under in the code block, and the key
// it's sent to Tome under.
const TITLE_KEY = 'title';

// Key the prop's image is expected under in the code block, and the key
// it's sent to Tome under.
const IMAGE_KEY = 'image';

/**
 * Returns true if the parsed YAML is a plain object with a non-empty
 * `title` field, e.g.:
 * ```prop
 * title: Simple Chest
 * image: simple-chest.webp
 * ```
 */
function hasRequiredShape(parsed: unknown): boolean {
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return false;
	}

	const title = (parsed as Record<string, unknown>)[TITLE_KEY];
	return typeof title === 'string' && title.trim() !== '';
}

/**
 * Registers a markdown code block processor that renders ```prop code
 * blocks (title + image preview) and adds a "Send to Tome" button beneath
 * the preview.
 */
export function registerPropCodeBlockButton(plugin: TomeConnectorPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		'prop',
		(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			let parsed: unknown;
			try {
				parsed = parseYaml(source);
			} catch {
				// Not valid YAML, render nothing.
				return;
			}

			if (!hasRequiredShape(parsed)) return;

			const record = parsed as Record<string, unknown>;
			const title =
				typeof record[TITLE_KEY] === 'string'
					? record[TITLE_KEY]
					: undefined;

			const container = el.createDiv({ cls: 'tome-connector-codeblock' });
			const preview = container.createDiv({ cls: 'tome-connector-prop-preview' });

			if (title) {
				preview.createDiv({ text: title, cls: 'tome-connector-prop-title' });
			}

			const imageValue = record[IMAGE_KEY];
			if (typeof imageValue === 'string' && imageValue.trim() !== '') {
				const imageFile = resolveImageFile(plugin, imageValue, ctx.sourcePath);
				if (imageFile) {
					preview.createEl('img', {
						attr: {
							src: plugin.app.vault.getResourcePath(imageFile),
							alt: title ?? 'Image',
						},
						cls: 'tome-connector-prop-image',
					});
				}
			}

			const button = preview.createEl('button', {
				text: BUTTON_TEXT,
				cls: 'tome-connector-send-button tome-connector-prop-send-button',
			});

			button.addEventListener('click', () => {
				void handleSendClick(button, plugin, source, ctx, el);
			});
		},
	);
}

/**
 * The vault file an image value (`simple-chest.webp` or a `[[wikilink]]`)
 * refers to, found the way Obsidian resolves links from the note, for the
 * preview. Null if it can't be resolved.
 */
function resolveImageFile(
	plugin: TomeConnectorPlugin,
	value: string,
	sourcePath: string,
): TFile | null {
	return plugin.app.metadataCache.getFirstLinkpathDest(unwrapWikilink(value) ?? value, sourcePath);
}

async function handleSendClick(
	button: HTMLButtonElement,
	plugin: TomeConnectorPlugin,
	rawYaml: string,
	ctx: MarkdownPostProcessorContext,
	sectionEl: HTMLElement,
): Promise<void> {
	button.disabled = true;
	button.setText(SENDING_TEXT);
	try {
		const campaignId = await chooseCampaign(plugin);
		if (campaignId === null) return;

		const source = parseYaml(rawYaml) as Record<string, unknown>;
		const id = await sendWithNotice(plugin, { kind: 'prop', path: ctx.sourcePath, block: source }, campaignId);
		if (id !== null) await writeTomeIdToYamlBlock(plugin, ctx, sectionEl, 'prop', id);
	} catch (error) {
		console.error('Tome Connector: failed to send prop', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	} finally {
		button.disabled = false;
		button.setText(BUTTON_TEXT);
	}
}
