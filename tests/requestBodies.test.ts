import { describe, expect, it } from 'vitest';

import { requestFor, type CharacterDestination } from '../src/characterDestination';
import { findSendables, type Sendable, type SendableKind } from '../src/recognizers/noteScan';
import { TOME_ROUTES } from '../src/routes';
import { KIND_ROUTES, sendCharacterToTome, sendToTome, type SendPorts } from '../src/sendModule';
import { CAMPAIGN_HEADER_NAME } from '../src/tomeHttp';
import { TINY_PNG, bodyOf, inMemorySendPorts } from './fixtures/inMemorySendPorts';
import {
	BAG_NAMES,
	EQUIPMENT_ITEM_INPUT,
	IMPORT_NON_PLAYER_CHARACTER,
	MAGIC_ITEM_INPUT,
	PLAYER_CHARACTER_INPUT,
	SPELL_INPUT,
	retiredKeysIn,
	undeclaredKeys,
	type InputContract,
} from './fixtures/serverContract';
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
} from './fixtures/wireNotes';

/**
 * The request bodies the connector sends to the rules-bearing routes, pinned against the
 * server's contract rather than against themselves.
 *
 * Since TomeVTT moved each kind's rules into one named bag, a body carrying any of the flat
 * fields an older connector sent is refused outright with `connector.outdated` - a Pathfinder
 * creature with a `Size` beside its `pf2e`, a spell with a `level` beside its `dnd5e`. The
 * failure was total and silent from this side: every note in a bulk send came back refused. So
 * the first two blocks here are about the whole set of bodies, not one kind at a time.
 *
 * Every body, route and header is the send module's: each note is sent through it against the
 * in-memory adapter and read off the recorded request.
 */

interface BuiltBody {
	/** What the case is, for a test name. */
	label: string;
	/** The game system a campaign receiving it must play. */
	system: 'dnd5e' | 'pf2e';
	contract: InputContract;
	route: string;
	/** Whether the request went without the campaign header - the account shelf. */
	accountScoped: boolean;
	body: Record<string, unknown>;
}

const SERVER = { baseUrl: 'https://tome.example.com', apiKey: 'key' };

/** The one request `send` makes against an in-memory vault holding `files`. */
async function posted(
	files: Record<string, string>,
	send: (ports: SendPorts) => Promise<unknown>,
): Promise<Pick<BuiltBody, 'route' | 'accountScoped' | 'body'>> {
	const { ports, sent } = inMemorySendPorts({ files });
	await send(ports);
	const [request] = sent;
	if (sent.length !== 1 || !request) throw new Error(`expected one request, sent ${sent.length}`);
	return {
		route: new URL(request.url).pathname,
		accountScoped: !(CAMPAIGN_HEADER_NAME in request.headers),
		body: bodyOf(request),
	};
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

/** Sends the one `kind` in a note to a campaign; with `image`, its art is that file. */
function note(path: string, content: string, kind: SendableKind, image: string | undefined) {
	const found = findSendables(noteInput(path, content), yamlParser);
	const [sendable] = found;
	if (found.length !== 1 || sendable?.kind !== kind) throw new Error(`${path}: expected one ${kind}`);
	const token = `${path.slice(0, path.lastIndexOf('/'))}/token.png`;
	const files = image === undefined ? {} : { [token]: image };
	return posted(files, (ports) =>
		sendToTome(ports, withArt(sendable, image === undefined ? null : token), { ...SERVER, campaignId: 'campaign' }),
	);
}

/** Sends a character note to `destination`; with `image`, its picture is `[[token.png]]` beside it. */
function character(frontmatter: Record<string, unknown>, content: string, image: string | undefined, destination: CharacterDestination) {
	const files: Record<string, string> = image === undefined ? {} : { 'Characters/token.png': image };
	const withImage = image === undefined ? frontmatter : { ...frontmatter, image: '[[token.png]]' };
	return posted(files, (ports) =>
		sendCharacterToTome(ports, { path: 'Characters/Zabadun.md', frontmatter: withImage, content }, SERVER, destination),
	);
}

/** Every case, once per route it goes to; built with and without art, since an absent image must be an absent key. */
async function everyBody(image?: string): Promise<BuiltBody[]> {
	const campaign: CharacterDestination = { kind: 'campaign', campaignId: 'campaign' };
	const zabadun = frontmatterOf(ZABADUN_NOTE);
	const npc = { contract: IMPORT_NON_PLAYER_CHARACTER };
	const dnd5e = 'dnd5e' as const;
	const pc = { system: dnd5e, contract: PLAYER_CHARACTER_INPUT };

	return [
		{ label: '5e creature', system: dnd5e, ...npc, ...(await note('Bestiary/Githyanki Knight.md', GITHYANKI_KNIGHT_NOTE, 'creature', image)) },
		{ label: 'Pathfinder creature', system: 'pf2e', ...npc, ...(await note('Bestiary/Goblin Warrior.md', GOBLIN_WARRIOR_NOTE, 'creature', image)) },
		{ label: 'magic item', system: dnd5e, contract: MAGIC_ITEM_INPUT, ...(await note('Items/bag-of-holding-xdmg.md', BAG_OF_HOLDING_NOTE, 'magicItem', image)) },
		{ label: 'magic item with attunement', system: dnd5e, contract: MAGIC_ITEM_INPUT, ...(await note('Items/cloak-of-protection-xdmg.md', CLOAK_OF_PROTECTION_NOTE, 'magicItem', undefined)) },
		{ label: 'equipment', system: dnd5e, contract: EQUIPMENT_ITEM_INPUT, ...(await note('Items/rope-xphb.md', ROPE_NOTE, 'equipmentItem', image)) },
		{ label: 'spell', system: dnd5e, contract: SPELL_INPUT, ...(await note('Spells/fireball-xphb.md', FIREBALL_NOTE, 'spell', image)) },
		{ label: 'reaction spell', system: dnd5e, contract: SPELL_INPUT, ...(await note('Spells/shield-xphb.md', SHIELD_NOTE, 'spell', undefined)) },
		{ label: 'character to a campaign', ...pc, ...(await character(zabadun, ZABADUN_NOTE, image, campaign)) },
		{ label: 'character to My Characters', ...pc, ...(await character(zabadun, ZABADUN_NOTE, image, { kind: 'vault' })) },
		{ label: 'multiclass character to a campaign', ...pc, ...(await character(MULTICLASS_FRONTMATTER, '', undefined, campaign)) },
	];
}

const WITH_IMAGES = await everyBody(TINY_PNG);
const WITHOUT_IMAGES = await everyBody();
const ALL: BuiltBody[] = [...WITH_IMAGES, ...WITHOUT_IMAGES];

/** The send module's kinds whose bodies carry no rules record, so the server contract has nothing to pin. */
const RULES_FREE_KINDS: readonly string[] = ['encounter', 'map', 'prop'];

function byLabel(label: string, bodies: BuiltBody[] = WITHOUT_IMAGES): Record<string, unknown> {
	const found = bodies.find((built) => built.label === label);
	if (!found) throw new Error(`no body labelled ${label}`);
	return found.body;
}

describe('every body the connector builds', () => {
	it.each(ALL.map((built) => [built.label, built] as const))(
		'%s carries no member the server retired, in any casing',
		(_, built) => {
			expect(retiredKeysIn(built.body, built.contract)).toEqual([]);
		},
	);

	it.each(ALL.map((built) => [built.label, built] as const))(
		'%s carries only keys the server declares, in its own spelling',
		(_, built) => {
			expect(undeclaredKeys(built.body, built.contract.shape)).toEqual([]);
		},
	);

	it.each(ALL.map((built) => [built.label, built] as const))(
		'%s carries its rules in exactly one named bag',
		(_, built) => {
			const bags = BAG_NAMES.filter((name) => name in built.body);
			expect(bags).toEqual([built.system]);
			expect(built.body[built.system]).toBeTypeOf('object');
		},
	);

	/** A kind added to the send module with a rules record and no case above fails here. */
	it('covers every rules-bearing route the send module posts to', () => {
		const kinds = Object.entries(KIND_ROUTES).filter(([kind]) => !RULES_FREE_KINDS.includes(kind));
		const characters = [requestFor({ kind: 'vault' }), requestFor({ kind: 'campaign', campaignId: 'campaign' })];

		expect(new Set(ALL.map((built) => built.route))).toEqual(
			new Set([...kinds.map(([, route]) => route), ...characters.map((request) => request.route)]),
		);
	});
});

/**
 * The checks above are only worth their green if they would go red. These are the two bodies
 * the connector sent before 1.1.0, trimmed, each of which the server now refuses.
 */
describe('the contract checks themselves', () => {
	it('catch the pre-bag Pathfinder creature, which copied its vitals out beside the bag', () => {
		const old = { Image: '', Name: 'Goblin Warrior', Size: 'Small', AC: 16, HP: '6', CR: '-1', Pf2e: {} };
		expect(retiredKeysIn(old, IMPORT_NON_PLAYER_CHARACTER)).toEqual(['Size', 'AC', 'HP', 'CR']);
		expect(undeclaredKeys(old, IMPORT_NON_PLAYER_CHARACTER.shape)).toContain('Pf2e');
	});

	it('catch the pre-bag character, whose sheet sat flat at the top level', () => {
		const old = { Name: 'Zabadun', Species: 'Dwarf', HpMax: 43, Str: 20, Saves: [], DndBeyondId: 1 };
		expect(retiredKeysIn(old, PLAYER_CHARACTER_INPUT)).toEqual(['Species', 'HpMax', 'Str', 'Saves']);
	});

	it('catch a key the server does not declare, however deep', () => {
		const stray = { name: 'X', dnd5e: { traits: [{ name: 'A', desc: 'B', Extra: 1 }] } };
		expect(undeclaredKeys(stray, IMPORT_NON_PLAYER_CHARACTER.shape)).toEqual(['dnd5e.traits[0].Extra']);
	});
});

describe('the creature body', () => {
	it('puts a 5e stat block in dnd5e and leaves the name and picture beside it', () => {
		const body = byLabel('5e creature', WITH_IMAGES);

		expect(Object.keys(body).sort()).toEqual(['dnd5e', 'image', 'name']);
		expect(body.name).toBe('Githyanki Knight');
		expect(body.image).toBe(TINY_PNG);
		expect(body.dnd5e).toMatchObject({
			size: 'Medium',
			type: 'aberration',
			subtype: 'gith',
			alignment: 'Lawful Evil',
			ac: 18,
			hp: '117',
			hitDice: '18d8 + 36',
			speed: '30 ft.',
			stats: [16, 14, 15, 14, 14, 15],
			damageResistances: 'psychic',
			senses: 'passive Perception 12',
			languages: 'Common, Gith',
			cr: '8',
			abilitySaves: [
				{ name: 'Constitution', desc: '+5' },
				{ name: 'Intelligence', desc: '+5' },
				{ name: 'Wisdom', desc: '+5' },
			],
			proficientSkills: [{ name: 'Perception', desc: '+5' }],
			traits: [
				{ name: 'Psionic Defense', desc: "The githyanki's mind cannot be read against its will." },
				{ name: 'Gear', desc: 'plate armor' },
			],
			actions: [{ name: 'Multiattack', desc: 'The githyanki makes three Silver Sword attacks.' }],
			bonusActions: [{ name: 'Misty Step (2/Day)', desc: 'The githyanki casts Misty Step.' }],
			reactions: [{ name: 'Parry', desc: 'The githyanki adds 3 to its AC against one melee attack.' }],
		});
	});

	it('sends a Pathfinder creature as its pf2e bag and nothing of it flat', () => {
		const body = byLabel('Pathfinder creature');

		expect(Object.keys(body).sort()).toEqual(['image', 'name', 'pf2e']);
		expect(body.pf2e).toMatchObject({ name: 'Goblin Warrior', level: -1, size: 'Small', ac: 16, hp: 6 });
	});
});

describe('the compendium item bodies', () => {
	it('sends a magic item with its whole record, source key included, in dnd5e', () => {
		expect(byLabel('magic item', WITH_IMAGES)).toEqual({
			name: 'Bag of Holding',
			image: TINY_PNG,
			dnd5e: {
				desc:
					'This bag has an interior space considerably larger than its outside dimensions.\n\n' +
					'If the bag is overloaded, pierced, or torn, it is destroyed.',
				rarity: 'uncommon',
				category: 'Wondrous item',
				requiresAttunement: false,
				attunementDetail: null,
				sourceKey: 'bag-of-holding-xdmg',
			},
		});
	});

	it('reads attunement into the bag', () => {
		expect(byLabel('magic item with attunement').dnd5e).toMatchObject({
			requiresAttunement: true,
			attunementDetail: null,
		});
	});

	it('sends a piece of equipment with its cost and weight, source key included, in dnd5e', () => {
		expect(byLabel('equipment')).toEqual({
			name: 'Rope',
			dnd5e: {
				desc: 'As a Utilize action, you can tie a knot with Rope if you succeed on a DC 10 Dexterity check.',
				category: 'Adventuring gear',
				cost: 1,
				weight: 5,
				sourceKey: 'rope-xphb',
			},
		});
	});

	/** The one kind whose source key stayed a column - the server's by-name upsert queries it. */
	it('sends a spell with its source key beside the bag and its rules inside it', () => {
		expect(byLabel('spell', WITH_IMAGES)).toEqual({
			name: 'Fireball',
			sourceKey: 'fireball-xphb',
			image: TINY_PNG,
			dnd5e: {
				desc:
					'A bright streak flashes from you to a point you choose within range and then ' +
					'blossoms into a fiery explosion.',
				level: 3,
				school: 'evocation',
				castingTime: 'action',
				reactionCondition: null,
				duration: 'instantaneous',
				range: 150,
				rangeText: '150 feet',
				rangeUnit: 'feet',
				concentration: false,
				ritual: false,
				verbal: true,
				somatic: true,
				material: true,
				materialSpecified: 'a ball of bat guano and sulfur',
				materialConsumed: false,
				higherLevel: 'The damage increases by 1d6 for each spell slot level above 3.',
				shapeType: null,
				shapeSize: null,
				shapeSizeUnit: null,
				classes: ['sorcerer', 'wizard'],
			},
		});
	});

	it('never sends the local path of an item picture', () => {
		for (const built of ALL) {
			expect(JSON.stringify(built.body)).not.toContain('imagePath');
			expect(JSON.stringify(built.body)).not.toContain('3-Mechanics/CLI/items/img');
		}
	});
});

describe('the character body', () => {
	it('keeps the name, gender, picture and D&D Beyond id at the top level and the sheet in dnd5e', () => {
		const body = byLabel('character to a campaign', WITH_IMAGES);

		expect(Object.keys(body).sort()).toEqual(['dnd5e', 'dndBeyondId', 'gender', 'image', 'name']);
		expect(body).toMatchObject({ name: 'Zabadun Stoneheart', gender: 'Male', dndBeyondId: 123456789, image: TINY_PNG });
		expect(body.dnd5e).toMatchObject({
			species: 'Dwarf',
			class: 'Barbarian 3',
			level: 3,
			background: 'Soldier',
			alignment: 'Chaotic Good',
			xp: 900,
			hpMax: 43,
			hpCurrent: 40,
			hpTemp: 0,
			ac: 19,
			speed: 30,
			proficiencyBonus: 2,
			str: 20,
			dex: 14,
			con: 16,
			int: 8,
			wis: 12,
			cha: 10,
			initiative: 2,
			languages: 'Common, Dwarvish, Goblin',
			armorProficiencies: 'Light Armor, Medium Armor',
			weaponProficiencies: 'Simple Weapons, Martial Weapons',
			toolProficiencies: "Smith's Tools",
			currency: { cp: 10, sp: 54, ep: 0, gp: 66, pp: 0 },
			spells: [{ name: 'Thaumaturgy', level: 0, school: 'Transmutation', castTime: '1 Action', range: '30 ft', concentration: false, prepared: false }],
			equipment: [
				{ name: 'Greataxe', quantity: 1, weight: '7.0 lbs', equipped: true },
				{ name: 'Rations', quantity: 10, weight: '20.0 lbs', equipped: false },
			],
		});

		const sheet = body.dnd5e as Record<string, unknown[]>;
		expect(sheet.saves).toHaveLength(6);
		expect(sheet.saves).toContainEqual({ ability: 'STR', bonus: 7, proficient: true });
		expect(sheet.skills).toContainEqual({ name: 'Athletics', ability: 'STR', bonus: 9, proficient: true, expertise: true });
		expect(sheet.attacks).toContainEqual({ name: 'Greataxe', attackBonus: '+7', damage: '1d12+5', range: '5 ft', notes: 'Slashing' });
		expect(sheet.features).toContainEqual({ category: 'Class Features', name: 'Rage', desc: 'You can imbue yourself with a primal power called Rage.' });
	});

	it('sends the same body to My Characters as to a campaign', () => {
		expect(byLabel('character to My Characters')).toEqual(byLabel('character to a campaign'));
	});

	it('sends to My Characters account-scoped, and to a campaign with the campaign', () => {
		const scoped = (label: string) => WITHOUT_IMAGES.find((built) => built.label === label);
		expect(scoped('character to My Characters')).toMatchObject({ route: TOME_ROUTES.importVaultCharacter, accountScoped: true });
		expect(scoped('character to a campaign')).toMatchObject({ route: TOME_ROUTES.addPlayerCharacter, accountScoped: false });
	});

	it('leaves Tome-owned fields off, so a re-send keeps them', () => {
		const body = byLabel('character to a campaign');
		expect(body).not.toHaveProperty('alias');
		expect(body).not.toHaveProperty('isFavorite');
	});

	it('sends a classes property as the bag\'s list, and leaves it off when the note has none', () => {
		expect((byLabel('multiclass character to a campaign').dnd5e as Record<string, unknown>).classes).toEqual([
			{ name: 'Fighter', subclass: 'Champion', level: 3 },
			{ name: 'Wizard', level: 2 },
		]);
		expect(byLabel('character to a campaign').dnd5e).not.toHaveProperty('classes');
	});

	/**
	 * The bag's armour class is nullable and absence means "unstated": a create takes the
	 * server's default and an update keeps the stored one. A `0` would be stored as a real AC.
	 */
	it('leaves an unstated armour class unstated rather than sending zero', () => {
		expect(byLabel('multiclass character to a campaign').dnd5e).not.toHaveProperty('ac');
	});
});
