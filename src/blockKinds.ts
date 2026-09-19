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
import type { TomeBlockKind } from './tomeIdWriteBack';

export interface BlockKind {
	/** The fence's language, as in ` ```statblock `. */
	language: string;
	/** Whether this parsed block is one worth a button. */
	recognizes(parsed: unknown): boolean;
	/** The send module's kind for it. */
	sends: 'creature' | 'encounter' | 'map' | 'prop';
	/** The id write-back module's kind for it, which picks the key the id goes under. */
	writeBack: TomeBlockKind;
	/**
	 * No other plugin draws this fence, so Tome renders a title-and-image preview
	 * itself rather than decorating another plugin's render.
	 */
	ownsFence?: true;
}

function isMapping(parsed: unknown): parsed is Record<string, unknown> {
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
}

const namesAnImage = (parsed: unknown) => mapReferenceFrom(parsed) !== null;

export const BLOCK_KINDS: readonly BlockKind[] = [
	// Whether a `monster:` reference resolves is the send's to report, not a reason to hide the button.
	{ language: 'statblock', recognizes: isMapping, sends: 'creature', writeBack: 'creature' },
	{
		language: 'encounter',
		recognizes: (parsed) => mapToEncounterPayload(parsed) !== null,
		sends: 'encounter',
		writeBack: 'encounter',
	},
	// Leaflet's `id` is the user's own map name, so its row writes Tome's id to `tome_id`.
	{ language: 'leaflet', recognizes: namesAnImage, sends: 'map', writeBack: 'leaflet' },
	{ language: 'zoommap', recognizes: namesAnImage, sends: 'map', writeBack: 'zoommap' },
	{
		language: 'prop',
		recognizes: (parsed) => isMapping(parsed) && typeof parsed.title === 'string' && parsed.title.trim() !== '',
		sends: 'prop',
		writeBack: 'prop',
		ownsFence: true,
	},
];

/** The row for this fence, if its parsed YAML is one the row recognizes. */
export function recognizeBlock(language: string, parsed: unknown): BlockKind | null {
	const kind = BLOCK_KINDS.find((row) => row.language === language);
	return kind?.recognizes(parsed) ? kind : null;
}
