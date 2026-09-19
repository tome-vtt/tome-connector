import { describe, expect, it } from 'vitest';

import { mapReferenceFrom, titleFromImagePath, unwrapWikilink } from '../src/recognizers/map';

describe('unwrapWikilink', () => {
	it('takes the target, not the alias', () => {
		expect(unwrapWikilink('[[Maps/Keep.jpg|The Old Keep]]')).toBe('Maps/Keep.jpg');
	});

	it('handles an embed', () => {
		expect(unwrapWikilink('![[Map.jpg]]')).toBe('Map.jpg');
	});

	it('leaves a plain path alone, which is how zoommap writes it', () => {
		expect(unwrapWikilink('Assets/Map.jpg')).toBe('Assets/Map.jpg');
	});
});

describe('titleFromImagePath', () => {
	it.each([
		['Assets/the-old-keep.jpg', 'The Old Keep'],
		['Maps/goblin_cave.png', 'Goblin Cave'],
		['Map.webp', 'Map'],
		['Maps/Sunless Citadel.jpg', 'Sunless Citadel']
	])('turns %s into %s', (path, expected) => {
		expect(titleFromImagePath(path)).toBe(expected);
	});
});

describe('mapReferenceFrom', () => {
	it('reads a Leaflet block', () => {
		const reference = mapReferenceFrom({
			id: 'my-map',
			image: '[[Maps/Keep.jpg]]',
			height: '500px'
		});

		expect(reference).toEqual({ image: 'Maps/Keep.jpg', title: 'Keep' });
	});

	/**
	 * The form zoommap's own README leads with, and the one the connector did not
	 * read at all — it only ever looked at `imageBases`.
	 */
	it('reads the single-image zoommap form', () => {
		expect(mapReferenceFrom({ image: 'Assets/Map.jpg', minZoom: 0.3 })).toEqual({
			image: 'Assets/Map.jpg',
			title: 'Map'
		});
	});

	it('reads a layered zoommap block, taking the first base', () => {
		const reference = mapReferenceFrom({
			imageBases: [{ path: 'Assets/Ground.jpg' }, { path: 'Assets/Upper.jpg' }]
		});

		expect(reference?.image).toBe('Assets/Ground.jpg');
	});

	it('accepts imageBases written as bare strings', () => {
		expect(mapReferenceFrom({ imageBases: ['Assets/Ground.jpg'] })?.image).toBe(
			'Assets/Ground.jpg'
		);
	});

	it('prefers an explicit image over imageBases', () => {
		const reference = mapReferenceFrom({
			image: 'Assets/Chosen.jpg',
			imageBases: [{ path: 'Assets/Other.jpg' }]
		});

		expect(reference?.image).toBe('Assets/Chosen.jpg');
	});

	/**
	 * Leaflet's `id` is the user's own string. Forwarding it would fail model
	 * binding server-side and turn a working import into a 400 for everyone using
	 * Leaflet the normal way.
	 */
	it('drops a non-GUID id', () => {
		expect(mapReferenceFrom({ id: 'my-map', image: 'Map.jpg' })).not.toHaveProperty('id');
	});

	it('carries a GUID id', () => {
		const id = '3e8f6c30-0000-4000-8c00-000000000001';
		expect(mapReferenceFrom({ id, image: 'Map.jpg' })?.id).toBe(id);
	});

	it("carries Tome's id from tome_id beside Leaflet's own id", () => {
		const id = '3e8f6c30-0000-4000-8c00-000000000001';
		expect(mapReferenceFrom({ id: 'my-map', tome_id: id, image: 'Map.jpg' })?.id).toBe(id);
	});

	it.each([[{}], [{ image: '   ' }], [{ imageBases: [] }], [null], [['a']]])(
		'returns null for %o, which has no image to send',
		(input) => {
			expect(mapReferenceFrom(input)).toBeNull();
		}
	);
});
