/**
 * The shapes an adventure import is built out of, from the first parse through
 * the review dialog to the upload.
 *
 * Pure and `obsidian`-free: nothing here reads a file, so a fixture built by
 * hand is enough to exercise every module in `src/adventure/`.
 */

/** What `SceneBlock.Kind` accepts, mirrored - see `TomeVTT.Server/Models/SceneBlock.cs`. */
export type BlockKind = 'Markdown' | 'ReadAloud' | 'GmNote';

/** What `SceneBlock.Audience` accepts, mirrored. */
export type BlockAudience = 'Gm' | 'Players';

/**
 * One creature or magic-item mention inside a block's text, by offset into
 * that block's already-flattened `text`.
 *
 * `entity` is the key into {@link PlannedEntity.key} and into the plan's
 * `entities` list - not a Tome id, since resolving one is the whole point of
 * the send. See `adventureLinks.ts`'s `flattenLinks`, which is what produces
 * these alongside the text they point into.
 */
export interface BlockRef {
	entity: string;
	text: string;
	start: number;
	end: number;
}

/**
 * One picture that was embedded in this block, by offset into the block's
 * flattened `text` - which by then holds the embed's alt text in place of
 * its markup.
 *
 * `image` is the key into {@link PlannedImage.key}. The send keeps that alt
 * text as the picture's caption, or drops it when the row was skipped; an
 * Obsidian embed pointing at a vault path is meaningless to Tome either way,
 * which is why it never survives the parse.
 */
export interface ImageRef {
	image: string;
	text: string;
	start: number;
	end: number;
}

export interface PlannedTextBlock {
	kind: BlockKind;
	text: string;
	audience: BlockAudience;
	refs: BlockRef[];
	imageRefs: ImageRef[];
}

/**
 * A library row standing in the scene as its own node - a map, a prop, a
 * creature - rather than a mention buried in a paragraph.
 *
 * `key` points into {@link AdventurePlan.images} or
 * {@link AdventurePlan.entities}; which one is what `from` says. The id is
 * not here because it does not exist yet at parse time: the upload fills
 * `resolvedId` in, and the send reads it back off the plan when it turns
 * this into an `Entity` block. A node whose row was skipped or never landed
 * is dropped there rather than sent pointing at nothing.
 */
export interface PlannedEntityBlock {
	kind: 'Entity';
	key: string;
	from: 'image' | 'entity';
	/** The picture's caption, kept as the block's note. */
	note: string | null;
	audience: BlockAudience;
}

export type PlannedBlock = PlannedTextBlock | PlannedEntityBlock;

export interface PlannedScene {
	title: string;
	blocks: PlannedBlock[];
	/**
	 * The scene's own Tome id, read off a `%%tome_scene_id: ...%%` suffix on
	 * its heading line if the note already carries one - null on a first
	 * write, or when the heading has no marker at all. Sent as a matching
	 * hint; `writeAdventureIdsToVault.ts` is what writes one back in.
	 */
	id: string | null;
}

export interface PlannedChapter {
	title: string;
	scenes: PlannedScene[];
	/** The chapter's own Tome id, read from `tome_chapter_id` frontmatter - null the same way {@link PlannedScene.id} is. */
	id: string | null;
	/** The chapter note's own vault path, or null for a fixture with no vault behind it. */
	notePath: string | null;
	/**
	 * Whether a numbered heading in this chapter was promoted to its own scene -
	 * see `ChapterSource.promoteRooms`. Carried onto the plan (not just used
	 * during parsing) because `writeAdventureIdsToVault.ts` needs the same flag
	 * to find a scene's heading line again after the fact.
	 */
	promoteRooms: boolean;
}

/** Where a creature, magic item, or piece of equipment mention should land in Tome, or nowhere. */
export type EntityDestination =
	| { to: 'NonPlayerCharacter' }
	| { to: 'MagicItem' }
	| { to: 'EquipmentItem' }
	| { to: 'skip' };

/**
 * Where a picture should land, or nowhere.
 *
 * Map or prop, because those are the two things Tome has: there is no
 * "keep the words and drop the picture" library row to send one to. A
 * picture nobody wants is skipped, and skipping it also takes its caption
 * out of the prose - see `renderBlockText`.
 */
export type ImageDestination = { to: 'Map' } | { to: 'Prop' } | { to: 'skip' };

/**
 * One creature or magic item the adventure mentions, deduped across the whole
 * book on the target note's vault path.
 *
 * `chosen` starts identical to `suggested` and the review dialog mutates it in
 * place - that is what keeps the dialog a pure editor and the uploader a pure
 * reader, with no dialog state class and no event plumbing between them.
 */
export interface PlannedEntity {
	key: string;
	label: string;
	/**
	 * The name to send. Starts as the link's own display text; `adventureVault.ts`
	 * overwrites it with the target note's real statblock name, run through the
	 * same `normalizeName` the rest of the connector sends with, once the note
	 * has actually been read.
	 */
	tomeName: string;
	occurrences: number;
	suggested: EntityDestination;
	chosen: EntityDestination;
	resolvedId: string | null;
}

/** One picture, or one DM/player pair, deduped on the DM image's vault path. */
export interface PlannedImage {
	key: string;
	label: string;
	dmPath: string;
	playerPath: string | null;
	/** An explicit map/prop callout takes precedence over image-size guesses. */
	destinationForced?: boolean;
	suggested: ImageDestination;
	chosen: ImageDestination;
	resolvedId: string | null;
}

export interface AdventurePlan {
	folder: string;
	title: string;
	summary: string | null;
	chapters: PlannedChapter[];
	/** Deduped across the whole book, keyed on the target note's vault path. */
	entities: PlannedEntity[];
	/** Deduped across the whole book, keyed on the image's vault path. */
	images: PlannedImage[];
	/**
	 * The book's own cover, or null for "ships with no cover". A key into
	 * {@link AdventurePlan.images}, not a copy of one - the review dialog
	 * mutates this in place the same way it mutates `chosen` on an image or
	 * entity, and `sendAdventureToTome.ts` resolves it to bytes only once, at
	 * the point of sending.
	 */
	coverKey: string | null;
}

export interface ImportedSceneResultBody {
	id: string;
}

export interface ImportedChapterResultBody {
	id: string;
	scenes: ImportedSceneResultBody[];
}
