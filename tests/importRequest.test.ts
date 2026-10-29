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
	items: [],
};

/** Reads the encoded body back the way a server would. */
function parse(built: { body: ArrayBuffer; contentType: string }): Promise<FormData> {
	return new Response(built.body, { headers: { 'Content-Type': built.contentType } }).formData();
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
	it('sends a multipart content type the server can read the parts from', async () => {
		const built = await buildImportRequest(manifest, contentPackage);

		expect(built.contentType).toMatch(/^multipart\/form-data; boundary=\S+$/);
		expect((await parse(built)).get('key')).toBe('my-books');
	});

	/** Field for field with the server's `ContentSourceImportDto`. */
	it.each([
		['key', 'my-books'],
		['name', 'My Books'],
		['version', '1.0.0'],
		['publisher', 'A Person'],
		['license', 'own-work'],
		['attribution', "Player's Handbook (2024)"],
	])('sends %s', async (field, value) => {
		const form = await parse(await buildImportRequest(manifest, contentPackage));

		expect(form.get(field)).toBe(value);
	});

	/**
	 * Omitted rather than sent empty: the server stores what it is given, and a
	 * blank publisher is a publisher of "" in the registry listing.
	 */
	it('leaves out the fields that were not filled in', async () => {
		const sparse = await parse(
			await buildImportRequest({ key: 'k', name: 'N', license: 'own-work' }, contentPackage),
		);

		expect(sparse.has('publisher')).toBe(false);
		expect(sparse.has('version')).toBe(false);
		expect(sparse.has('url')).toBe(false);
		expect(sparse.get('license')).toBe('own-work');
	});

	it('sends the package as a JSON file part, unindented', async () => {
		const file = (await parse(await buildImportRequest(manifest, contentPackage))).get('file') as File;

		expect(file.name).toBe('my-books.json');
		expect(file.type).toBe('application/json');
		const text = await file.text();
		expect(JSON.parse(text)).toMatchObject({ formatVersion: 1, documentKey: 'my-books' });
		// A wire format; a 391-spell document gains a third in whitespace nobody reads.
		expect(text).not.toContain('\n  "documentKey"');
	});

	it.each([
		['../etc/passwd', 'etc-passwd.json'],
		['my books', 'my-books.json'],
	])('makes %s a safe filename', async (key, expected) => {
		const form = await parse(await buildImportRequest({ ...manifest, key }, contentPackage));

		expect((form.get('file') as File).name).toBe(expected);
	});

	it('trims the fields', async () => {
		const form = await parse(
			await buildImportRequest({ ...manifest, name: '  My Books  ' }, contentPackage),
		);

		expect(form.get('name')).toBe('My Books');
	});

	/** The title is an upsert key on the server, so it must survive the wire as UTF-8. */
	it('keeps a non-ASCII name intact', async () => {
		const form = await parse(await buildImportRequest({ ...manifest, name: 'Ördögök – 魔法' }, contentPackage));

		expect(form.get('name')).toBe('Ördögök – 魔法');
	});
});
