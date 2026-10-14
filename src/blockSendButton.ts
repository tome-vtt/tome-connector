import { Notice, parseYaml } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import { BLOCK_KINDS, recognizeBlock, type BlockKind } from './blockKinds';
import type TomeConnectorPlugin from './main';
import { sendBlockWithNotice } from './obsidianSendPorts';
import { unwrapWikilink } from './recognizers/map';
import { chooseCampaign } from './tomeCampaigns';
import { describeError } from './shared';

/**
 * The one "Send to Tome" button frame every code block shares: busy state, the
 * campaign, the send and the error Notice live here once. Which
 * blocks get a button, and what they send as, is `blockKinds.ts`'s table.
 */

const BUTTON_TEXT = 'Send to Tome';
const SENDING_TEXT = 'Sending…';

/**
 * Fantasy Statblocks, Initiative Tracker, Leaflet and TTRPG Tools Maps each
 * register a processor that replaces the `<pre><code>` with their own render.
 * Post processors run lowest sort order first, so this one sees the original
 * element and wraps it in a container that the button survives in.
 */
const SORT_ORDER = -1000;

/** One rendered block a button sends. */
interface RenderedBlock {
	plugin: TomeConnectorPlugin;
	kind: BlockKind;
	/** The block's YAML as written, re-parsed on click. */
	source: string;
	ctx: MarkdownPostProcessorContext;
	/** What `getSectionInfo` finds the block's lines from. */
	sectionEl: HTMLElement;
}

/** Adds a "Send to Tome" button to every rendered block a row of the table recognizes. */
export function registerBlockSendButtons(plugin: TomeConnectorPlugin): void {
	registerDecoratedBlocks(plugin);
	for (const kind of BLOCK_KINDS) {
		if (kind.titleAndImagePreview) registerOwnedBlock(plugin, kind);
	}
}

function parse(source: string): unknown {
	try {
		return parseYaml(source);
	} catch {
		// Not valid YAML. The plugin drawing the block reports that in its own render.
		return undefined;
	}
}

/** Blocks another plugin draws: wrap its `<pre>` and put the button under it. */
function registerDecoratedBlocks(plugin: TomeConnectorPlugin): void {
	const languages = BLOCK_KINDS.filter((kind) => !kind.titleAndImagePreview).map((kind) => kind.language);
	const selector = languages.map((language) => `code.language-${language}`).join(', ');

	plugin.registerMarkdownPostProcessor((el, ctx) => {
		el.querySelectorAll<HTMLElement>(selector).forEach((codeEl) => {
			const preEl = codeEl.parentElement;
			if (!(preEl instanceof HTMLPreElement)) return;

			const language = languages.find((name) => codeEl.classList.contains(`language-${name}`)) ?? '';
			const source = codeEl.textContent ?? '';
			const kind = recognizeBlock(language, parse(source));
			if (!kind) return;

			const wrapperEl = createDiv({ cls: 'tome-connector-codeblock' });
			preEl.replaceWith(wrapperEl);
			wrapperEl.appendChild(preEl);
			addSendButton(wrapperEl, 'tome-connector-send-button', { plugin, kind, source, ctx, sectionEl: preEl });
		});
	}, SORT_ORDER);
}

/** A block only Tome draws: render its title-and-image preview with the button inside. */
function registerOwnedBlock(plugin: TomeConnectorPlugin, kind: BlockKind): void {
	plugin.registerMarkdownCodeBlockProcessor(kind.language, (source, el, ctx) => {
		const parsed = parse(source);
		if (!kind.sendable(parsed)) return;

		const preview = renderPreview(plugin, parsed as Record<string, unknown>, el, ctx.sourcePath);
		const cls = 'tome-connector-send-button tome-connector-prop-send-button';
		addSendButton(preview, cls, { plugin, kind, source, ctx, sectionEl: el });
	});
}

function renderPreview(
	plugin: TomeConnectorPlugin,
	block: Record<string, unknown>,
	el: HTMLElement,
	sourcePath: string,
): HTMLElement {
	const title = String(block.title);
	const preview = el.createDiv({ cls: 'tome-connector-codeblock' }).createDiv({ cls: 'tome-connector-prop-preview' });
	preview.createDiv({ text: title, cls: 'tome-connector-prop-title' });

	// `simple-chest.webp` or a `[[wikilink]]`, found the way Obsidian resolves links from the note.
	const image = block.image;
	const file =
		typeof image === 'string' && image.trim() !== ''
			? plugin.app.metadataCache.getFirstLinkpathDest(unwrapWikilink(image) ?? image, sourcePath)
			: null;
	if (file) {
		preview.createEl('img', {
			attr: { src: plugin.app.vault.getResourcePath(file), alt: title },
			cls: 'tome-connector-prop-image',
		});
	}
	return preview;
}

function addSendButton(parent: HTMLElement, cls: string, block: RenderedBlock): void {
	const button = parent.createEl('button', { text: BUTTON_TEXT, cls });
	button.addEventListener('click', () => {
		void send(button, block);
	});
}

async function send(button: HTMLButtonElement, block: RenderedBlock): Promise<void> {
	const { plugin, kind, ctx } = block;
	button.disabled = true;
	button.setText(SENDING_TEXT);
	try {
		const campaignId = await chooseCampaign(plugin);
		if (campaignId === null) return;

		const sendable = kind.sendable(parseYaml(block.source));
		if (!sendable) throw new Error(`This ${kind.language} block is no longer one Tome can take.`);
		// The block's lines are looked up once the send returns, so an edit made meanwhile cannot shift the id.
		await sendBlockWithNotice(plugin, { ...sendable, path: ctx.sourcePath }, campaignId, {
			kind: kind.writeBack,
			lines: () => ctx.getSectionInfo(block.sectionEl),
		});
	} catch (error) {
		console.error(`Tome Connector: failed to send ${kind.language} block`, error);
		const message = describeError(error);
		new Notice(`Tome connector: ${message}`);
	} finally {
		button.disabled = false;
		button.setText(BUTTON_TEXT);
	}
}
