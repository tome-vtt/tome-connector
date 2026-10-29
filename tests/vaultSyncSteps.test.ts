import { describe, expect, it } from 'vitest';

import type { Sendable } from '../src/recognizers/noteScan';
import type { NoteSource } from '../src/scopeReader';
import { runBulkSend, THROTTLE_MS } from '../src/bulkSend';
import { sendToTome, type Destination, type SendPorts } from '../src/sendModule';
import { scanScope } from '../src/vaultSyncSteps';
import { inMemorySendPorts } from './fixtures/inMemorySendPorts';

const DESTINATION = { baseUrl: 'https://tome.example.com/', apiKey: 'key', campaignId: 'campaign-1' };
const GOBLIN = { name: 'Goblin', size: 'Small', type: 'humanoid', ac: 15, hp: 7, stats: [8, 14, 10, 10, 8, 8] };

/** A statblock fence; JSON is YAML, so `JSON.parse` stands in for Obsidian's parser. */
const statblock = (block: Record<string, unknown>): string => '```statblock\n' + JSON.stringify(block) + '\n```\n';

function vault(notes: Record<string, { tags?: string[]; content: string }>): NoteSource {
	return {
		paths: () => Object.keys(notes),
		tags: (path) => notes[path]?.tags ?? [],
		read: (path) => Promise.resolve({ path, content: notes[path]?.content ?? '', frontmatter: null }),
	};
}

const notes = vault({
	'Bestiary/Goblin.md': { tags: ['#tome'], content: statblock(GOBLIN) },
	'Bestiary/Orc.md': { content: statblock({ ...GOBLIN, name: 'Orc' }) },
	'Session 1.md': { content: 'Nothing to send here.' },
});

const labels = (found: { sendables: Sendable[] }) => found.sendables.map((sendable) => sendable.label);

describe('scanScope', () => {
	it('finds the sendables in the whole vault', async () => {
		expect(labels(await scanScope(notes, { kind: 'vault' }, JSON.parse))).toEqual(['Goblin', 'Orc']);
	});

	it('finds only those in a tag scope', async () => {
		expect(labels(await scanScope(notes, { kind: 'tag', tag: 'tome' }, JSON.parse))).toEqual(['Goblin']);
	});

	it('finds nothing in a folder with no sendables, counting each note read', async () => {
		const progress: [number, number][] = [];
		const folder = { kind: 'folder' as const, folder: { path: 'Session 1.md', name: 'Session 1.md' } };

		const found = await scanScope(notes, folder, JSON.parse, (done, total) => progress.push([done, total]));

		expect(found).toEqual({ sendables: [], warnings: [] });
		expect(progress).toEqual([[1, 1]]);
	});

	it('sends only the one note when the scope is that note’s own path', async () => {
		const note = { kind: 'folder' as const, folder: { path: 'Bestiary/Goblin.md', name: 'Goblin.md' } };

		expect(labels(await scanScope(notes, note, JSON.parse))).toEqual(['Goblin']);
	});

	/** The 2026-10-27 test run: each of these was skipped or narrowed without a word. */
	it('lists every block it skips and every entry it changes, under its note', async () => {
		const fence = (language: string, block: Record<string, unknown>) =>
			'```' + language + '\n' + JSON.stringify(block) + '\n```\n';
		const swamp = vault({
			'Swamp.md': {
				content:
					fence('encounter', { name: ' ', creatures: ['Goblin'] }) +
					fence('encounter', { name: 'Frogs', creatures: [{ '2d4': 'Giant Frog' }, { Ogre: { hp: 70 } }, 42] }) +
					fence('statblock', { layout: 'Basic 5e Layout' }) +
					fence('leaflet', { id: 'swamp-map' }) +
					'```zoommap\n{not yaml\n```\n',
			},
		});

		const found = await scanScope(swamp, { kind: 'vault' }, JSON.parse);

		expect(labels(found)).toEqual(['Frogs']);
		expect(found.warnings).toEqual([
			{ path: 'Swamp.md', message: 'Encounter block skipped: it has no name.' },
			{ path: 'Swamp.md', message: 'Frogs: "2d4: Giant Frog" sent as 1 Giant Frog, since dice are not rolled.' },
			{ path: 'Swamp.md', message: 'Frogs: Ogre sent without its overrides, which Tome does not keep.' },
			{ path: 'Swamp.md', message: 'Frogs: creature entry 42 skipped: it names no creature.' },
			{ path: 'Swamp.md', message: 'Statblock block skipped: it has no stats and no monster: reference.' },
			{ path: 'Swamp.md', message: 'Map block skipped: it names no image.' },
			{ path: 'Swamp.md', message: 'Map block skipped: its YAML could not be read.' },
		]);
	});
});

/** What the vault sync runs: each sendable through the ports, paced and retried by runBulkSend. */
function sendSendables(options: {
	sendables: Sendable[];
	ports: SendPorts;
	destination: Destination;
	sleep: (ms: number) => Promise<void>;
	onProgress?: Parameters<typeof runBulkSend<Sendable>>[0]['onProgress'];
	isCancelled?: () => boolean;
}) {
	const { sendables, ports, destination, ...rest } = options;
	return runBulkSend<Sendable>({
		items: sendables.map((sendable) => ({ label: sendable.label, path: sendable.path, value: sendable })),
		throttleMs: THROTTLE_MS,
		send: (item) => sendToTome(ports, item.value, destination),
		...rest,
	});
}

describe('sendSendables', () => {
	const sleep = () => Promise.resolve();
	const scan = async () => (await scanScope(notes, { kind: 'vault' }, JSON.parse)).sendables;

	it('sends each through the ports and reports progress per item', async () => {
		const { ports, sent } = inMemorySendPorts();
		const progress: [number, number, string][] = [];

		const report = await sendSendables({
			sendables: await scan(),
			ports,
			destination: DESTINATION,
			sleep,
			onProgress: (done, total, latest) => progress.push([done, total, latest.item.label]),
		});

		expect(report.sent.map((outcome) => outcome.id)).toEqual(['id-1', 'id-2']);
		expect(report).toMatchObject({ failed: [], cancelled: false });
		expect(sent.map((request) => request.headers['X-Campaign-Id'])).toEqual(['campaign-1', 'campaign-1']);
		expect(progress).toEqual([[1, 2, 'Goblin'], [2, 2, 'Orc']]);
	});

	it('ends after the current item when stopped', async () => {
		const { ports, sent } = inMemorySendPorts();
		let done = 0;

		const report = await sendSendables({
			sendables: await scan(),
			ports,
			destination: DESTINATION,
			sleep,
			onProgress: (count) => (done = count),
			isCancelled: () => done >= 1,
		});

		expect(sent).toHaveLength(1);
		expect(report.cancelled).toBe(true);
		expect(report.sent).toHaveLength(1);
	});

	it('reports a refusal without retrying it', async () => {
		const { ports, sent } = inMemorySendPorts({ status: 400 });

		const report = await sendSendables({ sendables: await scan(), ports, destination: DESTINATION, sleep });

		expect(report.sent).toEqual([]);
		expect(report.failed.map((outcome) => outcome.reason)).toEqual(['refused', 'refused']);
		expect(sent).toHaveLength(2);
	});

	it('reports an item that cannot be turned into a request as unresolvable, and carries on', async () => {
		const { ports } = inMemorySendPorts();
		const sendables: Sendable[] = [
			{ kind: 'creature', path: 'A.md', label: 'Gnoll', block: { monster: 'Gnoll' } },
			...(await scan()),
		];

		const report = await sendSendables({ sendables, ports, destination: DESTINATION, sleep });

		expect(report.failed).toHaveLength(1);
		expect(report.failed[0]).toMatchObject({ reason: 'unresolvable', attempts: 0 });
		expect(report.failed[0]?.message).toMatch(/Fantasy Statblocks/);
		expect(report.sent).toHaveLength(2);
	});
});
