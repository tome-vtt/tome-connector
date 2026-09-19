import { Notice, parseYaml } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { sendJsonToTome } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { mapToEncounterPayload } from './recognizers/encounter';
import { writeTomeIdToYamlBlock } from './writeTomeIdToYamlBlock';
import { TOME_ROUTES } from './routes';
import { chooseCampaign } from './tomeCampaigns';

const ENCOUNTER_LANGUAGE_CLASS = 'language-encounter';
const BUTTON_TEXT = 'Send to Tome';
const SENDING_TEXT = 'Sending…';

/**
 * Initiative Tracker registers a code block processor for `encounter` and draws
 * the block itself. A post processor at a very low sort order sees the original
 * `<pre><code class="language-encounter">` before that happens, so wrapping it
 * here leaves a container the button survives in — the same trick the statblock
 * path uses against Fantasy Statblocks.
 *
 * This file used to call `registerMarkdownCodeBlockProcessor('encounter', …)`
 * and render its own preview, which meant two plugins claiming one fence and
 * whichever loaded last winning.
 */
const SORT_ORDER = -1000;

/**
 * Adds a "Send to Tome" button to every rendered ` ```encounter ` block that
 * parses into something sendable, leaving the rendering to Initiative Tracker.
 */
export function registerEncounterCodeBlockButton(plugin: TomeConnectorPlugin): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const codeBlocks = el.querySelectorAll<HTMLElement>(
				`code.${ENCOUNTER_LANGUAGE_CLASS}`,
			);

			codeBlocks.forEach((codeEl) => {
				const preEl = codeEl.parentElement;
				if (!(preEl instanceof HTMLPreElement)) return;

				const rawYaml = codeEl.textContent ?? '';
				let parsed: unknown;
				try {
					parsed = parseYaml(rawYaml);
				} catch {
					// Not valid YAML. Initiative Tracker will report that in its own
					// render; a second complaint from us underneath it helps nobody.
					return;
				}

				if (mapToEncounterPayload(parsed) === null) return;

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
	sectionEl: HTMLElement,
): Promise<void> {
	button.disabled = true;
	button.setText(SENDING_TEXT);
	try {
		const campaignId = await chooseCampaign(plugin);
		if (campaignId === null) return;

		// Re-parsed rather than captured at registration, so an edit since the
		// block was rendered is picked up rather than silently sending stale YAML.
		const parsed: unknown = parseYaml(rawYaml);
		const payload = mapToEncounterPayload(parsed);
		if (payload === null) {
			throw new Error('This encounter block no longer has a name to send.');
		}

		const id = await sendJsonToTome(
			plugin.settings.baseUrl,
			TOME_ROUTES.addEncounter,
			JSON.stringify(payload),
			getApiKey(plugin),
			campaignId,
		);

		if (id !== null) {
			await writeTomeIdToYamlBlock(plugin, ctx, sectionEl, 'encounter', id);
		}
	} catch (error) {
		console.error('Tome Connector: failed to send encounter', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	} finally {
		button.disabled = false;
		button.setText(BUTTON_TEXT);
	}
}
