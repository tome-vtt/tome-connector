import { App, normalizePath } from 'obsidian';
import { dataUriByteLength, getMimeType } from './tomeImageEncoding';
import { optimizeDataUri, optimizeImage } from './tomeImageOptimizer';
import { vaultPathFromResourceUrl } from './tomeResourcePath';
import { describeError } from './shared';

/**
 * Rewrites everything in a rendered note that points at a vault file so it
 * carries its own bytes instead.
 *
 * The printable document is handed to the guest as serialized HTML, which
 * severs it from this vault's `app://` origin - so any attachment left as a
 * reference would print blank. Inlining also means the resulting PDF is
 * self-contained, which is the whole point of pushing it to Tome.
 */

export interface InlineFailure {
	notePath: string;
	/** What the note referenced, as the author wrote it. */
	reference: string;
	reason: string;
}

interface Candidate {
	/** Vault-relative path to try reading. */
	path: string;
}

export interface InlineResult {
	failures: InlineFailure[];
	/** Total size of the attachments as they sit in the vault. */
	sourceBytes: number;
	/** Total size actually embedded, after downscaling and re-encoding. */
	embeddedBytes: number;
}

/** Running byte tally, threaded through the passes below. */
interface Tally {
	sourceBytes: number;
	embeddedBytes: number;
}

export async function inlineAssets(
	app: App,
	root: HTMLElement,
	notePath: string,
	resourceRoot: string,
): Promise<InlineResult> {
	const failures: InlineFailure[] = [];
	const tally: Tally = { sourceBytes: 0, embeddedBytes: 0 };

	// Canvases first: they become <img> elements carrying a full-resolution
	// PNG snapshot, which the image pass below then picks up as a data URI and
	// optimizes like any other attachment.
	inlineCanvases(root, notePath, failures);
	// Before the <img> pass: a <picture> would otherwise let a <source> win
	// over the src we are about to inline.
	dropPictureSources(root);
	await inlineImages(app, root, notePath, resourceRoot, failures, tally);
	await inlineSvgImages(app, root, notePath, resourceRoot, failures, tally);
	await inlineStyleBackgrounds(app, root, resourceRoot, tally);

	return { failures, ...tally };
}

/**
 * Removes `<source>` elements from `<picture>`. The browser prefers a
 * matching `<source>` over the `<img>` we inline, so leaving them in place
 * would send the original file to the printer regardless.
 */
function dropPictureSources(root: HTMLElement): void {
	for (const source of Array.from(root.querySelectorAll('picture source'))) {
		source.remove();
	}
}

/**
 * Rewrites `url(app://…)` inside inline `style` attributes. Rare in ordinary
 * note bodies, but a themed callout or a plugin-rendered banner can put an
 * image here, and it would otherwise never reach the optimizer.
 */
async function inlineStyleBackgrounds(
	app: App,
	root: HTMLElement,
	resourceRoot: string,
	tally: Tally,
): Promise<void> {
	for (const node of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
		const style = node.getAttribute('style') ?? '';
		if (!style.includes('app://')) continue;

		const urls = style.match(/app:\/\/[^"')\s]+/g) ?? [];
		let rewritten = style;
		for (const url of urls) {
			const path = vaultPathFromResourceUrl(url, resourceRoot);
			if (!path) continue;
			const dataUri = await readFirstReadable(app, [{ path }], tally);
			if (dataUri) rewritten = rewritten.split(url).join(dataUri);
		}
		if (rewritten !== style) node.setAttribute('style', rewritten);
	}
}

/**
 * `innerHTML` does not carry a canvas bitmap, so anything a plugin drew
 * (charts, some Excalidraw output) would arrive in the guest blank. Snapshot
 * each one to a PNG element instead.
 */
function inlineCanvases(
	root: HTMLElement,
	notePath: string,
	failures: InlineFailure[],
): void {
	for (const canvas of Array.from(root.querySelectorAll('canvas'))) {
		if (canvas.width === 0 || canvas.height === 0) continue;

		try {
			const dataUri = canvas.toDataURL('image/png');
			const image = createEl('img', { attr: { src: dataUri } });
			if (canvas.clientWidth > 0) {
				image.style.width = `${canvas.clientWidth}px`;
			}
			canvas.replaceWith(image);
		} catch (error) {
			// A canvas that had a cross-origin image drawn into it is tainted
			// and throws SecurityError on read.
			failures.push({
				notePath,
				reference: 'a generated image',
				reason: describeError(error),
			});
			canvas.replaceWith(missingAttachmentEl('a generated image'));
		}
	}
}

async function inlineImages(
	app: App,
	root: HTMLElement,
	notePath: string,
	resourceRoot: string,
	failures: InlineFailure[],
	tally: Tally,
): Promise<void> {
	for (const image of Array.from(root.querySelectorAll('img'))) {
		// A lazily-loaded image that never scrolled into view in the off-screen
		// container will not have decoded, and srcset would re-point the guest
		// at a resource it cannot resolve.
		image.removeAttribute('loading');
		image.removeAttribute('srcset');

		const source = image.getAttribute('src') ?? '';
		if (source.startsWith('data:')) {
			// Already inlined by a plugin, but not necessarily at a sensible
			// resolution - these used to reach the PDF untouched.
			const optimized = await optimizeDataUri(source);
			if (optimized !== source) image.setAttribute('src', optimized);
			tally.sourceBytes += dataUriByteLength(source);
			tally.embeddedBytes += dataUriByteLength(optimized);
			continue;
		}
		// Remote images are left as-is; the guest has network access and the
		// printer waits for them to load. Re-fetching here would only duplicate
		// a request the reading view has already made.
		if (/^https?:/i.test(source)) continue;

		const reference = describeReference(image, source, resourceRoot);
		const candidates = collectCandidates(
			app,
			image,
			source,
			notePath,
			resourceRoot,
		);

		const dataUri = await readFirstReadable(app, candidates, tally);
		if (dataUri) {
			image.setAttribute('src', dataUri);
			continue;
		}

		// Replace rather than leave in place: an unresolved `app://` src holds
		// an absolute local filesystem path, and this document is about to be
		// uploaded.
		failures.push({
			notePath,
			reference,
			reason: 'the file could not be read',
		});
		image.replaceWith(missingAttachmentEl(reference));
	}
}

/**
 * Mermaid and Excalidraw output survives serialization as vector SVG, so it
 * is left alone - but an `<image>` inside one still points at a vault file.
 */
async function inlineSvgImages(
	app: App,
	root: HTMLElement,
	notePath: string,
	resourceRoot: string,
	failures: InlineFailure[],
	tally: Tally,
): Promise<void> {
	for (const node of Array.from(root.querySelectorAll('svg image'))) {
		const attribute = node.hasAttribute('href') ? 'href' : 'xlink:href';
		const source = node.getAttribute(attribute) ?? '';
		if (!source || source.startsWith('data:') || /^https?:/i.test(source)) {
			continue;
		}

		const path = vaultPathFromResourceUrl(source, resourceRoot);
		const candidates = path ? [{ path }] : [];
		const dataUri = await readFirstReadable(app, candidates, tally);
		if (dataUri) {
			node.setAttribute(attribute, dataUri);
			continue;
		}

		failures.push({
			notePath,
			reference: path ?? 'an embedded image',
			reason: 'the file could not be read',
		});
		node.remove();
	}
}

/**
 * Vault paths worth trying for one `<img>`, most trustworthy first.
 *
 * The wrapper element Obsidian puts around a `![[wikilink]]` embed carries
 * the linkpath exactly as the author typed it, which `getFirstLinkpathDest`
 * resolves against the whole vault - that is what lets an attachment sitting
 * in a sibling subfolder resolve. The `app://` src is the fallback, and is
 * the only handle a markdown-style `![](path/img.png)` embed offers.
 */
function collectCandidates(
	app: App,
	image: HTMLImageElement,
	source: string,
	notePath: string,
	resourceRoot: string,
): Candidate[] {
	const candidates: Candidate[] = [];

	const linkpath = embedLinkpath(image);
	if (linkpath) {
		const dest = app.metadataCache.getFirstLinkpathDest(linkpath, notePath);
		if (dest) candidates.push({ path: dest.path });
	}

	const fromResource = vaultPathFromResourceUrl(source, resourceRoot);
	if (fromResource) candidates.push({ path: fromResource });

	if (source && !source.startsWith('app://')) {
		const decoded = safeDecode(source);
		const dest = app.metadataCache.getFirstLinkpathDest(decoded, notePath);
		if (dest) candidates.push({ path: dest.path });
	}

	return candidates;
}

async function readFirstReadable(
	app: App,
	candidates: readonly Candidate[],
	tally: Tally,
): Promise<string | null> {
	for (const candidate of candidates) {
		try {
			const bytes = await app.vault.adapter.readBinary(
				normalizePath(candidate.path),
			);
			const optimized = await optimizeImage(
				bytes,
				getMimeType(candidate.path),
			);
			tally.sourceBytes += optimized.sourceBytes;
			tally.embeddedBytes += optimized.embeddedBytes;
			return optimized.dataUri;
		} catch {
			// Try the next candidate; the caller records the failure if none work.
		}
	}
	return null;
}

/** The raw linkpath from an `![[embed]]` wrapper, minus any `#heading` or `|size`. */
function embedLinkpath(image: HTMLImageElement): string | null {
	const wrapper = image.closest('.internal-embed');
	const raw = wrapper?.getAttribute('src')?.trim();
	if (!raw) return null;
	const linkpath = raw.split('#')[0]?.split('|')[0]?.trim();
	return linkpath || null;
}

/**
 * A label for the missing-attachment placeholder. Deliberately never the raw
 * `app://` URL, which embeds an absolute local filesystem path - only the
 * link the author wrote, or the vault-relative path, both of which are
 * already part of the note.
 */
function describeReference(
	image: HTMLImageElement,
	source: string,
	resourceRoot: string,
): string {
	return (
		embedLinkpath(image) ??
		vaultPathFromResourceUrl(source, resourceRoot) ??
		image.getAttribute('alt')?.trim() ??
		'an attachment'
	);
}

function missingAttachmentEl(reference: string): HTMLElement {
	return createSpan({
		cls: 'tome-missing-attachment',
		text: `Missing attachment: ${reference}`,
	});
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
