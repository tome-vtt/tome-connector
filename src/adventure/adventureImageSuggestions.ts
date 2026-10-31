import type { AdventurePlan } from './adventurePlan';

/** Run once before review; unreadable images keep their original suggestion. */
export async function suggestMapsBySize(
	plan: AdventurePlan,
	readSize: (path: string) => Promise<{ width: number; height: number }>,
	onProgress?: (done: number, total: number) => void,
): Promise<void> {
	for (const [index, image] of plan.images.entries()) {
		onProgress?.(index + 1, plan.images.length);
		if (image.destinationForced || image.suggested.to !== 'Prop') continue;
		try {
			const { width, height } = await readSize(image.dmPath);
			// ponytail: size is only a guess; use richer signals if review corrections warrant it.
			if (width >= 1000 && height >= 600 && width > height) {
				image.suggested = { to: 'Map' };
				image.chosen = { to: 'Map' };
			}
		} catch {
			// Missing or unsupported pictures must not prevent reviewing the adventure.
		}
	}
}
