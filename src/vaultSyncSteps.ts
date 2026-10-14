import { MAX_ATTEMPTS, runBulkSend, THROTTLE_MS, type BulkReport, type BulkOutcome } from './bulkSend';
import { findSendables, type Sendable, type YamlParser } from './recognizers/noteScan';
import { readScope, type NoteSource, type SyncScope } from './scopeReader';
import { sendToTome, type Destination, type SendPorts } from './sendModule';

/**
 * The vault sync's two steps, without the dialogs: scan a scope for what it holds,
 * then send what was found. `syncVaultToTome.ts` asks, shows progress and reports;
 * both steps are tested here over an in-memory vault and in-memory send ports.
 *
 * Ids are deliberately not written back into notes: every endpoint upserts on name
 * or title, so a second run updates rather than duplicates.
 */

/** Reads the scope's notes and returns the sendables found, with a count after each note. */
export async function scanScope(
	notes: NoteSource,
	scope: SyncScope,
	parseYaml: YamlParser,
	onProgress?: (done: number, total: number) => void,
): Promise<Sendable[]> {
	const read = await readScope(notes, scope, onProgress);
	return read.flatMap((note) => findSendables(note, parseYaml));
}

export interface SendStepOptions {
	sendables: Sendable[];
	ports: SendPorts;
	destination: Destination;
	/** Injected so tests do not wait. */
	sleep: (ms: number) => Promise<void>;
	onProgress?: (done: number, total: number, latest: BulkOutcome<Sendable>) => void;
	/** Polled between items; true ends the run after the current one. */
	isCancelled?: () => boolean;
}

/**
 * Sends each sendable, paced and retried by `runBulkSend`.
 *
 * A send that throws (a missing image, no bestiary) is reported as unresolvable
 * and not retried; that is `runBulkSend`'s rule for a thrown error.
 */
export function sendSendables(options: SendStepOptions): Promise<BulkReport<Sendable>> {
	const { sendables, ports, destination, sleep, onProgress, isCancelled } = options;
	return runBulkSend<Sendable>({
		items: sendables.map((sendable) => ({ label: sendable.label, path: sendable.path, value: sendable })),
		sleep,
		throttleMs: THROTTLE_MS,
		maxAttempts: MAX_ATTEMPTS,
		isCancelled,
		onProgress,
		send: (item) => sendToTome(ports, item.value, destination),
	});
}
