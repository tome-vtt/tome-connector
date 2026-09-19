import { type BulkItem, type BulkReport, MAX_ATTEMPTS, runBulkSend, THROTTLE_MS } from '../bulkSend';
import type { Note } from '../recognizers/note';
import { findSendables, type Sendable, type YamlParser } from '../recognizers/noteScan';
import { sendToTome, type Destination, type SendPorts } from '../sendModule';
import type { AdventurePlan, PlannedEntity, PlannedImage } from './adventurePlan';

/**
 * The adventure import's upload passes: the creatures, magic items and equipment
 * it references, then its maps and props. Each row goes through the send module,
 * so it is the same request a block button, the bulk sync or the image menu would
 * send for that note or image; all a pass adds is which rows, and the `resolvedId`
 * it writes back onto the plan for the book to link to.
 *
 * Kept free of `obsidian` so `tests/adventurePasses.test.ts` runs both passes over
 * the in-memory adapter.
 */
export interface PassDeps {
	ports: SendPorts;
	readNote: (path: string) => Promise<Note>;
	parseYaml: YamlParser;
	/** Injected so tests do not wait. */
	sleep: (ms: number) => Promise<void>;
}

/** The one sendable in a target note that matches what the row was chosen to become. */
async function sendableForEntity(deps: PassDeps, entity: PlannedEntity): Promise<Sendable> {
	const note = await deps.readNote(entity.key);
	const wanted =
		entity.chosen.to === 'NonPlayerCharacter'
			? 'creature'
			: entity.chosen.to === 'MagicItem'
				? 'magicItem'
				: 'equipmentItem';
	const found = findSendables(note, deps.parseYaml).find((sendable) => sendable.kind === wanted);

	if (!found) {
		const noun = wanted === 'creature' ? 'statblock' : wanted === 'magicItem' ? 'magic item' : 'equipment';
		throw new Error(`No ${noun} was found in "${entity.key}".`);
	}
	return found;
}

export function entitiesPass(
	deps: PassDeps,
	plan: AdventurePlan,
	destination: Destination,
	onProgress?: (done: number) => void,
): Promise<BulkReport<PlannedEntity>> {
	const targets = plan.entities.filter((entity) => entity.chosen.to !== 'skip' && entity.resolvedId === null);
	const items: BulkItem<PlannedEntity>[] = targets.map((entity) => ({
		label: entity.tomeName,
		path: entity.key,
		value: entity,
	}));

	return runBulkSend<PlannedEntity>({
		items,
		sleep: deps.sleep,
		throttleMs: THROTTLE_MS,
		maxAttempts: MAX_ATTEMPTS,
		onProgress,
		send: async (item) => {
			const result = await sendToTome(deps.ports, await sendableForEntity(deps, item.value), destination);
			if (result.ok && result.id) item.value.resolvedId = result.id;
			return result;
		},
	});
}

export function imagesPass(
	deps: PassDeps,
	plan: AdventurePlan,
	destination: Destination,
	onProgress?: (done: number) => void,
): Promise<BulkReport<PlannedImage>> {
	const targets = plan.images.filter((image) => image.chosen.to === 'Map' || image.chosen.to === 'Prop');
	const items: BulkItem<PlannedImage>[] = targets.map((image) => ({
		label: image.label,
		path: image.dmPath,
		value: image,
	}));

	return runBulkSend<PlannedImage>({
		items,
		sleep: deps.sleep,
		throttleMs: THROTTLE_MS,
		maxAttempts: MAX_ATTEMPTS,
		onProgress,
		send: async (item) => {
			// The GM's choice in the review dialog decides the route and how large the
			// image may stay; the caption (or file name) the dialog shows is its title.
			const { dmPath, label, chosen } = item.value;
			const to = chosen.to === 'Map' ? 'map' : 'prop';
			const result = await sendToTome(deps.ports, { kind: 'image', path: dmPath, to, title: label }, destination);
			if (result.ok && result.id) item.value.resolvedId = result.id;
			return result;
		},
	});
}
