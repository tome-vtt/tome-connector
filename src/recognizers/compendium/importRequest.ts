/**
 * Turns an assembled package into the multipart request the server imports.
 *
 * `POST /api/ContentSources/import` takes the manifest as form fields and the
 * package as a file beside them - deliberately, so the registry records what the
 * importer claimed rather than what the document asserts about itself. This
 * module is that translation and nothing else.
 *
 * Pure and `obsidian`-free: it builds bytes, and the caller sends them.
 */

import { buildMultipartBody, type MultipartBody } from '../../tomeMultipartBody';
import type { ContentPackage } from './package';

/**
 * The manifest, matching the server's `ContentSourceImportDto` field for field.
 *
 * Lower-case names because MVC's form binding is case-insensitive but the DTO's
 * own property names are what the OpenAPI document publishes; keeping them
 * aligned means a rename on the server shows up here as a field that stops
 * arriving rather than one that silently binds to nothing.
 */
export interface ImportManifest {
	/** The stable handle. Re-importing the same key replaces the source's content. */
	key: string;
	name: string;
	version?: string;
	publisher?: string;
	/** Required by the server. `own-work` for homebrew, `CC-BY-4.0` for SRD-derived. */
	license: string;
	attribution?: string;
	url?: string;
}

/**
 * Checks the manifest before anything is uploaded; each problem is in words the person can act on.
 *
 * The server validates all of this too and would refuse with a 400, but by then
 * a 391-spell package has crossed the wire - and on a Free account the plan
 * check refuses *after* the upload, which is a documented consequence of the
 * size limit being a compile-time constant. Catching it here costs nothing.
 */
export function validateManifest(manifest: Partial<ImportManifest>): string[] {
	const problems: string[] = [];

	if (!manifest.key?.trim()) problems.push('Give the package a key.');
	else if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.key.trim())) {
		problems.push('A key may only hold lower-case letters, digits and hyphens.');
	}

	if (!manifest.name?.trim()) problems.push('Give the package a name.');

	// The one field with no sensible default. Content that is not SRD-marked gets
	// no suggestion, so this is where an import of book content stops until the
	// person says what it is - which is the point.
	if (!manifest.license?.trim()) {
		problems.push('Say what licence the content is under, or "own-work" if it is yours.');
	}

	return problems;
}

/**
 * `my-books` -> `my-books.json`, for the `Content-Disposition` filename.
 *
 * The key is already constrained by {@link validateManifest}, so this is defence
 * in depth; it trims leading dots and separators the same way
 * `sanitizeUploadFilename` does, which is what keeps a path out of the header
 * rather than merely a slash.
 */
function filenameFor(key: string): string {
	const safe = key
		.replace(/[^A-Za-z0-9._-]/g, '-')
		.replace(/^[._-]+|[._-]+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 100);

	return `${safe || 'package'}.json`;
}

/**
 * Builds the request body.
 *
 * The package is serialised without indentation: it is a wire format, and a
 * 391-spell document gains about a third in size for whitespace nobody reads.
 *
 * @param boundary
 *   Injected rather than generated here so a test can assert the byte layout;
 *   callers pass `createMultipartBoundary()`.
 */
export function buildImportRequest(
	manifest: ImportManifest,
	contentPackage: ContentPackage,
	boundary: string,
): MultipartBody {
	const fields = [
		{ name: 'key', value: manifest.key.trim() },
		{ name: 'name', value: manifest.name.trim() },
		{ name: 'license', value: manifest.license.trim() },
	];

	// Omitted rather than sent empty: the server stores what it is given, and a
	// blank publisher is a publisher of "" in the registry listing.
	for (const [name, value] of [
		['version', manifest.version],
		['publisher', manifest.publisher],
		['attribution', manifest.attribution],
		['url', manifest.url],
	] as const) {
		if (value?.trim()) fields.push({ name, value: value.trim() });
	}

	return buildMultipartBody(
		fields,
		[
			{
				name: 'file',
				filename: filenameFor(manifest.key),
				contentType: 'application/json',
				bytes: new TextEncoder().encode(JSON.stringify(contentPackage)),
			},
		],
		boundary,
	);
}
