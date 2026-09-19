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
	/** What the server answers every request with; 201 and an id unless a test says otherwise. */
	status?: number;
}

/**
 * Mirrors the Obsidian adapter: the path as written, then as a link from the note the way
 * `getFirstLinkpathDest` finds one - beside the note first, then the shortest path anywhere
 * in the vault that ends in it.
 */
function resolveLink(files: Record<string, string>, linkpath: string, sourcePath: string): string | undefined {
	const folder = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
	const elsewhere = Object.keys(files)
		.filter((path) => path.endsWith(`/${linkpath}`))
		.sort((a, b) => a.length - b.length);
	return [linkpath, folder + linkpath, ...elsewhere].find((path) => path in files);
}

export function inMemorySendPorts({ files = {}, bestiary = null, status = 201 }: InMemoryVault = {}) {
	const sent: TomeRequest[] = [];
	/** Frontmatter written back, by note path. */
	const frontmatter: Record<string, Record<string, string>> = {};
	const http = createTomeHttp(async (request) => {
		sent.push(request);
		return { status, text: JSON.stringify({ id: `id-${sent.length}` }) };
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
		setFrontmatter: async (path, key, value) => {
			frontmatter[path] = { ...frontmatter[path], [key]: value };
		},
	};

	return { ports, sent, frontmatter };
}

/** The body of a recorded request, as the server would parse it. */
export function bodyOf(request: TomeRequest | undefined): Record<string, unknown> {
	if (!request) throw new Error('nothing was sent');
	return JSON.parse(request.body as string) as Record<string, unknown>;
}
