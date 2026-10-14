/**
 * Encodes a `FormData` as a `multipart/form-data` body for `requestUrl`, which
 * takes only `string | ArrayBuffer`. The browser picks the boundary and writes
 * the `Content-Type` header that names it.
 *
 * Free of any `obsidian` import so it can be unit tested.
 */
export async function encodeForm(
	form: FormData,
): Promise<{ body: ArrayBuffer; contentType: string }> {
	const response = new Response(form);
	return {
		body: await response.arrayBuffer(),
		contentType: response.headers.get('Content-Type') ?? '',
	};
}

/**
 * Turns a reference title into a filename safe to interpolate into a
 * `Content-Disposition` header. Anything outside a conservative allowlist
 * becomes an underscore, which also rules out the CR/LF and quote characters
 * that would otherwise let a folder name break the header.
 *
 * The filename is cosmetic - the server prefers the `title` field and only
 * falls back to this - so mangling an exotic name is preferable to failing.
 */
export function sanitizeUploadFilename(title: string): string {
	const withoutExtension = title.replace(/\.pdf$/i, '');
	const trimmed = withoutExtension
		.replace(/[^A-Za-z0-9._ -]/g, '_')
		.replace(/_{2,}/g, '_')
		.slice(0, 100)
		.replace(/^[\s._-]+|[\s._-]+$/g, '');
	return `${trimmed || 'reference'}.pdf`;
}
