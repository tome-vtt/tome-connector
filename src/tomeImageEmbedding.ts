import { App, normalizePath } from 'obsidian';
import { getMimeType, toDataUri } from './tomeImageEncoding';
import { TomeImageKind, downscaleImageBytes } from './tomeImageDownscale';

/**
 * Reads the vault file at `path` and returns it as a base64 `data:` URI - the
 * send module's image port in the plugin, and the adventure import's reader.
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
