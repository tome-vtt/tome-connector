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

	it('passes each changed encounter entry to warn', () => {
		const warnings: string[] = [];
		const parsed = { name: 'Frogs', creatures: [{ '2d4': 'Giant Frog' }] };

		const sendable = recognizeBlock('encounter', parsed)?.sendable(parsed, (message) => warnings.push(message));

		expect(sendable).toMatchObject({ encounter: { encounterNpcs: [{ name: 'Giant Frog', quantity: 1 }] } });
		expect(warnings).toEqual(['Frogs: "2d4: Giant Frog" sent as 1 Giant Frog, since dice are not rolled.']);
	});

	it('passes a layered map’s dropped layers to warn', () => {
		const warnings: string[] = [];
		const parsed = { imageBases: [{ path: 'Assets/Keep.jpg' }, { path: 'Assets/Cellar.jpg' }] };

		recognizeBlock('zoommap', parsed)?.sendable(parsed, (message) => warnings.push(message));

		expect(warnings).toEqual(['Map Assets/Keep.jpg: only its first layer is sent, since Tome holds one image per map.']);
	});

	it('passes a statblock trait with no name to warn', () => {
		const warnings: string[] = [];
		const parsed = { name: 'Goblin', stats: [8, 14, 10, 10, 8, 8], traits: [{ name: '', desc: 'Nimble.' }] };

		recognizeBlock('statblock', parsed)?.sendable(parsed, (message) => warnings.push(message));

		expect(warnings).toEqual(['Goblin: entry {"name":"","desc":"Nimble."} left out: it has no name.']);
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
