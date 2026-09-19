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
 * {@link sendToTome}; a player character through {@link sendCharacterToTome}, whose
 * destination decides its route and campaign. The adventure import's images do not yet.
 */

import { requestFor, type CharacterDestination } from './characterDestination';
import { resolveCreatureData, type StatblockBestiaryApi } from './fantasyStatblocksBestiary';
import { libraryItemBody, type LibraryItemKind } from './libraryItemBody';
import { PLAYER_CHARACTER_PROPERTIES, playerCharacterBody, type PlayerCharacterBody } from './playerCharacterBody';
import { mapToEncounterPayload, type EncounterPayload } from './recognizers/encounter';
import { mapReferenceFrom, unwrapWikilink } from './recognizers/map';
import type { Sendable, SendableKind } from './recognizers/noteScan';
import { mapToNpcPayload, type NpcPayload } from './recognizers/statblockCreature';
import { TOME_ROUTES } from './routes';
import { embedImages, type TomeImageKind } from './tomeImageDownscale';
import type { SendResult, TomeTarget } from './tomeHttp';
import { existingTomeId } from './tomeIdWriteBack';
import { stripMarkdown } from './tomeMarkdownSanitizer';
import { parsePcSheet } from './tomePcSheetParser';

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
	/** Sets one frontmatter property on the note at `path`, leaving the rest alone. */
	setFrontmatter(path: string, key: string, value: string): Promise<void>;
}

/** Who a send is from and where it goes; the module adds the route. */
export type Destination = Omit<TomeTarget, 'path'>;

/**
 * What the module sends: a scanned sendable, a `prop` block, or a bare image file
 * sent as a map or a prop. `path` is the note the thing is in - what an image link
 * resolves from - and for a bare image it is the image itself.
 */
export type ModuleSendable =
	| (Pick<Sendable, 'path' | 'source'> & { kind: SendableKind | 'prop' })
	| { kind: 'image'; path: string; to: 'map' | 'prop' };

const ROUTES = {
	creature: TOME_ROUTES.addNonPlayerCharacter,
	encounter: TOME_ROUTES.addEncounter,
	map: TOME_ROUTES.addMap,
	prop: TOME_ROUTES.addProp,
	magicItem: TOME_ROUTES.addMagicItem,
	equipmentItem: TOME_ROUTES.addEquipmentItem,
	spell: TOME_ROUTES.addSpell,
} as const;

/**
 * Sends one sendable and reports what the server said.
 *
 * **Throwing means it never became a request** - a monster reference with no
 * bestiary, a map that no longer names an image. `runBulkSend` counts that as
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

	const { source } = sendable;
	switch (sendable.kind) {
		case 'creature':
			return creatureBody(ports, source, path);
		case 'encounter':
			return encounterBody(source);
		case 'map':
			return mapBody(ports, source, path);
		case 'prop':
			return propBody(ports, source, path);
		case 'magicItem':
		case 'equipmentItem':
		case 'spell':
			return itemBody(ports, sendable.kind, source, path);
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

function encounterBody(source: Record<string, unknown>): EncounterPayload {
	const payload = mapToEncounterPayload(source);
	// It was sendable when it was found, so this means the note changed underneath -
	// worth saying plainly rather than sending an empty encounter.
	if (!payload) throw new Error('This encounter no longer has a name.');
	return payload;
}

/**
 * Only the image, a title and an id Tome issued. Everything else in a map block is
 * the map plugin's own display configuration - zoom bounds, layers, markers - which
 * Tome neither models nor should be storing.
 */
async function mapBody(
	ports: SendPorts,
	source: Record<string, unknown>,
	sourcePath: string,
): Promise<Record<string, string>> {
	const reference = mapReferenceFrom(source);
	if (!reference) throw new Error('This map no longer names an image.');
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

/** The item as `noteScan` parsed it, with its art. Its local path is never sent. */
async function itemBody(
	ports: SendPorts,
	kind: LibraryItemKind,
	source: Record<string, unknown>,
	sourcePath: string,
): Promise<unknown> {
	const item = source['item'];
	if (item === undefined || item === null || typeof item !== 'object') {
		throw new Error(`No library entry was parsed from ${sourcePath}.`);
	}
	const fields = item as Record<string, unknown>;
	const imagePath = fields['imagePath'];
	const image =
		typeof imagePath === 'string' && imagePath !== ''
			? await readImage(ports, imagePath, sourcePath, 'token')
			: undefined;
	return libraryItemBody(kind, fields, image);
}

/** A D&D Beyond character note: Obsidian's parsed frontmatter, and the whole text the sheet is parsed from. */
export interface CharacterNote {
	path: string;
	frontmatter: Record<string, unknown>;
	content: string;
}

/**
 * Sends a player character to a campaign or to the account's My Characters shelf, and on
 * success records the id under the property the destination names - `requestFor` decides the
 * route, whether the request carries a campaign, and that property.
 *
 * Its own entry point rather than a {@link ModuleSendable} kind because the destination is
 * the character's, not the caller's: the vault must go without the campaign header.
 * Throws, like {@link sendToTome}, when the note's image cannot be read.
 */
export async function sendCharacterToTome(
	ports: SendPorts,
	note: CharacterNote,
	sender: Omit<Destination, 'campaignId'>,
	destination: CharacterDestination,
): Promise<SendResult> {
	const request = requestFor(destination);
	const result = await ports.postJson(
		{ ...sender, path: request.route, campaignId: request.campaignId },
		JSON.stringify(await characterBody(ports, note)),
	);
	if (!result.ok || result.id === null) return result;
	try {
		await ports.setFrontmatter(note.path, request.frontmatterKey, result.id);
	} catch (error) {
		// The character is in Tome by now; say so, or a retry looks like the fix.
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Sent to Tome, but its id could not be written to ${note.path}: ${reason}`);
	}
	return result;
}

/**
 * Only the properties the body mapper reads go on - anything else in the frontmatter could
 * only trip the image walk or the markdown flattening. The sheet is parsed from the note text.
 */
async function characterBody(ports: SendPorts, note: CharacterNote): Promise<PlayerCharacterBody> {
	const filtered: Record<string, unknown> = {};
	for (const key of PLAYER_CHARACTER_PROPERTIES) {
		if (key in note.frontmatter) filtered[key] = note.frontmatter[key];
	}
	if ('image' in filtered) filtered.image = unwrapWikilink(filtered.image) ?? filtered.image;
	const withImages = await embedFrom(ports, stripMarkdown(filtered), note.path);
	return playerCharacterBody(withImages as Record<string, unknown>, parsePcSheet(note.content));
}
