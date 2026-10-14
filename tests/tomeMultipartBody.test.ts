import { describe, expect, it } from 'vitest';
import { encodeForm, sanitizeUploadFilename } from '../src/tomeMultipartBody';

/** Reads the encoded body back the way a server would. */
function decode(encoded: { body: ArrayBuffer; contentType: string }): Promise<FormData> {
	return new Response(encoded.body, { headers: { 'Content-Type': encoded.contentType } }).formData();
}

describe('encodeForm', () => {
	it('round-trips a field and a file, with a content type naming the boundary', async () => {
		const form = new FormData();
		form.append('title', 'Sunless Citadel');
		form.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'a.pdf');

		const encoded = await encodeForm(form);
		const parsed = await decode(encoded);

		expect(encoded.contentType).toMatch(/^multipart\/form-data; boundary=\S+$/);
		expect(parsed.get('title')).toBe('Sunless Citadel');
		const file = parsed.get('file') as File;
		expect([file.name, file.type]).toEqual(['a.pdf', 'application/pdf']);
	});

	it('preserves binary file bytes exactly', async () => {
		// NUL, a bare CR and LF, and two values above 0x7F: what string concatenation corrupts.
		const bytes = new Uint8Array([0x00, 0x0d, 0x0a, 0x25, 0xff, 0x80]);
		const form = new FormData();
		form.append('file', new Blob([bytes]), 'x.bin');

		const file = (await decode(await encodeForm(form))).get('file') as File;

		expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual(Array.from(bytes));
	});

	/** The title is the server's upsert key: a mangled one would create a second reference. */
	it('encodes a non-ASCII field value as UTF-8', async () => {
		const form = new FormData();
		form.append('title', 'Ördögök');

		const encoded = await encodeForm(form);

		expect(new TextDecoder('utf-8').decode(encoded.body)).toContain('Ördögök');
		expect((await decode(encoded)).get('title')).toBe('Ördögök');
	});
});

describe('sanitizeUploadFilename', () => {
	it('keeps an ordinary folder name', () => {
		expect(sanitizeUploadFilename('My Folder')).toBe('My Folder.pdf');
	});

	it('replaces path separators and quotes', () => {
		expect(sanitizeUploadFilename('a/b\\c"d')).toBe('a_b_c_d.pdf');
	});

	it('strips characters that could break the header', () => {
		expect(sanitizeUploadFilename('bad\r\nname')).toBe('bad_name.pdf');
	});

	it('does not double the extension', () => {
		expect(sanitizeUploadFilename('Rulebook.pdf')).toBe('Rulebook.pdf');
	});

	it('falls back when nothing usable survives', () => {
		expect(sanitizeUploadFilename('…')).toBe('reference.pdf');
		expect(sanitizeUploadFilename('')).toBe('reference.pdf');
	});

	it('caps a very long name', () => {
		const result = sanitizeUploadFilename('x'.repeat(300));

		expect(result).toBe(`${'x'.repeat(100)}.pdf`);
	});

	it('trims leading and trailing dots and spaces', () => {
		expect(sanitizeUploadFilename('  ..Notes..  ')).toBe('Notes.pdf');
	});
});
