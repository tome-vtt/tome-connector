/**
 * Wraps a bulk run so a second call while the first is still going is refused.
 *
 * The guard is held for as long as `run`'s promise is pending, so `run` must await
 * everything it starts - the confirm modal included - rather than firing the send
 * from a callback and returning. It is released however `run` ends: cancelled,
 * thrown or finished.
 */
export function oneAtATime<A extends unknown[]>(
	run: (...args: A) => Promise<void>,
	onBusy: () => void,
): (...args: A) => Promise<void> {
	let running = false;
	return async (...args) => {
		if (running) {
			onBusy();
			return;
		}
		running = true;
		try {
			await run(...args);
		} finally {
			running = false;
		}
	};
}
