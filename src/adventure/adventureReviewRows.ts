/**
 * The grouping, counting and bulk-apply logic behind the adventure review
 * dialog.
 *
 * Kept apart from `adventureReviewModal.ts` so it can be unit-tested:
 * `Modal` is DOM-only and cannot be reached from vitest, but nothing here
 * touches the DOM. A row's choice reaches the uploader by mutating
 * `chosen` in place - that is what keeps the dialog a pure editor and the
 * uploader a pure reader, with no dialog state class and no event plumbing
 * between the two.
 *
 * Pure and `obsidian`-free.
 */

import type {
	AdventurePlan,
	EntityDestination,
	ImageDestination,
	PlannedEntity,
	PlannedImage,
} from './adventurePlan';

/**
 * Order fixes the dialog's reading order too: what to upload first,
 * ending on what nothing will be done with.
 */
export const ENTITY_LABELS: [EntityDestination['to'], string, string][] = [
	['NonPlayerCharacter', 'creature', 'creatures'],
	['MagicItem', 'magic item', 'magic items'],
	['EquipmentItem', 'equipment', 'equipment'],
	['skip', 'not recognised', 'not recognised'],
];

export const IMAGE_LABELS: [ImageDestination['to'], string, string][] = [
	['Map', 'battlemap', 'battlemaps'],
	['Prop', 'illustration or prop', 'illustrations and props'],
	['skip', 'skipped', 'skipped'],
];

/** Buckets items by keyOf (the dialog passes what the parser suggested, not what a row's been changed to), in labels order, omitting empty buckets. */
export function groupBy<T, K extends string>(items: T[], keyOf: (item: T) => K, labels: [K, string, string][]): { key: K; label: string; items: T[] }[] {
	const buckets = new Map<K, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const list = buckets.get(key);
		if (list) list.push(item);
		else buckets.set(key, [item]);
	}
	return labels.filter(([key]) => buckets.has(key)).map(([key, singular, plural]) => ({
		key,
		label: buckets.get(key)?.length === 1 ? singular : plural,
		items: buckets.get(key) ?? [],
	}));
}

/** Mutates every item in the group - what a group header's set-all control calls. */
export function setAll<T extends { chosen: D }, D>(items: T[], to: D): void {
	for (const item of items) item.chosen = to;
}

function countBy<T>(items: T[], to: string, of: (item: T) => string): number {
	return items.filter((item) => of(item) === to).length;
}

function noun(count: number, singular: string, plural: string): string | null {
	return count > 0 ? `${count} ${count === 1 ? singular : plural}` : null;
}

/** `This will create 186 creatures, 12 maps and 1 adventure.` */
export function summariseImport(plan: AdventurePlan): string {
	const entityOf = (entity: PlannedEntity): string => entity.chosen.to;
	const imageOf = (image: PlannedImage): string => image.chosen.to;

	const parts = [
		noun(countBy(plan.entities, 'NonPlayerCharacter', entityOf), 'creature', 'creatures'),
		noun(countBy(plan.entities, 'MagicItem', entityOf), 'magic item', 'magic items'),
		noun(countBy(plan.entities, 'EquipmentItem', entityOf), 'piece of equipment', 'pieces of equipment'),
		noun(countBy(plan.images, 'Map', imageOf), 'map', 'maps'),
		noun(countBy(plan.images, 'Prop', imageOf), 'prop', 'props'),
	].filter((part): part is string => part !== null);

	parts.push('1 adventure');
	return `This will create ${parts.join(', ')}.`;
}
