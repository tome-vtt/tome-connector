/**
 * Splits one scene's worth of markdown into `SceneBlock`-shaped pieces.
 *
 * Order matters: anchors have to go before segmentation, or a `> ^140` inside
 * a callout is quoted prose rather than a reference to strip; trailing spaces
 * are safe to strip everywhere because the corpus has zero fenced code blocks,
 * where a trailing double-space is Markdown's hard-line-break marker rather
 * than CLI list-item noise.
 *
 * Pure and `obsidian`-free.
 */

import { findImages, pairGallery, type ImageMention } from './adventureImages';
import { stem } from './adventurePaths';
import { findLinks, findWikiLinks } from './adventureLinks';
import type { BlockAudience, BlockKind } from './adventurePlan';

/** `*Source: Lost Mine of Phandelver, page 12*`, one per chapter, never wanted in a scene. */
export function stripSourceLine(markdown: string): string {
	return markdown
		.split(/\r?\n/)
		.filter((line) => !/^\s*\*Source:.*\*\s*$/.test(line))
		.join('\n');
}

/**
 * Obsidian block-reference anchors, `^140`, standalone or trailing - including
 * the six in the corpus that sit inside a callout as `> ^140` or `> > ^140`,
 * which is what the leading `(quote-marker)*` group is for.
 */
const ANCHOR_LINE = /^(?:[ \t]*>)*[ \t]*\^[a-zA-Z0-9-]+[ \t]*$/;
const TRAILING_ANCHOR = /[ \t]+\^[a-zA-Z0-9-]+[ \t]*$/;

export function stripAnchors(markdown: string): string {
	return markdown
		.split(/\r?\n/)
		.filter((line) => !ANCHOR_LINE.test(line))
		.map((line) => line.replace(TRAILING_ANCHOR, ''))
		.join('\n');
}

export function stripTrailingSpaces(markdown: string): string {
	return markdown.replace(/[ \t]+$/gm, '');
}

/**
 * `%% %%`, the Obsidian comment stub the CLI leaves at column 0 right after a
 * flowchart callout's last `>` line - which is exactly what ends the callout,
 * leaving this as a one-line prose run with nothing worth keeping in it.
 */
export function stripCommentStubs(text: string): string {
	return text
		.split(/\r?\n/)
		.filter((line) => line.trim() !== '%% %%')
		.join('\n');
}

export interface ProseSegment {
	kind: 'prose';
	lines: string[];
}

export interface CalloutSegment {
	kind: 'callout';
	/** Every line of the callout, quote markers and the `[!type]` marker line included. */
	lines: string[];
	calloutType: string;
	calloutTitle: string;
}

export type Segment = ProseSegment | CalloutSegment;

const CALLOUT_START = /^>\s*\[!([\w-]+)\]\s*(.*)$/;

/** Splits into alternating runs of plain prose and whole callouts, in document order. */
export function segment(markdown: string): Segment[] {
	const lines = markdown.split(/\r?\n/);
	const segments: Segment[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		const start = CALLOUT_START.exec(line);

		if (start) {
			const calloutLines = [line];
			index += 1;
			while (index < lines.length && /^>/.test(lines[index] ?? '')) {
				calloutLines.push(lines[index] ?? '');
				index += 1;
			}
			segments.push({
				kind: 'callout',
				lines: calloutLines,
				calloutType: (start[1] ?? '').toLowerCase(),
				calloutTitle: (start[2] ?? '').trim(),
			});
			continue;
		}

		const proseLines: string[] = [];
		while (index < lines.length && !CALLOUT_START.test(lines[index] ?? '')) {
			proseLines.push(lines[index] ?? '');
			index += 1;
		}
		segments.push({ kind: 'prose', lines: proseLines });
	}

	return segments;
}

/** Strips exactly one level of `> ` per line, leaving any nested blockquote intact. */
export function unquote(lines: string[]): string {
	return lines.map((line) => line.replace(/^>[ \t]?/, '')).join('\n');
}

/** What `forcedEntityBlock` sends a sole reference to, when a `forced-entity` callout matches one. */
export type ForcedEntityKind = 'NonPlayerCharacter' | 'Map' | 'Prop';

export type CalloutRoute =
	| { route: 'block'; kind: BlockKind; audience: BlockAudience }
	| { route: 'gallery' }
	| { route: 'forced-entity'; to: ForcedEntityKind };

/**
 * `readaloud` is boxed text read to the table; `gallery` has no text of its
 * own, only images, handled by `adventureImages.ts` instead. `npc`/`map`/
 * `prop` force a sole link or embed's destination rather than leaving it to
 * `adventureVault.ts`'s content-sniffing - the escape hatch for when the
 * guess is wrong, or the target note is not written yet. None of the three
 * is a type the CLI ever emits, so this never touches the corpus. Everything
 * else - `note`, `quote`, `flowchart`, every `embed-*`, and whatever the CLI
 * adds next - is a GM note: the cost of guessing wrong the other way is
 * reading a secret out loud.
 */
export function classifyCallout(calloutType: string): CalloutRoute {
	if (calloutType === 'gallery') return { route: 'gallery' };
	if (calloutType === 'readaloud') return { route: 'block', kind: 'ReadAloud', audience: 'Players' };
	if (calloutType === 'npc') return { route: 'forced-entity', to: 'NonPlayerCharacter' };
	if (calloutType === 'map') return { route: 'forced-entity', to: 'Map' };
	if (calloutType === 'prop') return { route: 'forced-entity', to: 'Prop' };
	return { route: 'block', kind: 'GmNote', audience: 'Gm' };
}

/** The callout's body, title marker line dropped, kept title prepended as a heading. */
function calloutBody(callout: CalloutSegment): string {
	const body = unquote(callout.lines.slice(1));
	return callout.calloutTitle ? `**${callout.calloutTitle}**\n\n${body}` : body;
}

/**
 * Splits `text` at the last blank line before `max`, then the last newline,
 * then hard-cuts - never mid-word unless there is truly nowhere else to cut.
 */
export function chunk(text: string, max: number): string[] {
	if (text.length <= max) return [text];

	const parts: string[] = [];
	let remaining = text;
	while (remaining.length > max) {
		let cut = remaining.lastIndexOf('\n\n', max);
		if (cut <= 0) cut = remaining.lastIndexOf('\n', max);
		if (cut <= 0) cut = max;
		parts.push(remaining.slice(0, cut).trimEnd());
		remaining = remaining.slice(cut).trimStart();
	}
	if (remaining.length > 0) parts.push(remaining);

	return parts;
}

export interface RawTextBlock {
	type: 'text';
	kind: BlockKind;
	audience: BlockAudience;
	text: string;
}

/** A picture that stood alone, so it becomes a node rather than a line of prose. */
export interface RawImageBlock {
	type: 'image';
	dmPath: string;
	playerPath: string | null;
	alt: string;
}

/**
 * A sole reference inside a `[!npc]`/`[!map]`/`[!prop]` callout, forced to
 * this destination rather than left for content-sniffing or the `looksLikeMap`
 * heuristic to guess at. `key` is a note path for `NonPlayerCharacter`, an
 * image path for `Map`/`Prop` - `adventureParser.ts`'s `makeScene` is what
 * tells the two apart, by `to`.
 */
export interface RawForcedEntityBlock {
	type: 'forced-entity';
	to: ForcedEntityKind;
	key: string;
	label: string;
}

export type RawBlock = RawTextBlock | RawImageBlock | RawForcedEntityBlock;

/**
 * The image on a line that holds nothing else.
 *
 * **This is the whole promote-or-not rule, and the corpus settles it:** of
 * 4,638 embeds across the 98 adventures, 4,619 stand alone on their line and
 * 19 do not - every one of those inside a table row or a list item, where
 * lifting the picture out into its own block would take the row apart. So a
 * line that is only a picture becomes a node, and a picture wedged into a
 * table cell stays where it is and flattens to its alt text.
 */
function standaloneImage(line: string): ImageMention | null {
	const found = findImages(line);
	const only = found[0];
	if (found.length !== 1 || !only) return null;

	const rest = line.slice(0, only.start) + line.slice(only.end);
	return rest.trim() === '' ? only : null;
}

type Run = { kind: 'text'; lines: string[] } | { kind: 'images'; images: ImageMention[] };

/** Splits a body into alternating runs of prose and consecutive standalone pictures. */
function runs(body: string): Run[] {
	const out: Run[] = [];

	for (const line of body.split(/\r?\n/)) {
		const image = standaloneImage(line);
		const last = out[out.length - 1];

		if (image) {
			if (last?.kind === 'images') last.images.push(image);
			else out.push({ kind: 'images', images: [image] });
			continue;
		}

		if (last?.kind === 'text') last.lines.push(line);
		else out.push({ kind: 'text', lines: [line] });
	}

	return out;
}

/**
 * Turns one run of pictures into image blocks, pairing a DM version with the
 * player version that follows it.
 *
 * Pairing is applied to any run, not only a gallery's: an adventure that
 * puts a map and its player copy on two consecutive lines outside a callout
 * means the same thing by it.
 */
function imageBlocks(images: ImageMention[]): RawImageBlock[] {
	return pairGallery(images).map((pair) => ({
		type: 'image',
		dmPath: pair.dm.path,
		playerPath: pair.player?.path ?? null,
		alt: pair.dm.altText,
	}));
}

function textBlocks(text: string, kind: BlockKind, audience: BlockAudience, max: number): RawTextBlock[] {
	const trimmed = stripCommentStubs(text).trim();
	if (trimmed === '') return [];
	return chunk(trimmed, max).map((piece) => ({ type: 'text', kind, audience, text: piece }));
}

/** True when `text` is `start`-to-`end` of `text` itself - nothing else sits either side. */
function spansWhole(text: string, start: number, end: number): boolean {
	return start === 0 && end === text.length;
}

/**
 * The forced block a `[!npc]`/`[!map]`/`[!prop]` callout resolves to, or null
 * when its body is not *only* a single link/wikilink (`npc`) or a single
 * image embed (`map`/`prop`) - a callout of that type with anything else in
 * it falls back to an ordinary GM note, the same as a stray callout type
 * nothing recognises.
 */
function forcedEntityBlock(callout: CalloutSegment, to: ForcedEntityKind): RawForcedEntityBlock | null {
	const body = unquote(callout.lines.slice(1)).trim();

	if (to === 'NonPlayerCharacter') {
		const wikiLink = findWikiLinks(body)[0];
		if (wikiLink && findWikiLinks(body).length === 1 && spansWhole(body, wikiLink.start, wikiLink.end)) {
			return { type: 'forced-entity', to, key: wikiLink.target, label: wikiLink.display };
		}
		const link = findLinks(body)[0];
		if (link && findLinks(body).length === 1 && spansWhole(body, link.start, link.end)) {
			return { type: 'forced-entity', to, key: link.path, label: link.text || link.path };
		}
		return null;
	}

	const images = findImages(body);
	const image = images[0];
	if (images.length !== 1 || !image || !spansWhole(body, image.start, image.end)) return null;
	const label = image.altText || stem(image.path);
	return { type: 'forced-entity', to, key: image.path, label };
}

/** The whole pipeline: clean, segment, classify, split out pictures, chunk. */
export function splitBlocks(markdown: string, max: number): RawBlock[] {
	const cleaned = stripTrailingSpaces(stripAnchors(stripSourceLine(markdown)));
	const blocks: RawBlock[] = [];

	for (const part of segment(cleaned)) {
		let route = part.kind === 'callout' ? classifyCallout(part.calloutType) : null;

		if (part.kind === 'callout' && route?.route === 'forced-entity') {
			const forced = forcedEntityBlock(part, route.to);
			if (forced) {
				blocks.push(forced);
				continue;
			}
			// Not a bare sole reference - falls back to an ordinary GM note.
			route = { route: 'block', kind: 'GmNote', audience: 'Gm' };
		}

		const isGallery = route?.route === 'gallery';
		const kind: BlockKind = route?.route === 'block' ? route.kind : 'Markdown';
		const audience: BlockAudience = route?.route === 'block' ? route.audience : 'Gm';
		const body = part.kind === 'prose' ? part.lines.join('\n') : calloutBody(part);

		for (const run of runs(body)) {
			if (run.kind === 'images') {
				blocks.push(...imageBlocks(run.images));
				continue;
			}
			// A gallery holds pictures; any stray prose in one is its own caption,
			// which the image block already carries.
			if (!isGallery) blocks.push(...textBlocks(run.lines.join('\n'), kind, audience, max));
		}
	}

	return blocks;
}
