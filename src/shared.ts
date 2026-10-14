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
