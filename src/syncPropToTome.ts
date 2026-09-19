import { Notice, TFile, parseYaml } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { resolveImagePaths } from './tomeImageEmbedding';
import { sendJsonToTome } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { stripMarkdown } from './tomeMarkdownSanitizer';
import { writeTomeIdToYamlBlock } from './writeTomeIdToYamlBlock';
import { existingTomeId } from './tomeIdWriteBack';
import { TOME_ROUTES } from './routes';
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
 * Resolves an image value (e.g. `simple-chest.webp` or a `[[wikilink]]`) to
 * the actual vault file it refers to by searching the vault the same way
 * Obsidian resolves links, using the note's own path as the resolution
 * context. Returns null if it can't be resolved.
 */
function resolveImageFile(
	plugin: TomeConnectorPlugin,
	value: string,
	sourcePath: string,
): TFile | null {
	// Strip wikilink brackets/alias/heading if present, e.g.
	// `[[simple-chest.webp|Chest]]` -> `simple-chest.webp`.
	const match = value.match(/^\[\[([^\]|#]+)/);
	const linkpath = (match?.[1] ?? value).trim();

	return plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
}

/**
 * Resolves an image value the same way as `resolveImageFile`, but returns
 * the resolved vault path as a string (or the original value unchanged if
 * it can't be resolved) - used for the outgoing payload rather than
 * rendering.
 */
function resolveImageLinkPath(
	plugin: TomeConnectorPlugin,
	value: unknown,
	sourcePath: string,
): unknown {
	if (typeof value !== 'string' || value.trim() === '') return value;

	const dest = resolveImageFile(plugin, value, sourcePath);
	return dest ? dest.path : value;
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

		const parsed = parseYaml(rawYaml) as Record<string, unknown>;

		// Only an id Tome issued goes back; anything else would fail model binding.
		const payload: Record<string, unknown> = { ...parsed };
		delete payload.id;
		delete payload.tome_id;
		const existingId = existingTomeId(parsed);
		if (existingId !== undefined) payload.id = existingId;
		if (IMAGE_KEY in payload) {
			payload[IMAGE_KEY] = resolveImageLinkPath(
				plugin,
				payload[IMAGE_KEY],
				ctx.sourcePath,
			);
		}

		const cleaned = stripMarkdown(payload);
		const resolved = await resolveImagePaths(
			plugin.app,
			cleaned,
			'token',
			plugin.settings.downscaleImages,
		);
		const id = await sendJsonToTome(
			plugin.settings.baseUrl,
			TOME_ROUTES.addProp,
			JSON.stringify(resolved),
			getApiKey(plugin),
			campaignId,
		);
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
