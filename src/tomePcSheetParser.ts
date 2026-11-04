/**
 * Parses the body of a D&D Beyond-exported character note into the structured
 * fields the Tome endpoint stores.
 *
 * Frontmatter carries the scalars - hit points, ability scores, level - and
 * that is all `syncPlayerCharacterToTome` used to read. Everything that makes a
 * character more than a row of numbers (what they are proficient in, what they
 * can do, what they are carrying) only ever exists in the note *body*, as the
 * rendered markdown tables and headings the exporter writes. This module reads
 * that body.
 *
 * Every field is named and cased as the server's `Dnd5eCharacter` record pins it,
 * because `playerCharacterBody` spreads the result straight into the character's
 * `dnd5e` bag.
 *
 * Two properties of the exporter's output shape everything here:
 *
 * - A section is omitted entirely when it would be empty. A barbarian's note has
 *   no `## Spells` heading at all rather than an empty one, so every parse
 *   returns what it found and no missing heading is an error.
 * - Cells carry presentation markup - `**+7** ✓ <span …>▲A</span>` - so every
 *   cell goes through `cleanCell` before it is read as a value.
 */

/** One of the six saving throws, as the sheet reports it. */
export interface PcSave {
	/** Ability abbreviation, upper case: `STR`, `DEX`, … */
	ability: string;
	/** Total bonus including proficiency, e.g. `7` for "+7". */
	bonus: number;
	proficient: boolean;
}

/** One row of the skills table. The exporter lists all eighteen, proficient or not. */
export interface PcSkill {
	name: string;
	/** The governing ability, upper case. */
	ability: string;
	bonus: number;
	proficient: boolean;
	expertise: boolean;
}

/** A row of the "Actions & Attacks" table. Values stay strings - `Damage` is as often `2d6+4` as a number. */
export interface PcAttack {
	name: string;
	attackBonus: string;
	damage: string;
	range: string;
	notes: string;
}

export interface PcSpell {
	name: string;
	/** 0 for a cantrip, otherwise the spell level. */
	level: number;
	school: string;
	castTime: string;
	range: string;
	concentration: boolean;
	prepared: boolean;
}

/** A feature, feat, or racial trait, kept under the sub-heading it was listed beneath. */
export interface PcFeature {
	/** `Racial Traits`, `Feats`, `Character Traits`, … whatever the note used. */
	category: string;
	name: string;
	desc: string;
}

export interface PcItem {
	name: string;
	quantity: number;
	/** As printed, e.g. `1.0 lbs` - the exporter's units, not ours to reinterpret. */
	weight: string;
	equipped: boolean;
}

export interface PcCurrency {
	cp: number;
	sp: number;
	ep: number;
	gp: number;
	pp: number;
}

/** Everything the note body has to offer. Every field is optional or empty-by-default. */
export interface PcSheet {
	initiative?: number;
	saves: PcSave[];
	skills: PcSkill[];
	attacks: PcAttack[];
	spells: PcSpell[];
	features: PcFeature[];
	equipment: PcItem[];
	currency?: PcCurrency;
	languages?: string;
	armorProficiencies?: string;
	weaponProficiencies?: string;
	toolProficiencies?: string;
}

/**
 * Upper bound on a single feature's description.
 *
 * The exporter flattens any table inside a feature into loose lines - the Elven
 * Lineage trait alone expands to well over a thousand characters of orphaned
 * table cells. Keeping the text is right (it is the character's own rules text),
 * letting one bad trait carry a hundred kilobytes into a jsonb column is not.
 */
const MAX_FEATURE_DESC = 2000;

/** Ability abbreviations, so a stray column header cannot invent a seventh ability. */
const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

/** `✓` marks proficiency, `★` marks expertise. Expertise implies proficiency. */
const PROFICIENT_MARK = '✓';
const EXPERTISE_MARK = '★';

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
	'&#39;': "'",
	'&nbsp;': ' ',
	'&ndash;': '–',
	'&mdash;': '—',
	'&rsquo;': '’',
	'&lsquo;': '‘',
	'&ldquo;': '“',
	'&rdquo;': '”',
	'&hellip;': '…',
};

/**
 * Strips the leading `---` frontmatter block, so the caller can hand this module
 * a whole note. A note with no frontmatter is returned unchanged rather than
 * having its first section eaten.
 */
export function stripFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) return normalized;
	const end = normalized.indexOf('\n---', 3);
	if (end === -1) return normalized;
	return normalized.slice(normalized.indexOf('\n', end + 1) + 1);
}

function decodeEntities(value: string): string {
	return value.replace(
		/&(?:amp|lt|gt|quot|apos|#39|nbsp|ndash|mdash|rsquo|lsquo|ldquo|rdquo|hellip);/g,
		(match) => ENTITIES[match] ?? match,
	);
}

/**
 * Reduces a rendered table cell to its value.
 *
 * `<span>` elements are dropped *with* their contents rather than unwrapped:
 * the only thing the exporter puts in one is the advantage marker (`▲A`, `–N`,
 * `▼D`), which reads as data but is not - it comes out `▲A` on all six saves and
 * `–N` on all eighteen skills for every character, so it carries no information
 * and is deliberately not parsed into a field.
 */
export function cleanCell(value: string): string {
	return decodeEntities(value)
		.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\*\*/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** Drops a leading emoji badge (`⚔️`, `✨`) so names sort and match on their text. */
function stripLeadingSymbols(value: string): string {
	return value.replace(/^[^\p{L}\p{N}"'(]+/u, '').trim();
}

/** Reads a signed integer out of a cell like `+7`, `-1`, or `5 ft`. Returns undefined when there is no number. */
function toIntSafe(value: string): number | undefined {
	const match = value.match(/[+-]?\d+/);
	return match ? parseInt(match[0], 10) : undefined;
}

interface Section {
	title: string;
	lines: string[];
	subsections: Section[];
}

/**
 * Splits a note body into its `##` sections, each with its own `###`
 * subsections. The `#` title line is ignored - it only ever repeats the name.
 */
export function splitSections(body: string): Section[] {
	const sections: Section[] = [];
	let current: Section | null = null;
	let sub: Section | null = null;

	for (const line of body.split('\n')) {
		const h2 = line.match(/^##\s+(.+?)\s*$/);
		if (h2?.[1] !== undefined) {
			current = { title: h2[1], lines: [], subsections: [] };
			sub = null;
			sections.push(current);
			continue;
		}
		const h3 = line.match(/^###\s+(.+?)\s*$/);
		if (h3?.[1] !== undefined && current) {
			sub = { title: h3[1], lines: [], subsections: [] };
			current.subsections.push(sub);
			continue;
		}
		if (sub) {
			sub.lines.push(line);
		} else if (current) {
			current.lines.push(line);
		}
	}

	return sections;
}

/** Case- and punctuation-insensitive section lookup, so `Proficiencies & Languages` survives a stray `&amp;`. */
function findSection(sections: Section[], title: string): Section | undefined {
	const wanted = normalizeTitle(title);
	return sections.find((section) => normalizeTitle(section.title) === wanted);
}

function normalizeTitle(title: string): string {
	return decodeEntities(title).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isTableRow(line: string): boolean {
	return line.trim().startsWith('|');
}

/** A `|:---|:--:|---|` line - the separator that confirms the row above it was a header. */
function isTableSeparator(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith('|') && /^[|\s:-]+$/.test(trimmed) && trimmed.includes('-');
}

function splitRow(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map(cleanCell);
}

/**
 * Finds the first markdown table in `lines` and returns its header and body
 * rows, already cleaned. Rows whose cells are all empty are dropped - the
 * exporter leaves a trailing blank row on some tables.
 */
export function findTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
	for (let i = 0; i < lines.length - 1; i++) {
		const header = lines[i];
		const separator = lines[i + 1];
		if (header === undefined || separator === undefined) continue;
		if (!isTableRow(header) || !isTableSeparator(separator)) continue;

		const rows: string[][] = [];
		for (let j = i + 2; j < lines.length; j++) {
			const line = lines[j];
			if (line === undefined || !isTableRow(line)) break;
			const cells = splitRow(line);
			if (cells.some((cell) => cell !== '')) rows.push(cells);
		}
		return { headers: splitRow(header), rows };
	}
	return null;
}

/** Index of the first header whose text contains `needle`, or -1. */
function columnIndex(headers: string[], needle: string): number {
	const wanted = needle.toLowerCase();
	return headers.findIndex((header) => header.toLowerCase().includes(wanted));
}

function cellAt(row: string[], index: number): string {
	if (index < 0) return '';
	return row[index] ?? '';
}

/**
 * Reads one number out of a one-row table: initiative and the proficiency
 * bonus from `## Core Stats`, an ability score from `## Ability Scores`. Of
 * these only initiative is sent as its own field; the rest is duplicated from
 * frontmatter, the more reliable source because it is typed rather than
 * formatted, and read here only to work out spell attack bonuses.
 */
function firstRowNumber(section: Section | undefined, header: string): number | undefined {
	if (!section) return undefined;
	const table = findTable(section.lines);
	const row = table?.rows[0];
	if (!table || !row) return undefined;
	return toIntSafe(cellAt(row, columnIndex(table.headers, header)));
}

/**
 * The saving-throw table is a single row of six cells, one per ability, headed
 * by the ability abbreviations. A proficient save is bolded *and* ticked; the
 * tick is what we read, since bold survives `cleanCell` no better than it needs to.
 */
function parseSaves(section: Section | undefined): PcSave[] {
	if (!section) return [];
	const table = findTable(section.lines);
	const row = table?.rows[0];
	if (!table || !row) return [];

	const saves: PcSave[] = [];
	table.headers.forEach((header, index) => {
		const ability = header.toUpperCase().trim();
		if (!ABILITIES.includes(ability)) return;
		const cell = cellAt(row, index);
		const bonus = toIntSafe(cell);
		if (bonus === undefined) return;
		saves.push({
			ability: ability,
			bonus: bonus,
			proficient: cell.includes(PROFICIENT_MARK) || cell.includes(EXPERTISE_MARK),
		});
	});
	return saves;
}

function parseSkills(section: Section | undefined): PcSkill[] {
	if (!section) return [];
	const table = findTable(section.lines);
	if (!table) return [];

	const nameCol = columnIndex(table.headers, 'skill');
	const abilityCol = columnIndex(table.headers, 'stat');
	const bonusCol = columnIndex(table.headers, 'bonus');

	const skills: PcSkill[] = [];
	for (const row of table.rows) {
		const rawName = cellAt(row, nameCol);
		const name = rawName.replace(PROFICIENT_MARK, '').replace(EXPERTISE_MARK, '').trim();
		if (name === '') continue;
		const bonus = toIntSafe(cellAt(row, bonusCol));
		if (bonus === undefined) continue;
		const expertise = rawName.includes(EXPERTISE_MARK);
		skills.push({
			name: name,
			ability: cellAt(row, abilityCol).toUpperCase(),
			bonus: bonus,
			proficient: expertise || rawName.includes(PROFICIENT_MARK),
			expertise: expertise,
		});
	}
	return skills;
}

/**
 * The ability each class casts its spells with. Fighter and Rogue are left
 * out: they cast only through Intelligence subclasses (Eldritch Knight, Arcane
 * Trickster), where the exporter's own Intelligence-based bonus is already right.
 */
const CASTING_ABILITY: Record<string, string> = {
	artificer: 'INT',
	bard: 'CHA',
	cleric: 'WIS',
	druid: 'WIS',
	paladin: 'CHA',
	ranger: 'WIS',
	sorcerer: 'CHA',
	warlock: 'CHA',
	wizard: 'INT',
};

/**
 * The bonus every spell row should carry: proficiency plus the casting
 * ability's modifier, or undefined when the note does not say enough.
 *
 * The exporter writes a spell row as Intelligence modifier plus proficiency
 * whatever the class casts with, and lists only class spells as attack rows
 * (a feat's spells never become one), so the class line, `> **Sorcerer 2** • …`,
 * names the ability.
 * ponytail: a multiclass note does not say which class a cantrip is from, so the first casting class listed wins.
 */
function spellAttackBonus(body: string, sections: Section[]): string | undefined {
	const classLine = body.match(/^>\s*\*\*(.+?)\*\*/m)?.[1] ?? '';
	const ability = classLine
		.split('/')
		.map((part) => CASTING_ABILITY[part.replace(/\d+/g, '').trim().toLowerCase()])
		.find((found) => found !== undefined);
	if (ability === undefined) return undefined;

	const score = firstRowNumber(findSection(sections, 'Ability Scores'), ability);
	const proficiency = firstRowNumber(findSection(sections, 'Core Stats'), 'proficiency');
	if (score === undefined || proficiency === undefined) return undefined;
	const bonus = Math.floor((score - 10) / 2) + proficiency;
	return bonus < 0 ? `${bonus}` : `+${bonus}`;
}

/** The exporter marks a spell row with this badge and a weapon row with `⚔️`. */
const SPELL_ROW_MARK = '✨';

function parseAttacks(section: Section | undefined, spellBonus: string | undefined): PcAttack[] {
	if (!section) return [];
	const table = findTable(section.lines);
	if (!table) return [];

	const nameCol = columnIndex(table.headers, 'name');
	const bonusCol = columnIndex(table.headers, 'atk');
	const damageCol = columnIndex(table.headers, 'damage');
	const rangeCol = columnIndex(table.headers, 'range');
	const notesCol = columnIndex(table.headers, 'notes');

	const attacks: PcAttack[] = [];
	for (const row of table.rows) {
		const rawName = cellAt(row, nameCol);
		const name = stripLeadingSymbols(rawName);
		if (name === '') continue;
		const isSpell = rawName.startsWith(SPELL_ROW_MARK);
		attacks.push({
			name: name,
			attackBonus: isSpell && spellBonus !== undefined ? spellBonus : cellAt(row, bonusCol),
			damage: cellAt(row, damageCol),
			range: cellAt(row, rangeCol),
			notes: cellAt(row, notesCol),
		});
	}
	return attacks;
}

/**
 * Turns a spell sub-heading into a level. `Cantrips` is 0; `1st Level`, `2nd
 * Level` and so on give up their leading number. A heading we cannot read is
 * skipped rather than filed under level 0, where it would masquerade as a cantrip.
 */
function spellLevel(title: string): number | undefined {
	if (/cantrip/i.test(title)) return 0;
	const level = toIntSafe(title);
	return level !== undefined && level >= 1 && level <= 9 ? level : undefined;
}

/**
 * Spells live one table per level sub-heading. The exporter can repeat a spell
 * (a cantrip granted twice by different features lists twice), so entries are
 * deduplicated on level and name.
 */
function parseSpells(section: Section | undefined): PcSpell[] {
	if (!section) return [];

	const spells: PcSpell[] = [];
	const seen = new Set<string>();
	for (const sub of section.subsections) {
		const level = spellLevel(sub.title);
		if (level === undefined) continue;
		const table = findTable(sub.lines);
		if (!table) continue;

		const nameCol = columnIndex(table.headers, 'spell');
		const schoolCol = columnIndex(table.headers, 'school');
		const castCol = columnIndex(table.headers, 'cast');
		const rangeCol = columnIndex(table.headers, 'range');
		const concCol = columnIndex(table.headers, 'conc');
		const preparedCol = columnIndex(table.headers, 'prepared');

		for (const row of table.rows) {
			const name = stripLeadingSymbols(cellAt(row, nameCol));
			if (name === '') continue;
			const key = `${level}:${name.toLowerCase()}`;
			if (seen.has(key)) continue;
			seen.add(key);
			spells.push({
				name: name,
				level: level,
				school: cellAt(row, schoolCol),
				castTime: cellAt(row, castCol),
				range: cellAt(row, rangeCol),
				concentration: isTicked(cellAt(row, concCol)),
				prepared: isTicked(cellAt(row, preparedCol)),
			});
		}
	}
	return spells;
}

/** The exporter writes `✓` for yes and an em dash for no, so anything that is not a tick is a no. */
function isTicked(value: string): boolean {
	return value.includes(PROFICIENT_MARK) || /^(yes|true)$/i.test(value.trim());
}

/**
 * Features are `**Name**` followed by free text, grouped under `###`
 * sub-headings. A note with no sub-headings still parses - its features are
 * filed under the section's own title.
 */
function parseFeatures(section: Section | undefined): PcFeature[] {
	if (!section) return [];

	const groups: Section[] = section.subsections.length > 0
		? section.subsections
		: [section];

	const features: PcFeature[] = [];
	for (const group of groups) {
		let name: string | null = null;
		let body: string[] = [];

		const flush = () => {
			if (name === null) return;
			const desc = body
				.join('\n')
				.replace(/\n{3,}/g, '\n\n')
				.trim();
			features.push({
				category: group.title,
				name: name,
				desc: desc.length > MAX_FEATURE_DESC ? `${desc.slice(0, MAX_FEATURE_DESC).trimEnd()}…` : desc,
			});
			name = null;
			body = [];
		};

		for (const line of group.lines) {
			// A line that is *only* bold text is a feature name; bold used inside a
			// paragraph is emphasis and stays with the text it belongs to.
			const heading = line.match(/^\*\*(.+?)\*\*\s*$/);
			if (heading?.[1] !== undefined) {
				flush();
				name = decodeEntities(heading[1]).trim();
				continue;
			}
			if (name !== null) body.push(decodeEntities(line));
		}
		flush();
	}
	return features;
}

function parseEquipment(section: Section | undefined): PcItem[] {
	if (!section) return [];
	const table = findTable(section.lines);
	if (!table) return [];

	const nameCol = columnIndex(table.headers, 'item');
	const qtyCol = columnIndex(table.headers, 'qty');
	const equippedCol = columnIndex(table.headers, 'equipped');
	const weightCol = columnIndex(table.headers, 'weight');

	const items: PcItem[] = [];
	for (const row of table.rows) {
		const name = stripLeadingSymbols(cellAt(row, nameCol));
		if (name === '') continue;
		items.push({
			name: name,
			quantity: toIntSafe(cellAt(row, qtyCol)) ?? 1,
			weight: cellAt(row, weightCol),
			equipped: isTicked(cellAt(row, equippedCol)),
		});
	}
	return items;
}

/** A one-row table of coin counts. Absent columns read as zero rather than dropping the whole purse. */
function parseCurrency(section: Section | undefined): PcCurrency | undefined {
	if (!section) return undefined;
	const table = findTable(section.lines);
	const row = table?.rows[0];
	if (!table || !row) return undefined;

	const coin = (label: string): number =>
		toIntSafe(cellAt(row, columnIndex(table.headers, label))) ?? 0;

	const currency: PcCurrency = {
		cp: coin('cp'),
		sp: coin('sp'),
		ep: coin('ep'),
		gp: coin('gp'),
		pp: coin('pp'),
	};
	// An all-zero purse is the exporter's default for a character who has never
	// tracked coin; storing it would put an empty Currency card on every sheet.
	const empty = Object.values(currency).every((value) => value === 0);
	return empty ? undefined : currency;
}

/** `**Languages:** Common, Dwarvish` and its siblings, keyed by the bolded label. */
function parseLabelledLines(section: Section | undefined): Map<string, string> {
	const found = new Map<string, string>();
	if (!section) return found;
	for (const line of section.lines) {
		const match = line.match(/^\*\*(.+?):?\*\*:?\s*(.+?)\s*$/);
		if (match?.[1] === undefined || match[2] === undefined) continue;
		found.set(normalizeTitle(match[1]), cleanCell(match[2]));
	}
	return found;
}

/**
 * Parses a whole character note (frontmatter included, or just its body) into
 * the structured fields the endpoint stores.
 */
export function parsePcSheet(content: string): PcSheet {
	const body = stripFrontmatter(content);
	const sections = splitSections(body);
	const proficiencies = parseLabelledLines(findSection(sections, 'Proficiencies & Languages'));

	return {
		initiative: firstRowNumber(findSection(sections, 'Core Stats'), 'initiative'),
		saves: parseSaves(findSection(sections, 'Saving Throws')),
		skills: parseSkills(findSection(sections, 'Skills')),
		attacks: parseAttacks(findSection(sections, 'Actions & Attacks'), spellAttackBonus(body, sections)),
		spells: parseSpells(findSection(sections, 'Spells')),
		features: parseFeatures(findSection(sections, 'Features & Traits')),
		equipment: parseEquipment(findSection(sections, 'Equipment')),
		currency: parseCurrency(findSection(sections, 'Currency')),
		languages: proficiencies.get('languages'),
		armorProficiencies: proficiencies.get('armor'),
		weaponProficiencies: proficiencies.get('weapons'),
		toolProficiencies: proficiencies.get('tools'),
	};
}
