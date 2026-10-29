import {
	assemblePackage,
	packageKeyFrom,
	type AssembleOptions,
	type PackageReport,
} from './recognizers/compendium/package';
import { buildImportRequest, type ImportManifest } from './recognizers/compendium/importRequest';
import type { Note } from './recognizers/note';
import { readScope, type NoteSource, type SyncScope } from './scopeReader';
import { TOME_ROUTES } from './routes';
import type { SendResult } from './tomeHttp';
import { describeError } from './shared';

/**
 * The work of importing a compendium as a content source, without Obsidian: scan the
 * scope, then upload the package. `importContentSource.ts` is the dialog around it -
 * it asks, shows progress and reports - and the tests drive this over an in-memory
 * {@link NoteSource} and a fake {@link ImportHttp}.
 */

/** Posts a multipart body to a Tome path; the plugin binds the base URL and key. */
export type ImportHttp = (path: string, body: ArrayBuffer, contentType: string) => Promise<SendResult>;

/** A sensible package key from the scope, so the field is rarely edited. */
export function suggestedKey(scope: SyncScope): string {
	return packageKeyFrom(
		scope.kind === 'folder' ? scope.folder.name : scope.kind === 'tag' ? scope.tag : '',
	);
}

export interface CompendiumScan {
	/**
	 * The package report under these options, from the notes already read. Parsing is
	 * fast; re-reading a 2,974-note vault to answer a checkbox is not.
	 */
	assemble(options: AssembleOptions): PackageReport;
}

/** Reads the scope's notes once. */
export async function scanCompendium(
	source: NoteSource,
	scope: SyncScope,
	onProgress?: (done: number, total: number) => void,
): Promise<CompendiumScan> {
	const notes: Note[] = await readScope(source, scope, onProgress);
	const key = suggestedKey(scope);
	return { assemble: (options) => assemblePackage(notes, key, options) };
}

/** The result of an upload; `thrown` is the original error, for the caller to log. */
export type UploadOutcome = { ok: true } | { ok: false; message: string; thrown?: unknown };

/** Posts the package as one multipart request and says how it went. */
export async function uploadPackage(
	http: ImportHttp,
	manifest: ImportManifest,
	report: PackageReport,
): Promise<UploadOutcome> {
	try {
		// The document key is the manifest's key: the person may have renamed it in
		// the form, and the two disagreeing would file the package under one name and
		// describe it under another.
		const body = await buildImportRequest(manifest, { ...report.package, documentKey: manifest.key });
		const result = await http(TOME_ROUTES.importContentSource, body.body, body.contentType);
		if (result.ok) return { ok: true };

		// The server explains itself - a plan ceiling, third-party content switched
		// off, a licence it would not take - and those are things the person can act on.
		return { ok: false, message: result.message ?? `import failed (${result.status})` };
	} catch (error) {
		return { ok: false, message: describeError(error), thrown: error };
	}
}
