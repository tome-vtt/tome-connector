import { describe, expect, it } from 'vitest';

import { oneAtATime } from '../src/oneAtATime';

/** A run that stops where a bulk flow waits on its confirm modal, until told to go on. */
function pausedRun() {
	let finish: (outcome: 'confirm' | 'cancel' | 'error') => void = () => {};
	let sent = 0;
	const run = async (): Promise<void> => {
		const outcome = await new Promise<'confirm' | 'cancel' | 'error'>((resolve) => {
			finish = resolve;
		});
		if (outcome === 'error') throw new Error('send failed');
		if (outcome === 'confirm') sent += 1;
	};
	return { run, finish: (outcome: 'confirm' | 'cancel' | 'error') => finish(outcome), sent: () => sent };
}

describe('oneAtATime', () => {
	it('refuses a second run while the first is waiting on confirm or sending', async () => {
		const paused = pausedRun();
		let refusals = 0;
		const guarded = oneAtATime(paused.run, () => {
			refusals += 1;
		});

		const first = guarded();
		await guarded();
		expect(refusals).toBe(1);

		paused.finish('confirm');
		await first;
		expect(paused.sent()).toBe(1);
	});

	it.each(['confirm', 'cancel'] as const)('releases the guard after %s', async (outcome) => {
		const paused = pausedRun();
		let refusals = 0;
		const guarded = oneAtATime(paused.run, () => {
			refusals += 1;
		});

		const first = guarded();
		paused.finish(outcome);
		await first;

		const second = guarded();
		paused.finish(outcome);
		await second;
		expect(refusals).toBe(0);
	});

	it('releases the guard when the run throws, and still reports the error', async () => {
		const paused = pausedRun();
		let refusals = 0;
		const guarded = oneAtATime(paused.run, () => {
			refusals += 1;
		});

		const first = guarded();
		paused.finish('error');
		await expect(first).rejects.toThrow('send failed');

		const second = guarded();
		paused.finish('confirm');
		await second;
		expect(refusals).toBe(0);
		expect(paused.sent()).toBe(1);
	});
});
