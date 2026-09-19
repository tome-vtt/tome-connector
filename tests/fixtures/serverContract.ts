/**
 * The Tome server's contract for the five rules-bearing routes, restated by hand.
 *
 * **Restated, never imported, and that is the point** - the same argument `routes.test.ts`
 * makes. The plugin's builders are one statement of the wire and this file is a second,
 * copied from the server itself, so a builder that drifts is caught by the other rather
 * than confirmed by reading its own output back.
 *
 * Two sources, both in the TomeVTT repository:
 *
 * - **What each body may carry** is `components.schemas` in the generated client schema,
 *   `tomevtt.client/src/app/api/generated/api-schema.ts`, as of TomeVTT `a103721a`: the
 *   input DTO each action binds, the named bag records under `Models/Dnd5e` and
 *   `Models/Pf2e`, and the nested records inside them. Every name is the camelCase one the
 *   records pin with `[JsonPropertyName]`.
 * - **What the server refuses** is `TomeVTT.Server/Models/DTOs/RetiredFlatMembers.cs`: the
 *   flat 5e members each input DTO accepted before its kind moved into the `dnd5e` bag.
 *   Any one of them at a body's top level is a 400 coded `connector.outdated`, whatever its
 *   value and even beside a valid bag. The server matches them case-insensitively, because
 *   the connector before 1.1.0 sent PascalCase (`HpMax`, `AC`).
 */

/** The keys an object may carry, and the shape of each key that is itself an object or a list of them. */
export interface Shape {
	keys: readonly string[];
	nested?: Readonly<Record<string, Shape>>;
}

const NAMED_ABILITY: Shape = { keys: ['name', 'desc'] };

const DND5E_CREATURE: Shape = {
	keys: [
		'size', 'type', 'subtype', 'alignment', 'ac', 'hp', 'hitDice', 'speed', 'stats',
		'abilitySaves', 'proficientSkills', 'damageVulnerabilities', 'damageResistances',
		'damageImmunities', 'conditionImmunities', 'senses', 'darkvisionFeet', 'languages', 'cr',
		'spells', 'traits', 'actions', 'legendaryActions', 'bonusActions', 'reactions',
	],
	nested: {
		abilitySaves: NAMED_ABILITY,
		proficientSkills: NAMED_ABILITY,
		traits: NAMED_ABILITY,
		actions: NAMED_ABILITY,
		legendaryActions: NAMED_ABILITY,
		bonusActions: NAMED_ABILITY,
		reactions: NAMED_ABILITY,
	},
};

const PF2E_CREATURE: Shape = {
	keys: [
		'key', 'name', 'source', 'level', 'rarity', 'size', 'traits', 'perception', 'perceptionNote',
		'senses', 'languages', 'languagesNote', 'skills', 'attributes', 'ac', 'acNote', 'fortitude',
		'reflex', 'will', 'savesNote', 'hp', 'hpNote', 'immunities', 'weaknesses', 'resistances',
		'speeds', 'speedNote', 'strikes', 'abilities', 'spellcasting', 'items',
	],
	nested: {
		skills: { keys: ['name', 'mod', 'note'] },
		attributes: { keys: ['str', 'dex', 'con', 'int', 'wis', 'cha'] },
		speeds: { keys: ['type', 'feet'] },
		strikes: {
			keys: ['name', 'kind', 'bonus', 'traits', 'damage', 'effects', 'rangeIncrement', 'text'],
			nested: { damage: { keys: ['formula', 'type', 'category'] } },
		},
		abilities: { keys: ['name', 'cost', 'category', 'traits', 'text'] },
	},
};

const DND5E_CHARACTER: Shape = {
	keys: [
		'species', 'class', 'level', 'classes', 'background', 'alignment', 'xp', 'hpMax',
		'hpCurrent', 'hpTemp', 'ac', 'speed', 'proficiencyBonus', 'str', 'dex', 'con', 'int', 'wis',
		'cha', 'initiative', 'saves', 'skills', 'attacks', 'spells', 'features', 'darkvisionFeet',
		'equipment', 'currency', 'playState', 'languages', 'armorProficiencies',
		'weaponProficiencies', 'toolProficiencies', 'build',
	],
	nested: {
		classes: { keys: ['name', 'subclass', 'level', 'classKey', 'subclassKey'] },
		saves: { keys: ['ability', 'bonus', 'proficient'] },
		skills: { keys: ['name', 'ability', 'bonus', 'proficient', 'expertise'] },
		attacks: {
			keys: [
				'name', 'toHit', 'damageDice', 'damageBonus', 'damageType', 'versatileDice', 'mastery',
				'rangeNormal', 'rangeLong', 'properties', 'notes', 'attackBonus', 'damage', 'range',
			],
		},
		spells: { keys: ['name', 'level', 'school', 'castTime', 'range', 'concentration', 'prepared'] },
		features: { keys: ['category', 'name', 'desc'] },
		equipment: {
			keys: [
				'id', 'name', 'quantity', 'weight', 'equipped', 'description', 'rarity',
				'requiresAttunement', 'grantedBy', 'sourceKey',
			],
		},
		currency: { keys: ['cp', 'sp', 'ep', 'gp', 'pp'] },
	},
};

const DND5E_SPELL: Shape = {
	keys: [
		'desc', 'level', 'school', 'castingTime', 'reactionCondition', 'duration', 'range',
		'rangeText', 'rangeUnit', 'concentration', 'ritual', 'verbal', 'somatic', 'material',
		'materialSpecified', 'materialConsumed', 'materialCost', 'attackRoll', 'savingThrowAbility',
		'damageRoll', 'damageTypes', 'higherLevel', 'shapeType', 'shapeSize', 'shapeSizeUnit',
		'targetCount', 'targetType', 'classes',
	],
};

const DND5E_MAGIC_ITEM: Shape = {
	keys: ['desc', 'rarity', 'category', 'requiresAttunement', 'attunementDetail', 'sourceKey'],
};

const DND5E_EQUIPMENT_ITEM: Shape = {
	keys: [
		'desc', 'category', 'cost', 'weight', 'sourceKey', 'damageDice', 'damageType', 'range',
		'longRange', 'distanceUnit', 'isSimple', 'weaponProperties', 'armorClassBase',
		'armorAddDexMod', 'armorCapDexMod', 'armorStrengthRequired', 'armorGrantsStealthDisadvantage',
	],
	nested: { weaponProperties: { keys: ['property', 'detail'] } },
};

/** The flat members `RetiredFlatMembers.cs` refuses, per input DTO. */
const RETIRED_CHARACTER = [
	'species', 'class', 'level', 'classes', 'background', 'alignment', 'xp',
	'hpMax', 'hpCurrent', 'hpTemp', 'ac', 'speed', 'proficiencyBonus',
	'str', 'dex', 'con', 'int', 'wis', 'cha', 'initiative',
	'saves', 'skills', 'attacks', 'spells', 'features', 'darkvisionFeet',
	'equipment', 'currency', 'languages',
	'armorProficiencies', 'weaponProficiencies', 'toolProficiencies', 'build',
] as const;

const RETIRED_CREATURE = [
	'size', 'type', 'subtype', 'alignment', 'ac', 'hp', 'hitDice', 'speed', 'stats',
	'abilitySaves', 'proficientSkills',
	'damageVulnerabilities', 'damageResistances', 'damageImmunities', 'conditionImmunities',
	'senses', 'darkvisionFeet', 'languages', 'cr', 'spells',
	'traits', 'actions', 'legendaryActions', 'bonusActions', 'reactions',
] as const;

const RETIRED_SPELL = [
	'desc', 'level', 'school', 'castingTime', 'reactionCondition', 'duration',
	'range', 'rangeText', 'rangeUnit', 'concentration', 'ritual',
	'verbal', 'somatic', 'material', 'materialSpecified', 'materialConsumed', 'materialCost',
	'attackRoll', 'savingThrowAbility', 'damageRoll', 'damageTypes', 'higherLevel',
	'shapeType', 'shapeSize', 'shapeSizeUnit', 'targetCount', 'targetType', 'classes',
] as const;

const RETIRED_MAGIC_ITEM_INPUT = [
	'desc', 'rarity', 'category', 'requiresAttunement', 'attunementDetail', 'sourceKey',
] as const;

const RETIRED_EQUIPMENT_INPUT = [
	'desc', 'category', 'cost', 'weight',
	'damageDice', 'damageType', 'range', 'longRange', 'distanceUnit', 'isSimple', 'weaponProperties',
	'armorClassBase', 'armorAddDexMod', 'armorCapDexMod', 'armorStrengthRequired',
	'armorGrantsStealthDisadvantage', 'sourceKey',
] as const;

/** One input DTO: what its body may carry, and which of its old flat members the server refuses. */
export interface InputContract {
	dto: string;
	shape: Shape;
	retired: readonly string[];
}

export const IMPORT_NON_PLAYER_CHARACTER: InputContract = {
	dto: 'ImportNonPlayerCharacterDto',
	shape: {
		// `fgg` (For Gold & Glory) is declared too; the connector has no such stat block to fill it with.
		keys: ['id', 'image', 'name', 'alias', 'dnd5e', 'pf2e', 'fgg', 'isFavorite'],
		nested: { dnd5e: DND5E_CREATURE, pf2e: PF2E_CREATURE },
	},
	retired: RETIRED_CREATURE,
};

export const PLAYER_CHARACTER_INPUT: InputContract = {
	dto: 'PlayerCharacterInputDto',
	shape: {
		// `pf2e` and `fgg` are declared too; the connector sends only D&D Beyond sheets, so it fills neither.
		keys: ['name', 'alias', 'gender', 'dndBeyondId', 'image', 'isFavorite', 'dnd5e', 'pf2e', 'fgg'],
		nested: { dnd5e: DND5E_CHARACTER },
	},
	retired: RETIRED_CHARACTER,
};

export const SPELL_INPUT: InputContract = {
	dto: 'SpellInputDto',
	shape: { keys: ['sourceKey', 'image', 'id', 'name', 'dnd5e'], nested: { dnd5e: DND5E_SPELL } },
	retired: RETIRED_SPELL,
};

export const MAGIC_ITEM_INPUT: InputContract = {
	dto: 'MagicItemInputDto',
	shape: { keys: ['id', 'name', 'dnd5e', 'image'], nested: { dnd5e: DND5E_MAGIC_ITEM } },
	retired: RETIRED_MAGIC_ITEM_INPUT,
};

export const EQUIPMENT_ITEM_INPUT: InputContract = {
	dto: 'EquipmentItemInputDto',
	shape: { keys: ['id', 'name', 'dnd5e', 'image'], nested: { dnd5e: DND5E_EQUIPMENT_ITEM } },
	retired: RETIRED_EQUIPMENT_INPUT,
};

/** The two bag names a rules-bearing body may carry, exactly one of which it must. */
export const BAG_NAMES = ['dnd5e', 'pf2e'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every key in `value` the shape does not declare, as a dotted path - compared exactly, so a
 * key in the wrong case is reported too. Lists are walked element by element.
 */
export function undeclaredKeys(value: unknown, shape: Shape, path = ''): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((entry, index) => undeclaredKeys(entry, shape, `${path}[${index}]`));
	}
	if (!isRecord(value)) return [];

	const found: string[] = [];
	for (const [key, child] of Object.entries(value)) {
		const where = path === '' ? key : `${path}.${key}`;
		if (!shape.keys.includes(key)) {
			found.push(where);
			continue;
		}
		const nested = shape.nested?.[key];
		if (nested) found.push(...undeclaredKeys(child, nested, where));
	}
	return found;
}

/**
 * The top-level keys the server would refuse the body over, matched case-insensitively as
 * `RetiredFlatMembers.Refuse` does - `AC` is `ac`.
 */
export function retiredKeysIn(body: Record<string, unknown>, contract: InputContract): string[] {
	const retired = new Set(contract.retired.map((name) => name.toLowerCase()));
	return Object.keys(body).filter((key) => retired.has(key.toLowerCase()));
}
