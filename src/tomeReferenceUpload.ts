import { requestUrl } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { API_KEY_HEADER_NAME, CAMPAIGN_HEADER_NAME, joinUrl } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { extractResponseId } from './tomeHttp';
import { TOME_ROUTES } from './routes';
import {
	buildMultipartBody,
	createMultipartBoundary,
	sanitizeUploadFilename,
} from './tomeMultipartBody';

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
 * Unlike `sendJsonToTome`, this throws on failure rather than showing its own
 * Notice: it is the last step of a long, multi-stage operation whose caller
 * already owns a progress notice, so error reporting belongs there.
 *
 * The returned id is informational. `ReferenceService.CreateReferenceAsync`
 * upserts on (user, campaign, title), so re-sending a folder replaces its
 * reference - there is nothing to write back into the vault, which is why
 * this module has no counterpart to `writeTomeIdToYamlBlock`.
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

	const boundary = createMultipartBoundary();
	const multipart = buildMultipartBody(
		[{ name: 'title', value: title }],
		[
			{
				name: 'file',
				filename: sanitizeUploadFilename(title),
				contentType: 'application/pdf',
				bytes: pdf,
			},
		],
		boundary,
	);

	const response = await requestUrl({
		url: joinUrl(plugin.settings.baseUrl, TOME_ROUTES.uploadReference),
		method: 'POST',
		contentType: multipart.contentType,
		headers: {
			'Content-Type': multipart.contentType,
			[API_KEY_HEADER_NAME]: getRequiredApiKey(plugin),
			[CAMPAIGN_HEADER_NAME]: campaignId,
		},
		body: multipart.body,
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		console.error(
			`Tome Connector: reference upload failed with status ${response.status}`,
			response.text,
		);
		throw new Error(
			`the server responded with status ${response.status}. Check the console for the response body.`,
		);
	}

	return extractResponseId(response.text);
}

function getRequiredApiKey(plugin: TomeConnectorPlugin): string {
	// The caller checks this before rendering anything; repeated here so the
	// request can never go out unauthenticated if that guard is bypassed.
	const apiKey = getApiKey(plugin);
	if (!apiKey) {
		throw new Error('no API key is configured in the plugin settings.');
	}
	return apiKey;
}

/** Human-readable byte count for progress and error messages. */
export function formatBytes(byteLength: number): string {
	if (byteLength < 1024) return `${byteLength} B`;
	if (byteLength < 1024 * 1024) return `${Math.round(byteLength / 1024)} KB`;
	return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}
