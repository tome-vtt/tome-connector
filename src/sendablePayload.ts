import type { App } from 'obsidian';

import { getStatblockBestiaryApi } from './fantasyStatblocksBestiary';
import { mapToEncounterPayload } from './recognizers/encounter';
import { mapReferenceFrom } from './recognizers/map';
import type { Sendable } from './recognizers/noteScan';
import { libraryItemBody, type LibraryItemKind } from './libraryItemBody';
import { TOME_ROUTES } from './routes';
import { send, type Destination, type SendPorts } from './sendModule';
import { postJsonToTome, tome } from './tomeApiClient';
import type { SendResult } from './tomeHttp';
import { readImageAsDataUri } from './tomeImageEmbedding';

/**
 * Turns a scanned {@link Sendable} into a request and sends it. Creatures are
 * handed to the send module (`sendModule.ts`); the other kinds are still built
 * here until they move there too.
 *
 * The impure half of the scan. Everything here needs the vault or the Fantasy
 * Statblocks bestiary — reading a token off disk, resolving a `monster:`
 * reference — which is exactly why the scan itself stops at intent and the
 * preview can count 709 creatures without touching a single image.
 *
 * **Throwing is how an item is reported as unresolvable.** `runBulkSend` treats a
 * thrown error as permanent for that item and does not retry it: a missing image
 * is still missing on the second attempt, and a bestiary that is not installed
 * will not be installed a second later.
 */

export interface PreparedRequest {
	/** Route appended to the configured base URL. */
	path: string;
	/** Serialised body. */
	body: string;
}

/**
 * The Obsidian adapter for the send module's ports. An image reference is
 * resolved as a link from the note it is in, and read as written when it does
 * not resolve, so a full vault path still works.
 */
export function obsidianSendPorts(app: App, downscale: boolean): SendPorts {
	return {
		readImage: (reference, sourcePath, kind) => {
			const file = app.metadataCache.getFirstLinkpathDest(reference, sourcePath);
			return readImageAsDataUri(app, file?.path ?? reference, kind, downscale);
		},
		bestiary: getStatblockBestiaryApi,
		postJson: tome.postJson,
	};
}

/** Sends one scanned sendable, quietly: creatures through the send module, the rest built here. */
export async function sendSendable(
	app: App,
	sendable: Sendable,
	destination: Destination,
	downscale: boolean,
): Promise<SendResult> {
	if (sendable.kind === 'creature') {
		return send(obsidianSendPorts(app, downscale), sendable, destination);
	}
	const request = await buildRequest(app, sendable, downscale);
	return postJsonToTome(
		destination.baseUrl,
		request.path,
		request.body,
		destination.apiKey,
		destination.campaignId,
	);
}

async function buildRequest(
	app: App,
	sendable: Sendable,
	downscale: boolean,
): Promise<PreparedRequest> {
	switch (sendable.kind) {
		case 'creature':
			throw new Error('A creature is sent by the send module, not built here.');
		case 'encounter':
			return { path: TOME_ROUTES.addEncounter, body: encounterBody(sendable) };
		case 'map':
			return { path: TOME_ROUTES.addMap, body: await mapBody(app, sendable, downscale) };
		case 'magicItem':
			return {
				path: TOME_ROUTES.addMagicItem,
				body: await itemBody(app, sendable, sendable.kind, downscale),
			};
		case 'equipmentItem':
			return {
				path: TOME_ROUTES.addEquipmentItem,
				body: await itemBody(app, sendable, sendable.kind, downscale),
			};
		case 'spell':
			return {
				path: TOME_ROUTES.addSpell,
				body: await itemBody(app, sendable, sendable.kind, downscale),
			};
	}
}

/**
 * The item as parsed, with its art read off disk if it has any. Shared by
 * `magicItem`, `equipmentItem` and `spell` - each carries a finished parse on the
 * sendable (`noteScan` already did it), so the only work left here is the image,
 * which needs the vault. `libraryItemBody` puts the rules into the `dnd5e` bag.
 *
 * **A missing image does not lose the item.** Everywhere else in this file an
 * unreadable file throws, because a map without its image is not a map. An item is
 * its rules text; the picture is decoration, and a broken embed in one note out of
 * five hundred should cost that note its art rather than its entry in the library.
 * The path is dropped rather than sent, so a local vault path never reaches the
 * server either way.
 */
async function itemBody(
	app: App,
	sendable: Sendable,
	kind: LibraryItemKind,
	downscale: boolean,
): Promise<string> {
	const item = sendable.source['item'];
	if (item === undefined || item === null || typeof item !== 'object') {
		throw new Error(`No library entry was parsed from ${sendable.path}.`);
	}

	const fields = item as Record<string, unknown>;
	const imagePath = fields['imagePath'];
	let image: string | undefined;
	if (typeof imagePath === 'string' && imagePath !== '') {
		try {
			image = await readImageAsDataUri(app, imagePath, 'token', downscale);
		} catch {
			console.warn(`Tome Connector: could not read ${imagePath}; sending without the image.`);
		}
	}

	return JSON.stringify(libraryItemBody(kind, fields, image));
}

function encounterBody(sendable: Sendable): string {
	const payload = mapToEncounterPayload(sendable.source);
	if (!payload) {
		// The scan accepted it, so this means the note changed underneath the
		// preview - worth saying plainly rather than sending an empty encounter.
		throw new Error('This encounter no longer has a name.');
	}
	return JSON.stringify(payload);
}

async function mapBody(
	app: App,
	sendable: Sendable,
	downscale: boolean,
): Promise<string> {
	const reference = mapReferenceFrom(sendable.source);
	if (!reference) {
		throw new Error('This map no longer names an image.');
	}

	const payload: Record<string, unknown> = {
		title: reference.title,
		image: await readImageAsDataUri(app, reference.image, 'map', downscale),
	};
	if (reference.id !== undefined) payload.id = reference.id;
	return JSON.stringify(payload);
}
