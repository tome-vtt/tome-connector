import {
	dataUriByteLength,
	drawScaled,
	parseDataUri,
	toDataUri,
} from './tomeImageEncoding';

/**
 * Downscales and re-encodes an attachment before it is embedded in the PDF.
 *
 * Every image goes into the document as a base64 data URI, which costs about
 * a third more than the raw bytes on top of the file's own size. A folder of
 * map-heavy notes at full camera or scanner resolution produces a PDF far
 * larger than anything the pages can actually show, so images are capped at a
 * sensible print resolution first.
 */

/**
 * Longest edge, in pixels, an embedded image is allowed to keep.
 *
 * A Letter page with the margins this exporter uses is about 7.3in wide, so
 * 1600px is roughly 220 DPI across the full text column - past what the page
 * can resolve in print and comfortably sharp when zoomed on screen.
 */
export const MAX_IMAGE_EDGE_PX = 1600;

/** Re-encoding quality for images that end up as JPEG. */
const JPEG_QUALITY = 0.82;

/**
 * How much of an image may be non-opaque before its transparency is treated
 * as meaningful.
 *
 * Testing against a real book showed this is the single biggest lever on file
 * size. Painted artwork exported as PNG routinely carries an alpha channel
 * that is opaque everywhere except anti-aliased edges - a fraction of a
 * percent of pixels - yet a strict "any transparency at all" test condemns it
 * to lossless PNG at roughly ten times the size JPEG would need. A 753x1000
 * illustration cost 1.5 MB as PNG.
 *
 * Below this threshold the image is flattened onto white and encoded as JPEG.
 * That is visually identical wherever the art sits directly on the page, which
 * this exporter forces white. Above it, the transparency is assumed to be
 * load-bearing - a cut-out token over a coloured callout - and PNG is kept.
 */
export const NEAR_OPAQUE_MAX_ALPHA_FRACTION = 0.01;

/**
 * Largest image, in pixels, allowed to stay lossless for the sake of its
 * transparency - roughly a 200x200 icon.
 *
 * This exists because **a PDF has no PNG format**. A JPEG is embedded
 * byte-for-byte as DCTDecode, but anything else is decoded and re-compressed
 * as raw FlateDecode, losing the predictor filtering that made the PNG small
 * in the first place. Measured on a real book, 25 MB of embedded images became
 * 90 MB of PDF purely through that expansion.
 *
 * So transparency is only worth paying for on images small enough for the cost
 * not to matter. Above this, the image is flattened onto white - identical on
 * the page, which this exporter forces white, and only visibly different for a
 * cut-out sitting on a coloured callout.
 */
export const LOSSLESS_MAX_PIXELS = 200 * 200;

/**
 * How much a non-JPEG image grows when embedded in a PDF, measured on a real
 * export: 25 MB of data URIs became 90 MB of PDF image streams. Used to
 * compare encodings by what they will actually cost in the document.
 */
export const PDF_LOSSLESS_EXPANSION = 3.5;

/** Bytes an image of `byteLength` will occupy once embedded in the PDF. */
export function pdfCost(byteLength: number, isJpeg: boolean): number {
	return isJpeg ? byteLength : byteLength * PDF_LOSSLESS_EXPANSION;
}

type ImageEncoding = 'jpeg' | 'jpeg-on-white' | 'png';

/**
 * Picks an encoding from how transparent the image is and how big it is.
 * Separated from the pixel work so the policy can be unit tested.
 */
export function chooseEncoding(
	nonOpaqueFraction: number,
	pixelCount: number,
): ImageEncoding {
	if (nonOpaqueFraction <= 0) return 'jpeg';
	// Anti-aliased edges on otherwise solid artwork: not real transparency.
	if (nonOpaqueFraction < NEAR_OPAQUE_MAX_ALPHA_FRACTION) return 'jpeg-on-white';
	// Real transparency, but only affordable while the image is small.
	if (pixelCount <= LOSSLESS_MAX_PIXELS) return 'png';
	return 'jpeg-on-white';
}

/**
 * Formats worth re-encoding. SVG is vector - rasterizing it would make it both
 * larger and worse - and an unrecognized type is left alone rather than being
 * guessed at.
 */
const RASTER_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/bmp',
]);

interface OptimizedImage {
	dataUri: string;
	/** Size of the file as it sits in the vault. */
	sourceBytes: number;
	/** Approximate size of the bytes actually embedded, after re-encoding. */
	embeddedBytes: number;
}

/**
 * Optimizes an image that is already a data URI - one a plugin inlined
 * itself, or a canvas snapshot. These bypass the vault-reading path entirely,
 * and were the reason some images reached the PDF at full resolution.
 */
export async function optimizeDataUri(dataUri: string): Promise<string> {
	const parsed = parseDataUri(dataUri);
	if (!parsed) return dataUri;

	const optimized = await optimizeImage(parsed.bytes, parsed.mimeType);
	return optimized.dataUri.length < dataUri.length ? optimized.dataUri : dataUri;
}

/**
 * Returns `bytes` as a data URI, downscaled and re-encoded when that is
 * smaller.
 *
 * The re-encoded result is always compared against the original and the
 * smaller one wins, so an already-optimized asset, a small icon, or artwork
 * that happens to compress badly as JPEG is passed through untouched. Any
 * failure falls back to the original bytes: a bigger PDF is a much better
 * outcome than a missing illustration.
 */
export async function optimizeImage(
	bytes: ArrayBuffer,
	mimeType: string,
): Promise<OptimizedImage> {
	const original = toDataUri(bytes, mimeType);
	const unchanged: OptimizedImage = {
		dataUri: original,
		sourceBytes: bytes.byteLength,
		embeddedBytes: dataUriByteLength(original),
	};

	if (!RASTER_TYPES.has(mimeType)) return unchanged;

	try {
		const target = await drawScaled(bytes, mimeType, MAX_IMAGE_EDGE_PX);
		if (!target) return unchanged;
		const { canvas, context } = target;

		// A JPEG source cannot carry alpha, so skip reading back the pixels.
		const encoding =
			mimeType === 'image/jpeg'
				? 'jpeg'
				: chooseEncoding(
						nonOpaqueFraction(context, canvas),
						target.width * target.height,
					);

		if (encoding === 'jpeg-on-white') {
			// Paints white *behind* what has already been drawn, so the few
			// translucent edge pixels composite against the page rather than
			// against the black that JPEG would otherwise give them.
			context.globalCompositeOperation = 'destination-over';
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.globalCompositeOperation = 'source-over';
		}

		const encoded =
			encoding === 'png'
				? canvas.toDataURL('image/png')
				: canvas.toDataURL('image/jpeg', JPEG_QUALITY);

		// Compare what each option will cost *in the PDF*, not on disk. A JPEG
		// is embedded byte-for-byte; anything else is re-compressed as raw
		// Flate and grows. Comparing file sizes naively kept PNGs that then
		// tripled on the way into the document.
		if (pdfCost(encoded.length, encoding !== 'png') >= pdfCost(original.length, mimeType === 'image/jpeg')) {
			return unchanged;
		}

		return {
			dataUri: encoded,
			sourceBytes: bytes.byteLength,
			embeddedBytes: dataUriByteLength(encoded),
		};
	} catch (error) {
		console.warn('Tome Connector: could not optimize an image', error);
		return unchanged;
	}
}

/**
 * Fraction of pixels that are not fully opaque. Returns 1 - "entirely
 * transparent", the most conservative answer - if the pixels cannot be read,
 * which keeps a tainted canvas on the lossless path.
 */
function nonOpaqueFraction(
	context: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
): number {
	try {
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		const pixels = data.length / 4;
		if (pixels === 0) return 0;

		let nonOpaque = 0;
		for (let index = 3; index < data.length; index += 4) {
			if (data[index] !== 255) nonOpaque++;
		}
		return nonOpaque / pixels;
	} catch {
		return 1;
	}
}
