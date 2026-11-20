import { describe, expect, it } from 'vitest';

import { findImages, isPlayerVersion, pairGallery } from '../src/adventure/adventureImages';

describe('findImages', () => {
	it('keeps a stray % in an image path as written', () => {
		const images = findImages('![Sale](img/50%off.png) and ![[maps/50%off.webp]]');

		expect(images.map((image) => image.path)).toEqual(['img/50%off.png', 'maps/50%off.webp']);
	});

	it('decodes a valid escape in an image path', () => {
		expect(findImages('![Sale](img/half%20off.png)').map((image) => image.path)).toEqual(['img/half off.png']);
	});

	it('finds a markdown image embed', () => {
		const markdown = '![Battle map](3-Mechanics/CLI/adventures/maps/room-1.webp)';
		const images = findImages(markdown);

		expect(images).toEqual([
			{
				altText: 'Battle map',
				path: '3-Mechanics/CLI/adventures/maps/room-1.webp',
				center: false,
				start: 0,
				end: markdown.length,
			},
		]);
	});

	it('finds a wikilink embed', () => {
		const images = findImages('![[maps/room-1.png|Room 1]]');
		expect(images[0]).toMatchObject({ altText: 'Room 1', path: 'maps/room-1.png' });
	});

	it('reads the #center alignment hint', () => {
		const images = findImages('![A portrait](art/npc.png#center)');
		expect(images[0]?.center).toBe(true);
	});

	it('ignores a markdown transclusion that is not an image', () => {
		expect(findImages('![[3-Mechanics/CLI/rules/embed-note.md]]')).toEqual([]);
	});

	it('ignores a plain link that happens to point at an image-shaped path with no bang', () => {
		expect(findImages('[Not an embed](art/npc.png)')).toEqual([]);
	});

	it('finds several images in document order', () => {
		const images = findImages('![A](a.png) some text ![B](b.webp)');
		expect(images.map((image) => image.path)).toEqual(['a.png', 'b.webp']);
	});
});

describe('isPlayerVersion', () => {
	it('recognises the "Player Version" alt text', () => {
		expect(isPlayerVersion('Player Version', 'room-1.webp')).toBe(true);
	});

	it('recognises the "Without Tokens" alt text', () => {
		expect(isPlayerVersion('Without Tokens', 'room-1.webp')).toBe(true);
	});

	it('recognises a -player or -pc filename suffix', () => {
		expect(isPlayerVersion('', 'room-1-player.webp')).toBe(true);
		expect(isPlayerVersion('', 'npc-portrait-pc.png')).toBe(true);
	});

	it('does not flag the DM version', () => {
		expect(isPlayerVersion('', 'room-1.webp')).toBe(false);
		expect(isPlayerVersion('DM Version', 'room-1.webp')).toBe(false);
	});
});

describe('pairGallery', () => {
	it('pairs a DM image with the player image that follows it', () => {
		const images = findImages(
			'![](room-1.webp) ![Player Version](room-1-player.webp)',
		);
		const pairs = pairGallery(images);

		expect(pairs).toHaveLength(1);
		expect(pairs[0]?.dm.path).toBe('room-1.webp');
		expect(pairs[0]?.player?.path).toBe('room-1-player.webp');
	});

	it('reports an unpaired image alone', () => {
		const images = findImages('![](room-1.webp)');
		expect(pairGallery(images)).toEqual([{ dm: images[0], player: null }]);
	});

	it('does not pair two DM images together', () => {
		const images = findImages('![](room-1.webp) ![](room-2.webp)');
		const pairs = pairGallery(images);
		expect(pairs).toEqual([
			{ dm: images[0], player: null },
			{ dm: images[1], player: null },
		]);
	});
});
