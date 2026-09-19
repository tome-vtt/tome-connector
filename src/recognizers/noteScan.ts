/**
 * Decides what, if anything, a note has to send.
 *
 * The existing sync paths are all driven by a button on a *rendered* block, so
 * they never had to answer this: Obsidian had already found the fence and the
 * user had already pointed at it. A vault scan has neither, so this reads file
 * text and frontmatter and reports what it finds.
 *
 * Pure and `obsidian`-free, with the YAML parser passed in — `parseYaml` cannot
 * resolve under vitest, and injecting it is what keeps the interesting half of
 * the scanner testable. That is the same seam the plugin already uses elsewhere;
 * see the header of `tomeChapterPlan.ts`.
 */

import { extractFencedBlocks } from './markdownBlocks';
import { cliNoteType } from './compendium/cliNote';
import { parseEquipmentItem } from './compendium/equipmentItem';
import { isMagic, parseMagicItem, readImagePath } from './compendium/magicItem';
import { parseSpell } from './compendium/spell';
import { mapToEncounterPayload } from './encounter';
import { mapReferenceFrom } from './map';
import { hasInlineStats } from './statblockCreature';
import { noteName, type Note } from './note';

export type SendableKind = 'creature' | 'encounter' | 'map' | 'magicItem' | 'equipmentItem' | 'spell';

/**
 * One thing in one note that could be sent.
 *
 * Deliberately not a finished payload: creatures need the Fantasy Statblocks
 * bestiary and maps need image bytes off disk, and neither is available here.
 * The scan produces intent, and the sender resolves it — which is also what lets
 * the preview count things without reading a single image.
 */
export interface Sendable {
	kind: SendableKind;
	/** Vault-relative path of the note it came from. */
	path: string;
	/** What the preview lists it as. */
	label: string;
	/** The parsed block or frontmatter, for the sender to finish. */
	source: Record<string, unknown>;
	/**
	 * Line of the opening fence, so an id can be written back. Absent when the
	 * creature came from frontmatter rather than a fence.
	 */
	startLine?: number;
}

/** Injected so this module never imports `obsidian`. Returns null on bad YAML. */
export type YamlParser = (source: string) => unknown;

/**
 * Whether a note's frontmatter declares it a creature.
 *
 * `ttrpg-convert-cli` writes **`statblock: inline`**, not `statblock: true` — the
 * plugin accepts several values here and the docs lead with `true`, so reading
 * only that would miss every note the CLI generates. Anything truthy that is not
 * an explicit `false` counts.
 */
export function declaresStatblock(frontmatter: Record<string, unknown> | null): boolean {
	if (!frontmatter) return false;
	const value = frontmatter.statblock;
	if (value === undefined || value === null) return false;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') return value.trim().toLowerCase() !== 'false';
	return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function creatureLabel(record: Record<string, unknown>, fallback: string): string {
	const name = record.name ?? record.monster;
	return typeof name === 'string' && name.trim() !== '' ? name.trim() : fallback;
}

/**
 * Everything sendable in one note.
 *
 * A note may hold several — a location note with a map and the encounter that
 * happens there is ordinary — so this returns a list rather than a first match.
 *
 * A creature is taken from the frontmatter *only* when the note has no statblock
 * fence. The CLI writes both, with the fence holding the real stats and the
 * frontmatter carrying `statblock: inline` to point at it; reading both would
 * import every one of its 667 creatures twice.
 */
export function findSendables(note: Note, parseYaml: YamlParser): Sendable[] {
	const found: Sendable[] = [];
	let sawStatblockFence = false;

	for (const block of extractFencedBlocks(note.content)) {
		if (block.language === 'statblock') sawStatblockFence = true;

		let record: Record<string, unknown> | null;
		try {
			record = asRecord(parseYaml(block.source));
		} catch {
			continue;
		}
		if (!record) continue;

		const sendable = sendableFromBlock(block.language, record, note);
		if (sendable) found.push({ ...sendable, startLine: block.startLine });
	}

	const fromFrontmatter = creatureFromFrontmatter(note, sawStatblockFence);
	if (fromFrontmatter) found.push(fromFrontmatter);

	const item = magicItemFrom(note) ?? equipmentItemFrom(note);
	if (item) found.push(item);

	const spell = spellFrom(note);
	if (spell) found.push(spell);

	return found;
}

/** A whole-note spell, using the same structured parser as content-package imports. */
function spellFrom(note: Note): Sendable | null {
	if (cliNoteType(note.frontmatter) !== 'spell') return null;

	const key = noteName(note.path);
	const parsed = parseSpell(note.content, note.frontmatter, key, key);
	if (!parsed) return null;
	const { key: sourceKey, ...spell } = parsed;
	return {
		kind: 'spell',
		path: note.path,
		label: spell.name,
		source: {
			item: {
				...spell,
				sourceKey,
				imagePath: readImagePath(note.content),
			},
		},
	};
}

/**
 * The magic item a note is, if it is one.
 *
 * Whole-note rather than per-block: an item has no fence, it *is* the note. And
 * unlike the other four compendium types, a magic item is a library row rather
 * than content-package material, so it travels this route - the same one creatures
 * take - and shows up in the same preview.
 */
function magicItemFrom(note: Note): Sendable | null {
	if (cliNoteType(note.frontmatter) !== 'item') return null;

	const key = noteName(note.path);
	const item = parseMagicItem(note.content, note.frontmatter, key, key);

	return item
		? { kind: 'magicItem', path: note.path, label: item.name, source: { item } }
		: null;
}

/**
 * The piece of equipment a note is, when it is an item note but not a magic
 * one - `magicItemFrom`'s `rarity/none` twin. Only tried once `magicItemFrom`
 * has already returned null, so an item note is never counted as both.
 */
function equipmentItemFrom(note: Note): Sendable | null {
	if (cliNoteType(note.frontmatter) !== 'item' || isMagic(note.frontmatter)) return null;

	const key = noteName(note.path);
	const item = parseEquipmentItem(note.content, key, key);
	return { kind: 'equipmentItem', path: note.path, label: item.name, source: { item } };
}

/** One recognised block, or null when this language or shape is not sendable. */
function sendableFromBlock(
	language: string,
	record: Record<string, unknown>,
	note: Note,
): Sendable | null {
	switch (language) {
		case 'statblock': {
			// A bare `monster:` reference is included: it needs the bestiary, and
			// whether that is available is the sender's problem to report per item
			// rather than a reason to hide it from the count.
			if (!hasInlineStats(record) && typeof record.monster !== 'string') return null;
			return {
				kind: 'creature',
				path: note.path,
				label: creatureLabel(record, noteName(note.path)),
				source: record,
			};
		}
		case 'encounter': {
			const payload = mapToEncounterPayload(record);
			return payload
				? { kind: 'encounter', path: note.path, label: payload.name, source: record }
				: null;
		}
		case 'leaflet':
		case 'zoommap': {
			const reference = mapReferenceFrom(record);
			return reference
				? { kind: 'map', path: note.path, label: reference.title, source: record }
				: null;
		}
		default:
			return null;
	}
}

/**
 * The creature a note declares in its frontmatter, when it has no statblock fence.
 *
 * `ttrpg-convert-cli` writes both - a fence holding the real stats, and
 * `statblock: inline` pointing at it - so taking the frontmatter as well would
 * import every one of its 667 creatures twice.
 */
function creatureFromFrontmatter(note: Note, sawStatblockFence: boolean): Sendable | null {
	if (sawStatblockFence || !note.frontmatter || !declaresStatblock(note.frontmatter)) {
		return null;
	}

	const record = note.frontmatter;
	if (!hasInlineStats(record) && typeof record.monster !== 'string') return null;

	return {
		kind: 'creature',
		path: note.path,
		label: creatureLabel(record, noteName(note.path)),
		source: record,
	};
}

/** Counts by kind, for the preview. Kinds with nothing found are omitted. */
export function summarise(sendables: Sendable[]): Record<SendableKind, number> {
	const counts = { creature: 0, encounter: 0, map: 0, magicItem: 0, equipmentItem: 0, spell: 0 };
	for (const sendable of sendables) {
		counts[sendable.kind] += 1;
	}
	return counts;
}
