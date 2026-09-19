/**
 * The send module: a recognised sendable and a destination go in, and the route,
 * the headers and the body are decided here, once, for every caller.
 *
 * It never imports `obsidian`. What it needs from outside sits behind
 * {@link SendPorts}, with two adapters: the vault, Fantasy Statblocks and
 * `requestUrl` in the plugin (`obsidianSendPorts.ts`), and
 * plain objects in the tests (`tests/fixtures/inMemorySendPorts.ts`) - which is
 * what lets the server-contract test pin the body the plugin really sends.
 *
 * Creatures only for now; the other kinds still go through `buildRequest`.
 */

import { resolveCreatureData, type StatblockBestiaryApi } from './fantasyStatblocksBestiary';
import type { Sendable } from './recognizers/noteScan';
import { mapToNpcPayload, type NpcPayload } from './recognizers/statblockCreature';
import { TOME_ROUTES } from './routes';
import { embedImages, type TomeImageKind } from './tomeImageDownscale';
import type { SendResult, TomeTarget } from './tomeHttp';
import { stripMarkdown } from './tomeMarkdownSanitizer';

export interface SendPorts {
	/**
	 * The image `reference` names, as a `data:` URI. `reference` is a vault path or
	 * a wikilink target, resolved the way Obsidian resolves links from the note at
	 * `sourcePath`. Throws when there is no such file.
	 */
	readImage(reference: string, sourcePath: string, kind: TomeImageKind): Promise<string>;
	/** The Fantasy Statblocks bestiary, or null when the plugin is not installed. */
	bestiary(): StatblockBestiaryApi | null;
	/** One JSON POST through the Tome HTTP module. */
	postJson(target: TomeTarget, payload: string): Promise<SendResult>;
}

/** Who a send is from and where it goes; the module adds the route. */
export type Destination = Omit<TomeTarget, 'path'>;

/** What the module sends today. Widens as the other kinds move here. */
export type ModuleSendable = Pick<Sendable, 'path' | 'source'> & { kind: 'creature' };

/**
 * Sends one sendable and reports what the server said.
 *
 * **Throwing means it never became a request** - a monster reference with no
 * bestiary, an image that is not in the vault. `runBulkSend` counts that as
 * unresolvable rather than retrying it; a refusal from the server comes back as
 * a result instead.
 */
export async function sendToTome(
	ports: SendPorts,
	sendable: ModuleSendable,
	destination: Destination,
): Promise<SendResult> {
	const body = await creatureBody(ports, sendable.source, sendable.path);
	return ports.postJson(
		{ ...destination, path: TOME_ROUTES.addNonPlayerCharacter },
		JSON.stringify(body),
	);
}

/**
 * Resolve against the bestiary, flatten the markdown links the CLI embeds in
 * every value, then swap image references for bytes. The image's link target is
 * taken out before the flattening, which would otherwise keep a wikilink's alias.
 */
async function creatureBody(
	ports: SendPorts,
	source: Record<string, unknown>,
	sourcePath: string,
): Promise<NpcPayload> {
	const resolved = resolveCreatureData(source, ports.bestiary());
	if ('image' in resolved) resolved.image = linkTarget(resolved.image);
	const cleaned = stripMarkdown(resolved);
	const withImages = await embedImages(cleaned, 'token', (reference, kind) =>
		ports.readImage(reference, sourcePath, kind),
	);
	return mapToNpcPayload(withImages as Record<string, unknown>);
}

/**
 * The file an image field points at. `image: [[goblin.png]]` unquoted is a list
 * holding a list to YAML, which is how Fantasy Statblocks' own docs write it;
 * quoted it is a wikilink string, maybe with an alias. A plain path is kept.
 */
function linkTarget(image: unknown): unknown {
	const value: unknown = Array.isArray(image) ? (image as unknown[]).flat(2)[0] : image;
	if (typeof value !== 'string') return value;
	return /^!?\[\[([^\]|#]+)/.exec(value.trim())?.[1]?.trim() ?? value;
}
