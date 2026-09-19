import { describe, expect, it } from 'vitest';

import { recognizeBlock } from '../src/blockKinds';

/**
 * The table every "Send to Tome" block button is driven by: a code-block language
 * and its parsed YAML in, what to send it as and where its id goes back out.
 */
describe('recognizeBlock', () => {
	it('sends a statblock as a creature and writes back to `id`', () => {
		expect(recognizeBlock('statblock', { monster: 'Goblin' })).toMatchObject({
			sends: 'creature',
			writeBack: 'creature',
		});
	});

	it('sends a Leaflet map as a map, keeping Leaflet’s own `id` out of it', () => {
		expect(recognizeBlock('leaflet', { id: 'keep', image: '[[Keep.jpg]]' })).toMatchObject({
			sends: 'map',
			writeBack: 'leaflet',
		});
	});

	it('sends a zoommap block as a map', () => {
		expect(recognizeBlock('zoommap', { image: 'Assets/Keep.jpg' })).toMatchObject({
			sends: 'map',
			writeBack: 'zoommap',
		});
	});

	it('sends an encounter', () => {
		const block = { name: 'Ambush', creatures: ['2: Goblin'] };
		expect(recognizeBlock('encounter', block)).toMatchObject({ sends: 'encounter', writeBack: 'encounter' });
	});

	it('sends a prop, the one block Tome renders itself', () => {
		expect(recognizeBlock('prop', { title: 'Simple Chest' })).toMatchObject({
			sends: 'prop',
			writeBack: 'prop',
			ownsFence: true,
		});
	});

	it.each([
		['a map naming no image', 'leaflet', { id: 'coords-only' }],
		['a prop with no title', 'prop', { image: 'chest.webp' }],
		['a prop with a blank title', 'prop', { title: '  ' }],
		['a statblock that is not a mapping', 'statblock', ['a', 'list']],
		['a statblock that is a bare string', 'statblock', 'Goblin'],
		['a language no row names', 'dataview', { title: 'x' }],
	])('offers no button for %s', (_, language, parsed) => {
		expect(recognizeBlock(language, parsed)).toBeNull();
	});
});
