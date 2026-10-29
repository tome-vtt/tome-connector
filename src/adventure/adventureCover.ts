import { basename } from './adventurePaths';
import type { PlannedImage } from './adventurePlan';

/**
 * Picks a default cover for a freshly parsed adventure, so the review dialog
 * never opens to an empty "Cover Image" section for a folder that has art.
 *
 * <para>
 * `ttrpg-convert-cli` output does not have a fixed cover convention - most
 * adventures in the corpus carry no such file at all - but some books ship
 * one literally named `cover.webp` or `*-banner*.webp` inside their `img/`
 * folder, embedded near the top of the first chapter. That filename is
 * checked first because it is a stronger signal than anything guessed from
 * document order.
 * </para>
 * <para>
 * Falling back to a random pick rather than always the first image: the
 * first picture in a book is not reliably its best one, and a fixed choice
 * would make every book from a folder full of near-identical floorplans
 * default to whichever happens to sort first. Battle maps are excluded from
 * that random pool where a non-map alternative exists - a dungeon floorplan
 * is a poor book cover next to any piece of scene art - but a cover-named
 * file wins outright even if it happens to also look like a map.
 * </para>
 */
const COVER_FILENAME = /cover|banner/i;

/** The default `coverKey` for a plan whose `images` were just assembled, or null if it has none. */
export function pickDefaultCover(images: readonly PlannedImage[]): string | null {
	if (images.length === 0) return null;

	const byFilename = images.find((image) => COVER_FILENAME.test(basename(image.dmPath)));
	if (byFilename) return byFilename.key;

	// `suggested` already carries `looksLikeMap`'s verdict from adventureParser.ts's
	// registerImage - reused rather than re-derived from `label`, which by then may
	// already have lost the raw alt text to a filename fallback.
	const nonMaps = images.filter((image) => image.suggested.to !== 'Map');
	const pool = nonMaps.length > 0 ? nonMaps : images;
	return pool[Math.floor(Math.random() * pool.length)]!.key;
}
