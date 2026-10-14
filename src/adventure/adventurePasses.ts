import { type BulkItem, type BulkReport, runBulkSend, THROTTLE_MS } from '../bulkSend';
import type { Note } from '../recognizers/note';
import { findSendables, type Sendable, type YamlParser } from '../recognizers/noteScan';
import { sendToTome, type Destination, type ModuleSendable, type SendPorts } from '../sendModule';
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

/** The rows `entitiesPass` will try to send. Exported so the progress total counts the same rows. */
export const isEntityTarget = (entity: PlannedEntity): boolean =>
	entity.chosen.to !== 'skip' && entity.resolvedId === null;

/** The rows `imagesPass` will try to send. */
export const isImageTarget = (image: PlannedImage): boolean => image.chosen.to === 'Map' || image.chosen.to === 'Prop';

/** Sends each target through the send module, writing the new id back onto its row. */
function runPass<T extends { resolvedId: string | null }>(
	deps: PassDeps,
	targets: T[],
	describe: (row: T) => { label: string; path: string },
	sendableFor: (row: T) => Promise<ModuleSendable>,
	destination: Destination,
	onProgress?: (done: number) => void,
): Promise<BulkReport<T>> {
	const items: BulkItem<T>[] = targets.map((row) => ({ ...describe(row), value: row }));

	return runBulkSend<T>({
		items,
		sleep: deps.sleep,
		throttleMs: THROTTLE_MS,
		onProgress,
		send: async (item) => {
			const result = await sendToTome(deps.ports, await sendableFor(item.value), destination);
			if (result.ok && result.id) item.value.resolvedId = result.id;
			return result;
		},
	});
}

export function entitiesPass(
	deps: PassDeps,
	plan: AdventurePlan,
	destination: Destination,
	onProgress?: (done: number) => void,
): Promise<BulkReport<PlannedEntity>> {
	return runPass(
		deps,
		plan.entities.filter(isEntityTarget),
		(entity) => ({ label: entity.tomeName, path: entity.key }),
		(entity) => sendableForEntity(deps, entity),
		destination,
		onProgress,
	);
}

export function imagesPass(
	deps: PassDeps,
	plan: AdventurePlan,
	destination: Destination,
	onProgress?: (done: number) => void,
): Promise<BulkReport<PlannedImage>> {
	return runPass(
		deps,
		plan.images.filter(isImageTarget),
		(image) => ({ label: image.label, path: image.dmPath }),
		// The GM's choice in the review dialog decides the route and how large the
		// image may stay; the caption (or file name) the dialog shows is its title.
		({ dmPath, label, chosen }) =>
			Promise.resolve({ kind: 'image', path: dmPath, to: chosen.to === 'Map' ? 'map' : 'prop', title: label }),
		destination,
		onProgress,
	);
}
