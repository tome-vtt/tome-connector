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

import { stripMarkdownFromString } from '../../tomeMarkdownSanitizer';
import { slug } from '../labelledMarkdown';

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

const DAMAGE = /^\s*-\s*\*\*Damage\*\*:[ \t]*(.*)$/m;
const ONE_HANDED = /^\s*-\s*One-handed:\s*(.+)$/m;
const TWO_HANDED = /^\s*-\s*Two-handed:\s*(\S+)/m;
const DICE_AND_TYPE = /^(\S+)\s+([a-z]+)/i;
const RANGE = /^\s*-\s*\*\*Range\*\*:\s*(\d+)\s*\/\s*(\d+)/m;
const PROPERTIES = /^\s*-\s*\*\*Properties\*\*:\s*(.+)$/m;
const ARMOR_CLASS = /^\s*-\s*\*\*Armor Class\*\*:\s*\+?(\d+)(.*)$/m;
const STRENGTH = /^\s*-\s*\*\*Strength\*\*:\D*(\d+)/m;
const STEALTH = /^\s*-\s*\*\*Stealth\*\*:/m;

/**
 * The 2024 SRD's weapon properties, by the key the shipped catalogue gives each. A
 * content source layers over that catalogue, so a weapon points at these rather than
 * carrying its own copies; a property Tome has no entry for is left off.
 */
const SHIPPED_PROPERTIES = new Set([
	'ammunition', 'finesse', 'heavy', 'light', 'loading', 'reach', 'thrown', 'two-handed', 'versatile',
]);

function readProperties(body: string, versatileDice: string | null, range: string | null) {
	const line = PROPERTIES.exec(body)?.[1] ?? '';
	return stripMarkdownFromString(line)
		.split(',')
		.map((name) => slug(name.trim()))
		.filter((name) => SHIPPED_PROPERTIES.has(name))
		.map((name) => ({
			property: `srd-2024_${name}-wp`,
			detail:
				name === 'versatile'
					? versatileDice
					: name === 'thrown' || name === 'ammunition'
						? range
						: null,
		}));
}

/** The weapon a note describes, or null when it has no damage line. */
export function readWeapon(body: string, subtitle: string, key: string, name: string): PackageWeapon | null {
	const damage = DAMAGE.exec(body);
	if (!damage) return null;

	const oneHanded = damage[1]?.trim() || ONE_HANDED.exec(body)?.[1] || '';
	const [, dice = null, type = null] = DICE_AND_TYPE.exec(oneHanded.trim()) ?? [];
	const range = RANGE.exec(body);

	return {
		key,
		name,
		damageDice: dice,
		damageType: type?.toLowerCase() ?? null,
		range: Number(range?.[1] ?? 0),
		longRange: Number(range?.[2] ?? 0),
		distanceUnit: null,
		isSimple: /\bsimple\b/i.test(subtitle),
		isImprovised: false,
		properties: readProperties(
			body,
			TWO_HANDED.exec(body)?.[1] ?? null,
			range ? `Range ${range[1]}/${range[2]}` : null,
		),
	};
}

/** The armour a note describes, or null when it has no armour class line. */
export function readArmor(body: string, key: string, name: string): PackageArmor | null {
	const armorClass = ARMOR_CLASS.exec(body);
	if (!armorClass) return null;

	const rest = armorClass[2] ?? '';
	const strength = STRENGTH.exec(body)?.[1];
	const cap = /max of \+(\d+)/i.exec(rest)?.[1];

	return {
		key,
		name,
		acBase: Number(armorClass[1]),
		acAddDexMod: /\bDex\b/i.test(rest),
		acCapDexMod: cap === undefined ? null : Number(cap),
		strengthScoreRequired: strength === undefined ? null : Number(strength),
		grantsStealthDisadvantage: STEALTH.test(body),
	};
}
