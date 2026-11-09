/**
 * `decodeURIComponent` that keeps the text as written when it is not a valid
 * escape: a stray `%` (`50%off.png`) is part of a filename, not a broken escape.
 *
 * Pure and `obsidian`-free.
 */
export function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
