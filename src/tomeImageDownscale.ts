import {
	dataUriByteLength,
	fitWithin,
	toDataUri,
} from './tomeImageEncoding';

/**
 * Shrinks an attachment before it is pushed to Tome.
 *
 * A sibling of `tomeImageOptimizer` rather than a mode of it, because almost
 * every policy decision that module makes is about a PDF page and is wrong
 * here:
 *
 * - `pdfCost`/`PDF_LOSSLESS_EXPANSION` exist because a PDF has no PNG format
 *   and re-Flates anything that is not JPEG. A JSON upload has no such
 *   expansion - a PNG costs its base64 length and nothing more.
 * - `LOSSLESS_MAX_PIXELS` has the same justification, and inverts the right
 *   answer here: a large cut-out prop *needs* its alpha.
 * - the `jpeg-on-white` flatten is defended by "this exporter forces white".
 *   **A board is not white.** Measured against a real vault, 26,647 of 34,800
 *   WebP files carry an alpha channel, so flattening would put a white halo on
 *   three quarters of everything anybody syncs.
 * - `MAX_IMAGE_EDGE_PX` is a print-DPI number for a Letter text column.
 *
 * What is shared is the honest part - `fitWithin` and the byte helpers - which
 * now live in `tomeImageEncoding`.
 */

export type TomeImageKind = 'map' | 'token' | 'cover';

/**
 * The map cap, named separately from the table below so `verify-limits.mjs` can read
 * it - the Angular client declares the same number and nothing else links the two.
 * Written as a bare literal because that script's reader evaluates digits and `*`
 * and nothing else.
 */
export const TOME_MAP_MAX_EDGE = 3072;

/**
 * Longest edge each kind of image keeps.
 *
 * Measured against a real `ttrpg-convert-cli` vault. Maps are the only place
 * there is anything to win: 1,469 of them, median 3600px, the largest 6429x9000
 * at 15.7 MB, against a token corpus whose median is 280px and 93 KB. 3072
 * leaves 102px per square on a thirty-square battle map, which is the
 * resolution virtual tabletops have settled on, and halves the bytes.
 *
 * A token is capped well above what it is drawn at because the crop happens in
 * Tome, not here - this is a ceiling on the absurd, not the working size.
 */
export const TOME_MAX_EDGE: Readonly<Record<TomeImageKind, number>> = {
	map: TOME_MAP_MAX_EDGE,
	token: 1024,
	cover: 1600,
};

/**
 * Which cap a key inside a walked payload should be held to.
 *
 * The walker is the one place the caller's knowledge of what it is sending gets
 * lost, so this is where it is recovered. A key literally named `map` is
 * stronger evidence than whatever the caller guessed; `image` means whatever
 * the caller is sending; anything else is not an image and keeps walking.
 *
 * Lives here, with the walker, rather than in `tomeImageEmbedding` because that
 * imports `obsidian`, and a module that does cannot be imported from a test at
 * all - the connector runs Vitest on Node defaults with no mock for it.
 */
export function imageKindForKey(
	key: string,
	callerKind: TomeImageKind,
): TomeImageKind | null {
	if (key === 'map') return 'map';
	if (key === 'image') return callerKind;
	return null;
}

/** Reads the image a payload names and returns it as a `data:` URI; throws when it cannot. */
export type ImageReader = (reference: string, kind: TomeImageKind) => Promise<string>;

/**
 * Recursively walks a parsed JSON value and replaces every non-empty string under
 * an image key (see {@link imageKindForKey}) with what `read` returns for it, so
 * the receiving API never needs filesystem access.
 *
 * The input is not mutated; a new value is returned. If a referenced file can't
 * be read the whole walk fails, so a local vault path is never sent.
 */
export async function embedImages(
	value: unknown,
	kind: TomeImageKind,
	read: ImageReader,
): Promise<unknown> {
	let missingFile = false;

	async function walk(node: unknown): Promise<unknown> {
		if (Array.isArray(node)) return Promise.all(node.map(walk));
		if (typeof node !== 'object' || node === null) return node;

		const result: Record<string, unknown> = {};
		await Promise.all(
			Object.entries(node as Record<string, unknown>).map(async ([key, val]) => {
				const keyKind = typeof val === 'string' && val.trim() !== '' ? imageKindForKey(key, kind) : null;
				if (!keyKind) {
					result[key] = await walk(val);
					return;
				}
				try {
					result[key] = await read(val as string, keyKind);
				} catch {
					missingFile = true;
					result[key] = val;
				}
			}),
		);
		return result;
	}

	const resolved = await walk(value);
	if (missingFile) {
		throw new Error('One or more images could not be read. Nothing was sent to Tome.');
	}
	return resolved;
}

/** Quality asked of the WebP encoder. */
export const WEBP_QUALITY = 0.9;

/**
 * Formats worth re-encoding.
 *
 * GIF is absent: a canvas keeps only the first frame, and silently turning
 * somebody's animated token into a still is worse than sending the bytes. SVG
 * is absent because rasterising vector art makes it both larger and worse.
 */
export const DOWNSCALEABLE_TYPES: ReadonlySet<string> = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/bmp',
]);

/** Whether the re-encode earned its place. Pure, so the rule is testable. */
export function keepReencoded(
	originalBytes: number,
	encodedBytes: number,
): boolean {
	if (!Number.isFinite(originalBytes) || !Number.isFinite(encodedBytes)) {
		return false;
	}
	if (originalBytes <= 0 || encodedBytes <= 0) return false;
	return encodedBytes < originalBytes;
}

/** Whether `fitWithin` actually has anything to do at this cap. */
export function needsDownscale(
	width: number,
	height: number,
	maxEdge: number,
): boolean {
	if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
	if (width <= 0 || height <= 0 || maxEdge <= 0) return false;
	return Math.max(width, height) > maxEdge;
}

/**
 * Returns `bytes` as a data URI, downscaled and re-encoded when that is
 * smaller.
 *
 * Takes bytes rather than a data URI on purpose: on the downscale path the
 * original is never base64-encoded at all, which saves a whole 1.33x copy of a
 * 16 MB map.
 *
 * Any failure falls back to the original bytes. A heavy map is a much better
 * outcome than a missing one.
 */
export async function downscaleImageBytes(
	bytes: ArrayBuffer,
	mimeType: string,
	kind: TomeImageKind,
): Promise<string> {
	const original = () => toDataUri(bytes, mimeType);

	if (!DOWNSCALEABLE_TYPES.has(mimeType)) return original();

	let bitmap: ImageBitmap | null = null;
	try {
		bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
		const maxEdge = TOME_MAX_EDGE[kind];
		if (!needsDownscale(bitmap.width, bitmap.height, maxEdge)) {
			// Already inside the cap. Re-encoding at 1:1 would re-quantise and shift
			// the colour space in exchange for no bytes at all.
			return original();
		}

		const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
		const canvas = createEl('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const context = canvas.getContext('2d');
		if (!context) return original();
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, 0, 0, target.width, target.height);

		// WebP, or PNG when the browser will not. Never JPEG: it would flatten
		// every transparent prop onto black, and `toDataURL` is allowed to answer
		// with something other than what was asked for, so the type is checked
		// rather than assumed.
		const encoded = canvas.toDataURL('image/webp', WEBP_QUALITY);
		const usable = encoded.startsWith('data:image/webp')
			? encoded
			: canvas.toDataURL('image/png');

		if (!keepReencoded(bytes.byteLength, dataUriByteLength(usable))) {
			return original();
		}
		return usable;
	} catch (error) {
		console.warn('Tome Connector: could not downscale an image', error);
		return original();
	} finally {
		bitmap?.close();
	}
}

/**
 * What to say beneath the "downscale images" setting, or null while it is on.
 *
 * A pure function beside the policy it describes, matching `baseUrlWarning` and
 * `syncTagHint`. It lives here rather than in `tomeConnectorSettings` for the
 * same reason `imageKindForKey` does: that file imports `obsidian` and so cannot
 * be reached from a test at all.
 *
 * The three outcomes are deliberately not summarised as "large images may fail",
 * because only one of them fails. A map over the ceiling is refused and says so;
 * a token, prop portrait or item picture over it is dropped by
 * `AssetService.TryStoreDataUriAsync` and the request still answers 200, so
 * nothing anywhere would tell the user their art went missing.
 */
export function downscaleWarning(enabled: boolean): string | null {
	if (enabled) return null;
	return (
		'Tome accepts map backgrounds up to 50 MB and token art up to 5 MB. ' +
		'A map over that is refused; a token, prop portrait or item picture over ' +
		'it is dropped silently - the entry is created without its art.'
	);
}
