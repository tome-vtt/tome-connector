/**
 * Turns a flattened block's entity refs back into real links, for the ones
 * that resolved.
 *
 * `adventureLinks.ts`'s `flattenLinks` already reduced every mention to plain
 * text with a {@link BlockRef} recorded for the ones worth another look. This
 * is where a resolved one gets its link syntax back - now pointing at Tome
 * rather than the vault - and an unresolved one is simply left as the flat
 * text it already is, which is the whole point of flattening first: a
 * partial run never needs a second pass to know what stayed plain.
 *
 * Pure and `obsidian`-free.
 */

import type { BlockRef, ImageRef } from './adventurePlan';

export interface ResolvedEntityLink {
	/** `NonPlayerCharacter` or `MagicItem` - whatever `chosen.to` ended up as. */
	libraryKind: string;
	id: string;
}

interface Edit {
	start: number;
	end: number;
	replacement: string;
}

/**
 * The block's final text: entity mentions linked, skipped captions removed.
 *
 * **One pass over both, not two.** `refs` and `imageRefs` are both offsets
 * into the same flattened string, so rewriting either one first moves the
 * ground under the other - dropping a caption ahead of a creature mention
 * would leave that mention's recorded offsets pointing at the wrong
 * characters, and the link would be spliced into the middle of a word.
 * Collecting every edit and applying them right-to-left is what keeps each
 * offset valid at the moment it is used.
 *
 * A picture that went up as a map or a prop keeps the alt text naming it;
 * one the user skipped takes it with them, since a caption for a picture
 * nobody sent describes something the reader cannot see.
 */
export function renderBlockText(
	text: string,
	refs: BlockRef[],
	imageRefs: ImageRef[],
	resolved: Map<string, ResolvedEntityLink>,
	skippedImages: ReadonlySet<string>,
): string {
	const edits: Edit[] = [];

	for (const ref of refs) {
		const link = resolved.get(ref.entity);
		if (!link) continue;
		edits.push({
			start: ref.start,
			end: ref.end,
			replacement: `[${ref.text}](tome:${link.libraryKind}/${link.id})`,
		});
	}

	for (const ref of imageRefs) {
		if (!skippedImages.has(ref.image)) continue;
		edits.push({ start: ref.start, end: ref.end, replacement: '' });
	}

	let result = text;
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
	}
	return result;
}
