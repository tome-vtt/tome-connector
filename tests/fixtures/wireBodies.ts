/**
 * Every rules-bearing request body the connector builds, built the way the plugin builds it
 * from the notes in `wireNotes.ts`.
 *
 * `findSendables` decides what a note is. A creature, magic item, piece of equipment or spell
 * is then sent by the real send module against its in-memory adapter - no bestiary, the art a
 * file beside the note - and its body is read off the recorded request. A character goes the
 * same way, once per destination, its route and account scoping read off the request too.
 */

import type { CharacterDestination } from '../../src/characterDestination';
import { findSendables, type Sendable, type SendableKind } from '../../src/recognizers/noteScan';
import { TOME_ROUTES, type TomeRoute } from '../../src/routes';
import { sendCharacterToTome, sendToTome } from '../../src/sendModule';
import { CAMPAIGN_HEADER_NAME } from '../../src/tomeHttp';
import { bodyOf, inMemorySendPorts } from './inMemorySendPorts';
import {
	EQUIPMENT_ITEM_INPUT,
	IMPORT_NON_PLAYER_CHARACTER,
	MAGIC_ITEM_INPUT,
	PLAYER_CHARACTER_INPUT,
	SPELL_INPUT,
	type InputContract,
} from './serverContract';
import {
	BAG_OF_HOLDING_NOTE,
	CLOAK_OF_PROTECTION_NOTE,
	FIREBALL_NOTE,
	GITHYANKI_KNIGHT_NOTE,
	GOBLIN_WARRIOR_NOTE,
	MULTICLASS_FRONTMATTER,
	ROPE_NOTE,
	SHIELD_NOTE,
	ZABADUN_NOTE,
	frontmatterOf,
	noteInput,
	yamlParser,
} from './wireNotes';

export interface BuiltBody {
	/** What the case is, for a test name or a log line. */
	label: string;
	/** The game system a campaign receiving it must play. */
	system: 'dnd5e' | 'pf2e';
	route: TomeRoute;
	/** Whether the route is the account shelf, which carries no campaign header. */
	accountScoped: boolean;
	contract: InputContract;
	body: Record<string, unknown>;
}

/** A 1x1 transparent PNG - a real image the server's ingest can decode, and small. */
export const TINY_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function onlySendable(path: string, content: string): Sendable {
	const found = findSendables(noteInput(path, content), yamlParser);
	const [sendable] = found;
	if (found.length !== 1 || !sendable) {
		throw new Error(`${path}: expected one sendable, found ${found.length}`);
	}
	return sendable;
}

/**
 * The note's art pointed at `token.png` beside it, or taken away. A creature links it the
 * way an author would; a library item's parse carries it as a path.
 */
function withArt(sendable: Sendable, token: string | null): Sendable {
	switch (sendable.kind) {
		case 'creature':
			return token === null ? sendable : { ...sendable, block: { ...sendable.block, image: '[[token.png]]' } };
		case 'magicItem':
			return { ...sendable, item: { ...sendable.item, imagePath: token } };
		case 'equipmentItem':
			return { ...sendable, item: { ...sendable.item, imagePath: token } };
		case 'spell':
			return { ...sendable, spell: { ...sendable.spell, imagePath: token } };
		default:
			return sendable;
	}
}

/** What the send module posts for the one `kind` in a note; with `image`, its art is that file. */
async function sent(path: string, content: string, kind: SendableKind, image: string | undefined): Promise<Record<string, unknown>> {
	const sendable = onlySendable(path, content);
	if (sendable.kind !== kind) throw new Error(`${path}: a ${sendable.kind}, not a ${kind}`);
	const token = `${path.slice(0, path.lastIndexOf('/'))}/token.png`;
	const { ports, sent: requests } = inMemorySendPorts({ files: image === undefined ? {} : { [token]: image } });

	await sendToTome(ports, withArt(sendable, image === undefined ? null : token), { baseUrl: 'https://tome.example.com', apiKey: 'key', campaignId: 'campaign' });
	return bodyOf(requests[0]);
}

/**
 * What the send module posts for a character note to `destination`; with `image`, the note's
 * picture is `[[token.png]]` beside it. The route and the account scoping are read off the
 * recorded request, so they are the module's, not this fixture's.
 */
async function character(
	frontmatter: Record<string, unknown>,
	content: string,
	image: string | undefined,
	destination: CharacterDestination,
): Promise<Pick<BuiltBody, 'route' | 'accountScoped' | 'body'>> {
	const path = 'Characters/Zabadun.md';
	const { ports, sent } = inMemorySendPorts({ files: image === undefined ? {} : { 'Characters/token.png': image } });
	const withImage = image === undefined ? frontmatter : { ...frontmatter, image: '[[token.png]]' };

	await sendCharacterToTome(ports, { path, frontmatter: withImage, content }, { baseUrl: 'https://tome.example.com', apiKey: 'key' }, destination);
	const request = sent[0];
	const route = Object.values(TOME_ROUTES).find((candidate) => request?.url.endsWith(candidate));
	if (!request || !route) throw new Error(`${path}: sent nowhere the plugin knows`);
	return { route, accountScoped: !(CAMPAIGN_HEADER_NAME in request.headers), body: bodyOf(request) };
}

/**
 * Every body, once per route it goes to. Pass `image` to fill the picture on the kinds that
 * have one; the tests build both ways, since an absent image must be an absent key.
 */
export async function everyBody(image?: string): Promise<BuiltBody[]> {
	const campaign: CharacterDestination = { kind: 'campaign', campaignId: 'campaign' };
	const zabadun = frontmatterOf(ZABADUN_NOTE);
	const pc = { system: 'dnd5e', contract: PLAYER_CHARACTER_INPUT } as const;
	const npc = { route: TOME_ROUTES.addNonPlayerCharacter, accountScoped: false, contract: IMPORT_NON_PLAYER_CHARACTER };

	return [
		{ label: '5e creature', system: 'dnd5e', ...npc, body: await sent('Bestiary/Githyanki Knight.md', GITHYANKI_KNIGHT_NOTE, 'creature', image) },
		{ label: 'Pathfinder creature', system: 'pf2e', ...npc, body: await sent('Bestiary/Goblin Warrior.md', GOBLIN_WARRIOR_NOTE, 'creature', image) },
		{ label: 'magic item', system: 'dnd5e', route: TOME_ROUTES.addMagicItem, accountScoped: false, contract: MAGIC_ITEM_INPUT, body: await sent('Items/bag-of-holding-xdmg.md', BAG_OF_HOLDING_NOTE, 'magicItem', image) },
		{ label: 'magic item with attunement', system: 'dnd5e', route: TOME_ROUTES.addMagicItem, accountScoped: false, contract: MAGIC_ITEM_INPUT, body: await sent('Items/cloak-of-protection-xdmg.md', CLOAK_OF_PROTECTION_NOTE, 'magicItem', undefined) },
		{ label: 'equipment', system: 'dnd5e', route: TOME_ROUTES.addEquipmentItem, accountScoped: false, contract: EQUIPMENT_ITEM_INPUT, body: await sent('Items/rope-xphb.md', ROPE_NOTE, 'equipmentItem', image) },
		{ label: 'spell', system: 'dnd5e', route: TOME_ROUTES.addSpell, accountScoped: false, contract: SPELL_INPUT, body: await sent('Spells/fireball-xphb.md', FIREBALL_NOTE, 'spell', image) },
		{ label: 'reaction spell', system: 'dnd5e', route: TOME_ROUTES.addSpell, accountScoped: false, contract: SPELL_INPUT, body: await sent('Spells/shield-xphb.md', SHIELD_NOTE, 'spell', undefined) },
		{ label: 'character to a campaign', ...pc, ...(await character(zabadun, ZABADUN_NOTE, image, campaign)) },
		{ label: 'character to My Characters', ...pc, ...(await character(zabadun, ZABADUN_NOTE, image, { kind: 'vault' })) },
		{ label: 'multiclass character to a campaign', ...pc, ...(await character(MULTICLASS_FRONTMATTER, '', undefined, campaign)) },
	];
}
