/**
 * Reads the `*Source: ...*` line every `ttrpg-convert-cli` note carries.
 *
 * This is the line that decides whether a package can be shared, so it is worth
 * reading properly rather than guessing from the folder. The CLI writes it in one
 * of two shapes:
 *
 * ```text
 * *Source: Player's Handbook (2024) p. 185. Available in the <span
 *   title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*
 * *Source: Ghosts of Saltmarsh, p. 42*
 * ```
 *
 * The difference is not decoration. The first says the text is in the SRD and
 * therefore under CC-BY-4.0; the second is book content, which the person running
 * the import owns a copy of and may keep for themselves, and may not publish.
 *
 * Pure and `obsidian`-free.
 */

/** What a note's source line says about where its text came from. */
export interface NoteSource {
	/** `Player's Handbook (2024)` - the book, without the page number. */
	book: string | null;
	/** The year in the title, when there is one. Distinguishes the 2024 books from the 2014 ones. */
	year: number | null;
	/**
	 * Whether the line says the text is in the SRD.
	 *
	 * False is the safe reading and the default: a note with no source line, or one
	 * this does not understand, is treated as book content.
	 */
	srd: boolean;
	/** The line as printed, tags stripped - what an attribution string is built from. */
	text: string | null;
}

const SOURCE_LINE = /^\s*\*Source:\s*([\s\S]+?)\*\s*$/m;

/**
 * The SRD marker, as the CLI writes it.
 *
 * Matched on the words rather than the `<span title='...'>` wrapper, because the
 * wrapper is a rendering detail of one CLI version and the sentence is what the
 * publisher actually said. Both `Available in the SRD` and `...and the Free Rules`
 * appear; either is enough.
 */
const SRD_MARKER = /available in the[\s\S]*?(?:systems reference document|SRD|free rules)/i;

/** `Player's Handbook (2024) p. 185. Available in...` -> `Player's Handbook (2024)`. */
function readBook(text: string): string | null {
	const book = text
		// Everything from the page number or the availability sentence onwards.
		.replace(/[,.]?\s*p\.\s*\d+[\s\S]*$/i, '')
		.replace(/\.\s*Available in[\s\S]*$/i, '')
		.replace(/[,.]\s*$/, '')
		.trim();

	return book === '' ? null : book;
}

/**
 * Reads the source line, or an all-null result when the note has none.
 *
 * Note the asymmetry: `srd` false does not mean "this is not SRD content", it
 * means "the note does not say it is". That is the reading that fails safe -
 * treating unmarked content as shareable is the mistake that matters, and
 * treating shareable content as private only costs the user a checkbox.
 */
export function readSourceLine(markdown: string): NoteSource {
	const match = SOURCE_LINE.exec(markdown);
	const raw = match?.[1]?.trim();
	if (!raw) return { book: null, year: null, srd: false, text: null };

	// The SRD marker is an HTML span; strip tags before anything is shown or stored.
	const text = raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
	const book = readBook(text);
	const year = /\((\d{4})\)/.exec(book ?? '')?.[1];

	return {
		book,
		year: year ? parseInt(year, 10) : null,
		srd: SRD_MARKER.test(text),
		text,
	};
}

/** What a whole package's worth of notes says about its provenance. */
export interface SourceSummary {
	/** Every distinct book, in the order first seen. */
	books: string[];
	/** How many notes said they are in the SRD. */
	srdCount: number;
	/** How many did not - the ones that keep a package private. */
	nonSrdCount: number;
	/** True when every note is SRD-marked, which is the only case a package may be shared. */
	allSrd: boolean;
}

/**
 * Rolls the source lines of a whole import up into one answer.
 *
 * A package is as shareable as its least shareable note, so `allSrd` is an `and`
 * across everything and an empty import is not shareable - there is nothing in it
 * that said it was.
 */
export function summariseSources(sources: NoteSource[]): SourceSummary {
	const books: string[] = [];
	let srdCount = 0;

	for (const source of sources) {
		if (source.book !== null && !books.includes(source.book)) books.push(source.book);
		if (source.srd) srdCount += 1;
	}

	return {
		books,
		srdCount,
		nonSrdCount: sources.length - srdCount,
		allSrd: sources.length > 0 && srdCount === sources.length,
	};
}

/** The CC-BY-4.0 licence key the server records for SRD-derived content. */
export const SRD_LICENSE = 'CC-BY-4.0';

/**
 * The licence to prefill the import manifest with.
 *
 * Only ever a *suggestion* - the manifest is what the importer claims, and the
 * server records the claim rather than auditing it. Content that is not SRD-marked
 * gets no licence at all rather than a plausible-looking one, so the user has to
 * say what it is before the import will go through. A prefilled wrong answer is
 * worse than a blank field here.
 */
export function suggestedLicense(summary: SourceSummary): string | null {
	return summary.allSrd ? SRD_LICENSE : null;
}

const ATTRIBUTION_BOOKS_SHOWN = 3;

/**
 * The attribution line to prefill, naming the books the content came from.
 *
 * The SRD's CC-BY-4.0 term is attribution, so this is not a courtesy - it is the
 * condition the licence is granted on. A folder drawn from many books lists the
 * first few and counts the rest, so the field stays readable; the user can extend it.
 */
export function suggestedAttribution(summary: SourceSummary): string | null {
	const { books } = summary;
	if (books.length === 0) return null;
	const shown = books.slice(0, ATTRIBUTION_BOOKS_SHOWN).join('; ');
	const more = books.length - ATTRIBUTION_BOOKS_SHOWN;
	return more > 0 ? `${shown} and ${more} more` : shown;
}
