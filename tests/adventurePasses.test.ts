import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { entitiesPass, imagesPass, type PassDeps } from '../src/adventure/adventurePasses';
import type { AdventurePlan, PlannedEntity, PlannedImage } from '../src/adventure/adventurePlan';
import type { Note } from '../src/recognizers/note';
import { findSendables } from '../src/recognizers/noteScan';
import { sendToTome } from '../src/sendModule';
import { TINY_PNG } from './fixtures/wireBodies';
import { bodyOf, inMemorySendPorts } from './fixtures/inMemorySendPorts';

/**
 * An adventure's entities and images go through the send module, so each one is
 * the same request the same note or image sends on its own - compared here by
 * running both through the in-memory adapter.
 */

const DESTINATION = { baseUrl: 'https://tome.example.com/', apiKey: 'key', campaignId: 'campaign-1' };
const FILES = { 'Adventure/maps/Old Keep.png': TINY_PNG, 'Bestiary/goblin.png': TINY_PNG };

const GOBLIN: Note = {
	path: 'Bestiary/Goblin.md',
	content: '```statblock\nname: Goblin\nac: 15\nhp: 7\nstats: [8, 14, 10, 10, 8, 8]\nimage: "[[goblin.png]]"\n```\n',
	frontmatter: null,
};

function plan(entities: PlannedEntity[], images: PlannedImage[]): AdventurePlan {
	return { folder: 'Adventure', title: 'Adventure', summary: null, chapters: [], entities, images, coverKey: null };
}

function entity(key: string, to: PlannedEntity['chosen']['to']): PlannedEntity {
	const chosen = { to };
	return { key, label: 'Goblin', tomeName: 'Goblin', occurrences: 1, suggested: chosen, chosen, resolvedId: null };
}

function image(label: string, to: 'Map' | 'Prop'): PlannedImage {
	const path = 'Adventure/maps/Old Keep.png';
	return { key: path, label, dmPath: path, playerPath: null, suggested: { to }, chosen: { to }, resolvedId: null };
}

function deps(notes: Note[] = []) {
	const adapter = inMemorySendPorts({ files: FILES });
	const passDeps: PassDeps = {
		ports: adapter.ports,
		readNote: async (path) => {
			const found = notes.find((note) => note.path === path);
			if (!found) throw new Error(`"${path}" no longer exists in the vault.`);
			return found;
		},
		parseYaml: parse,
		sleep: async () => {},
	};
	return { ...adapter, passDeps };
}

describe('the entities pass', () => {
	it('sends a creature exactly as the note sends on its own, and keeps the id for the book', async () => {
		const harness = deps([GOBLIN]);
		const goblin = entity(GOBLIN.path, 'NonPlayerCharacter');

		const report = await entitiesPass(harness.passDeps, plan([goblin], []), DESTINATION);

		const alone = inMemorySendPorts({ files: FILES });
		await sendToTome(alone.ports, findSendables(GOBLIN, parse)[0]!, DESTINATION);
		expect(harness.sent).toEqual(alone.sent);
		expect(bodyOf(harness.sent[0])).toMatchObject({ name: 'Goblin', image: TINY_PNG });
		expect(report.sent).toHaveLength(1);
		expect(goblin.resolvedId).toBe('id-1');
	});

	it('refuses a note with nothing of the chosen kind, and sends nothing', async () => {
		const harness = deps([GOBLIN]);
		const goblin = entity(GOBLIN.path, 'MagicItem');

		const report = await entitiesPass(harness.passDeps, plan([goblin], []), DESTINATION);

		expect(harness.sent).toHaveLength(0);
		expect(report.failed[0]?.message).toMatch(/No magic item was found/);
		expect(goblin.resolvedId).toBeNull();
	});
});

describe('the images pass', () => {
	it.each([
		['map', 'Map', '/api/maps/addmap'],
		['prop', 'Prop', '/api/props/addprop'],
	] as const)('sends an image as a %s exactly as the image sends on its own', async (to, chosen, route) => {
		const harness = deps();
		// No caption: the plan labels it after its file name, as the image menu titles it.
		const keep = image('Old Keep', chosen);

		await imagesPass(harness.passDeps, plan([], [keep]), DESTINATION);

		const alone = inMemorySendPorts({ files: FILES });
		await sendToTome(alone.ports, { kind: 'image', path: keep.dmPath, to }, DESTINATION);
		expect(harness.sent).toEqual(alone.sent);
		expect(harness.sent[0]?.url).toBe(`https://tome.example.com${route}`);
		expect(keep.resolvedId).toBe('id-1');
	});

	it('titles an image after its caption, which is all the image on its own lacks', async () => {
		const harness = deps();

		await imagesPass(harness.passDeps, plan([], [image('The keep at dusk', 'Map')]), DESTINATION);

		expect(bodyOf(harness.sent[0])).toEqual({ title: 'The keep at dusk', image: TINY_PNG });
	});

	it('refuses an image that is not in the vault, and sends nothing', async () => {
		const harness = deps();
		const missing = { ...image('Gone', 'Map'), dmPath: 'Adventure/maps/gone.png' };

		const report = await imagesPass(harness.passDeps, plan([], [missing]), DESTINATION);

		expect(harness.sent).toHaveLength(0);
		expect(report.failed[0]?.message).toMatch(/could not be read/);
		expect(missing.resolvedId).toBeNull();
	});
});
