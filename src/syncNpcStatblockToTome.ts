import { Notice, parseYaml } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { resolveImagePaths } from './tomeImageEmbedding';
import { joinUrl, sendJsonToTome } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { stripMarkdown } from './tomeMarkdownSanitizer';
// The mapping and the Fantasy Statblocks normalisers live in a pure module so
// they can be tested; this file keeps the DOM and the HTTP call.
import { mapToNpcPayload } from './recognizers/statblockCreature';
import { resolveCreatureData } from './fantasyStatblocksBestiary';
import { TOME_ROUTES } from './routes';
import { chooseCampaign } from './tomeCampaigns';
import { writeTomeIdToYamlBlock } from './writeTomeIdToYamlBlock';

const STATBLOCK_LANGUAGE_CLASS = 'language-statblock';
const BUTTON_TEXT = 'Send to Tome';
const SENDING_TEXT = 'Sending…';

// The Fantasy Statblocks plugin also registers a processor for the
// `statblock` language that fully replaces the `<pre><code>` element with
// its own rendered UI. Post processors run in `sortOrder` order (lowest
// first), so using a very low sortOrder here guarantees we see the original
// `<pre><code class="language-statblock">` element before it gets swapped
// out, letting us wrap it in a container that survives that replacement.
const SORT_ORDER = -1000;

/**
 * Returns true if the parsed YAML is a plain object (the shape a statblock
 * code block is expected to have).
 */
function hasRequiredShape(parsed: unknown): boolean {
	return (
		typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
	);
}

/**
 * Registers a markdown post processor that scans rendered ```statblock code
 * blocks (used by the Fantasy Statblocks plugin) for valid YAML and adds a
 * "Send to Tome" button to the bottom right of each one.
 */
export function registerStatblockCodeBlockButton(
	plugin: TomeConnectorPlugin,
): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const codeBlocks = el.querySelectorAll<HTMLElement>(
				`code.${STATBLOCK_LANGUAGE_CLASS}`,
			);

			codeBlocks.forEach((codeEl) => {
				const preEl = codeEl.parentElement;
				if (!(preEl instanceof HTMLPreElement)) return;

				const rawYaml = codeEl.textContent ?? '';
				let parsed: unknown;
				try {
					parsed = parseYaml(rawYaml);
				} catch {
					// Not valid YAML, skip adding the button.
					return;
				}

				if (!hasRequiredShape(parsed)) {
					// Valid YAML, but not the shape we're looking for.
					return;
				}

				// Wrap `preEl` in our own container instead of decorating it
				// directly. Other plugins (e.g. Fantasy Statblocks) replace
				// the `<pre>` element with their own rendered markup; since
				// that only swaps out `preEl` itself, our wrapper - and the
				// button inside it - remain in place afterwards.
				const wrapperEl = createDiv({ cls: 'tome-connector-codeblock' });
				preEl.replaceWith(wrapperEl);
				wrapperEl.appendChild(preEl);

				const button = wrapperEl.createEl('button', {
					text: BUTTON_TEXT,
					cls: 'tome-connector-send-button',
				});

				button.addEventListener('click', () => {
					void handleSendClick(button, plugin, rawYaml, ctx, preEl);
				});
			});
		},
		SORT_ORDER,
	);
}

async function handleSendClick(
	button: HTMLButtonElement,
	plugin: TomeConnectorPlugin,
	rawYaml: string,
	ctx: MarkdownPostProcessorContext,
	preEl: HTMLPreElement,
): Promise<void> {
	button.disabled = true;
	button.setText(SENDING_TEXT);
	try {
		const campaignId = await chooseCampaign(plugin);
		if (campaignId === null) return;

		const parsed: unknown = parseYaml(rawYaml);
		const withMonsterResolved = resolveCreatureData(parsed);
		const cleaned = stripMarkdown(withMonsterResolved);
		const resolved = (await resolveImagePaths(
			plugin.app,
			cleaned,
			'token',
			plugin.settings.downscaleImages,
		)) as Record<
			string,
			unknown
		>;
		const payload = mapToNpcPayload(resolved);
		const id = await sendJsonToTome(
			joinUrl(plugin.settings.baseUrl, TOME_ROUTES.addNonPlayerCharacter),
			JSON.stringify(payload),
			getApiKey(plugin),
			campaignId,
		);

		if (id !== null) {
			// Only the id line changes, so the note keeps its compact `monster:`
			// reference rather than a full copy of the resolved bestiary data.
			await writeTomeIdToYamlBlock(plugin, ctx, preEl, 'creature', id);
		}
	} catch (error) {
		console.error('Tome Connector: failed to send statblock', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	} finally {
		button.disabled = false;
		button.setText(BUTTON_TEXT);
	}
}
