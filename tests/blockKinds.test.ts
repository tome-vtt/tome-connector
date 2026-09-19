import { describe, expect, it } from 'vitest';

import { recognizeBlock } from '../src/blockKinds';

/**
 * The table every "Send to Tome" block button is driven by: a code-block language
 * and its parsed YAML in, what to send it as and where its id goes back out.
 */
function routed(language: string, parsed: unknown) {
	const row = recognizeBlock(language, parsed);
	return row && { sendable: row.sendable(parsed), writeBack: row.writeBack, preview: row.titleAndImagePreview };
}

describe('recognizeBlock', () => {
	it('sends a statblock as a creature, block as written, and writes back to `id`', () => {
		expect(routed('statblock', { monster: 'Goblin' })).toEqual({
			sendable: { kind: 'creature', block: { monster: 'Goblin' } },
			writeBack: 'creature',
			preview: undefined,
		});
	});

	it('sends a Leaflet map as a map, keeping Leaflet’s own `id` out of it', () => {
		expect(routed('leaflet', { id: 'keep', image: '[[Keep.jpg]]' })).toMatchObject({
			sendable: { kind: 'map', map: { image: 'Keep.jpg' } },
			writeBack: 'leaflet',
		});
	});

	it('sends a zoommap block as a map', () => {
		expect(routed('zoommap', { image: 'Assets/Keep.jpg' })).toMatchObject({
			sendable: { kind: 'map', map: { image: 'Assets/Keep.jpg' } },
			writeBack: 'zoommap',
		});
	});

	it('sends an encounter as its payload', () => {
		expect(routed('encounter', { name: 'Ambush', creatures: ['2: Goblin'] })).toMatchObject({
			sendable: { kind: 'encounter', encounter: { name: 'Ambush' } },
			writeBack: 'encounter',
		});
	});

	it('sends a prop, the one block Tome draws itself', () => {
		expect(routed('prop', { title: 'Simple Chest' })).toEqual({
			sendable: { kind: 'prop', block: { title: 'Simple Chest' } },
			writeBack: 'prop',
			preview: true,
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
