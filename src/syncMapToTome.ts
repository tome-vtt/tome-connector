import { Notice, parseYaml } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TomeConnectorPlugin from './main';
// The body, the route and the headers are the send module's; this file keeps the DOM.
import { sendWithNotice } from './obsidianSendPorts';
import { mapReferenceFrom } from './recognizers/map';
import { writeTomeIdToYamlBlock } from './writeTomeIdToYamlBlock';
import { chooseCampaign } from './tomeCampaigns';

/**
 * Both map blocks the community uses.
 *
 * `zoommap` is TTRPG Tools Maps; `leaflet` is javalent's Leaflet, which is the
 * larger of the two. Reading the shapes is `recognizers/map.ts`'s job, and
 * sending one is the send module's — this file finds the blocks.
 */
const MAP_LANGUAGE_CLASSES = ['language-zoommap', 'language-leaflet'] as const;

const BUTTON_TEXT = 'Send to Tome';
const SENDING_TEXT = 'Sending…';

/**
 * Both plugins register their own code block processor and replace the
 * `<pre><code>` with a rendered map. A very low sort order means this runs
 * first and can wrap the element in a container the button survives in.
 */
const SORT_ORDER = -1000;

/**
 * Adds a "Send to Tome" button to every rendered map block that names an image.
 */
export function registerMapCodeBlockButton(plugin: TomeConnectorPlugin): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const selector = MAP_LANGUAGE_CLASSES.map((name) => `code.${name}`).join(', ');

			el.querySelectorAll<HTMLElement>(selector).forEach((codeEl) => {
				const preEl = codeEl.parentElement;
				if (!(preEl instanceof HTMLPreElement)) return;

				const rawYaml = codeEl.textContent ?? '';
				let parsed: unknown;
				try {
					parsed = parseYaml(rawYaml);
				} catch {
					return;
				}

				// No image named, nothing to send. Covers a Leaflet block that only
				// sets up coordinates, and a zoommap block still being written.
				if (mapReferenceFrom(parsed) === null) return;

				const wrapperEl = createDiv({ cls: 'tome-connector-codeblock' });
				preEl.replaceWith(wrapperEl);
				wrapperEl.appendChild(preEl);

				const button = wrapperEl.createEl('button', {
					text: BUTTON_TEXT,
					cls: 'tome-connector-send-button',
				});

				button.addEventListener('click', () => {
					const kind = codeEl.classList.contains('language-leaflet') ? 'leaflet' : 'zoommap';
					void handleSendClick(button, plugin, rawYaml, ctx, preEl, kind);
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
	sectionEl: HTMLElement,
	kind: 'leaflet' | 'zoommap',
): Promise<void> {
	button.disabled = true;
	button.setText(SENDING_TEXT);
	try {
		const campaignId = await chooseCampaign(plugin);
		if (campaignId === null) return;

		const source = parseYaml(rawYaml) as Record<string, unknown>;
		const id = await sendWithNotice(plugin, { kind: 'map', path: ctx.sourcePath, source }, campaignId);
		if (id !== null) {
			await writeTomeIdToYamlBlock(plugin, ctx, sectionEl, kind, id);
		}
	} catch (error) {
		console.error('Tome Connector: failed to send map', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	} finally {
		button.disabled = false;
		button.setText(BUTTON_TEXT);
	}
}
