/**
 * The one module Tome requests go through: headers, the unconfigured guard, the
 * status classification, and reading the server's answer all live here.
 *
 * It never imports `obsidian`. The network sits behind {@link TomeTransport}, a
 * port with two adapters: `requestUrl` in production (see `tomeApiClient.ts`)
 * and a fake in the tests.
 */

/** Header name the Tome server expects the API key under (see TomeVTT.Server.Auth.ApiKeyAuthenticationDefaults). */
export const API_KEY_HEADER_NAME = 'X-Api-Key';
export const CAMPAIGN_HEADER_NAME = 'X-Campaign-Id';

/** What every caller says when a request is refused before it is sent. */
export const NOT_CONFIGURED = 'Set a base URL and an API key in the plugin settings first.';

/**
 * Joins a configured base URL with a hardcoded API route, e.g.
 * `joinUrl('https://host.example.com/', '/api/encounter')` returns
 * `'https://host.example.com/api/encounter'`.
 */
export function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export interface TomeRequest {
	url: string;
	method: 'POST';
	contentType: string;
	headers: Record<string, string>;
	body: string | ArrayBuffer;
}

export interface TomeResponse {
	status: number;
	text: string;
	/** Response headers, in whatever case the adapter gives them. */
	headers?: Record<string, string>;
}

/** Sends one request. Resolves with any status the server answered; rejects only when nothing came back. */
export type TomeTransport = (request: TomeRequest) => Promise<TomeResponse>;

/** Where a request goes and who it is from. `campaignId` only for campaign-scoped routes. */
export interface TomeTarget {
	baseUrl: string;
	path: string;
	apiKey: string;
	campaignId?: string;
}

/** What one POST did, in enough detail for a caller to report or retry it. */
export interface SendResult {
	ok: boolean;
	/** 0 when the request never reached the server. */
	status: number;
	/** The created or updated id, when the server returned one. */
	id: string | null;
	/** The server's own explanation, when it gave one. */
	message: string | null;
	/** Whether trying the same request again could plausibly succeed. */
	retryable: boolean;
	/** Seconds the server asked us to wait before trying again, from its `Retry-After`. */
	retryAfterSeconds?: number;
}

export function createTomeHttp(transport: TomeTransport) {
	return {
		postJson: (target: TomeTarget, payload: string) =>
			post(transport, target, payload, 'application/json'),
		/**
		 * For the endpoints that take a file beside their fields. The caller builds the
		 * body with `buildMultipartBody`, because `requestUrl` takes only
		 * `string | ArrayBuffer` and `FormData` is not an option.
		 */
		postMultipart: (target: TomeTarget, body: ArrayBuffer, contentType: string) =>
			post(transport, target, body, contentType),
	};
}

async function post(
	transport: TomeTransport,
	target: TomeTarget,
	body: string | ArrayBuffer,
	contentType: string,
): Promise<SendResult> {
	if (!target.baseUrl.trim() || !target.apiKey) {
		return { ok: false, status: 0, id: null, message: NOT_CONFIGURED, retryable: false };
	}

	const headers: Record<string, string> = {
		'Content-Type': contentType,
		[API_KEY_HEADER_NAME]: target.apiKey,
	};
	if (target.campaignId) headers[CAMPAIGN_HEADER_NAME] = target.campaignId;

	let response: TomeResponse;
	try {
		response = await transport({
			url: joinUrl(target.baseUrl, target.path),
			method: 'POST',
			contentType,
			headers,
			body,
		});
	} catch (error) {
		console.error('Tome Connector: failed to send payload', error);
		return {
			ok: false,
			status: 0,
			id: null,
			message: error instanceof Error ? error.message : String(error),
			// The request never arrived, so the server has not refused anything.
			retryable: true,
		};
	}

	const { status, text } = response;
	if (status >= 200 && status < 300) {
		return { ok: true, status, id: extractResponseId(text), message: null, retryable: false };
	}

	console.error(`Tome Connector: server responded with status ${status}`, text);
	const result: SendResult = {
		ok: false,
		status,
		id: null,
		message: extractErrorMessage(text),
		retryable: isRetryable(status),
	};
	const retryAfterSeconds = parseRetryAfter(response.headers);
	if (retryAfterSeconds !== undefined) result.retryAfterSeconds = retryAfterSeconds;
	return result;
}

/**
 * The server's `Retry-After` as seconds from now: either delay-seconds or an
 * HTTP-date, per RFC 9110. Undefined when absent or unreadable, so the bulk
 * sender falls back to its own backoff.
 */
function parseRetryAfter(headers: Record<string, string> | undefined): number | undefined {
	const name = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === 'retry-after');
	const value = name === undefined ? '' : (headers?.[name] ?? '').trim();
	if (/^\d+$/.test(value)) return Number(value);
	const date = Date.parse(value);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

/**
 * Statuses worth trying again.
 *
 * 429 is the one that matters for a bulk run: the server's global limiter allows
 * 600 requests a minute per user, so a large vault will meet it, and meeting it
 * is a pacing problem rather than a failed item. 5xx and a request that never
 * arrived at all get the same treatment. Everything else - a 400, a 402 over a
 * plan limit, a 409 on a duplicate name - is the server saying no for a reason
 * that will still be true on the next attempt.
 */
function isRetryable(status: number): boolean {
	return status === 429 || status === 408 || status >= 500;
}

/** The id from a success body: `{ id }`, `{ Id }`, a JSON string, or plain text. */
export function extractResponseId(rawText: string): string | null {
	const trimmed = rawText.trim();
	if (!trimmed) return null;

	try {
		const parsedBody: unknown = JSON.parse(trimmed);
		if (typeof parsedBody === 'string') return parsedBody || null;
		if (typeof parsedBody !== 'object' || parsedBody === null) return null;

		const body = parsedBody as Record<string, unknown>;
		const responseId = body.id ?? body.Id;
		return typeof responseId === 'string' && responseId.length > 0
			? responseId
			: null;
	} catch {
		return trimmed;
	}
}

/**
 * Pulls the human-readable half of a Tome error response out of its body.
 *
 * The server refuses things for reasons the person syncing can act on - "more
 * than one player character in this campaign is called 'Alanna'", "you have
 * reached the map limit for your plan" - and every one of those arrives as a
 * ProblemDetails `detail`. Without this the connector could only say "server
 * responded with status 409", which tells you a sync failed and nothing about
 * what to do next.
 *
 * Handles the three shapes the server actually produces:
 *
 * - ProblemDetails (`{ title, detail, status, code? }`) - the mapped exceptions,
 *   which is nearly all of them. `detail` is the sentence worth showing; `title`
 *   is a category ("Resource is in use.") and is the fallback.
 * - `ApiMessageDto` (`{ message, code? }`) - what the controllers return for a
 *   refusal they shape themselves.
 * - A bare string, or something unparseable, which is returned as-is so a plain
 *   text error is not swallowed.
 *
 * Returns null when there is nothing worth putting in front of someone, so the
 * caller can fall back to the status code rather than showing an empty notice.
 */
export function extractErrorMessage(rawText: string): string | null {
	const trimmed = rawText.trim();
	if (!trimmed) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		// Not JSON. Whatever it is, it is what the server said - but cap it, since
		// an HTML error page would otherwise become the notice.
		return truncate(trimmed);
	}

	if (typeof parsed === 'string') return truncate(parsed) || null;
	if (typeof parsed !== 'object' || parsed === null) return null;

	const body = parsed as Record<string, unknown>;
	// detail before message before title: most specific first, and title is a
	// category rather than an explanation.
	for (const key of ['detail', 'message', 'title']) {
		const value = body[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return truncate(value.trim());
		}
	}

	return null;
}

/** Notices are transient and one-line; a wall of text in one is unreadable. */
function truncate(value: string): string {
	const limit = 300;
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
