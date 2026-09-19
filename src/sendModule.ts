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
 * Every kind a block button, the bulk sync or the image menu sends goes through
 * here. Player characters and the adventure import's images do not yet.
 */

import { resolveCreatureData, type StatblockBestiaryApi } from './fantasyStatblocksBestiary';
import { equipmentItemBody, magicItemBody, spellBody } from './libraryItemBody';
import { unwrapWikilink, type MapReference } from './recognizers/map';
import type { SendableKind, SendableParse } from './recognizers/noteScan';
import { mapToNpcPayload, type NpcPayload } from './recognizers/statblockCreature';
import { TOME_ROUTES, type TomeRoute } from './routes';
import { embedImages, type TomeImageKind } from './tomeImageDownscale';
import type { SendResult, TomeTarget } from './tomeHttp';
import { existingTomeId } from './tomeIdWriteBack';
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

/**
 * What the module sends: a scanned sendable, a `prop` block, or a bare image file
 * sent as a map or a prop. `path` is the note the thing is in - what an image link
 * resolves from - and for a bare image it is the image itself.
 */
export type ModuleSendable =
	| (SendableParse & { path: string })
	| { kind: 'prop'; path: string; block: Record<string, unknown> }
	| { kind: 'image'; path: string; to: 'map' | 'prop' };

/** Which route each kind posts to; pinned by `tests/sendModule.test.ts`. */
const ROUTES: Record<SendableKind | 'prop', TomeRoute> = {
	creature: TOME_ROUTES.addNonPlayerCharacter,
	encounter: TOME_ROUTES.addEncounter,
	map: TOME_ROUTES.addMap,
	prop: TOME_ROUTES.addProp,
	magicItem: TOME_ROUTES.addMagicItem,
	equipmentItem: TOME_ROUTES.addEquipmentItem,
	spell: TOME_ROUTES.addSpell,
};

/**
 * Sends one sendable and reports what the server said.
 *
 * **Throwing means it never became a request** - a monster reference with no
 * bestiary, an image that is not in the vault. `runBulkSend` counts that as
 * unresolvable rather than retrying it; a refusal from the server comes back as
 * a result instead.
 *
 * **An image that cannot be read throws, for every kind.** Nothing is sent: not
 * the thing without its picture, and never the local path in its place. A map
 * without its image is not a map, and one rule is easier to trust than a list of
 * exceptions - a library item used to go without its art instead.
 */
export async function sendToTome(
	ports: SendPorts,
	sendable: ModuleSendable,
	destination: Destination,
): Promise<SendResult> {
	const kind = sendable.kind === 'image' ? sendable.to : sendable.kind;
	const body = await bodyFor(ports, sendable);
	return ports.postJson({ ...destination, path: ROUTES[kind] }, JSON.stringify(body));
}

async function bodyFor(ports: SendPorts, sendable: ModuleSendable): Promise<unknown> {
	const { path } = sendable;
	if (sendable.kind === 'image') {
		// The file name is the only thing on a bare image that reads like a title. Kept
		// as written (Obsidian's `basename`), not title-cased the way a map block's is.
		const title = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
		const kind = sendable.to === 'map' ? 'map' : 'token';
		return { title, image: await readImage(ports, path, path, kind) };
	}

	switch (sendable.kind) {
		case 'creature':
			return creatureBody(ports, sendable.block, path);
		case 'encounter':
			return sendable.encounter;
		case 'map':
			return mapBody(ports, sendable.map, path);
		case 'prop':
			return propBody(ports, sendable.block, path);
		case 'magicItem':
			return magicItemBody(sendable.item, await itemImage(ports, sendable.item, path));
		case 'equipmentItem':
			return equipmentItemBody(sendable.item, await itemImage(ports, sendable.item, path));
		case 'spell':
			return spellBody(sendable.spell, await itemImage(ports, sendable.spell, path));
	}
}

/**
 * Reads one named image through the port, and says which when it cannot. A
 * creature or prop, whose images the `embedImages` walk finds, throws that walk's
 * error instead - the same outcome: nothing sent.
 */
async function readImage(
	ports: SendPorts,
	reference: string,
	sourcePath: string,
	kind: TomeImageKind,
): Promise<string> {
	try {
		return await ports.readImage(reference, sourcePath, kind);
	} catch {
		throw new Error(`The image ${reference} could not be read. Nothing was sent to Tome.`);
	}
}

/** Swaps every image reference in a parsed block for its bytes, resolved from the note. */
function embedFrom(ports: SendPorts, value: unknown, sourcePath: string): Promise<unknown> {
	return embedImages(value, 'token', (reference, kind) => ports.readImage(reference, sourcePath, kind));
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
	if ('image' in resolved) resolved.image = unwrapWikilink(resolved.image) ?? resolved.image;
	const withImages = await embedFrom(ports, stripMarkdown(resolved), sourcePath);
	return mapToNpcPayload(withImages as Record<string, unknown>);
}

/**
 * Only the image, a title and an id Tome issued. Everything else in a map block is
 * the map plugin's own display configuration - zoom bounds, layers, markers - which
 * `mapReferenceFrom` already left behind and Tome neither models nor should be storing.
 */
async function mapBody(
	ports: SendPorts,
	reference: MapReference,
	sourcePath: string,
): Promise<Record<string, string>> {
	const body: Record<string, string> = {
		title: reference.title,
		image: await readImage(ports, reference.image, sourcePath, 'map'),
	};
	if (reference.id !== undefined) body.id = reference.id;
	return body;
}

/** The whole block, its markdown flattened, its image read, and only an id Tome issued. */
function propBody(ports: SendPorts, source: Record<string, unknown>, sourcePath: string): Promise<unknown> {
	const payload: Record<string, unknown> = { ...source };
	delete payload.id;
	delete payload.tome_id;
	const id = existingTomeId(source);
	if (id !== undefined) payload.id = id;
	if ('image' in payload) payload.image = unwrapWikilink(payload.image) ?? payload.image;
	return embedFrom(ports, stripMarkdown(payload), sourcePath);
}

/** A library item's art as bytes, or undefined when it has none. Its local path is never sent. */
async function itemImage(
	ports: SendPorts,
	{ imagePath }: { imagePath: string | null },
	sourcePath: string,
): Promise<string | undefined> {
	return imagePath ? readImage(ports, imagePath, sourcePath, 'token') : undefined;
}
