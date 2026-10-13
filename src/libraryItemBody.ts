/**
 * The request bodies for the three library rows a compendium note becomes: a magic item,
 * a piece of equipment and a spell.
 *
 * **The rules travel in the `dnd5e` bag, and only there.** Tome stores every rules-bearing
 * row's system record as one named bag, and its input DTOs (`MagicItemInputDto`,
 * `EquipmentItemInputDto`, `SpellInputDto`) declare only the neutral fields beside it: the
 * name, the picture, the id - and, for a spell alone, the source key. A body carrying any of
 * the flat fields a connector before 1.1.0 sent (`desc`, `rarity`, `level`, `cost` and the
 * rest) is refused with a 400 coded `connector.outdated`, even beside a valid bag.
 *
 * **Where the source key goes differs by kind, and that is the server's decision, not a
 * slip.** A magic item's and a piece of equipment's moved into the bag with the rest of
 * their record; a spell's stayed a column, because the server's by-name upsert queries it
 * and the Pathfinder loader fills it too. Sending it on the wrong side is refused on the two
 * item routes and silently dropped on the spell's.
 *
 * The parsers (`magicItem.ts`, `equipmentItem.ts`, `spell.ts`) stay flat: they describe
 * what a note says, and `spell.ts`'s shape is also the content-package catalogue's. Only
 * this module knows the wire.
 *
 * Pure and `obsidian`-free, so the exact bodies are pinned by `tests/requestBodies.test.ts`.
 */

import type { EquipmentItem } from './recognizers/compendium/equipmentItem';
import type { MagicItem } from './recognizers/compendium/magicItem';
import type { Spell } from './recognizers/compendium/spell';

/** What `noteScan` carries for a spell: the parse, its key renamed to the column it lands in, and its art. */
export type SpellNote = Omit<Spell, 'key'> & { sourceKey: string; imagePath: string | null };

/** The server's `Dnd5eMagicItem`, as far as a note can fill it. */
export interface Dnd5eMagicItem {
	desc: string | null;
	rarity: string | null;
	category: string | null;
	requiresAttunement: boolean;
	attunementDetail: string | null;
	sourceKey: string;
}

/** The server's `Dnd5eEquipmentItem`, as far as a note can fill it - no weapon or armour table. */
export interface Dnd5eEquipmentItem {
	desc: string | null;
	category: string | null;
	cost: number | null;
	weight: number | null;
	sourceKey: string;
}

/**
 * The server's `Dnd5eSpell`, as far as prose can fill it - see `parseSpell` for what it
 * deliberately does not mine.
 *
 * `level` is nullable here where the server's is an `int`: a note with no level tag is sent
 * as it reads and refused, rather than arriving as a cantrip nobody chose.
 */
export interface Dnd5eSpell {
	desc: string;
	level: number | null;
	school: string | null;
	castingTime: string | null;
	reactionCondition: string | null;
	duration: string | null;
	range: number | null;
	rangeText: string | null;
	rangeUnit: string | null;
	concentration: boolean;
	ritual: boolean;
	verbal: boolean;
	somatic: boolean;
	material: boolean;
	materialSpecified: string | null;
	materialConsumed: boolean;
	higherLevel: string | null;
	shapeType: string | null;
	shapeSize: number | null;
	shapeSizeUnit: string | null;
	classes: string[];
}

/** `MagicItemInputDto`. */
export interface MagicItemBody {
	name: string;
	image?: string;
	dnd5e: Dnd5eMagicItem;
}

/** `EquipmentItemInputDto`. */
export interface EquipmentItemBody {
	name: string;
	image?: string;
	dnd5e: Dnd5eEquipmentItem;
}

/** `SpellInputDto` - the one of the three whose source key stays outside the bag. */
export interface SpellBody {
	name: string;
	sourceKey: string;
	image?: string;
	dnd5e: Dnd5eSpell;
}

/** Adds the picture only when there is one; a missing image is an absent key, never `null`. */
function withImage<T extends object>(body: T, image: string | undefined): T & { image?: string } {
	return image === undefined || image === '' ? body : { ...body, image };
}

export function magicItemBody(item: MagicItem, image?: string): MagicItemBody {
	return withImage(
		{
			name: item.name,
			dnd5e: {
				desc: item.desc,
				rarity: item.rarity,
				category: item.category,
				requiresAttunement: item.requiresAttunement,
				attunementDetail: item.attunementDetail,
				sourceKey: item.sourceKey,
			},
		},
		image,
	);
}

export function equipmentItemBody(item: EquipmentItem, image?: string): EquipmentItemBody {
	return withImage(
		{
			name: item.name,
			dnd5e: {
				desc: item.desc,
				category: item.category,
				cost: item.cost,
				weight: item.weight,
				sourceKey: item.sourceKey,
			},
		},
		image,
	);
}

export function spellBody(spell: SpellNote, image?: string): SpellBody {
	return withImage(
		{
			name: spell.name,
			sourceKey: spell.sourceKey,
			dnd5e: {
				desc: spell.desc,
				level: spell.level,
				school: spell.school,
				castingTime: spell.castingTime,
				reactionCondition: spell.reactionCondition,
				duration: spell.duration,
				range: spell.range,
				rangeText: spell.rangeText,
				rangeUnit: spell.rangeUnit,
				concentration: spell.concentration,
				ritual: spell.ritual,
				verbal: spell.verbal,
				somatic: spell.somatic,
				material: spell.material,
				materialSpecified: spell.materialSpecified,
				materialConsumed: spell.materialConsumed,
				higherLevel: spell.higherLevel,
				shapeType: spell.shapeType,
				shapeSize: spell.shapeSize,
				shapeSizeUnit: spell.shapeSizeUnit,
				classes: spell.classes,
			},
		},
		image,
	);
}
