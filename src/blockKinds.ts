/**
 * The table every "Send to Tome" block button is driven by: code-block language →
 * recognizer → what the send module sends it as, and which key the id write-back
 * module writes. Adding a block kind is adding a row; the button frame that reads
 * this table is `blockSendButton.ts`.
 *
 * Pure and `obsidian`-free, so the routing is pinned in `tests/blockKinds.test.ts`.
 */

import { mapToEncounterPayload } from './recognizers/encounter';
import { mapReferenceFrom } from './recognizers/map';
import type { SendableParse } from './recognizers/noteScan';
import type { TomeBlockKind } from './tomeIdWriteBack';

/** What a block sends as: the send module's typed variant, less the note it is in. */
export type BlockSendable =
	| Extract<SendableParse, { kind: 'creature' | 'encounter' | 'map' }>
	| { kind: 'prop'; block: Record<string, unknown> };

export interface BlockKind {
	/** The fence's language, as in ` ```statblock `. */
	language: string;
	/** The parsed block as the send module's variant, or null when it is not one worth a button. */
	sendable(parsed: unknown): BlockSendable | null;
	/** The id write-back module's kind for it, which picks the key the id goes under. */
	writeBack: TomeBlockKind;
	/**
	 * No other plugin draws this fence, so Tome draws it as a `title`-and-`image`
	 * preview rather than decorating another plugin's render. The row's recognizer
	 * must require a `title`.
	 */
	titleAndImagePreview?: true;
}

function isMapping(parsed: unknown): parsed is Record<string, unknown> {
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
}

// No image, nothing to send: a Leaflet block that only sets up coordinates, or a zoommap block still being written.
function mapSendable(parsed: unknown): BlockSendable | null {
	const map = mapReferenceFrom(parsed);
	return map && { kind: 'map', map };
}

export const BLOCK_KINDS: readonly BlockKind[] = [
	// Whether a `monster:` reference resolves is the send's to report, not a reason to hide the button.
	{
		language: 'statblock',
		sendable: (parsed) => (isMapping(parsed) ? { kind: 'creature', block: parsed } : null),
		writeBack: 'creature',
	},
	{
		language: 'encounter',
		sendable: (parsed) => {
			const encounter = mapToEncounterPayload(parsed);
			return encounter && { kind: 'encounter', encounter };
		},
		writeBack: 'encounter',
	},
	// Leaflet's `id` is the user's own map name, so its row writes Tome's id to `tome_id`.
	{ language: 'leaflet', sendable: mapSendable, writeBack: 'leaflet' },
	{ language: 'zoommap', sendable: mapSendable, writeBack: 'zoommap' },
	{
		language: 'prop',
		sendable: (parsed) =>
			isMapping(parsed) && typeof parsed.title === 'string' && parsed.title.trim() !== ''
				? { kind: 'prop', block: parsed }
				: null,
		writeBack: 'prop',
		titleAndImagePreview: true,
	},
];

/** The row for this fence, if its parsed YAML is one the row sends. */
export function recognizeBlock(language: string, parsed: unknown): BlockKind | null {
	const kind = BLOCK_KINDS.find((row) => row.language === language);
	return kind?.sendable(parsed) ? kind : null;
}
