import { describe, expect, it } from 'vitest';

import { send } from '../src/sendModule';
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
