import { describe, expect, it } from 'vitest';

import {
	readSourceLine,
	SRD_LICENSE,
	suggestedAttribution,
	suggestedLicense,
	summariseSources,
} from '../src/recognizers/compendium/sourceLine';

const srdLine =
	"*Source: Player's Handbook (2024) p. 185. Available in the <span title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*";
const bookLine = '*Source: Ghosts of Saltmarsh, p. 42*';

describe('readSourceLine', () => {
	it('reads an SRD-marked line', () => {
		expect(readSourceLine(`# Soldier\n${srdLine}\n\nProse.`)).toEqual({
			book: "Player's Handbook (2024)",
			year: 2024,
			srd: true,
			text: "Player's Handbook (2024) p. 185. Available in the SRD and the Free Rules (2024)",
		});
	});

	/**
	 * The distinction the whole licence prefill turns on: this text is in a book the
	 * user owns, not in the SRD, so it stays private to their account.
	 */
	it('reads a book-only line as not SRD', () => {
		expect(readSourceLine(bookLine)).toMatchObject({
			book: 'Ghosts of Saltmarsh',
			year: null,
			srd: false,
		});
	});

	/** The `<span title=...>` wrapper is one CLI version's rendering, not the claim. */
	it('strips the HTML before storing the text', () => {
		expect(readSourceLine(srdLine).text).not.toContain('<span');
		expect(readSourceLine(srdLine).text).not.toContain('title=');
	});

	it('reads the line wherever it sits in the note', () => {
		// Feats put it under the title; spells put it at the very bottom.
		expect(readSourceLine(`# Fireball\n\nProse.\n\n${srdLine}`).srd).toBe(true);
	});

	/**
	 * False means "the note does not say it is SRD", not "it is not". That is the
	 * reading that fails safe - treating unmarked content as shareable is the
	 * mistake that matters.
	 */
	it('is not SRD when there is no source line at all', () => {
		expect(readSourceLine('# Homebrew\n\nMy own thing.')).toEqual({
			book: null,
			year: null,
			srd: false,
			text: null,
		});
	});

	it('reads a 2014 book', () => {
		expect(readSourceLine("*Source: Player's Handbook p. 42*")).toMatchObject({
			book: "Player's Handbook",
			year: null,
		});
	});
});

describe('summariseSources', () => {
	const srd = readSourceLine(srdLine);
	const book = readSourceLine(bookLine);

	it('counts both kinds and lists the books once each', () => {
		const summary = summariseSources([srd, srd, book]);

		expect(summary).toMatchObject({
			books: ["Player's Handbook (2024)", 'Ghosts of Saltmarsh'],
			srdCount: 2,
			nonSrdCount: 1,
			allSrd: false,
		});
	});

	/** A package is as shareable as its least shareable note. */
	it('is all-SRD only when every note said so', () => {
		expect(summariseSources([srd, srd]).allSrd).toBe(true);
		expect(summariseSources([srd, book]).allSrd).toBe(false);
	});

	/** Nothing in an empty import said it was shareable, because nothing is in it. */
	it('is not all-SRD when empty', () => {
		expect(summariseSources([]).allSrd).toBe(false);
	});
});

describe('suggestedLicense', () => {
	it('offers CC-BY-4.0 for an all-SRD package', () => {
		expect(suggestedLicense(summariseSources([readSourceLine(srdLine)]))).toBe(SRD_LICENSE);
	});

	/**
	 * A prefilled wrong answer is worse than a blank field: the manifest is what the
	 * importer *claims*, and the server records the claim rather than auditing it.
	 * Book content gets no licence so the user has to say what it is.
	 */
	it('offers nothing when any note is book content', () => {
		const mixed = summariseSources([readSourceLine(srdLine), readSourceLine(bookLine)]);

		expect(suggestedLicense(mixed)).toBeNull();
	});
});

describe('suggestedAttribution', () => {
	/** CC-BY-4.0's term is attribution, so this is the licence condition, not a courtesy. */
	it('names every book the content came from', () => {
		const summary = summariseSources([readSourceLine(srdLine), readSourceLine(bookLine)]);

		expect(suggestedAttribution(summary)).toBe("Player's Handbook (2024); Ghosts of Saltmarsh");
	});

	it('lists the first few books and counts the rest', () => {
		const lines = ['A', 'B', 'C', 'D', 'E'].map((b) => readSourceLine(`*Source: ${b}, p. 1*`));

		expect(suggestedAttribution(summariseSources(lines))).toBe('A; B; C and 2 more');
	});

	it('is null when no note named a book', () => {
		expect(suggestedAttribution(summariseSources([]))).toBeNull();
	});
});
