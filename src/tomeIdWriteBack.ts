/**
 * Writes the id Tome returns after a code-block "Send to Tome" back into the
 * note's fenced block, and reads it again on the next send so a re-send updates
 * the row rather than duplicating it.
 *
 * Pure and `obsidian`-free; `writeTomeIdToYamlBlock` locates the block and calls
 * this.
 */

/** The fenced blocks that carry a "Send to Tome" button. */
export type TomeBlockKind = 'creature' | 'encounter' | 'prop' | 'leaflet' | 'zoommap';

const GUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Whether a value could be an id Tome issued. Anything else - Leaflet's own map
 * name, a Fantasy Statblocks id - would fail model binding server-side, so it is
 * never sent.
 */
export function isTomeId(value: unknown): value is string {
	return typeof value === 'string' && GUID_PATTERN.test(value);
}

/**
 * The id an earlier send wrote into this block, if any. `tome_id` first (where a
 * Leaflet block keeps it), then `id` - which also covers Leaflet blocks sent
 * before Tome's id moved out of Leaflet's own key.
 */
export function existingTomeId(block: Record<string, unknown>): string | undefined {
	if (isTomeId(block.tome_id)) return block.tome_id;
	return isTomeId(block.id) ? block.id : undefined;
}

/**
 * Leaflet's `id` is the user's own map name and Leaflet's persistence key, so
 * Tome's id goes beside it rather than over it.
 */
function keyFor(kind: TomeBlockKind): string {
	return kind === 'leaflet' ? 'tome_id' : 'id';
}

/**
 * Returns `text` with Tome's `id` written into the fenced block whose fences sit
 * on lines `lineStart` and `lineEnd` (0-based, as Obsidian's section info gives
 * them). A top-level line for the kind's key is replaced in place; otherwise one
 * is added just before the closing fence.
 *
 * Only that one line changes: the fences, the rest of the block and everything
 * outside it stay byte-identical, and the new line takes the note's own line
 * ending, so a CRLF note stays CRLF throughout.
 */
export function writeTomeIdIntoNote(
	text: string,
	lineStart: number,
	lineEnd: number,
	kind: TomeBlockKind,
	id: string,
): string {
	// Each entry keeps its own terminator, so joining with '' is lossless.
	const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const eol = lines[lineStart]?.endsWith('\r\n') ? '\r\n' : '\n';
	const key = keyFor(kind);
	// ponytail: a column-0 `key:` line; a flow-style block (`{id: …}`) is not handled.
	const keyLine = new RegExp(`^(["']?)${key}\\1[ \\t]*:`);

	for (let index = lineStart + 1; index < lineEnd; index++) {
		const line = lines[index] ?? '';
		if (keyLine.test(line)) {
			const ending = /\r?\n$/.exec(line)?.[0] ?? '';
			lines[index] = `${key}: ${id}${ending}`;
			return lines.join('');
		}
	}

	lines.splice(lineEnd, 0, `${key}: ${id}${eol}`);
	return lines.join('');
}
