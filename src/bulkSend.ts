/**
 * Sends a queue of items, paced, with retries, and reports what happened.
 *
 * Pure: the thing that actually posts and the thing that waits are both passed
 * in, so the whole policy - ordering, concurrency, backoff, when to give up, what
 * counts as skipped - is testable without a server or a clock. That matters more
 * here than anywhere else in the plugin, because the failure modes only appear at
 * scale: a run of 709 creatures meeting a rate limit is not something anybody is
 * going to reproduce by hand.
 */

/**
 * Milliseconds between items, for every bulk run: the vault sync and the
 * adventure import's upload passes.
 *
 * **The budget is shared with the browser, and that is what sets this number.**
 * The server's limiter allows 600 requests a minute *per user*, not per client,
 * and these endpoints are not under the tighter 30/minute upload policy. At the
 * old 120ms a run sat near 500/minute on its own, which left the person's own
 * Tome tab about a hundred - and a library panel loading spends that instantly.
 * Sending 1,478 magic items locked the UI out of its own server until the tab
 * was reloaded.
 *
 * 200ms puts a run around 260/minute once the request itself is counted, which
 * leaves more than half the budget for whoever is watching it happen. The cost
 * is about two extra minutes on a full magic-item import, which is the right
 * trade against a browser that cannot load a page.
 */
export const THROTTLE_MS = 200;

/** A 429 is still handled rather than assumed away; this is how many tries it gets. */
export const MAX_ATTEMPTS = 4;

/** Why an item did not go. */
export type FailureReason = 'refused' | 'unresolvable' | 'exhausted';

export interface BulkItem<T> {
	/** Shown in the report. */
	label: string;
	/** Where it came from, so a failure can be found again. */
	path: string;
	value: T;
}

export interface BulkOutcome<T> {
	item: BulkItem<T>;
	ok: boolean;
	id: string | null;
	message: string | null;
	reason?: FailureReason;
	/** How many times it was posted. 0 when it never became a payload. */
	attempts: number;
}

export interface BulkReport<T> {
	sent: BulkOutcome<T>[];
	failed: BulkOutcome<T>[];
	/** True when the caller asked to stop partway. */
	cancelled: boolean;
}

export interface AttemptResult {
	ok: boolean;
	id: string | null;
	message: string | null;
	retryable: boolean;
	/** Seconds the server asked us to wait, from Retry-After. */
	retryAfterSeconds?: number;
}

export interface BulkSendOptions<T> {
	items: BulkItem<T>[];
	/**
	 * Turns one item into a sent result. Throwing means the item could not be
	 * turned into a payload at all - a missing image, a bestiary reference with no
	 * bestiary - which is a permanent failure for that item and not a retry.
	 */
	send: (item: BulkItem<T>) => Promise<AttemptResult>;
	/** Injected so tests do not wait. */
	sleep: (ms: number) => Promise<void>;
	/** Called after each item settles, for a progress bar. */
	onProgress?: (done: number, total: number, latest: BulkOutcome<T>) => void;
	/** Polled between items; true stops the run and reports what is done so far. */
	isCancelled?: () => boolean;
	/** Attempts per item, including the first. */
	maxAttempts?: number;
	/** Delay before the first retry; doubles each time. */
	baseDelayMs?: number;
	/** Ceiling on the backoff, so a long run cannot stall for minutes. */
	maxDelayMs?: number;
	/** Pause between items, to stay under the server's limiter. */
	throttleMs?: number;
}

const DEFAULTS = {
	maxAttempts: 4,
	baseDelayMs: 1_000,
	maxDelayMs: 30_000,
	throttleMs: 0,
};

/**
 * How long to wait before attempt `attempt` (1-based, so attempt 2 is the first
 * retry).
 *
 * The server's `Retry-After` wins when it sends one: it knows when its window
 * rolls over and we are guessing. Otherwise exponential from `baseDelayMs`,
 * capped - a 709-item run that backed off to four minutes would look hung.
 */
export function backoffDelay(
	attempt: number,
	options: { baseDelayMs: number; maxDelayMs: number },
	retryAfterSeconds?: number,
): number {
	if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
		return Math.min(retryAfterSeconds * 1_000, options.maxDelayMs);
	}
	const exponential = options.baseDelayMs * 2 ** Math.max(0, attempt - 2);
	return Math.min(exponential, options.maxDelayMs);
}

/**
 * Runs the queue in order, one item at a time.
 *
 * Sequential deliberately. Parallelism would buy little against a server that is
 * rate limiting by user anyway, and it would make the progress count jump about
 * and the failure order stop matching the list the user just confirmed. The
 * throttle is the knob that matters.
 */
export async function runBulkSend<T>(options: BulkSendOptions<T>): Promise<BulkReport<T>> {
	const settings = { ...DEFAULTS, ...options };
	const sent: BulkOutcome<T>[] = [];
	const failed: BulkOutcome<T>[] = [];
	let done = 0;

	for (const item of settings.items) {
		if (settings.isCancelled?.()) {
			return { sent, failed, cancelled: true };
		}

		const outcome = await sendOne(item, settings);
		(outcome.ok ? sent : failed).push(outcome);
		done += 1;
		settings.onProgress?.(done, settings.items.length, outcome);

		if (settings.throttleMs > 0 && done < settings.items.length) {
			await settings.sleep(settings.throttleMs);
		}
	}

	return { sent, failed, cancelled: false };
}

async function sendOne<T>(
	item: BulkItem<T>,
	settings: Required<Omit<BulkSendOptions<T>, 'onProgress' | 'isCancelled'>> &
		Pick<BulkSendOptions<T>, 'onProgress' | 'isCancelled'>,
): Promise<BulkOutcome<T>> {
	let attempts = 0;
	let last: AttemptResult | null = null;

	while (attempts < settings.maxAttempts) {
		attempts += 1;

		let result: AttemptResult;
		try {
			result = await settings.send(item);
		} catch (error) {
			// The item never became a payload. Retrying cannot help: the image is
			// still missing, the bestiary is still absent.
			return {
				item,
				ok: false,
				id: null,
				message: error instanceof Error ? error.message : String(error),
				reason: 'unresolvable',
				attempts: attempts - 1,
			};
		}

		if (result.ok) {
			return { item, ok: true, id: result.id, message: null, attempts };
		}

		last = result;
		if (!result.retryable) {
			return {
				item,
				ok: false,
				id: null,
				message: result.message,
				reason: 'refused',
				attempts,
			};
		}

		if (attempts < settings.maxAttempts) {
			await settings.sleep(backoffDelay(attempts + 1, settings, result.retryAfterSeconds));
		}
	}

	return {
		item,
		ok: false,
		id: null,
		message: last?.message ?? null,
		reason: 'exhausted',
		attempts,
	};
}

/** One line summarising a finished run, for a Notice. */
export function describeReport<T>(report: BulkReport<T>): string {
	const parts = [`${report.sent.length} sent`];
	if (report.failed.length > 0) parts.push(`${report.failed.length} failed`);
	if (report.cancelled) parts.push('stopped early');
	return parts.join(', ');
}
