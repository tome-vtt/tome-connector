/**
 * Reads the two map blocks the community actually uses.
 *
 * **Leaflet** (`obsidian-leaflet-plugin`, javalent) is the larger of the two and
 * references its image as a wikilink:
 *
 * ```leaflet
 * id: my-map
 * image: [[Map.jpg]]
 * height: 500px
 * ```
 *
 * **TTRPG Tools Maps** (`zoom-map`) uses a plain vault path, and has two forms:
 *
 * ```zoommap
 * image: Assets/Map.jpg
 * ```
 *
 * ...or `imageBases:` when the map has switchable layers. **Only the second was
 * read before**, so the single-image form — the one its own README leads with —
 * was not recognised at all.
 *
 * Pure and `obsidian`-free; resolving a vault path to bytes is the caller's job.
 */

import { existingTomeId } from '../tomeIdWriteBack';

export interface MapReference {
	/** Vault-relative path or wikilink target, as written. The caller resolves it. */
	image: string;
	/** Derived from the filename when the block does not name the map. */
	title: string;
	/** Present only when the block carries one that is worth sending back. */
	id?: string;
}

/**
 * `[[Map.jpg]]` and `[[Maps/Map.jpg|The Keep]]` both yield the *target*, not the
 * alias: the alias is display text, and the target is what resolves to a file.
 */
export function unwrapWikilink(value: string): string {
	const match = /^\s*!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(value);
	return (match?.[1] ?? value).trim();
}

/**
 * The filename without extension, title-cased on separators, e.g.
 * `Assets/the-old-keep.jpg` -> `The Old Keep`.
 *
 * Neither block type has a reliable title field — Leaflet's `id` is a
 * uniqueness handle rather than a name, and zoommap has none — so the filename
 * is the only thing that reads like one.
 */
export function titleFromImagePath(path: string): string {
	const file = path.split(/[\\/]/).pop() ?? path;
	const stem = file.replace(/\.[^.]+$/, '');
	const words = stem
		.split(/[-_\s]+/)
		.map((word) => word.trim())
		.filter((word) => word !== '');

	if (words.length === 0) return stem;
	return words
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function firstImageBasePath(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	for (const entry of value) {
		if (typeof entry === 'string' && entry.trim() !== '') return entry.trim();
		if (typeof entry === 'object' && entry !== null) {
			const path = (entry as Record<string, unknown>).path;
			if (typeof path === 'string' && path.trim() !== '') return path.trim();
		}
	}
	return null;
}

/**
 * Pulls a map reference out of a parsed `leaflet` or `zoommap` block, or returns
 * null when there is no image to send.
 *
 * One function for both because after the wikilink is unwrapped the two are the
 * same thing — a path and a name — and a second near-identical reader would be
 * two places to fix the next time either plugin adds a field.
 *
 * A layered zoommap sends its first base only. Tome holds one image per map, so
 * the alternative is refusing the map entirely; the first layer is the one the
 * plugin shows first.
 */
export function mapReferenceFrom(parsed: unknown): MapReference | null {
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return null;
	}

	const record = parsed as Record<string, unknown>;
	const direct = typeof record.image === 'string' ? record.image.trim() : '';
	const raw = direct !== '' ? direct : firstImageBasePath(record.imageBases);
	if (!raw) return null;

	const image = unwrapWikilink(raw);
	if (image === '') return null;

	const reference: MapReference = { image, title: titleFromImagePath(image) };

	// Leaflet's `id` is the user's own string ("my-map"), not a GUID, so only an
	// id Tome issued is carried - the server would reject the rest on model
	// binding. Tome's id sits under `tome_id` on a Leaflet block.
	const id = existingTomeId(record);
	if (id !== undefined) reference.id = id;

	return reference;
}
