import { describe, expect, it } from 'vitest';

import { sendCharacterToTome as sendCharacter, sendToTome as send } from '../src/sendModule';
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

describe('sending a character', () => {
	const SENDER = { baseUrl: 'https://tome.example.com/', apiKey: 'key' };
	const note = {
		path: 'Characters/Zabadun.md',
		frontmatter: { name: 'Zabadun', dndbeyond_id: 123, image: '[[zabadun.png]]' },
		content: '---\nname: Zabadun\n---\n# Zabadun\n',
	};

	it('sends to My Characters with no campaign header, and records the id as tome_vault_id', async () => {
		const { ports, sent, frontmatter } = inMemorySendPorts({ files: { 'Characters/zabadun.png': TINY_PNG } });

		const result = await sendCharacter(ports, note, SENDER, { kind: 'vault' });

		expect(result).toMatchObject({ ok: true, id: 'id-1' });
		expect(sent[0]?.url).toBe('https://tome.example.com/api/vault/characters/import');
		expect(sent[0]?.headers).not.toHaveProperty('X-Campaign-Id');
		expect(bodyOf(sent[0])).toMatchObject({ name: 'Zabadun', dndBeyondId: 123, image: TINY_PNG });
		expect(frontmatter).toEqual({ 'Characters/Zabadun.md': { tome_vault_id: 'id-1' } });
	});

	it('sends to a campaign with its header, and records the id as tome_id', async () => {
		const { ports, sent, frontmatter } = inMemorySendPorts({ files: { 'Characters/zabadun.png': TINY_PNG } });

		await sendCharacter(ports, note, SENDER, { kind: 'campaign', campaignId: 'campaign-1' });

		expect(sent[0]?.url).toBe('https://tome.example.com/api/playercharacters/addplayercharacter');
		expect(sent[0]?.headers).toMatchObject({ 'X-Api-Key': 'key', 'X-Campaign-Id': 'campaign-1' });
		expect(frontmatter).toEqual({ 'Characters/Zabadun.md': { tome_id: 'id-1' } });
	});

	it('records nothing when the server refuses the send', async () => {
		const { ports, frontmatter } = inMemorySendPorts({ status: 400 });

		const result = await sendCharacter(ports, { ...note, frontmatter: { name: 'Zabadun' } }, SENDER, { kind: 'vault' });

		expect(result.ok).toBe(false);
		expect(frontmatter).toEqual({});
	});

	it('sends only the properties the body reads, so an unread one cannot fail the send', async () => {
		const { ports, sent } = inMemorySendPorts();
		const stray = { name: 'Zabadun', portrait: { image: '[[missing.png]]' } };

		await sendCharacter(ports, { ...note, frontmatter: stray }, SENDER, { kind: 'vault' });

		expect(sent).toHaveLength(1);
		expect(bodyOf(sent[0])).not.toHaveProperty('portrait');
	});
});
