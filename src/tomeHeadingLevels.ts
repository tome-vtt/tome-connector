/**
 * Works out what heading level each of a note's own headings should occupy
 * once the note has been slotted into the compiled document as a chapter.
 *
 * Kept free of any `obsidian` import so the level arithmetic can be unit
 * tested; `tomeExportDocument` applies the result to the rendered DOM.
 */

/** PDF outlines and HTML both stop at six heading levels. */
const MAX_HEADING_LEVEL = 6;

/**
 * Maps a note's heading levels, in document order, onto the levels they take
 * beneath a chapter heading at `chapterLevel`.
 *
 * Naively adding `chapterLevel` to each source level is wrong. Plenty of
 * notes reserve `#` for a title they never write and start at `##`, and a
 * source that skips a level (`##` then `####`) is common too. Either would
 * leave a gap that the outline generator renders as a missing or misplaced
 * node. So each heading's *true depth in the note's own tree* is recovered
 * with a stack first, and that is what gets offset.
 *
 * Levels beyond `MAX_HEADING_LEVEL` are clamped rather than dropped, which flattens
 * the tail of a deeply nested outline instead of losing those entries.
 */
export function planHeadingLevels(
	sourceLevels: readonly number[],
	chapterLevel: number,
): number[] {
	const openLevels: number[] = [];

	return sourceLevels.map((level) => {
		// Close every heading at or above this one; whatever is still open is
		// this heading's ancestry, so its depth is that count plus itself.
		while (
			openLevels.length > 0 &&
			openLevels[openLevels.length - 1]! >= level
		) {
			openLevels.pop();
		}
		openLevels.push(level);
		return Math.min(MAX_HEADING_LEVEL, chapterLevel + openLevels.length);
	});
}
