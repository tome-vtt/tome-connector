import { describe, expect, it } from 'vitest';

import {
	buildImportRequest,
	validateManifest,
	type ImportManifest,
} from '../src/recognizers/compendium/importRequest';
import type { ContentPackage } from '../src/recognizers/compendium/package';

const manifest: ImportManifest = {
	key: 'my-books',
	name: 'My Books',
	version: '1.0.0',
	publisher: 'A Person',
	license: 'own-work',
	attribution: "Player's Handbook (2024)",
};

const contentPackage: ContentPackage = {
	formatVersion: 1,
	documentKey: 'my-books',
	license: 'own-work',
	source: "Player's Handbook (2024)",
	species: [],
	backgrounds: [],
	feats: [],
	spells: [],
	classes: [],
};

function read(body: ArrayBuffer): string {
	return new TextDecoder().decode(body);
}

describe('validateManifest', () => {
	it('accepts a complete manifest', () => {
		expect(validateManifest(manifest)).toEqual([]);
	});

	it.each([
		[{ ...manifest, key: '' }, 'Give the package a key.'],
		[{ ...manifest, name: '  ' }, 'Give the package a name.'],
	])('refuses %o', (input, expected) => {
		expect(validateManifest(input)).toContain(expected);
	});

	it.each([['My Books'], ['-leading'], ['UPPER'], ['has space']])(
		'refuses %s as a key',
		(key) => {
			expect(validateManifest({ ...manifest, key })).toContain(
				'A key may only hold lower-case letters, digits and hyphens.',
			);
		},
	);

	/**
	 * The one field with no sensible default. Content that is not SRD-marked gets
	 * no suggestion, so this is where an import of book content stops until the
	 * person says what it is.
	 */
	it('refuses a package with no licence', () => {
		expect(validateManifest({ ...manifest, license: '' })).toEqual([
			'Say what licence the content is under, or "own-work" if it is yours.',
		]);
	});

	/**
	 * The server would refuse all of this too, but by then a 391-spell package has
	 * crossed the wire - and on a Free account the plan check refuses after the
	 * upload, not before it.
	 */
	it('collects every problem at once rather than stopping at the first', () => {
		expect(validateManifest({})).toHaveLength(3);
	});
});

describe('buildImportRequest', () => {
	const built = buildImportRequest(manifest, contentPackage, 'BOUNDARY');
	const text = read(built.body);

	it('names the boundary in the content type', () => {
		expect(built.contentType).toBe('multipart/form-data; boundary=BOUNDARY');
	});

	/** Field for field with the server's `ContentSourceImportDto`. */
	it.each([
		['key', 'my-books'],
		['name', 'My Books'],
		['version', '1.0.0'],
		['publisher', 'A Person'],
		['license', 'own-work'],
		['attribution', "Player's Handbook (2024)"],
	])('sends %s', (field, value) => {
		expect(text).toContain(`name="${field}"`);
		expect(text).toContain(value);
	});

	/**
	 * Omitted rather than sent empty: the server stores what it is given, and a
	 * blank publisher is a publisher of "" in the registry listing.
	 */
	it('leaves out the fields that were not filled in', () => {
		const sparse = read(
			buildImportRequest(
				{ key: 'k', name: 'N', license: 'own-work' },
				contentPackage,
				'B',
			).body,
		);

		expect(sparse).not.toContain('name="publisher"');
		expect(sparse).not.toContain('name="version"');
		expect(sparse).not.toContain('name="url"');
		expect(sparse).toContain('name="license"');
	});

	it('sends the package as a JSON file part', () => {
		expect(text).toContain('name="file"; filename="my-books.json"');
		expect(text).toContain('Content-Type: application/json');
	});

	it('sends the package itself, parseable', () => {
		const json = /\{"formatVersion[\s\S]*?\}\r\n--BOUNDARY--/.exec(text)?.[0];
		const parsed: unknown = JSON.parse(json?.replace(/\r\n--BOUNDARY--$/, '') ?? '{}');

		expect(parsed).toMatchObject({ formatVersion: 1, documentKey: 'my-books' });
	});

	/** It is a wire format; a 391-spell document gains a third in whitespace nobody reads. */
	it('does not indent the package', () => {
		expect(text).not.toContain('\n  "documentKey"');
	});

	it.each([
		['../etc/passwd', 'etc-passwd.json'],
		['my books', 'my-books.json'],
	])('makes %s a safe filename', (key, expected) => {
		const built = read(buildImportRequest({ ...manifest, key }, contentPackage, 'B').body);

		expect(built).toContain(`filename="${expected}"`);
	});

	it('trims the fields', () => {
		const padded = read(
			buildImportRequest({ ...manifest, name: '  My Books  ' }, contentPackage, 'B').body,
		);

		expect(padded).toContain('\r\n\r\nMy Books\r\n');
	});
});


