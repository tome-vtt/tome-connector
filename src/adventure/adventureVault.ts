import { App, TFile, TFolder, parseYaml } from 'obsidian';

import { fallbackChapterTitle, orderByFilenamePrefix, parseAdventureIndex } from './adventureIndex';
import { findWikiLinks } from './adventureLinks';
import { parseAdventure } from './adventureParser';
import type { AdventureSource, ChapterSource } from './adventureParser';
import type { AdventurePlan, EntityDestination, PlannedEntity } from './adventurePlan';
import { parseEquipmentItem } from '../recognizers/compendium/equipmentItem';
import { parseMagicItem } from '../recognizers/compendium/magicItem';
import { findFencedBlock } from '../recognizers/markdownBlocks';
import { findSendables } from '../recognizers/noteScan';
import { normalizeName } from '../recognizers/statblockCreature';
import { vaultNotes } from '../vaultNotes';

/**
 * The one module in `src/adventure/` that touches the vault.
 *
 * Everything else in this folder is pure so it can be unit-tested against a
 * fixture; this is where that pure parse gets its input and, afterward, its
 * corrections. `adventureParser.ts` cannot read a linked note itself - that
 * is what keeps it testable - so a bestiary/item link's `tomeName` starts as
 * its own display text and {@link resolveEntityNames} overwrites it once the
 * target note has actually been read, in the same pass that routes an
 * `items/*` link to the magic-item or equipment library depending on what
 * the note's `rarity` tag says.
 */

/**
 * Reads the folder's index note - whichever note parses as one, rather than
 * assuming a filename - and every chapter it names, in the order it names
 * them.
 *
 * **A folder with no index note falls back to filename order.** The index
 * note is a `ttrpg-convert-cli` convention with no reason to be discoverable
 * by someone writing an adventure by hand, so a folder with none is not an
 * error: chapters are ordered by {@link orderByFilenamePrefix} instead, and
 * the folder's own name becomes the adventure's title. See
 * `adventureIndex.ts` for why filename order needs a number at all.
 */
export async function readAdventureSource(app: App, folder: TFolder): Promise<AdventureSource> {
	const notes = folder.children.filter(
		(child): child is TFile => child instanceof TFile && child.extension === 'md',
	);
	if (notes.length === 0) {
		throw new Error(`No markdown notes were found in "${folder.name}".`);
	}

	let title: string | null = null;
	let entries: { title: string; file: string }[] = [];
	for (const note of notes) {
		const parsed = parseAdventureIndex(await app.vault.cachedRead(note));
		if (parsed) {
			title = parsed.title;
			entries = parsed.entries;
			break;
		}
	}

	const chapters: ChapterSource[] = [];

	if (title !== null) {
		for (const entry of entries) {
			const file = notes.find((note) => note.name === entry.file);
			if (!file) {
				console.warn(`Tome Connector: chapter "${entry.file}" named in the index was not found in the folder.`);
				continue;
			}
			const content = await app.vault.cachedRead(file);
			chapters.push({
				title: entry.title,
				content: rewriteWikiLinks(app, content, file.path),
				promoteRooms: promoteRoomsFor(app, file),
				id: chapterIdFor(app, file),
				notePath: file.path,
			});
		}
		return { folder: folder.path, title, summary: null, chapters };
	}

	for (const filename of orderByFilenamePrefix(notes.map((note) => note.name))) {
		const file = notes.find((note) => note.name === filename);
		if (!file) continue;
		const content = await app.vault.cachedRead(file);
		chapters.push({
			title: fallbackChapterTitle(filename, content),
			content: rewriteWikiLinks(app, content, file.path),
			promoteRooms: promoteRoomsFor(app, file),
			id: chapterIdFor(app, file),
			notePath: file.path,
		});
	}

	return { folder: folder.path, title: folder.name, summary: null, chapters };
}

/**
 * Whether a numbered heading in this chapter note should be promoted to its
 * own scene - true unless the note's frontmatter says `tome_room_promotion:
 * false`. Default true is what keeps every CLI-imported folder, which never
 * sets this, behaving exactly as it did before the switch existed.
 */
function promoteRoomsFor(app: App, file: TFile): boolean {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	return frontmatter?.['tome_room_promotion'] !== false;
}

/**
 * The chapter's own Tome id, from `tome_chapter_id` frontmatter -
 * `writeAdventureIdsToVault.ts` writes this back after a successful import,
 * the same property name `tome_id` sets on a player character in
 * `syncPlayerCharacterToTome.ts`, prefixed here since a chapter's id and a
 * scene's live in different places on the note (frontmatter versus a heading
 * marker) and are worth telling apart at a glance.
 */
function chapterIdFor(app: App, file: TFile): string | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const id: unknown = frontmatter?.['tome_chapter_id'];
	return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/**
 * Turns every plain wikilink in `content` into `[[real/vault/path.md|display]]`
 * - still wikilink syntax, so `adventureLinks.ts` can go on telling a hand
 * author's mention apart from a CLI markdown link by nothing but its shape,
 * but with the target resolved to a real path so `adventureParser.ts` never
 * has to. `sourcePath` is the chapter note's own path, which is what lets
 * Obsidian's link resolution break a name collision the way the author's own
 * vault would.
 *
 * A link that resolves to nothing is left exactly as written. It still gets
 * tokenized as a wikilink downstream and still becomes a candidate - `skip`,
 * once nothing is found at that target - the same outcome a hand author
 * would want from a link they wrote to a note that does not exist.
 */
function rewriteWikiLinks(app: App, content: string, sourcePath: string): string {
	const mentions = findWikiLinks(content);
	if (mentions.length === 0) return content;

	let result = '';
	let cursor = 0;
	for (const mention of mentions) {
		result += content.slice(cursor, mention.start);
		const dest = app.metadataCache.getFirstLinkpathDest(mention.target, sourcePath);
		result += dest ? `[[${dest.path}|${mention.display}]]` : content.slice(mention.start, mention.end);
		cursor = mention.end;
	}
	result += content.slice(cursor);
	return result;
}

/** The statblock fence's own `name`, normalised the same way a sent creature's is. */
async function resolveBestiaryName(app: App, file: TFile): Promise<string | null> {
	const block = findFencedBlock(await app.vault.cachedRead(file), 'statblock');
	if (!block) return null;

	let record: unknown;
	try {
		record = parseYaml(block.source);
	} catch {
		return null;
	}
	if (typeof record !== 'object' || record === null) return null;

	const name = (record as Record<string, unknown>).name;
	const normalized = typeof name === 'string' ? normalizeName(name) : null;
	return typeof normalized === 'string' && normalized !== '' ? normalized : null;
}

/**
 * The item's real name and where it belongs: the magic-item library when the
 * note's `rarity` tag says so, the equipment library otherwise. `skip` is no
 * longer the default for a non-magic item - `parseEquipmentItem` has nothing
 * to refuse, so it is only reachable if the note is not a real item note at
 * all (the plan-time link classifier already filtered for `items/*`, so this
 * is the true edge case, not the common one).
 */
async function resolveItem(
	app: App,
	file: TFile,
	key: string,
	fallback: string,
): Promise<{ name: string; destination: EntityDestination }> {
	const { content, frontmatter } = await vaultNotes(app).read(file.path);

	const magic = parseMagicItem(content, frontmatter, key, fallback);
	if (magic) return { name: magic.name, destination: { to: 'MagicItem' } };

	const equipment = parseEquipmentItem(content, key, fallback);
	return { name: equipment.name, destination: { to: 'EquipmentItem' } };
}

/**
 * What a hand-authored wikilink's own target note turns out to be, by the
 * same recognisers `noteScan.ts` uses to decide what a "Send to Tome" button
 * sends - a statblock fence or frontmatter, a `rarity` tag, an equipment
 * shape. Null when nothing in the note is recognisable, which leaves the
 * entity `skip` exactly as it started: a dead-feeling link stays dead rather
 * than guessed at.
 */
async function resolveUnknownEntity(app: App, file: TFile, entity: PlannedEntity): Promise<PlannedEntity> {
	const sendables = findSendables(await vaultNotes(app).read(file.path), parseYaml);

	if (sendables.some((sendable) => sendable.kind === 'creature')) {
		const name = await resolveBestiaryName(app, file);
		const destination: EntityDestination = { to: 'NonPlayerCharacter' };
		return { ...entity, tomeName: name ?? entity.label, suggested: destination, chosen: destination };
	}

	if (sendables.some((sendable) => sendable.kind === 'magicItem' || sendable.kind === 'equipmentItem')) {
		const { name, destination } = await resolveItem(app, file, entity.key, entity.label);
		return { ...entity, tomeName: name, suggested: destination, chosen: destination };
	}

	return entity;
}

async function resolveEntity(app: App, entity: PlannedEntity): Promise<PlannedEntity> {
	const file = app.vault.getAbstractFileByPath(entity.key);
	if (!(file instanceof TFile)) return entity;

	if (entity.suggested.to === 'NonPlayerCharacter') {
		const name = await resolveBestiaryName(app, file);
		return name ? { ...entity, tomeName: name } : entity;
	}

	if (entity.suggested.to === 'skip') {
		return resolveUnknownEntity(app, file, entity);
	}

	const { name, destination } = await resolveItem(app, file, entity.key, entity.label);
	return { ...entity, tomeName: name, suggested: destination, chosen: destination };
}

/**
 * Corrects every entity's `tomeName`, and routes each `items/*` link to the
 * magic-item or equipment library. Called once, before the review dialog
 * opens - `chosen` still equals `suggested` on every row at this point, so
 * overwriting both together cannot clobber a choice nobody has made yet.
 */
export async function resolveEntityNames(
	app: App,
	plan: AdventurePlan,
	onProgress?: (done: number, total: number) => void,
): Promise<AdventurePlan> {
	const entities: PlannedEntity[] = [];
	for (const [index, entity] of plan.entities.entries()) {
		entities.push(await resolveEntity(app, entity));
		onProgress?.(index + 1, plan.entities.length);
	}
	return { ...plan, entities };
}

/** Reads the folder, parses it, and resolves every entity name. Ready for the review dialog. */
export async function buildAdventurePlan(
	app: App,
	folder: TFolder,
	onProgress?: (done: number, total: number) => void,
): Promise<AdventurePlan> {
	const source = await readAdventureSource(app, folder);
	return resolveEntityNames(app, parseAdventure(source), onProgress);
}
