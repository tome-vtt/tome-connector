/**
 * Turns one chapter file's worth of `ttrpg-convert-cli` markdown into scenes,
 * and a whole adventure folder into a plan.
 *
 * **The room-promotion rule.** A chapter's `##` sections each become a scene,
 * but a numbered room can be buried several headings deeper - `## Area 1` >
 * `### The Approach` > `#### B1: Guard Post`. `extractRooms` pulls every
 * heading whose text passes {@link asRoomHeading} out to its own sibling
 * scene, however deep it sits, and removes that heading's own text from
 * whichever section used to contain it - `parseSections` in
 * `labelledMarkdown.ts` deliberately gives a parent its children's text, so
 * without this cut every room's prose would appear twice: once under the area
 * heading, once under its own.
 *
 * Correct for a published dungeon crawl, and a surprise for someone who just
 * numbered a heading by hand - `ChapterSource.promoteRooms` (read from a
 * chapter note's `tome_room_promotion` frontmatter by `adventureVault.ts`,
 * true unless set to `false`) is the opt-out. `parseChapter` skips
 * `extractRooms` entirely when it is off, so a numbered heading stays exactly
 * where it was written.
 *
 * Entity and image resolution is intentionally shallow here. `tomeName`
 * starts as the link's own display text, which is what the adventure's prose
 * already shows the GM; `adventureVault.ts` overwrites it with the target
 * note's real statblock name (and downgrades an `items/*` link that turns out
 * not to be magic to `skip`) once it has actually read the note - this module
 * never touches the vault, which is what keeps it testable with a fixture.
 *
 * Pure and `obsidian`-free.
 */

import { flattenLinks } from './adventureLinks';
import { splitBlocks } from './adventureBlocks';
import { looksLikeMap } from './adventureImages';
import { pickDefaultCover } from './adventureCover';
import { asRoomHeading } from './roomHeadings';
import { HEADING, preamble, sectionsAtLevel } from '../recognizers/labelledMarkdown';
import type {
	AdventurePlan,
	EntityDestination,
	ImageDestination,
	PlannedBlock,
	PlannedChapter,
	PlannedEntity,
	PlannedImage,
	PlannedScene,
} from './adventurePlan';

export interface ChapterSource {
	title: string;
	content: string;
	/**
	 * Whether a numbered heading (`B1: Guard Post`) should be pulled out into its
	 * own scene. Optional and defaults true - most callers, and every existing
	 * fixture, have no opinion - unless the note's frontmatter sets
	 * `tome_room_promotion: false`; see the doc comment on {@link extractRooms}.
	 */
	promoteRooms?: boolean;
	/**
	 * The chapter's own Tome id, read from `tome_chapter_id` frontmatter by
	 * `adventureVault.ts`. Optional and null by default, the same as
	 * {@link promoteRooms} - a re-import matching hint, not something most
	 * fixtures need an opinion on.
	 */
	id?: string | null;
	/**
	 * The chapter note's own vault path, so `writeAdventureIdsToVault.ts` can
	 * find it again after a send with no second folder walk. Optional for the
	 * same reason `id` is - a fixture with no vault behind it has nothing to
	 * put here.
	 */
	notePath?: string;
}

export interface AdventureSource {
	folder: string;
	title: string;
	summary: string | null;
	chapters: ChapterSource[];
}

/** How long a block's text may run before `adventureBlocks.ts` splits it further. */
const MAX_BLOCK_LENGTH = 8000;

interface RoomBlock {
	title: string;
	body: string;
	id: string | null;
}

/**
 * `## The Village Square %%tome_scene_id: 3fa85f64-...%%` - a hidden Obsidian
 * comment suffix `writeAdventureIdsToVault.ts` appends to a heading line once
 * a scene has a Tome id. Shared with that module, which re-locates the same
 * heading later to update it - see the doc comment there.
 */
const SCENE_ID_MARKER = /[ \t]*%%tome_scene_id:\s*([^%]+?)\s*%%[ \t]*$/;

/** Splits a raw heading capture into its title and its id marker, if it has one. */
export function stripSceneIdMarker(headingText: string): { title: string; id: string | null } {
	const match = SCENE_ID_MARKER.exec(headingText);
	if (!match?.[1]) return { title: headingText.trim(), id: null };
	return { title: headingText.slice(0, match.index).trim(), id: match[1].trim() };
}

/** Drops a trailing `.ext`, so a fallback label built from a filename doesn't carry it. */
function stripExtension(filename: string): string {
	return filename.replace(/\.[^./]+$/, '');
}

/**
 * Pulls every room heading (any level, any depth) out of `sectionBody`,
 * recursing into each room's own body so a room nested inside another room is
 * still promoted rather than staying folded into its parent's scene.
 */
function extractRooms(sectionBody: string): { parentBody: string; rooms: RoomBlock[] } {
	const lines = sectionBody.split(/\r?\n/);
	const parentLines: string[] = [];
	const rooms: RoomBlock[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		const heading = HEADING.exec(line);
		const stripped = heading ? stripSceneIdMarker(heading[2] ?? '') : null;
		const level = heading ? (heading[1] ?? '').length : 0;
		const room = stripped ? asRoomHeading(stripped.title) : null;

		if (heading && stripped && room) {
			const bodyLines: string[] = [];
			index += 1;
			while (index < lines.length) {
				const next = HEADING.exec(lines[index] ?? '');
				if (next && (next[1] ?? '').length <= level) break;
				bodyLines.push(lines[index] ?? '');
				index += 1;
			}
			const nested = extractRooms(bodyLines.join('\n'));
			rooms.push({ title: stripped.title, body: nested.parentBody, id: stripped.id });
			rooms.push(...nested.rooms);
			continue;
		}

		parentLines.push(line);
		index += 1;
	}

	return { parentBody: parentLines.join('\n').trim(), rooms };
}

interface ParseAccumulator {
	entities: Map<string, PlannedEntity>;
	images: Map<string, PlannedImage>;
}

/**
 * `unknown` - a hand author's wikilink - starts `skip` rather than a guess:
 * unlike a CLI path, its target hasn't been read yet, so there is nothing
 * here to suggest from. `adventureVault.ts`'s `resolveEntityNames` reads the
 * target note before the review dialog opens and settles it into a real
 * destination, the same pass that already corrects a CLI entity's name.
 */
function destinationFor(kind: 'bestiary' | 'item' | 'unknown'): EntityDestination {
	if (kind === 'bestiary') return { to: 'NonPlayerCharacter' };
	if (kind === 'item') return { to: 'MagicItem' };
	return { to: 'skip' };
}

function registerEntities(
	found: ReturnType<typeof flattenLinks>['entities'],
	entities: Map<string, PlannedEntity>,
): void {
	for (const ref of found) {
		const existing = entities.get(ref.key);
		if (existing) {
			existing.occurrences += 1;
			continue;
		}
		const destination = destinationFor(ref.kind);
		entities.set(ref.key, {
			key: ref.key,
			label: ref.label,
			tomeName: ref.label,
			occurrences: 1,
			suggested: destination,
			chosen: destination,
			resolvedId: null,
		});
	}
}

/**
 * A `[!npc]`-forced mention: unlike `registerEntities`, this destination is
 * not a guess `resolveEntityNames` might later correct - it is what the
 * author wrote, so it starts and stays `NonPlayerCharacter`.
 */
function registerForcedEntity(key: string, label: string, entities: Map<string, PlannedEntity>): void {
	const existing = entities.get(key);
	if (existing) {
		existing.occurrences += 1;
		return;
	}
	const destination: EntityDestination = { to: 'NonPlayerCharacter' };
	entities.set(key, { key, label, tomeName: label, occurrences: 1, suggested: destination, chosen: destination, resolvedId: null });
}

function registerImage(
	key: string,
	label: string,
	dmPath: string,
	playerPath: string | null,
	suggested: ImageDestination,
	images: Map<string, PlannedImage>,
): void {
	if (images.has(key)) return;
	images.set(key, { key, label, dmPath, playerPath, suggested, chosen: suggested, resolvedId: null });
}

/**
 * One scene's blocks, with pictures and creatures standing in the flow as
 * their own nodes rather than only as words inside a paragraph.
 *
 * A picture becomes a node where it sat. A creature becomes one directly
 * after the paragraph that first names it, so the statblock is next to the
 * text that calls for it - and only on that first mention, or a creature
 * named five times in one scene would arrive five times over.
 */
function makeScene(title: string, body: string, id: string | null, acc: ParseAccumulator): PlannedScene {
	const blocks: PlannedBlock[] = [];
	const alreadyNoded = new Set<string>();

	for (const raw of splitBlocks(body, MAX_BLOCK_LENGTH)) {
		if (raw.type === 'image') {
			// A picture captioned or named "map" is a battle map; everything else
			// is scene art, which is a prop. Both are nodes either way.
			const suggested: ImageDestination = { to: looksLikeMap(raw.alt, raw.dmPath) ? 'Map' : 'Prop' };
			const filename = raw.dmPath.split('/').pop() ?? raw.dmPath;
			const label = raw.alt || stripExtension(filename);
			registerImage(raw.dmPath, label, raw.dmPath, raw.playerPath, suggested, acc.images);
			blocks.push({ kind: 'Entity', key: raw.dmPath, from: 'image', note: raw.alt || null, audience: 'Gm' });
			continue;
		}

		if (raw.type === 'forced-entity') {
			if (raw.to === 'NonPlayerCharacter') {
				registerForcedEntity(raw.key, raw.label, acc.entities);
				blocks.push({ kind: 'Entity', key: raw.key, from: 'entity', note: null, audience: 'Gm' });
			} else {
				const suggested: ImageDestination = { to: raw.to };
				registerImage(raw.key, raw.label, raw.key, null, suggested, acc.images);
				blocks.push({ kind: 'Entity', key: raw.key, from: 'image', note: null, audience: 'Gm' });
			}
			continue;
		}

		const flattened = flattenLinks(raw.text);
		registerEntities(flattened.entities, acc.entities);
		blocks.push({
			kind: raw.kind,
			audience: raw.audience,
			text: flattened.text,
			refs: flattened.refs,
			imageRefs: flattened.imageRefs,
		});

		for (const mention of flattened.entities) {
			if (alreadyNoded.has(mention.key)) continue;
			alreadyNoded.add(mention.key);
			blocks.push({ kind: 'Entity', key: mention.key, from: 'entity', note: null, audience: 'Gm' });
		}
	}

	return { title, blocks, id };
}

function parseChapter(source: ChapterSource, acc: ParseAccumulator): PlannedChapter {
	const scenes: PlannedScene[] = [];
	const lead = preamble(source.content);
	const sections = sectionsAtLevel(source.content, 2);

	// 41 chapter files have no `##` at all - the whole chapter is one scene. It has no
	// heading of its own to carry a marker, so it is always matched by title - see the
	// residual limit noted in the authoring doc.
	if (lead !== '' || sections.length === 0) {
		scenes.push(makeScene(source.title, lead, null, acc));
	}

	for (const section of sections) {
		const { title, id } = stripSceneIdMarker(section.title);
		const { parentBody, rooms } = source.promoteRooms !== false
			? extractRooms(section.body)
			: { parentBody: section.body, rooms: [] };
		scenes.push(makeScene(title, parentBody, id, acc));
		for (const room of rooms) scenes.push(makeScene(room.title, room.body, room.id, acc));
	}

	return {
		title: source.title,
		scenes,
		id: source.id ?? null,
		notePath: source.notePath ?? null,
		promoteRooms: source.promoteRooms !== false,
	};
}

/**
 * The line number of each scene's own heading, in the same order
 * {@link parseChapter} emits scenes for this same `content` and
 * `promoteRooms` flag - null for the preamble scene, which has no heading to
 * point at. `writeAdventureIdsToVault.ts` uses this to find where to write a
 * scene's id back into the note.
 *
 * A flat, single top-to-bottom scan rather than a second walk through
 * {@link extractRooms}'s own recursion: a room and everything nested inside
 * it are physically written in document order in the source file - a child
 * heading always sits on a later line than its parent - so `extractRooms`'s
 * depth-first "this room, then its own nested rooms" emission order and a
 * flat line-number scan produce the same sequence. That equivalence is what
 * keeps this independent of `extractRooms`'s own bookkeeping, which returns
 * body text rather than positions and has nothing to offer this comparison.
 */
export function sceneHeadingLines(content: string, promoteRooms: boolean): (number | null)[] {
	const lines = content.split(/\r?\n/);
	const lead = preamble(content);
	const sections = sectionsAtLevel(content, 2);
	const result: (number | null)[] = [];

	if (lead !== '' || sections.length === 0) {
		result.push(null);
	}

	for (let index = 0; index < lines.length; index++) {
		const heading = HEADING.exec(lines[index] ?? '');
		if (!heading) continue;
		const level = (heading[1] ?? '').length;
		const { title } = stripSceneIdMarker(heading[2] ?? '');

		if (level === 2) {
			result.push(index);
		} else if (promoteRooms && level > 2 && asRoomHeading(title)) {
			result.push(index);
		}
	}

	return result;
}

/**
 * Replaces any `%%tome_scene_id: ...%%` marker already on a heading line with
 * a fresh one, rather than appending a second. `writeAdventureIdsToVault.ts`
 * is the only caller, but it lives here rather than there so it can be
 * tested directly: that module's own top-level `import ... from 'obsidian'`
 * makes it unloadable under vitest, which has no double for that package.
 */
export function withSceneIdMarker(headingLine: string, id: string): string {
	const match = /^(#{1,6}[ \t]+)(.+?)[ \t]*$/.exec(headingLine);
	if (!match?.[1]) return headingLine;

	const { title } = stripSceneIdMarker(match[2] ?? '');
	return `${match[1]}${title} %%tome_scene_id: ${id}%%`;
}

export function parseAdventure(source: AdventureSource): AdventurePlan {
	const acc: ParseAccumulator = { entities: new Map(), images: new Map() };
	const chapters = source.chapters.map((chapter) => parseChapter(chapter, acc));
	const images = [...acc.images.values()];

	return {
		folder: source.folder,
		title: source.title,
		summary: source.summary,
		chapters,
		entities: [...acc.entities.values()],
		images,
		coverKey: pickDefaultCover(images),
	};
}
