/**
 * Byte- and MIME-level helpers shared by the code that embeds attachments.
 *
 * Kept free of any `obsidian` import so this, `tomeImageOptimizer` and
 * `tomeImageDownscale` all stay unit testable - the vault access lives in
 * `tomeImageEmbedding`.
 */

const MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
	svg: 'image/svg+xml',
};

export function getMimeType(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Converts an ArrayBuffer to a base64 string, chunking the conversion so
 * large files don't blow the call stack via `String.fromCharCode(...)`.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

/**
 * `bytes` as a base64 `data:` URI, with nothing done to them.
 *
 * The "send it as it is" answer, shared by the downscaler's own fallback and by
 * the upload path when the user has turned downscaling off, so there is one
 * implementation of what "untouched" means.
 */
export function toDataUri(bytes: ArrayBuffer, mimeType: string): string {
	return `data:${mimeType};base64,${arrayBufferToBase64(bytes)}`;
}

/**
 * Scales `width` x `height` down to fit inside `maxEdge`, preserving aspect
 * ratio. Images already within the cap are returned unchanged - this never
 * upscales, which would add bytes without adding detail.
 *
 * `maxEdge` is required rather than defaulted: the PDF exporter and the upload
 * paths want very different numbers, and a default would quietly hand one of
 * them the other's.
 */
export function fitWithin(
	width: number,
	height: number,
	maxEdge: number,
): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= maxEdge || longest === 0) {
		return { width, height };
	}

	const scale = maxEdge / longest;
	return {
		// At least one pixel each way, so an extreme aspect ratio cannot
		// collapse to a zero-sized canvas.
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * Decodes `bytes`, fits the bitmap inside `maxEdge` and draws it to a canvas,
 * closing the bitmap either way. `scaled` is false when the image was already
 * inside the cap. Null when the canvas has no 2D context. Throws if the bytes
 * cannot be decoded.
 */
export async function drawScaled(
	bytes: ArrayBuffer,
	mimeType: string,
	maxEdge: number,
): Promise<{
	canvas: HTMLCanvasElement;
	context: CanvasRenderingContext2D;
	width: number;
	height: number;
	scaled: boolean;
} | null> {
	const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
	try {
		const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
		const canvas = createEl('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const context = canvas.getContext('2d');
		if (!context) return null;
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, 0, 0, target.width, target.height);
		return {
			canvas,
			context,
			...target,
			scaled: target.width !== bitmap.width || target.height !== bitmap.height,
		};
	} finally {
		bitmap.close();
	}
}

/**
 * Splits a base64 data URI back into its bytes, or null if it isn't one -
 * a plain-text `data:image/svg+xml,<svg…>` URI has nothing to re-encode.
 */
export function parseDataUri(
	dataUri: string,
): { mimeType: string; bytes: ArrayBuffer } | null {
	const match = /^data:([^;,]*);base64,(.*)$/s.exec(dataUri);
	if (!match) return null;

	const [, mimeType = '', payload = ''] = match;
	try {
		const binary = atob(payload);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) {
			bytes[index] = binary.charCodeAt(index);
		}
		return { mimeType, bytes: bytes.buffer };
	} catch {
		return null;
	}
}

/** Bytes represented by a base64 data URI, without decoding it. */
export function dataUriByteLength(dataUri: string): number {
	const comma = dataUri.indexOf(',');
	if (comma === -1) return 0;

	const base64 = dataUri.length - comma - 1;
	const padding = dataUri.endsWith('==') ? 2 : dataUri.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((base64 * 3) / 4) - padding);
}
