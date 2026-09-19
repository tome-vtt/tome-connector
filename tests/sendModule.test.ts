import { describe, expect, it } from 'vitest';

import { sendToTome as send } from '../src/sendModule';
import { TINY_PNG } from './fixtures/wireBodies';
import { bodyOf, inMemorySendPorts } from './fixtures/inMemorySendPorts';

const DESTINATION = { baseUrl: 'https://tome.example.com/', apiKey: 'key', campaignId: 'campaign-1' };

const INLINE_GOBLIN = {
	name: 'Goblin',
	size: 'Small',
	type: 'humanoid',
	ac: 15,
	hp: 7,
	stats: [8, 14, 10, 10, 8, 8],
};

function creature(source: Record<string, unknown>, path = 'Bestiary/Goblin.md') {
	return { kind: 'creature' as const, path, source };
}

describe('sending a creature', () => {
	it('posts an inline stat block to the NPC route with the key and campaign headers', async () => {
		const { ports, sent } = inMemorySendPorts();

		const result = await send(ports, creature(INLINE_GOBLIN), DESTINATION);

		expect(result).toMatchObject({ ok: true, id: 'id-1' });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			url: 'https://tome.example.com/api/nonplayercharacters/addnonplayercharacter',
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'key', 'X-Campaign-Id': 'campaign-1' },
		});
		const body = bodyOf(sent[0]);
		expect(body).toMatchObject({ name: 'Goblin', image: '', dnd5e: { size: 'Small', ac: 15, hp: '7' } });
	});

	it('fills a monster reference from the bestiary, the note\'s own fields on top', async () => {
		const { ports, sent } = inMemorySendPorts({ bestiary: { Goblin: INLINE_GOBLIN } });

		await send(ports, creature({ monster: 'Goblin', name: 'Snik' }), DESTINATION);

		expect(bodyOf(sent[0])).toMatchObject({ name: 'Snik', dnd5e: { size: 'Small', ac: 15 } });
	});

	it('refuses a monster reference with no bestiary, and sends nothing', async () => {
		const { ports, sent } = inMemorySendPorts();

		await expect(send(ports, creature({ monster: 'Goblin' }), DESTINATION)).rejects.toThrow(/Fantasy Statblocks/);
		expect(sent).toHaveLength(0);
	});

	it.each([
		['a quoted wikilink', '[[goblin.png]]'],
		['a wikilink with an alias', '[[goblin.png|The goblin]]'],
		['an unquoted wikilink, which YAML reads as a nested list', [['goblin.png']]],
	])('reads %s beside the note it is in', async (_, image) => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Bestiary/goblin.png': TINY_PNG } });

		await send(ports, creature({ ...INLINE_GOBLIN, image }), DESTINATION);

		expect(bodyOf(sent[0]).image).toBe(TINY_PNG);
	});

	it('sends a Pathfinder stat block as its pf2e bag, its wikilinked token read beside the note', async () => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Bestiary/goblin.png': TINY_PNG } });
		const goblin = {
			layout: 'Pathfinder 2e Creature Layout',
			name: 'Goblin Warrior',
			level: 'Creature -1',
			size: 'small',
			ac: 16,
			hp: 6,
			image: '[[goblin.png]]',
		};

		await send(ports, creature(goblin), DESTINATION);

		const body = bodyOf(sent[0]);
		expect(Object.keys(body).sort()).toEqual(['image', 'name', 'pf2e']);
		expect(body.image).toBe(TINY_PNG);
		expect(body.pf2e).toMatchObject({ name: 'Goblin Warrior', level: -1, size: 'Small', ac: 16, hp: 6 });
	});

	it('reads a path as written before resolving it as a link, so a vault-root path wins', async () => {
		const other = 'data:image/png;base64,AAAA';
		const { ports, sent } = inMemorySendPorts({ files: { 'goblin.png': TINY_PNG, 'Bestiary/goblin.png': other } });

		await send(ports, creature({ ...INLINE_GOBLIN, image: 'goblin.png' }), DESTINATION);

		expect(bodyOf(sent[0]).image).toBe(TINY_PNG);
	});

	it('reads a vault path as written', async () => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Tokens/goblin.webp': TINY_PNG } });

		await send(ports, creature({ ...INLINE_GOBLIN, image: 'Tokens/goblin.webp' }), DESTINATION);

		expect(bodyOf(sent[0]).image).toBe(TINY_PNG);
	});

	it('refuses a creature whose image cannot be read, so no local path reaches the server', async () => {
		const { ports, sent } = inMemorySendPorts();

		await expect(
			send(ports, creature({ ...INLINE_GOBLIN, image: '[[missing.png]]' }), DESTINATION),
		).rejects.toThrow(/could not be read/);
		expect(sent).toHaveLength(0);
	});
});

const TOME_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('sending a map', () => {
	it('sends a Leaflet map whose image is a wikilink to a file in another folder', async () => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Assets/Maps/Old Keep.jpg': TINY_PNG } });

		await send(ports, { kind: 'map', path: 'Adventures/Keep.md', source: { id: 'my-map', image: [['Old Keep.jpg']] } }, DESTINATION);

		expect(sent[0]?.url).toBe('https://tome.example.com/api/maps/addmap');
		expect(bodyOf(sent[0])).toEqual({ title: 'Old Keep', image: TINY_PNG });
	});

	it('sends a zoommap by its vault path, with the id Tome issued', async () => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Assets/the-old-keep.jpg': TINY_PNG } });

		await send(ports, { kind: 'map', path: 'Keep.md', source: { image: 'Assets/the-old-keep.jpg', id: TOME_ID } }, DESTINATION);

		expect(bodyOf(sent[0])).toEqual({ title: 'The Old Keep', image: TINY_PNG, id: TOME_ID });
	});
});

describe('sending an encounter', () => {
	it('posts the encounter as the recognizer reads it', async () => {
		const { ports, sent } = inMemorySendPorts();

		await send(ports, { kind: 'encounter', path: 'Keep.md', source: { name: 'Ambush', creatures: [{ 2: 'Goblin' }] } }, DESTINATION);

		expect(sent[0]?.url).toBe('https://tome.example.com/api/encounters/addencounter');
		expect(bodyOf(sent[0])).toEqual({ name: 'Ambush', encounterNpcs: [{ name: 'Goblin', quantity: 2 }] });
	});
});

describe('sending a prop', () => {
	it('sends the block\'s fields, its wikilinked image read from another folder, and only a Tome id', async () => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Assets/Props/chest.webp': TINY_PNG } });

		await send(
			ports,
			{ kind: 'prop', path: 'Keep.md', source: { title: 'Simple **Chest**', image: '[[chest.webp|A chest]]', tome_id: TOME_ID } },
			DESTINATION,
		);

		expect(sent[0]?.url).toBe('https://tome.example.com/api/props/addprop');
		expect(bodyOf(sent[0])).toEqual({ title: 'Simple Chest', image: TINY_PNG, id: TOME_ID });
	});
});

describe('sending a bare image', () => {
	it.each([
		['map', 'https://tome.example.com/api/maps/addmap'],
		['prop', 'https://tome.example.com/api/props/addprop'],
	] as const)('sends it as a %s titled by its file name', async (to, url) => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Art/Old Keep.png': TINY_PNG } });

		await send(ports, { kind: 'image', path: 'Art/Old Keep.png', to }, DESTINATION);

		expect(sent[0]?.url).toBe(url);
		expect(bodyOf(sent[0])).toEqual({ title: 'Old Keep', image: TINY_PNG });
	});
});

describe('sending a library item', () => {
	it('sends the parsed item with its art read off disk', async () => {
		const { ports, sent } = inMemorySendPorts({ files: { 'Items/img/rope.webp': TINY_PNG } });
		const item = { name: 'Rope', sourceKey: 'rope-xphb', imagePath: 'Items/img/rope.webp' };

		await send(ports, { kind: 'equipmentItem', path: 'Items/rope.md', source: { item } }, DESTINATION);

		expect(sent[0]?.url).toBe('https://tome.example.com/api/EquipmentItems/AddEquipmentItem');
		expect(bodyOf(sent[0])).toMatchObject({ name: 'Rope', image: TINY_PNG });
	});
});

describe('an image that is not in the vault', () => {
	it.each([
		['creature', { kind: 'creature', path: 'Goblin.md', source: { ...INLINE_GOBLIN, image: '[[missing.png]]' } }],
		['map', { kind: 'map', path: 'Keep.md', source: { image: '[[missing.png]]' } }],
		['prop', { kind: 'prop', path: 'Keep.md', source: { title: 'Chest', image: 'missing.png' } }],
		['bare image', { kind: 'image', path: 'missing.png', to: 'map' }],
		['library item', { kind: 'magicItem', path: 'Bag.md', source: { item: { name: 'Bag', imagePath: 'img/missing.webp' } } }],
	] as const)('refuses the %s, and sends nothing', async (_, sendable) => {
		const { ports, sent } = inMemorySendPorts();

		await expect(send(ports, sendable, DESTINATION)).rejects.toThrow(/could not be read/);
		expect(sent).toHaveLength(0);
	});
});
