import { describe, expect, it, vi } from 'vitest';

import {
	backoffDelay,
	describeReport,
	runBulkSend,
	type AttemptResult,
	type BulkItem
} from '../src/bulkSend';

/**
 * The failure modes here only appear at scale - a run of 709 creatures meeting
 * the server's rate limit is not something anybody reproduces by hand - so the
 * policy is pure and the clock is injected. `sleep` records what it was asked to
 * wait rather than waiting, which is also how the backoff is asserted.
 */

const ok = (id = 'new-id'): AttemptResult => ({ ok: true, id, message: null, retryable: false });
const rateLimited = (retryAfterSeconds?: number): AttemptResult => ({
	ok: false,
	id: null,
	message: 'Too many requests',
	retryable: true,
	...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
});
const refused = (message: string): AttemptResult => ({
	ok: false,
	id: null,
	message,
	retryable: false
});

function items(...labels: string[]): BulkItem<string>[] {
	return labels.map((label) => ({ label, path: `${label}.md`, value: label }));
}

/** Collects the delays asked for instead of waiting them. */
function fakeClock() {
	const waited: number[] = [];
	return {
		waited,
		sleep: (ms: number) => {
			waited.push(ms);
			return Promise.resolve();
		}
	};
}

describe('backoffDelay', () => {
	it('doubles from the base', () => {
		expect(backoffDelay(2)).toBe(1_000);
		expect(backoffDelay(3)).toBe(2_000);
		expect(backoffDelay(4)).toBe(4_000);
	});

	it('is capped, so a long run cannot stall for minutes', () => {
		expect(backoffDelay(20)).toBe(30_000);
	});

	/** The server knows when its window rolls over; we are guessing. */
	it('prefers the server\'s Retry-After', () => {
		expect(backoffDelay(2, 5)).toBe(5_000);
	});

	it('still caps an unreasonable Retry-After', () => {
		expect(backoffDelay(2, 600)).toBe(30_000);
	});

	it('treats Retry-After: 0 as now rather than falling back to exponential', () => {
		expect(backoffDelay(3, 0)).toBe(0);
	});
});

describe('runBulkSend', () => {
	it('sends everything and reports it', async () => {
		const clock = fakeClock();
		const report = await runBulkSend({
			items: items('Goblin', 'Bugbear'),
			send: () => Promise.resolve(ok()),
			sleep: clock.sleep
		});

		expect(report.sent.map((o) => o.item.label)).toEqual(['Goblin', 'Bugbear']);
		expect(report.failed).toEqual([]);
		expect(report.cancelled).toBe(false);
	});

	it('keeps going after one item fails', async () => {
		const send = vi
			.fn<() => Promise<AttemptResult>>()
			.mockResolvedValueOnce(refused('Name already taken'))
			.mockResolvedValue(ok());

		const report = await runBulkSend({
			items: items('Goblin', 'Bugbear'),
			send,
			sleep: fakeClock().sleep
		});

		expect(report.sent).toHaveLength(1);
		expect(report.failed).toHaveLength(1);
		expect(report.failed[0]?.message).toBe('Name already taken');
		expect(report.failed[0]?.reason).toBe('refused');
	});

	/** A 402 over a plan limit will still be a 402 next time. */
	it('does not retry a refusal', async () => {
		const send = vi.fn<() => Promise<AttemptResult>>().mockResolvedValue(refused('Plan limit'));

		await runBulkSend({ items: items('Goblin'), send, sleep: fakeClock().sleep });

		expect(send).toHaveBeenCalledTimes(1);
	});

	it('retries a rate limit and succeeds', async () => {
		const clock = fakeClock();
		const send = vi
			.fn<() => Promise<AttemptResult>>()
			.mockResolvedValueOnce(rateLimited())
			.mockResolvedValueOnce(rateLimited())
			.mockResolvedValue(ok());

		const report = await runBulkSend({ items: items('Goblin'), send, sleep: clock.sleep });

		expect(report.sent).toHaveLength(1);
		expect(report.sent[0]?.attempts).toBe(3);
		expect(clock.waited).toEqual([1_000, 2_000]);
	});

	it('honours Retry-After when the server sends one', async () => {
		const clock = fakeClock();
		const send = vi
			.fn<() => Promise<AttemptResult>>()
			.mockResolvedValueOnce(rateLimited(7))
			.mockResolvedValue(ok());

		await runBulkSend({ items: items('Goblin'), send, sleep: clock.sleep });

		expect(clock.waited).toEqual([7_000]);
	});

	it('gives up after maxAttempts and says so', async () => {
		const send = vi.fn<() => Promise<AttemptResult>>().mockResolvedValue(rateLimited());

		const report = await runBulkSend({
			items: items('Goblin'),
			send,
			sleep: fakeClock().sleep,
			maxAttempts: 3
		});

		expect(send).toHaveBeenCalledTimes(3);
		expect(report.failed[0]?.reason).toBe('exhausted');
		expect(report.failed[0]?.attempts).toBe(3);
	});

	/**
	 * A missing image or an absent bestiary is permanent for that item. Retrying
	 * it three times just makes a long run longer and the log more confusing.
	 */
	it('does not retry an item that cannot be turned into a payload', async () => {
		const send = vi
			.fn<() => Promise<AttemptResult>>()
			.mockRejectedValue(new Error('Image not found: Maps/Keep.jpg'));

		const report = await runBulkSend({ items: items('Keep'), send, sleep: fakeClock().sleep });

		expect(send).toHaveBeenCalledTimes(1);
		expect(report.failed[0]?.reason).toBe('unresolvable');
		expect(report.failed[0]?.message).toContain('Maps/Keep.jpg');
		expect(report.failed[0]?.attempts).toBe(0);
	});

	it('throttles between items but not after the last', async () => {
		const clock = fakeClock();

		await runBulkSend({
			items: items('A', 'B', 'C'),
			send: () => Promise.resolve(ok()),
			sleep: clock.sleep,
			throttleMs: 100
		});

		expect(clock.waited).toEqual([100, 100]);
	});

	it('reports progress as it goes', async () => {
		const seen: [number, number][] = [];

		await runBulkSend({
			items: items('A', 'B'),
			send: () => Promise.resolve(ok()),
			sleep: fakeClock().sleep,
			onProgress: (doneCount, total) => seen.push([doneCount, total])
		});

		expect(seen).toEqual([
			[1, 2],
			[2, 2]
		]);
	});

	it('stops when cancelled and keeps what already went', async () => {
		const send = vi.fn<() => Promise<AttemptResult>>().mockResolvedValue(ok());
		let calls = 0;

		const report = await runBulkSend({
			items: items('A', 'B', 'C'),
			send,
			sleep: fakeClock().sleep,
			isCancelled: () => ++calls > 2
		});

		expect(report.cancelled).toBe(true);
		expect(report.sent).toHaveLength(2);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('carries the returned id back, for writing into the note', async () => {
		const report = await runBulkSend({
			items: items('Goblin'),
			send: () => Promise.resolve(ok('abc-123')),
			sleep: fakeClock().sleep
		});

		expect(report.sent[0]?.id).toBe('abc-123');
	});
});

describe('describeReport', () => {
	it.each([
		[{ sent: [1], failed: [], cancelled: false }, '1 sent'],
		[{ sent: [1, 2], failed: [3], cancelled: false }, '2 sent, 1 failed'],
		[{ sent: [1], failed: [], cancelled: true }, '1 sent, stopped early'],
		[{ sent: [], failed: [], cancelled: false }, '0 sent']
	])('%o -> %s', (report, expected) => {
		expect(describeReport(report as never)).toBe(expected);
	});
});
