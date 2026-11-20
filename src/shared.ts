/** The message of a thrown value, whatever it is. */
export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The value as a plain object (not null, not an array), or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** `decodeURIComponent`, keeping the text as written when it is no valid escape: a stray `%` (`50%off.png`) is part of a filename. */
export function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
