import { describe, expect, it } from 'vitest';
import {
	DOWNSCALEABLE_TYPES,
	TOME_MAX_EDGE,
	WEBP_QUALITY,
	downscaleWarning,
	imageKindForKey,
	keepReencoded,
} from '../src/tomeImageDownscale';
import {
	dataUriByteLength,
	parseDataUri,
	toDataUri,
} from '../src/tomeImageEncoding';

/**
 * The pure half only. `downscaleImageBytes` reaches for `createImageBitmap`,
 * `createEl` and a canvas, none of which exist under Node - the same split
 * `tomeImageOptimizer.test.ts` makes, and the reason the policy is factored out
 * of the pixel work at all.
 */

describe('TOME_MAX_EDGE', () => {
	it('caps a map well above a token, because that is where the bytes are', () => {
		// Measured against a real ttrpg-convert-cli vault: 1,469 maps at a median
		// 3600px against a token corpus with a median of 280px.
		expect(TOME_MAX_EDGE.map).toBeGreaterThan(TOME_MAX_EDGE.cover);
		expect(TOME_MAX_EDGE.cover).toBeGreaterThan(TOME_MAX_EDGE.token);
	});

	it('leaves a map usable at the table', () => {
		// Below roughly 100px per square on a thirty-square battle map the art goes
		// visibly soft once a GM zooms in.
		expect(TOME_MAX_EDGE.map / 30).toBeGreaterThanOrEqual(100);
	});

	it('is whole pixels in every kind', () => {
		for (const edge of Object.values(TOME_MAX_EDGE)) {
			expect(Number.isInteger(edge)).toBe(true);
			expect(edge).toBeGreaterThan(0);
		}
	});
});

describe('keepReencoded', () => {
	it('keeps a re-encode that actually saved something', () => {
		expect(keepReencoded(1000, 999)).toBe(true);
	});

	it('discards one that saved nothing, so an image is never made worse for free', () => {
		expect(keepReencoded(1000, 1000)).toBe(false);
		expect(keepReencoded(1000, 1001)).toBe(false);
	});

});

describe('DOWNSCALEABLE_TYPES', () => {
	it('covers the raster formats a vault actually holds', () => {
		expect(DOWNSCALEABLE_TYPES.has('image/webp')).toBe(true);
		expect(DOWNSCALEABLE_TYPES.has('image/png')).toBe(true);
		expect(DOWNSCALEABLE_TYPES.has('image/jpeg')).toBe(true);
	});

	it('leaves an animated GIF alone, since a canvas keeps only its first frame', () => {
		expect(DOWNSCALEABLE_TYPES.has('image/gif')).toBe(false);
	});

	it('leaves vector art alone', () => {
		expect(DOWNSCALEABLE_TYPES.has('image/svg+xml')).toBe(false);
	});
});

describe('WEBP_QUALITY', () => {
	it('is a real quality, not a stray percentage', () => {
		expect(WEBP_QUALITY).toBeGreaterThan(0);
		expect(WEBP_QUALITY).toBeLessThanOrEqual(1);
	});
});

describe('imageKindForKey', () => {
	it('trusts a key literally named map over whatever the caller guessed', () => {
		expect(imageKindForKey('map', 'token')).toBe('map');
		expect(imageKindForKey('map', 'map')).toBe('map');
	});

	it('lets a generic image key mean whatever the caller is sending', () => {
		expect(imageKindForKey('image', 'token')).toBe('token');
		expect(imageKindForKey('image', 'map')).toBe('map');
		expect(imageKindForKey('image', 'cover')).toBe('cover');
	});

	it('keeps walking past anything that is not an image key', () => {
		// Null is what tells the walker to recurse rather than to read a file.
		expect(imageKindForKey('name', 'map')).toBeNull();
		expect(imageKindForKey('tokenImage', 'token')).toBeNull();
		expect(imageKindForKey('', 'token')).toBeNull();
	});
});

describe('toDataUri', () => {
	const bytes = (): ArrayBuffer => Uint8Array.from([0, 1, 2, 250, 251, 255]).buffer;

	it('names the MIME type it was given rather than sniffing the bytes', () => {
		// Nothing decodes here, so the caller's type is the only one there is -
		// which is why `readImageAsDataUri` derives it from the file extension
		// before calling in.
		expect(toDataUri(bytes(), 'image/png').startsWith('data:image/png;base64,')).toBe(true);
		expect(toDataUri(bytes(), 'image/gif').startsWith('data:image/gif;base64,')).toBe(true);
	});

	it('round-trips through parseDataUri unchanged', () => {
		// The whole point of the "send it as it is" path: what comes out the far
		// end has to be the bytes that went in, to the byte.
		const parsed = parseDataUri(toDataUri(bytes(), 'image/webp'));
		expect(parsed).not.toBeNull();
		expect(parsed?.mimeType).toBe('image/webp');
		expect(Array.from(new Uint8Array(parsed?.bytes ?? new ArrayBuffer(0)))).toEqual([
			0, 1, 2, 250, 251, 255,
		]);
	});

	it('agrees with dataUriByteLength, which is what the size checks read', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 6, 7]) {
			const buffer = new Uint8Array(length).buffer;
			expect(dataUriByteLength(toDataUri(buffer, 'image/png'))).toBe(length);
		}
	});
});

describe('downscaleWarning', () => {
	it('says nothing while downscaling is on', () => {
		// The setting's own description already explains what it does; a warning
		// about the default behaviour would be noise on every settings visit.
		expect(downscaleWarning(true)).toBeNull();
	});

	it('names both ceilings and the fact that one of them fails quietly', () => {
		const warning = downscaleWarning(false) ?? '';
		expect(warning).toContain('50 MB');
		expect(warning).toContain('5 MB');
		// The silent drop is the only part a user could not discover for
		// themselves, so it is the part that must survive an edit to this copy.
		expect(warning).toContain('silently');
	});
});
