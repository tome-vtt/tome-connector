/**
 * The in-memory adapter for the send module's ports: a vault of images, a Fantasy Statblocks
 * bestiary and a Tome server, each a plain object, so the real module runs under vitest.
 *
 * The server end is the real Tome HTTP module over a transport that records what it was handed
 * and answers 201 with an id - so headers and routes are built by the code that ships.
 */

import type { SendPorts } from '../../src/sendModule';
import { createTomeHttp, type TomeRequest } from '../../src/tomeHttp';

export interface InMemoryVault {
	/** Vault path to the `data:` URI it holds. */
	files?: Record<string, string>;
	/** Creatures by bestiary name, or null for "Fantasy Statblocks is not installed". */
	bestiary?: Record<string, Record<string, unknown>> | null;
}

/** Mirrors the Obsidian adapter: the path as written, then as a link from the note - beside it, for these tests. */
function resolveLink(files: Record<string, string>, linkpath: string, sourcePath: string): string | undefined {
	const folder = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
	return [linkpath, folder + linkpath].find((path) => path in files);
}

export function inMemorySendPorts({ files = {}, bestiary = null }: InMemoryVault = {}) {
	const sent: TomeRequest[] = [];
	const http = createTomeHttp(async (request) => {
		sent.push(request);
		return { status: 201, text: JSON.stringify({ id: `id-${sent.length}` }) };
	});

	const ports: SendPorts = {
		readImage: async (reference, sourcePath) => {
			const path = resolveLink(files, reference, sourcePath);
			if (path === undefined) throw new Error(`No file at ${reference}`);
			return files[path] as string;
		},
		bestiary: () =>
			bestiary && { getCreatureFromBestiary: (name: string) => bestiary[name] ?? null },
		postJson: http.postJson,
	};

	return { ports, sent };
}

/** The body of a recorded request, as the server would parse it. */
export function bodyOf(request: TomeRequest | undefined): Record<string, unknown> {
	if (!request) throw new Error('nothing was sent');
	return JSON.parse(request.body as string) as Record<string, unknown>;
}
