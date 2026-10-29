import { findSendables, type Sendable, type ScanWarning, type YamlParser } from './recognizers/noteScan';
import { readScope, type NoteSource, type SyncScope } from './scopeReader';

/**
 * The vault sync's scan step, without the dialogs: read a scope for what it holds.
 * `syncVaultToTome.ts` asks, sends, shows progress and reports; the scan is tested
 * here over an in-memory vault.
 *
 * Ids are deliberately not written back into notes: every endpoint upserts on name
 * or title, so a second run updates rather than duplicates.
 */

/**
 * Reads the scope's notes and returns the sendables found, and what was skipped or
 * changed on the way, with a count after each note.
 */
export async function scanScope(
	notes: NoteSource,
	scope: SyncScope,
	parseYaml: YamlParser,
	onProgress?: (done: number, total: number) => void,
): Promise<{ sendables: Sendable[]; warnings: ScanWarning[] }> {
	const read = await readScope(notes, scope, onProgress);
	const warnings: ScanWarning[] = [];
	const sendables = read.flatMap((note) =>
		findSendables(note, parseYaml, (message) => warnings.push({ path: note.path, message })),
	);
	return { sendables, warnings };
}
