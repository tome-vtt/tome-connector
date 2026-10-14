import { describe, expect, it } from 'vitest';
import {
	arrayBufferToBase64,
	dataUriByteLength,
	fitWithin,
	parseDataUri,
} from '../src/tomeImageEncoding';
import {
	LOSSLESS_MAX_PIXELS,
	MAX_IMAGE_EDGE_PX,
	NEAR_OPAQUE_MAX_ALPHA_FRACTION,
	PDF_LOSSLESS_EXPANSION,
	chooseEncoding,
	pdfCost,
} from '../src/tomeImageOptimizer';

describe('fitWithin', () => {
	it('leaves an image already inside the cap alone', () => {
		expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
	});

	it('leaves an image exactly at the cap alone', () => {
		expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
	});

	it('scales a landscape image by its width', () => {
		expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
	});

	it('scales a portrait image by its height', () => {
		expect(fitWithin(1600, 3200, 1600)).toEqual({ width: 800, height: 1600 });
	});

	it('preserves aspect ratio on awkward dimensions', () => {
		const { width, height } = fitWithin(4032, 3024, 1600);
		expect(width).toBe(1600);
		expect(height).toBe(1200);
	});

	it('never collapses an extreme aspect ratio to zero', () => {
		const { width, height } = fitWithin(20000, 5, 1600);
		expect(width).toBe(1600);
		expect(height).toBe(1);
	});

	it('handles a zero-sized image without dividing by zero', () => {
		expect(fitWithin(0, 0, 1600)).toEqual({ width: 0, height: 0 });
	});

	it('applies the PDF exporter cap when it is the one passed', () => {
		// No longer a default: the exporter and the upload paths want different
		// numbers, so each states its own.
		expect(
			fitWithin(MAX_IMAGE_EDGE_PX * 2, MAX_IMAGE_EDGE_PX * 2, MAX_IMAGE_EDGE_PX),
		).toEqual({
			width: MAX_IMAGE_EDGE_PX,
			height: MAX_IMAGE_EDGE_PX,
		});
	});
});

describe('chooseEncoding', () => {
	const ICON = 100 * 100;
	const ARTWORK = 1000 * 750;

	it('uses JPEG for a fully opaque image', () => {
		expect(chooseEncoding(0, ARTWORK)).toBe('jpeg');
	});

	it('flattens near-opaque artwork onto white', () => {
		// Anti-aliased edges on otherwise solid art: not real transparency.
		expect(chooseEncoding(0.002, ARTWORK)).toBe('jpeg-on-white');
	});

	it('keeps a small transparent icon lossless', () => {
		expect(chooseEncoding(0.4, ICON)).toBe('png');
	});

	it('flattens large artwork even when genuinely transparent', () => {
		// A PDF has no PNG: keeping this lossless costs several times its size
		// once embedded, which is not worth paying on a full-page illustration.
		expect(chooseEncoding(0.4, ARTWORK)).toBe('jpeg-on-white');
	});

	it('keeps a small image lossless when the pixels cannot be read', () => {
		expect(chooseEncoding(1, ICON)).toBe('png');
	});

	it('treats the alpha threshold boundary as real transparency', () => {
		expect(chooseEncoding(NEAR_OPAQUE_MAX_ALPHA_FRACTION, ICON)).toBe('png');
		expect(chooseEncoding(NEAR_OPAQUE_MAX_ALPHA_FRACTION - 1e-9, ICON)).toBe(
			'jpeg-on-white',
		);
	});

	it('treats the size boundary as the last lossless size', () => {
		expect(chooseEncoding(0.5, LOSSLESS_MAX_PIXELS)).toBe('png');
		expect(chooseEncoding(0.5, LOSSLESS_MAX_PIXELS + 1)).toBe('jpeg-on-white');
	});
});

describe('pdfCost', () => {
	it('charges a JPEG its own size', () => {
		expect(pdfCost(1000, true)).toBe(1000);
	});

	it('charges a lossless image the measured expansion', () => {
		expect(pdfCost(1000, false)).toBe(1000 * PDF_LOSSLESS_EXPANSION);
	});

	it('prefers a slightly larger JPEG over a PNG that will expand', () => {
		// The comparison that was keeping originals which then tripled.
		expect(pdfCost(1200, true)).toBeLessThan(pdfCost(1000, false));
	});
});

describe('parseDataUri', () => {
	it('round-trips bytes through a base64 data uri', () => {
		const bytes = [0x00, 0x89, 0x50, 0x4e, 0xff];
		const uri = `data:image/png;base64,${arrayBufferToBase64(new Uint8Array(bytes).buffer)}`;

		const parsed = parseDataUri(uri);

		expect(parsed?.mimeType).toBe('image/png');
		expect(Array.from(new Uint8Array(parsed!.bytes))).toEqual(bytes);
	});

	it('rejects a plain-text data uri that has nothing to re-encode', () => {
		expect(parseDataUri('data:image/svg+xml,<svg></svg>')).toBeNull();
	});

	it('rejects a non-data uri', () => {
		expect(parseDataUri('https://example.com/a.png')).toBeNull();
		expect(parseDataUri('')).toBeNull();
	});

	it('rejects a malformed base64 payload', () => {
		expect(parseDataUri('data:image/png;base64,!!!not base64!!!')).toBeNull();
	});
});

describe('dataUriByteLength', () => {
	function dataUri(bytes: number[]): string {
		// Encoded with the plugin's own helper, so this also covers the round
		// trip the exporter actually performs.
		const encoded = arrayBufferToBase64(new Uint8Array(bytes).buffer);
		return `data:image/png;base64,${encoded}`;
	}

	it.each([1, 2, 3, 4, 5, 6, 7, 8, 100])(
		'reports %i bytes exactly',
		(count) => {
			const bytes = Array.from({ length: count }, (_, i) => i % 256);
			expect(dataUriByteLength(dataUri(bytes))).toBe(count);
		},
	);

	it('is zero for a malformed uri with no comma', () => {
		expect(dataUriByteLength('data:image/png;base64')).toBe(0);
	});

	it('is zero for an empty payload', () => {
		expect(dataUriByteLength('data:image/png;base64,')).toBe(0);
	});
});
