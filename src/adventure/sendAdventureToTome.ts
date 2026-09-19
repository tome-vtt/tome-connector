import { App, Notice, TFile, TFolder, parseYaml, requestUrl } from 'obsidian';

import type TomeConnectorPlugin from '../main';
import { type BulkItem, type BulkReport, runBulkSend } from '../bulkSend';
import { oneAtATime } from '../oneAtATime';
import { findSendables, type Sendable } from '../recognizers/noteScan';
import { buildRequest } from '../sendablePayload';
import { MAX_ATTEMPTS, THROTTLE_MS } from '../syncVaultToTome';
import { API_KEY_HEADER_NAME, CAMPAIGN_HEADER_NAME, joinUrl, postJsonToTome } from '../tomeApiClient';
import { loadCampaignChoice, rememberCampaign } from '../tomeCampaigns';
import { getApiKey } from '../tomeConnectorSettings';
import { TomeImageKind } from '../tomeImageDownscale';
import { readImageAsDataUri } from '../tomeImageEmbedding';
import { TomeProgressNotice } from '../tomeProgressNotice';
import { TOME_ROUTES } from '../routes';
import { AdventureReviewModal } from './adventureReviewModal';
import { buildAdventurePlan } from './adventureVault';
import { renderBlockText, type ResolvedEntityLink } from './adventureLinkRewrite';
import { writeAdventureIdsToVault } from './writeAdventureIdsToVault';
import type { AdventurePlan, PlannedBlock, PlannedEntity, PlannedImage } from './adventurePlan';

/**
 * The four passes that turn a reviewed {@link AdventurePlan} into a book in
 * Tome: check what already exists, upload the new creatures, magic items
 * and equipment, upload the new maps and props, then send the whole book in
 * one request with entity mentions rewritten into links.
 *
 * **Only pass 3 failing aborts the run.** A partial pass 1 or 2 leaves some
 * `resolvedId`s null; those mentions simply flatten to plain text in pass 3
 * rather than becoming a link, and the book still comes out whole. Sending
 * the same folder again is what pass 0 exists to make cheap. Pass 3 failing
 * is different - creatures and maps landed but there is no book to find them
 * from - and that is reported as its own case.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
	return chunks;
}

async function postJson<TResponse>(
	baseUrl: string,
	path: string,
	body: unknown,
	apiKey: string,
	campaignId: string,
): Promise<TResponse> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (apiKey) headers[API_KEY_HEADER_NAME] = apiKey;
	headers[CAMPAIGN_HEADER_NAME] = campaignId;

	const response = await requestUrl({
		url: joinUrl(baseUrl, path),
		method: 'POST',
		contentType: 'application/json',
		headers,
		body: JSON.stringify(body),
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Server responded with status ${response.status}.`);
	}
	return JSON.parse(response.text) as TResponse;
}

/** `LibraryLookupService.MaxLookupsPerRequest`. */
const MAX_LOOKUPS_PER_REQUEST = 500;

interface ResolveLinksResponseBody {
	matches: { libraryKind: string; name: string; id: string | null }[];
}

/**
 * Asks the server which of the plan's entities it already holds. Throwing
 * here stops the whole run - proceeding would re-upload everything that
 * already exists.
 */
async function resolveLinksPass(
	baseUrl: string,
	apiKey: string,
	campaignId: string,
	plan: AdventurePlan,
): Promise<void> {
	const candidates = plan.entities.filter((entity) => entity.chosen.to !== 'skip');

	for (const batch of chunk(candidates, MAX_LOOKUPS_PER_REQUEST)) {
		const response = await postJson<ResolveLinksResponseBody>(
			baseUrl,
			TOME_ROUTES.resolveLinks,
			{ lookups: batch.map((entity) => ({ libraryKind: entity.chosen.to, name: entity.tomeName })) },
			apiKey,
			campaignId,
		);

		for (const match of response.matches) {
			if (!match.id) continue;
			for (const entity of batch) {
				if (entity.tomeName === match.name && entity.chosen.to === match.libraryKind) {
					entity.resolvedId = match.id;
				}
			}
		}
	}
}

/** The one sendable in a target note that matches what the row was chosen to become. */
async function sendableForEntity(app: App, entity: PlannedEntity): Promise<Sendable> {
	const file = app.vault.getAbstractFileByPath(entity.key);
	if (!(file instanceof TFile)) {
		throw new Error(`"${entity.key}" no longer exists in the vault.`);
	}

	const content = await app.vault.cachedRead(file);
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	const wanted =
		entity.chosen.to === 'NonPlayerCharacter'
			? 'creature'
			: entity.chosen.to === 'MagicItem'
				? 'magicItem'
				: 'equipmentItem';
	const found = findSendables({ path: file.path, content, frontmatter }, parseYaml).find(
		(sendable) => sendable.kind === wanted,
	);

	if (!found) {
		const noun = wanted === 'creature' ? 'statblock' : wanted === 'magicItem' ? 'magic item' : 'equipment';
		throw new Error(`No ${noun} was found in "${entity.key}".`);
	}
	return found;
}

async function entitiesPass(
	plugin: TomeConnectorPlugin,
	plan: AdventurePlan,
	apiKey: string,
	campaignId: string,
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
		sleep,
		throttleMs: THROTTLE_MS,
		maxAttempts: MAX_ATTEMPTS,
		onProgress: onProgress ? (done) => onProgress(done) : undefined,
		send: async (item) => {
			const sendable = await sendableForEntity(plugin.app, item.value);
			const request = await buildRequest(
				plugin.app,
				sendable,
				plugin.settings.downscaleImages,
			);
			const result = await postJsonToTome(
				plugin.settings.baseUrl,
				request.path,
				request.body,
				apiKey,
				campaignId,
			);
			if (result.ok && result.id) item.value.resolvedId = result.id;
			return { ok: result.ok, id: result.id, message: result.message, retryable: result.retryable };
		},
	});
}

async function imagesPass(
	plugin: TomeConnectorPlugin,
	plan: AdventurePlan,
	apiKey: string,
	campaignId: string,
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
		sleep,
		throttleMs: THROTTLE_MS,
		maxAttempts: MAX_ATTEMPTS,
		onProgress: onProgress ? (done) => onProgress(done) : undefined,
		send: async (item) => {
			// The GM's choice in the review dialog decides both where the image goes and
			// how large it is allowed to stay, so the two are read off it together
			// rather than one being re-derived from the route later.
			const toMap = item.value.chosen.to === 'Map';
			const route = toMap ? TOME_ROUTES.addMap : TOME_ROUTES.addProp;
			const kind: TomeImageKind = toMap ? 'map' : 'token';
			const body = JSON.stringify({
				title: item.value.label,
				image: await readImageAsDataUri(
					plugin.app,
					item.value.dmPath,
					kind,
					plugin.settings.downscaleImages,
				),
			});
			const result = await postJsonToTome(
				plugin.settings.baseUrl,
				route,
				body,
				apiKey,
				campaignId,
			);
			if (result.ok && result.id) item.value.resolvedId = result.id;
			return { ok: result.ok, id: result.id, message: result.message, retryable: result.retryable };
		},
	});
}

/** The `Entity`-kind library and id a resolved row sends as - never sent itself, only a link target. */
function resolvedLinksByKey(plan: AdventurePlan): Map<string, ResolvedEntityLink> {
	const resolved = new Map<string, ResolvedEntityLink>();
	for (const entity of plan.entities) {
		if (entity.chosen.to === 'skip' || entity.resolvedId === null) continue;
		resolved.set(entity.key, { libraryKind: entity.chosen.to, id: entity.resolvedId });
	}
	return resolved;
}

interface BlockDto {
	kind: string;
	text: string | null;
	libraryKind: string | null;
	itemId: string | null;
	mapStateId: string | null;
	note: string | null;
	audience: string;
}

/**
 * One block as the server wants it, or null when there is nothing to send.
 *
 * A node is dropped rather than sent whenever the row behind it did not
 * land - skipped in the review dialog, or failed on the way up. The server
 * refuses an `Entity` block with no `ItemId`, and rightly: a node pointing
 * at nothing is worse in the scene than no node at all.
 */
function toBlockDto(
	block: PlannedBlock,
	plan: AdventurePlan,
	resolved: Map<string, ResolvedEntityLink>,
	skippedImages: ReadonlySet<string>,
): BlockDto | null {
	if (block.kind !== 'Entity') {
		return {
			kind: block.kind,
			text: renderBlockText(block.text, block.refs, block.imageRefs, resolved, skippedImages),
			libraryKind: null,
			itemId: null,
			mapStateId: null,
			note: null,
			audience: block.audience,
		};
	}

	const row =
		block.from === 'image'
			? plan.images.find((image) => image.key === block.key)
			: plan.entities.find((entity) => entity.key === block.key);

	if (!row || row.chosen.to === 'skip' || row.resolvedId === null) return null;

	return {
		kind: 'Entity',
		text: null,
		libraryKind: row.chosen.to,
		itemId: row.resolvedId,
		mapStateId: null,
		note: block.note,
		audience: block.audience,
	};
}

/**
 * The one place a cover's bytes are actually read - everything before this
 * (the default pick in adventureCover.ts, a change in AdventureReviewModal)
 * only ever moves `plan.coverKey` around, which is free. `null` covers both
 * "no cover chosen" and "the key no longer resolves", so a stale pick left
 * over from a plan mutated after the modal closed degrades to no cover
 * rather than throwing.
 */
async function resolveCoverDataUri(
	app: App,
	plan: AdventurePlan,
	downscale: boolean,
): Promise<string | null> {
	const cover = plan.images.find((image) => image.key === plan.coverKey);
	return cover ? readImageAsDataUri(app, cover.dmPath, 'cover', downscale) : null;
}

async function buildImportRequest(
	app: App,
	plan: AdventurePlan,
	downscale: boolean,
): Promise<unknown> {
	const resolved = resolvedLinksByKey(plan);
	const skippedImages = new Set(
		plan.images.filter((image) => image.chosen.to === 'skip').map((image) => image.key),
	);
	const cover = await resolveCoverDataUri(app, plan, downscale);

	return {
		title: plan.title,
		summary: plan.summary,
		cover,
		chapters: plan.chapters.map((chapter) => ({
			title: chapter.title,
			id: chapter.id,
			scenes: chapter.scenes.map((scene) => ({
				title: scene.title,
				id: scene.id,
				blocks: scene.blocks
					.map((block) => toBlockDto(block, plan, resolved, skippedImages))
					.filter((block): block is BlockDto => block !== null),
			})),
		})),
	};
}

export interface ImportedSceneResultBody {
	id: string;
}

export interface ImportedChapterResultBody {
	id: string;
	scenes: ImportedSceneResultBody[];
}

interface ImportAdventureResponseBody {
	id: string;
	created: boolean;
	chaptersCreated: number;
	chaptersMatched: number;
	scenesCreated: number;
	scenesMatched: number;
	blocksWritten: number;
	untouchedChapters: string[];
	untouchedScenes: string[];
	chapters: ImportedChapterResultBody[];
}

function reportImport(plan: AdventurePlan, response: ImportAdventureResponseBody, failures: number): void {
	const parts = [
		`${response.chaptersCreated + response.chaptersMatched} chapters`,
		`${response.scenesCreated + response.scenesMatched} scenes`,
		`${response.blocksWritten} blocks`,
	];
	const failureNote = failures > 0 ? ` ${failures} item${failures === 1 ? '' : 's'} failed - see the console.` : '';
	new Notice(`Tome connector: "${plan.title}" sent - ${parts.join(', ')}.${failureNote}`);
}

/** How many rows `entitiesPass`/`imagesPass` will actually try to send - the same filters each uses internally. */
function countRemainingTargets(plan: AdventurePlan): { entities: number; images: number } {
	return {
		entities: plan.entities.filter((entity) => entity.chosen.to !== 'skip' && entity.resolvedId === null).length,
		images: plan.images.filter((image) => image.chosen.to === 'Map' || image.chosen.to === 'Prop').length,
	};
}

/**
 * Runs all four passes. `plan` is mutated throughout - `resolvedId` on each
 * entity and image fills in as it goes - so a caller inspecting `plan`
 * afterward sees exactly what landed.
 *
 * **One bar for the whole run, not one per pass.** Only pass 0 (checking
 * what already exists) has no per-item count worth showing - everything
 * after it does, so the total is fixed once pass 0 finishes (entity and
 * image targets, plus one more step for writing the book itself) and the
 * bar only ever moves forward from there, the same shape `syncFolderToTome`
 * uses for its stages that don't each have their own count.
 */
async function resolveAdventureLinks(
	baseUrl: string,
	apiKey: string,
	campaignId: string,
	plan: AdventurePlan,
	notice: TomeProgressNotice,
): Promise<boolean> {
	try {
		await resolveLinksPass(baseUrl, apiKey, campaignId, plan);
		return true;
	} catch (error) {
		notice.hide();
		new Notice(`Tome connector: could not check what Tome already has - nothing was sent. ${describeError(error)}`);
		return false;
	}
}

function reportAdventureFailures(
	entityReport: BulkReport<PlannedEntity>,
	imageReport: BulkReport<PlannedImage>,
): number {
	const failureCount = entityReport.failed.length + imageReport.failed.length;
	if (failureCount > 0) {
		console.warn('Tome Connector: adventure import had failures', {
			entities: entityReport.failed,
			images: imageReport.failed,
		});
	}
	return failureCount;
}

export async function runAdventureImport(
	plugin: TomeConnectorPlugin,
	plan: AdventurePlan,
	campaignId: string,
): Promise<void> {
	const apiKey = getApiKey(plugin);
	const baseUrl = plugin.settings.baseUrl;
	const notice = new TomeProgressNotice(`Tome connector: checking what Tome already has for "${plan.title}"…`);
	if (!(await resolveAdventureLinks(baseUrl, apiKey, campaignId, plan, notice))) return;

	const targets = countRemainingTargets(plan);
	const totalSteps = targets.entities + targets.images + 1;
	notice.setProgress(0, totalSteps);

	notice.setMessage(`Tome connector: sending "${plan.title}" - uploading creatures, magic items and equipment…`);
	const entityReport = await entitiesPass(plugin, plan, apiKey, campaignId, (done) => notice.setProgress(done, totalSteps));

	notice.setMessage(`Tome connector: sending "${plan.title}" - uploading maps and props…`);
	const imageReport = await imagesPass(plugin, plan, apiKey, campaignId, (done) => notice.setProgress(targets.entities + done, totalSteps));

	notice.setMessage(`Tome connector: sending "${plan.title}" - writing the book…`);
	notice.setProgress(targets.entities + targets.images, totalSteps);
	let response: ImportAdventureResponseBody;
	try {
		const request = await buildImportRequest(plugin.app, plan, plugin.settings.downscaleImages);
		response = await postJson<ImportAdventureResponseBody>(
			baseUrl,
			TOME_ROUTES.importAdventure,
			request,
			apiKey,
			campaignId,
		);
	} catch (error) {
		notice.hide();
		new Notice(
			`Tome connector: creatures and maps were sent, but "${plan.title}" itself was not. ` +
				`Sending "${plan.folder}" again is safe. ${describeError(error)}`,
		);
		return;
	}

	notice.setProgress(totalSteps, totalSteps);
	notice.hide();
	const failureCount = reportAdventureFailures(entityReport, imageReport);

	// Best-effort and after the fact: a note that fails to write its id is no worse off
	// than before this existed, so nothing here is allowed to turn a successful import
	// into a failed one.
	try {
		await writeAdventureIdsToVault(plugin.app, plan, response.chapters);
	} catch (error) {
		console.warn('Tome Connector: could not write ids back into the vault.', error);
	}

	reportImport(plan, response, failureCount);
}

/**
 * Parses `folder`, opens the review dialog, and runs the four passes if the
 * user presses Send. The entry point every command and menu item calls.
 * One at a time, from the parse through the last pass.
 */
export const runAdventureFolderImport = oneAtATime(
	async (plugin: TomeConnectorPlugin, folder: TFolder): Promise<void> => {
		const choice = await loadCampaignChoice(plugin);
		if (choice === null) return;

		const notice = new TomeProgressNotice(`Tome connector: reading "${folder.name}"…`);
		let plan: AdventurePlan;
		try {
			plan = await buildAdventurePlan(plugin.app, folder, (done, total) => notice.setProgress(done, total));
		} catch (error) {
			new Notice(`Tome connector: ${describeError(error)}`);
			return;
		} finally {
			notice.hide();
		}

		// Awaited, not fired from the callback: the guard has to hold through the send.
		const campaignId = await new Promise<string | null>((resolve) => {
			new AdventureReviewModal(plugin.app, plan, choice, resolve).open();
		});
		if (campaignId === null) return;

		void rememberCampaign(plugin, campaignId);
		await runAdventureImport(plugin, plan, campaignId);
	},
	() => new Notice('Tome connector: an adventure import is already running.'),
);
