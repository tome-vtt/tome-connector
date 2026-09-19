/**
 * Turns a `ttrpg-convert-cli` item note into a magic item.
 *
 * **A library row, not package content.** The other five compendium parsers build
 * a `ContentSource` the character builder draws on; a magic item goes to the
 * campaign's own magic-item library, one `POST /api/MagicItems` apiece, upserted
 * on name. That is where Tome already keeps them, and it is why this parser sits
 * beside the others but its output travels the route creatures do.
 *
 * **Magic only.** Two thirds of a full library's item notes are magic and the rest
 * is rope and rations, which the magic-item library is not for. The `rarity/none`
 * tag draws that line and the CLI puts it on all but one of 2,099 notes, so it is
 * a stated fact rather than a guess about what an item is.
 *
 * Pure and `obsidian`-free.
 */

import { parseSections, preamble } from '../labelledMarkdown';
import { stripMarkdownFromString } from '../../tomeMarkdownSanitizer';

/** Mirrors the server's `MagicItemInputDto`, minus the fields a note cannot fill. */
export interface MagicItem {
	name: string;
	desc: string | null;
	rarity: string | null;
	category: string | null;
	requiresAttunement: boolean;
	attunementDetail: string | null;
	/** The note's filename stem, so a re-import is recognisable as one. */
	sourceKey: string;
	/**
	 * Vault-relative path of the item's art, or null when the note has none.
	 *
	 * A *path*, not the bytes: this module is pure, and reading a file needs the
	 * vault. The send module swaps it for a `data:` URI on the way out.
	 */
	imagePath: string | null;
}

const RARITY_TAG = /^ttrpg-cli\/item\/rarity\/(.+)$/;

/**
 * The subtitle: `*Wondrous item, uncommon (requires attunement by a Druid)*` for
 * a magic item, `*Adventuring gear*` or `*Artisan's tools*` for mundane gear.
 * Exported because `equipmentItem.ts` reads the same line - the shape is not
 * magic-specific, only what a caller does with it is.
 */
export const SUBTITLE = /^\s*\*([^*]+)\*\s*$/m;

/** Frontmatter values arrive as a list, a bare string, or missing. */
function tagsOf(frontmatter: Record<string, unknown> | null): string[] {
	const raw = frontmatter?.['tags'];
	if (typeof raw === 'string') return [raw];
	if (Array.isArray(raw)) return raw.filter((tag): tag is string => typeof tag === 'string');
	return [];
}

/**
 * `uncommon`, `very-rare`, or null for a note with no rarity tag at all.
 *
 * `none` comes back as `none` rather than null: "this item has no rarity" and
 * "this note does not say" are different answers, and {@link isMagic} needs to
 * tell them apart.
 */
export function readRarity(frontmatter: Record<string, unknown> | null): string | null {
	for (const tag of tagsOf(frontmatter)) {
		const match = RARITY_TAG.exec(tag);
		if (match?.[1]) return match[1];
	}
	return null;
}

/**
 * Whether this is a magic item rather than adventuring gear.
 *
 * A rarity of `none` is the CLI's way of saying "mundane", and it says it on 620
 * of a full library's 2,099 items. `unknown` and `varies` are magic items whose
 * rarity the book does not fix, so they count.
 *
 * A note with no rarity tag is *not* treated as magic. Only one note in the
 * reference corpus is missing the tag, and guessing would put a rope in the magic
 * item library.
 */
export function isMagic(frontmatter: Record<string, unknown> | null): boolean {
	const rarity = readRarity(frontmatter);
	return rarity !== null && rarity !== 'none';
}

/** `very-rare` -> `very rare`, as the books print it and the library displays it. */
function displayRarity(rarity: string): string {
	return rarity.replace(/-/g, ' ');
}

export interface Attunement {
	requiresAttunement: boolean;
	attunementDetail: string | null;
}

/**
 * `(requires attunement by a Druid)` out of the subtitle.
 *
 * The detail is the condition alone - "by a Druid" - because the flag already
 * carries "requires attunement" and the library prints the two together.
 *
 * **The condition can itself contain brackets**, and stopping at the first `)`
 * truncates it mid-sentence: the Black Crystal Tablet requires attunement "by a
 * creature that has proficiency in the [Arcana](…) skill", and a lazy match ended
 * inside that link, keeping half a URL and losing the word "skill". So the closing
 * bracket is found by counting, and the result is flattened like every other
 * scraped string.
 */
export function readAttunement(subtitle: string): Attunement {
	const start = /\(requires attunement/i.exec(subtitle);
	if (!start) return { requiresAttunement: false, attunementDetail: null };

	let depth = 0;
	let end = subtitle.length;
	for (let index = start.index; index < subtitle.length; index += 1) {
		const character = subtitle[index];
		if (character === '(') depth += 1;
		else if (character === ')') {
			depth -= 1;
			if (depth === 0) {
				end = index;
				break;
			}
		}
	}

	const detail = stripMarkdownFromString(
		subtitle.slice(start.index + start[0].length, end),
	).trim();

	return { requiresAttunement: true, attunementDetail: detail === '' ? null : detail };
}

/**
 * The category, which is the subtitle up to the first comma.
 *
 * Taken from the subtitle rather than a tag because the CLI has no category tag -
 * the `item/gear/` and `item/weapon/` ones are sparse and disagree with the
 * printed line. Links are flattened, so `Armor ([shield](...))` reads as
 * `Armor (shield)`.
 *
 * Null when the subtitle is only a rarity, which happens on the items whose line
 * reads `*Rare (requires attunement)*` with no category at all.
 */
export function readCategory(subtitle: string, rarity: string | null): string | null {
	const first = stripMarkdownFromString(subtitle.split(',')[0] ?? '').trim();
	const withoutAttunement = first.replace(/\s*\(requires attunement[^)]*\)\s*$/i, '').trim();
	if (withoutAttunement === '') return null;

	// `*Rare (requires attunement)*` - the whole subtitle is the rarity, so there is
	// no category in it to read.
	const bare = withoutAttunement.toLowerCase();
	if (rarity !== null && bare === displayRarity(rarity)) return null;

	return withoutAttunement;
}

/**
 * What the item does: the prose, without the fields, the portrait or the footers.
 *
 * A mundane item has none - an abacus is a name, a cost and a weight - but a magic
 * item's rules are the reason it is in the library at all.
 */
export function readDescription(markdown: string): string | null {
	const sections = parseSections(markdown);
	const body = sections.length > 0 ? preamble(markdown) : markdown;

	const lines = body
		.split(/\r?\n/)
		.filter((line) => !/^[ \t]*(?:[-*+][ \t]+)?\*\*/.test(line))
		.filter((line) => !/^\s*\*Source:/.test(line))
		.filter((line) => !/^\s*!\[/.test(line))
		// The subtitle, which is the category and rarity read separately above.
		.filter((line) => !SUBTITLE.test(line));

	const text = stripMarkdownFromString(lines.join('\n'))
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return text === '' ? null : text;
}

/**
 * The item's art, from the embed the CLI puts under the subtitle.
 *
 * Written `![](3-Mechanics/CLI/items/img/bag-of-holding.webp#right)`, where the
 * `#right` is Obsidian's own alignment hint rather than part of the filename - and
 * a path that keeps it does not resolve. Wikilink form is read too, since a
 * hand-written note is as likely to use it.
 */
export function readImagePath(markdown: string): string | null {
	const embed =
		/^\s*!\[[^\]]*\]\(([^)]+)\)/m.exec(markdown) ?? /^\s*!\[\[([^\]|]+)/m.exec(markdown);
	const path = embed?.[1]?.split('#')[0]?.trim();

	return path ? decodeURIComponent(path) : null;
}

/**
 * Reads a magic item, or null when the note is gear rather than treasure.
 *
 * @param key The stable handle, normally the note's filename stem.
 */
export function parseMagicItem(
	markdown: string,
	frontmatter: Record<string, unknown> | null,
	key: string,
	fallbackName: string,
): MagicItem | null {
	if (!isMagic(frontmatter)) return null;

	const title = parseSections(markdown).find((section) => section.level === 1)?.title;
	const subtitle = SUBTITLE.exec(preamble(markdown))?.[1] ?? '';
	const rarity = readRarity(frontmatter);

	return {
		name: title?.trim() || fallbackName,
		desc: readDescription(markdown),
		rarity: rarity === null ? null : displayRarity(rarity),
		category: readCategory(subtitle, rarity),
		...readAttunement(subtitle),
		sourceKey: key,
		imagePath: readImagePath(preamble(markdown)),
	};
}
