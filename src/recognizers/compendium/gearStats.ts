/**
 * Reads a weapon's or an armour's stats out of a `ttrpg-convert-cli` item note, in
 * the server's `Srd2024Weapon` and `Srd2024Armor` shapes.
 *
 * The CLI writes them as field lines under the subtitle: `- **Damage**: 1d8 slashing`
 * (or a `One-handed:`/`Two-handed:` pair beneath it), `- **Range**: 80/320`,
 * `- **Properties**: [Finesse](...), ...`, and for armour `- **Armor Class**: 14 + Dex
 * modifier (max of +2)`, `- **Strength**: Requires 13 STR.` and a `- **Stealth**:` line.
 * A note is a weapon when it has a damage line and armour when it has an armour class.
 *
 * Pure and `obsidian`-free.
 */

import { labelMap, slug } from '../labelledMarkdown';
import { SUBTITLE } from './magicItem';

/** Mirrors the server's `Srd2024Weapon`. */
export interface PackageWeapon {
	key: string;
	name: string;
	damageDice: string | null;
	damageType: string | null;
	/** In feet; 0 for a melee weapon, as the shipped catalogue writes it. */
	range: number;
	longRange: number;
	distanceUnit: null;
	isSimple: boolean;
	isImprovised: boolean;
	properties: { property: string; detail: string | null }[];
}

/** Mirrors the server's `Srd2024Armor`. */
export interface PackageArmor {
	key: string;
	name: string;
	acBase: number;
	acAddDexMod: boolean;
	/** Null means no cap; 2 is the medium-armour limit. */
	acCapDexMod: number | null;
	strengthScoreRequired: number | null;
	grantsStealthDisadvantage: boolean;
}

const ONE_HANDED = /^[ \t]*-[ \t]*One-handed:[ \t]*(.+)$/m;
const TWO_HANDED = /^[ \t]*-[ \t]*Two-handed:[ \t]*(\S+)/m;
const DICE_AND_TYPE = /^(\S+)\s+([a-z]+)/i;
const RANGE = /^(\d+)\s*\/\s*(\d+)/;

/**
 * The 2024 SRD's weapon properties, by the key the shipped catalogue gives each. A
 * content source layers over that catalogue, so a weapon points at these rather than
 * carrying its own copies; a property Tome has no entry for is left off.
 */
const SHIPPED_PROPERTIES = new Set([
	'ammunition', 'finesse', 'heavy', 'light', 'loading', 'reach', 'thrown', 'two-handed', 'versatile',
]);

/** What a property's `detail` carries: the versatile die, or the thrown or ammunition range. */
function propertyDetail(name: string, versatileDice: string | null, range: string | null): string | null {
	if (name === 'versatile') return versatileDice;
	if (name === 'thrown' || name === 'ammunition') return range;
	return null;
}

/** The weapon a note's preamble describes, or null when it has no damage line. */
export function readWeapon(body: string, key: string, name: string): PackageWeapon | null {
	const fields = labelMap(body);
	const damage = fields.get('damage');
	if (damage === undefined) return null;

	const oneHanded = damage || ONE_HANDED.exec(body)?.[1] || '';
	const [, dice = null, type = null] = DICE_AND_TYPE.exec(oneHanded.trim()) ?? [];
	const range = RANGE.exec(fields.get('range') ?? '');
	const rangeDetail = range ? `Range ${range[1]}/${range[2]}` : null;
	const versatileDice = TWO_HANDED.exec(body)?.[1] ?? null;

	return {
		key,
		name,
		damageDice: dice,
		damageType: type,
		range: Number(range?.[1] ?? 0),
		longRange: Number(range?.[2] ?? 0),
		distanceUnit: null,
		isSimple: /\bsimple\b/i.test(SUBTITLE.exec(body)?.[1] ?? ''),
		isImprovised: false,
		properties: (fields.get('properties') ?? '')
			.split(',')
			.map((property) => slug(property.trim()))
			.filter((property) => SHIPPED_PROPERTIES.has(property))
			.map((property) => ({
				property: `srd-2024_${property}-wp`,
				detail: propertyDetail(property, versatileDice, rangeDetail),
			})),
	};
}

/** The armour a note's preamble describes, or null when it has no armour class line. */
export function readArmor(body: string, key: string, name: string): PackageArmor | null {
	const fields = labelMap(body);
	const armorClass = /^\+?(\d+)(.*)$/.exec(fields.get('armor class') ?? '');
	if (!armorClass) return null;

	const rest = armorClass[2] ?? '';
	const strength = /\d+/.exec(fields.get('strength') ?? '')?.[0];
	const cap = /max of \+(\d+)/i.exec(rest)?.[1];

	return {
		key,
		name,
		acBase: Number(armorClass[1]),
		acAddDexMod: /\bDex\b/i.test(rest),
		acCapDexMod: cap === undefined ? null : Number(cap),
		strengthScoreRequired: strength === undefined ? null : Number(strength),
		grantsStealthDisadvantage: fields.has('stealth'),
	};
}
