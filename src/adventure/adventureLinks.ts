/**
 * Reads and flattens the prose links inside an adventure block.
 *
 * **About 45% of links have nowhere to point in Tome.** Only two segments of
 * the CLI's `3-Mechanics/CLI/` tree have a library home - `bestiary/*` and
 * `items/*` - everything else (rules, spells, other adventures, tables,
 * decks, and a dozen smaller categories) is reference material Tome does not
 * model. Those links flatten to plain text unconditionally; the review
 * dialog must never try to list them.
 *
 * Every link is flattened the same way, whether or not it has a home -
 * `flattenLinks` always replaces `[text](path)` with bare `text`. What
 * distinguishes a chip candidate from a dead link is a {@link BlockRef}
 * recorded alongside, so `adventureLinkRewrite.ts` can turn a *resolved* one
 * back into a real link at send time and leave everything else as the flat
 * text it already is.
 *
 * **A wikilink is a separate, always-a-candidate case.** `[[Goblin Boss]]`
 * is how a hand author writes a mention, never how the CLI does - the corpus
 * contains none of them - so `flattenLinks` never runs a wikilink target
 * through `classifyCliPath` at all; it is unconditionally `unknown`,
 * regardless of what the target text looks like. That is what keeps this
 * change from also turning every one of the CLI corpus's own internal,
 * nowhere-to-point cross-references into a spurious candidate: those are
 * ordinary `[text](path)` links with no CLI marker, which still classify
 * `none` exactly as before. `adventureVault.ts` is what resolves a wikilink's
 * target to a vault path in the first place, before this module ever sees it
 * - see {@link findWikiLinks} and the doc comment on `rewriteWikiLinks`
 * there.
 *
 * Pure and `obsidian`-free.
 */

import { MARKDOWN_IMAGE, WIKI_IMAGE } from './adventureImages';
import type { BlockRef, ImageRef } from './adventurePlan';

export type LinkClass = { kind: 'bestiary' } | { kind: 'item' } | { kind: 'unknown' } | { kind: 'none' };

const CLI_MARKER = '3-Mechanics/CLI/';

/** The segment after `3-Mechanics/CLI/` decides; only two have a Tome home. */
export function classifyCliPath(path: string): LinkClass {
	const decoded = decodeURIComponent(path.split('#')[0] ?? '');
	const markerIndex = decoded.indexOf(CLI_MARKER);
	if (markerIndex === -1) return { kind: 'none' };

	const segment = decoded.slice(markerIndex + CLI_MARKER.length).split('/')[0];
	if (segment === 'bestiary') return { kind: 'bestiary' };
	if (segment === 'items') return { kind: 'item' };
	return { kind: 'none' };
}

export interface ProseLink {
	text: string;
	path: string;
	start: number;
	end: number;
}

/**
 * `[text](path)`, never `![text](path)` - the negative lookbehind is what
 * keeps this off the 4,751 image embeds and 113 markdown transclusions in the
 * corpus, without the off-by-one bookkeeping a consumed-character guard would
 * need for two links sitting back to back.
 */
const LINK = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

export function findLinks(markdown: string): ProseLink[] {
	return collect(markdown, LINK, (match) => ({ text: match[1] ?? '', path: match[2] ?? '', ...span(match) }));
}

/**
 * One creature or magic-item mention found while flattening a block's links -
 * or, for `unknown`, a hand author's own wikilink, not yet classified by
 * anything but its syntax. `adventureVault.ts` reads the target note's own
 * content to settle an `unknown` one into a real destination or leave it
 * `skip`; see the module doc comment above.
 */
export interface EntityMention {
	/** Vault path of the linked note, anchor stripped - the dedup key across the book. */
	key: string;
	label: string;
	kind: 'bestiary' | 'item' | 'unknown';
}

export interface FlattenedLinks {
	/** `markdown` with every link's and embed's syntax replaced by its display text. */
	text: string;
	/** Offsets into `text`, one per bestiary/item link found. */
	refs: BlockRef[];
	/** One entry per bestiary/item link found, in document order, duplicates included. */
	entities: EntityMention[];
	/** Offsets into `text`, one per image embed found. */
	imageRefs: ImageRef[];
}

/** One link or embed found in the source, before it is flattened. */
interface Token {
	kind: 'link' | 'wikilink' | 'image';
	text: string;
	target: string;
	start: number;
	end: number;
}

/**
 * `[[Goblin Boss]]`, `[[Goblin Boss|the boss]]`, `[[Goblin Boss#Lair]]` -
 * never `![[...]]`, which `WIKI_IMAGE` already owns. Shared with
 * `adventureVault.ts`'s `rewriteWikiLinks`, which is what turns the target
 * into a real vault path before this module ever tokenizes it - see the
 * module doc comment above.
 */
const WIKI_LINK = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

export interface WikiLinkMention {
	/** The link's own target text, exactly as written - not resolved to a vault path here. */
	target: string;
	/** The alias if the link carries one, the target otherwise. */
	display: string;
	start: number;
	end: number;
}

/** Every plain wikilink in `markdown`, in document order. Pure - resolving `target` needs the vault. */
export function findWikiLinks(markdown: string): WikiLinkMention[] {
	return collect(markdown, WIKI_LINK, (match) => {
		const target = (match[1] ?? '').trim();
		return { target, display: (match[2] ?? '').trim() || target, ...span(match) };
	});
}

function span(match: RegExpMatchArray): { start: number; end: number } {
	const start = match.index ?? 0;
	return { start, end: start + match[0].length };
}

function collect<T>(markdown: string, pattern: RegExp, build: (match: RegExpMatchArray) => T): T[] {
	return [...markdown.matchAll(pattern)].map(build);
}

/** Every link and embed, in document order. The two never overlap: `LINK` excludes `!`-prefixed. */
function tokenize(markdown: string): Token[] {
	return [
		...collect<Token>(markdown, MARKDOWN_IMAGE, (match) => ({
			kind: 'image',
			text: match[1] ?? '',
			target: match[2] ?? '',
			...span(match),
		})),
		...collect<Token>(markdown, WIKI_IMAGE, (match) => ({
			kind: 'image',
			// `![[maps/room.png|Room 1]]` captions as "Room 1"; with no alias there is
			// nothing to caption it with but the filename, which is not prose.
			text: match[3] ?? '',
			target: match[1] ?? '',
			...span(match),
		})),
		...collect<Token>(markdown, WIKI_LINK, (match) => ({
			kind: 'wikilink',
			text: (match[2] ?? '').trim() || (match[1] ?? '').trim(),
			target: match[1] ?? '',
			...span(match),
		})),
		...collect<Token>(markdown, LINK, (match) => ({
			kind: 'link',
			text: match[1] ?? '',
			target: match[2] ?? '',
			...span(match),
		})),
	].sort((a, b) => a.start - b.start);
}

/**
 * Replaces every link with its bare text and records where the bestiary/item
 * ones landed.
 *
 * One pass rather than two: flattening after the fact would have to re-find
 * every link's new offset, and finding refs first would have to account for
 * text shifting underneath them as later links get flattened. Building the
 * output string left to right sidesteps both.
 */
export function flattenLinks(markdown: string): FlattenedLinks {
	const refs: BlockRef[] = [];
	const entities: EntityMention[] = [];
	const imageRefs: ImageRef[] = [];
	let text = '';
	let cursor = 0;

	for (const token of tokenize(markdown)) {
		text += markdown.slice(cursor, token.start);
		const start = text.length;
		text += token.text;
		cursor = token.end;

		const key = decodeURIComponent(token.target.split('#')[0] ?? '').trim();

		if (token.kind === 'image') {
			imageRefs.push({ image: key, text: token.text, start, end: start + token.text.length });
			continue;
		}

		// A wikilink is always a candidate, whatever its target looks like - see the
		// module doc comment for why this is what keeps the CLI corpus's own
		// nowhere-to-point links from becoming candidates too.
		const cls: LinkClass = token.kind === 'wikilink' ? { kind: 'unknown' } : classifyCliPath(token.target);
		if (cls.kind === 'none') continue;

		refs.push({ entity: key, text: token.text, start, end: start + token.text.length });
		entities.push({ key, label: token.text, kind: cls.kind });
	}
	text += markdown.slice(cursor);

	return { text, refs, entities, imageRefs };
}
