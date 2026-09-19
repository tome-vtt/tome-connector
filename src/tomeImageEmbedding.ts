import { App, normalizePath } from 'obsidian';
import { getMimeType, toDataUri } from './tomeImageEncoding';
import {
	TomeImageKind,
	downscaleImageBytes,
	embedImages,
} from './tomeImageDownscale';

/**
 * Reads the vault file at `path` and returns it as a base64 `data:` URI.
 * Shared by the JSON/statblock image resolution below and by other code
 * block buttons (e.g. maps) that need to embed a single image's raw bytes.
 *
 * `downscale` is the user's `downscaleImages` setting, passed as a plain boolean
 * rather than as the plugin: this module must not import `main.ts`, and
 * `tomeImageDownscale` must not learn that a settings object exists at all -
 * being free of both is what keeps it unit testable.
 *
 * It is required rather than defaulted so the compiler names every call site,
 * the same reason `fitWithin` gives for its `maxEdge`. A default here would mean
 * a new send path silently opting its images into one policy or the other.
 */
export async function readImageAsDataUri(
	app: App,
	path: string,
	kind: TomeImageKind,
	downscale: boolean,
): Promise<string> {
	const normalized = normalizePath(path);
	const buffer = await app.vault.adapter.readBinary(normalized);
	const mimeType = getMimeType(normalized);
	// "As-is" means the downscaler is not consulted at all, not that it is asked
	// for a cap it will decline to apply.
	return downscale
		? downscaleImageBytes(buffer, mimeType, kind)
		: toDataUri(buffer, mimeType);
}

/**
 * Replaces every image path in a parsed payload with its bytes, read from the
 * vault through the adapter, so it works on desktop and mobile alike. See
 * `embedImages` for the walk and its failure rule.
 */
export function resolveImagePaths(
	app: App,
	value: unknown,
	kind: TomeImageKind,
	downscale: boolean,
): Promise<unknown> {
	return embedImages(value, kind, (path, keyKind) =>
		readImageAsDataUri(app, path, keyKind, downscale),
	);
}
