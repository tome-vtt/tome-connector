import { Notice, requestUrl } from 'obsidian';
import { createTomeHttp, type JsonResult, type SendResult, type TomeTransport } from './tomeHttp';

export { API_KEY_HEADER_NAME, CAMPAIGN_HEADER_NAME, describeFailure, joinUrl, type SendResult } from './tomeHttp';

/** The production adapter at the transport seam. `throw: false` so a 4xx comes back as a status. */
const obsidianTransport: TomeTransport = async (request) => {
	const response = await requestUrl({ ...request, throw: false });
	return { status: response.status, text: response.text, headers: response.headers };
};

/** The Tome HTTP module over `requestUrl`: the post port the send module is given in the plugin. */
export const tomeHttp = createTomeHttp(obsidianTransport);

/**
 * Sends a JSON payload and reports what happened, without saying anything to the
 * user.
 *
 * The quiet half of {@link sendJsonToTome}, split out for bulk sending: one
 * Notice per item is right when somebody pressed a button on one block, and
 * unusable when 709 creatures are going across.
 */
export function postJsonToTome(
	baseUrl: string,
	path: string,
	payload: string,
	apiKey: string,
	campaignId?: string,
): Promise<SendResult> {
	return tomeHttp.postJson({ baseUrl, path, apiKey, campaignId }, payload);
}

/**
 * Posts a prebuilt `multipart/form-data` body, quietly: the PDF reference upload
 * and the content-package import. Retry classification is shared with
 * {@link postJsonToTome}, so a 429 backs off the same way on both.
 */
export function postMultipartToTome(
	baseUrl: string,
	path: string,
	body: ArrayBuffer,
	contentType: string,
	apiKey: string,
	campaignId?: string,
): Promise<SendResult> {
	return tomeHttp.postMultipart({ baseUrl, path, apiKey, campaignId }, body, contentType);
}

/** GETs a JSON body, quietly: the campaign list. */
export function getJsonFromTome<T>(baseUrl: string, path: string, apiKey: string): Promise<JsonResult<T>> {
	return tomeHttp.getJson<T>({ baseUrl, path, apiKey });
}

/** Posts JSON and reads the JSON answer, quietly: the adventure import's link-resolve and import passes. */
export function postJsonAndReadFromTome<T>(
	baseUrl: string,
	path: string,
	payload: string,
	apiKey: string,
	campaignId: string,
): Promise<JsonResult<T>> {
	return tomeHttp.postJsonAndRead<T>({ baseUrl, path, apiKey, campaignId }, payload);
}

/**
 * Sends a raw JSON payload and tells the user how it went.
 *
 * Returns the `id` from the response body on success, or null if the request
 * failed or no id was present. Used by the per-block buttons, where one Notice
 * per send is exactly right.
 */
export async function sendJsonToTome(
	baseUrl: string,
	path: string,
	payload: string,
	apiKey: string,
	campaignId?: string,
): Promise<string | null> {
	return noticeResult(await postJsonToTome(baseUrl, path, payload, apiKey, campaignId));
}

/**
 * Tells the user how one send went, and returns the id on success or null.
 * For the per-block buttons, where one Notice per send is exactly right.
 */
export function noticeResult(result: SendResult): string | null {
	if (result.ok) {
		new Notice('Sent to Tome successfully.');
		return result.id;
	}

	// The server explains itself - a duplicated character name, a plan limit, a
	// title already taken - and those are things the person syncing can fix.
	// Sending them to the developer console to find out what went wrong made
	// every refusal look like a bug.
	new Notice(
		result.message
			? `Tome connector: ${result.message}`
			: `Tome connector: server responded with status ${result.status}. Check the console for the response body.`,
	);
	return null;
}
