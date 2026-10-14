import type TomeConnectorPlugin from './main';
import { describeFailure, tomeHttp } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { TOME_ROUTES } from './routes';
import { encodeForm, sanitizeUploadFilename } from './tomeMultipartBody';

/**
 * Mirrors `ReferencesController.MaxPdfBytes`. Checked locally so a long
 * upload isn't spent only to be rejected, and so the message can name the
 * limit instead of surfacing a bare 400.
 */
const MAX_REFERENCE_BYTES = 100 * 1024 * 1024;

/** The `%PDF-` signature the server checks before storing anything. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** True if `bytes` opens with the PDF magic number. */
function hasPdfSignature(bytes: Uint8Array): boolean {
	return PDF_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Uploads a compiled PDF into the campaign's Reference library.
 *
 * Unlike a button's send, which reports through `noticeResult`, this throws on failure rather than showing its own
 * Notice: it is the last step of a long, multi-stage operation whose caller
 * already owns a progress notice, so error reporting belongs there.
 *
 * The returned id is informational. `ReferenceService.CreateReferenceAsync`
 * upserts on (user, campaign, title), so re-sending a folder replaces its
 * reference - there is nothing to write back into the vault, which is why
 * this module has no counterpart to the block buttons' id write-back.
 */
export async function uploadReferencePdf(
	plugin: TomeConnectorPlugin,
	pdf: Uint8Array,
	title: string,
	campaignId: string,
): Promise<string | null> {
	if (!hasPdfSignature(pdf)) {
		throw new Error('The generated file was not a valid PDF. Nothing was sent.');
	}
	if (pdf.byteLength > MAX_REFERENCE_BYTES) {
		throw new Error(
			`The generated PDF is ${formatBytes(pdf.byteLength)}, over the 100 MB limit for a reference.`,
		);
	}

	const form = new FormData();
	form.append('title', title);
	form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), sanitizeUploadFilename(title));
	const { body, contentType } = await encodeForm(form);

	const result = await tomeHttp.postMultipart(
		{
			baseUrl: plugin.settings.baseUrl,
			path: TOME_ROUTES.uploadReference,
			apiKey: getApiKey(plugin),
			campaignId,
		},
		body,
		contentType,
	);
	if (!result.ok) throw new Error(`the reference upload failed. ${describeFailure(result)}`);
	return result.id;
}

/** Human-readable byte count for progress and error messages. */
export function formatBytes(byteLength: number): string {
	if (byteLength < 1024) return `${byteLength} B`;
	if (byteLength < 1024 * 1024) return `${Math.round(byteLength / 1024)} KB`;
	return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}
