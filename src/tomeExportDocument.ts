import { Component, MarkdownRenderer, TFile } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { inlineAssets, type InlineFailure } from './tomeAssetInlining';
import { countChapters, type ExportItem } from './tomeChapterPlan';
import { planHeadingLevels } from './tomeHeadingLevels';
import { stripFrontmatter } from './tomeMarkdownSanitizer';
import { normalizeResourceRoot } from './tomeResourcePath';

/**
 * Renders a chapter plan into a single off-screen DOM tree, ready to be
 * serialized into the print guest.
 *
 * The caller owns both the host element and the `Component`, because both
 * have to outlive this function: the component keeps every child renderer a
 * post-processor created alive until the tree has been serialized.
 */

/**
 * `MarkdownRenderer.render` resolves once the synchronous pass is done, but
 * async post-processors (Mermaid, Dataview, Fantasy Statblocks) are still
 * working at that point and there is no API that reports when they finish.
 * This is a heuristic; raise it if a plugin's output prints half-built.
 */
const RENDER_SETTLE_MS = 500;

/** Cap on waiting for any single image to decode in the host document. */
const IMAGE_DECODE_TIMEOUT_MS = 5000;

export interface BuiltDocument {
	root: HTMLElement;
	failures: InlineFailure[];
	/** Notes that could not be read or rendered at all. */
	skipped: string[];
	/** Total size of the embedded attachments in the vault. */
	imageSourceBytes: number;
	/** Total size embedded, after downscaling and re-encoding. */
	imageEmbeddedBytes: number;
}

/**
 * Reports the current stage. The message is built here rather than by the
 * caller so the phase names stay next to the work they describe. `done`/
 * `total` are only passed for a stage that actually has an item count -
 * "embedding attachments" doesn't, so the caller falls back to whatever it
 * shows for an indeterminate stage.
 */
export type BuildProgress = (message: string, done?: number, total?: number) => void;

export async function buildExportDocument(
	plugin: TomeConnectorPlugin,
	host: HTMLElement,
	component: Component,
	plan: readonly ExportItem[],
	onProgress: BuildProgress,
): Promise<BuiltDocument> {
	const { app } = plugin;
	const resourceRoot = normalizeResourceRoot(
		app.vault.adapter.getResourcePath(''),
	);

	// The reading-view classes are what make Obsidian's own CSS - callouts,
	// tables, code blocks - apply to this tree once it reaches the guest.
	const root = host.createDiv({
		cls: 'markdown-preview-view markdown-rendered tome-export-root',
	});

	const total = countChapters(plan);
	const rendered: { body: HTMLElement; notePath: string }[] = [];
	const skipped: string[] = [];
	let current = 0;

	for (const item of plan) {
		if (item.kind === 'group') {
			const section = root.createDiv({ cls: 'tome-group' });
			section.createEl(headingTag(item.level), {
				cls: 'tome-group-title',
				text: item.title,
			});
			continue;
		}

		current += 1;
		onProgress(`rendering ${current}/${total} — ${item.title}`, current, total);

		const section = root.createDiv({ cls: 'tome-chapter' });
		section.createEl(headingTag(item.level), {
			cls: 'tome-chapter-title',
			text: item.title,
		});
		const body = section.createDiv({ cls: 'tome-chapter-body' });

		const file = app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) {
			skipped.push(item.path);
			body.createEl('p', {
				cls: 'tome-render-error',
				text: 'This note could not be read.',
			});
			continue;
		}

		try {
			const markdown = stripFrontmatter(await app.vault.cachedRead(file));
			await MarkdownRenderer.render(app, markdown, body, item.path, component);
			applyHeadingLevels(body, item.level);
			rendered.push({ body, notePath: item.path });
		} catch (error) {
			// One unrenderable note must not cost the rest of the book; the
			// chapter still appears, with the failure visible in place.
			console.error(`Tome Connector: failed to render ${item.path}`, error);
			skipped.push(item.path);
			body.empty();
			body.createEl('p', {
				cls: 'tome-render-error',
				text: 'This note could not be rendered.',
			});
		}
	}

	await settle(root);

	onProgress('embedding attachments…');

	const failures: InlineFailure[] = [];
	let imageSourceBytes = 0;
	let imageEmbeddedBytes = 0;
	for (const { body, notePath } of rendered) {
		const result = await inlineAssets(app, body, notePath, resourceRoot);
		failures.push(...result.failures);
		imageSourceBytes += result.sourceBytes;
		imageEmbeddedBytes += result.embeddedBytes;
	}

	return {
		root,
		failures,
		skipped,
		imageSourceBytes,
		imageEmbeddedBytes,
	};
}

/**
 * Rewrites a rendered note's headings to the levels they occupy beneath its
 * chapter heading. Done on the DOM rather than the Markdown source, because a
 * source-level rewrite would also hit `#` inside fenced code blocks, callouts
 * and inline code.
 */
function applyHeadingLevels(body: HTMLElement, chapterLevel: number): void {
	const headings = Array.from(
		body.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
	);
	if (headings.length === 0) return;

	const targets = planHeadingLevels(
		headings.map((heading) => Number(heading.tagName.slice(1))),
		chapterLevel,
	);

	headings.forEach((heading, index) => {
		const target = targets[index];
		if (target === undefined) return;

		const source = Number(heading.tagName.slice(1));
		if (source === target) return;

		const replacement = createEl(headingTag(target));
		for (const attribute of Array.from(heading.attributes)) {
			replacement.setAttribute(attribute.name, attribute.value);
		}
		// Lets styles.css restore the note's original heading scale if the
		// depth-driven sizing ever proves unwanted.
		replacement.addClass(`tome-source-h${source}`);
		while (heading.firstChild) {
			replacement.appendChild(heading.firstChild);
		}
		heading.replaceWith(replacement);
	});
}

function headingTag(level: number): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
	const clamped = Math.min(6, Math.max(1, Math.trunc(level)));
	return `h${clamped}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

/**
 * Waits for the rendered tree to stop changing: images decoded (a canvas can
 * only be snapshotted once what was drawn into it has settled), async
 * post-processors given their heuristic window, then two frames so layout has
 * flushed before anything is measured.
 */
async function settle(root: HTMLElement): Promise<void> {
	const images = Array.from(root.querySelectorAll('img'));
	await Promise.all(
		images.map((image) =>
			image.complete
				? Promise.resolve()
				: withTimeout(
						image.decode().catch(() => undefined),
						IMAGE_DECODE_TIMEOUT_MS,
					),
		),
	);

	await sleep(RENDER_SETTLE_MS);
	await nextFrame();
	await nextFrame();
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		window.requestAnimationFrame(() => resolve());
	});
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
	return Promise.race([promise, sleep(ms)]);
}
