import { Modal, Notice, TFile, TFolder, getAllTags, parseYaml } from 'obsidian';
import type { App } from 'obsidian';

import type TomeConnectorPlugin from './main';
import { describeReport, runBulkSend, type BulkItem, type BulkReport } from './bulkSend';
import { oneAtATime } from './oneAtATime';
import { findSendables, summarise, type Sendable, type SendableKind } from './recognizers/noteScan';
import { sendSendable } from './sendablePayload';
import { loadCampaignChoice, rememberCampaign, renderCampaignSelector, type CampaignChoice } from './tomeCampaigns';
import { getApiKey } from './tomeConnectorSettings';
import { TomeProgressNotice } from './tomeProgressNotice';

/**
 * Scanning a folder or the whole vault and sending everything found.
 *
 * Until now the only way to move anything was clicking a button on one rendered
 * block, which does not scale to a converted compendium. The policy — pacing,
 * retries, what counts as a failure — lives in `bulkSend.ts` and is tested there;
 * this file walks the vault, asks, and reports.
 */

/**
 * Milliseconds between items.
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

export type SyncScope =
	| { kind: 'folder'; folder: TFolder }
	| { kind: 'vault' }
	| { kind: 'tag'; tag: string };

export function describeScope(scope: SyncScope): string {
	switch (scope.kind) {
		case 'folder':
			return `"${scope.folder.name}"`;
		case 'vault':
			return 'this vault';
		case 'tag':
			return scope.tag;
	}
}

export function filesInScope(app: App, scope: SyncScope): TFile[] {
	const all = app.vault.getMarkdownFiles();

	switch (scope.kind) {
		case 'vault':
			return all;
		case 'folder': {
			// `startsWith` on the folder path plus a separator, so `Maps` does not
			// also collect `Maps Archive`.
			const prefix = `${scope.folder.path}/`;
			return all.filter((file) => file.path === scope.folder.path || file.path.startsWith(prefix));
		}
		case 'tag': {
			const wanted = scope.tag.startsWith('#') ? scope.tag : `#${scope.tag}`;
			return all.filter((file) => {
				const cache = app.metadataCache.getFileCache(file);
				return cache ? (getAllTags(cache) ?? []).includes(wanted) : false;
			});
		}
	}
}

/**
 * Reads every note in scope and collects what could be sent.
 *
 * `cachedRead` rather than `read`: this touches every markdown file in the vault
 * on the widest scope, and the cache is what keeps that from being a few thousand
 * disk reads.
 */
async function scan(app: App, scope: SyncScope, onProgress?: (done: number, total: number) => void): Promise<Sendable[]> {
	const found: Sendable[] = [];
	const files = filesInScope(app, scope);

	for (const [index, file] of files.entries()) {
		const content = await app.vault.cachedRead(file);
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? null;
		found.push(...findSendables({ path: file.path, content, frontmatter }, parseYaml));
		onProgress?.(index + 1, files.length);
	}

	return found;
}

const KIND_NOUNS: Record<SendableKind, [string, string]> = {
	creature: ['creature', 'creatures'],
	encounter: ['encounter', 'encounters'],
	map: ['map', 'maps'],
	magicItem: ['magic item', 'magic items'],
	equipmentItem: ['piece of equipment', 'pieces of equipment'],
	spell: ['spell', 'spells'],
};

/**
 * Shows what the scan found and waits for a yes.
 *
 * Nothing is sent before this. A vault-wide scan that started uploading on the
 * command is how somebody ends up with seven hundred creatures in a campaign they
 * were only poking at, and no way to take them back out in one go.
 */
class ConfirmSyncModal extends Modal {
	private confirmed = false;
	private campaignId: string;

	constructor(
		app: App,
		private readonly sendables: Sendable[],
		// Not `scope`: Modal already has one, for hotkeys.
		private readonly syncScope: SyncScope,
		private readonly choice: CampaignChoice,
		/** The chosen campaign on Send, null on Cancel or Close. */
		private readonly onDone: (campaignId: string | null) => void,
	) {
		super(app);
		this.campaignId = choice.campaignId;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Send to Tome' });
		renderCampaignSelector(contentEl, this.choice, (campaignId) => {
			this.campaignId = campaignId;
		});

		const counts = summarise(this.sendables);
		const lines = (Object.entries(counts) as [SendableKind, number][])
			.filter(([, count]) => count > 0)
			.map(([kind, count]) => `${count} ${KIND_NOUNS[kind][count === 1 ? 0 : 1]}`);

		if (lines.length === 0) {
			contentEl.createEl('p', {
				text: `Nothing to send in ${describeScope(this.syncScope)}.`,
			});
			contentEl.createEl('p', {
				cls: 'tome-connector-sync-hint',
				text:
					'Looked for statblock, encounter, leaflet and zoommap blocks, notes whose ' +
					'frontmatter declares a statblock, plus equipment, magic-item, and spell notes.',
			});
			this.addButtons(contentEl, false);
			return;
		}

		contentEl.createEl('p', {
			text: `Found ${lines.join(', ')} in ${describeScope(this.syncScope)}.`,
		});
		contentEl.createEl('p', {
			cls: 'tome-connector-sync-hint',
			text:
				'Anything already sent from these notes will be updated rather than duplicated. ' +
				'This can take a while for a large folder.',
		});

		this.addButtons(contentEl, true);
	}

	private addButtons(contentEl: HTMLElement, canSend: boolean): void {
		const buttons = contentEl.createDiv({ cls: 'tome-connector-sync-buttons' });

		buttons.createEl('button', { text: canSend ? 'Cancel' : 'Close' }).addEventListener(
			'click',
			() => this.close(),
		);

		if (!canSend) return;

		const send = buttons.createEl('button', { text: 'Send', cls: 'mod-cta' });
		send.addEventListener('click', () => {
			this.confirmed = true;
			this.close();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onDone(this.confirmed ? this.campaignId : null);
	}
}

/** A live count while the run is going, and somewhere to press stop. */
class SyncProgressModal extends Modal {
	private cancelled = false;
	private statusEl: HTMLElement | null = null;
	private barEl: HTMLProgressElement | null = null;

	constructor(
		app: App,
		private readonly total: number,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Sending to Tome' });
		this.statusEl = contentEl.createEl('p', { text: `0 of ${this.total}…` });
		this.barEl = contentEl.createEl('progress', { cls: 'tome-connector-progress-bar' });
		this.barEl.max = this.total;
		this.barEl.value = 0;

		const buttons = contentEl.createDiv({ cls: 'tome-connector-sync-buttons' });
		buttons.createEl('button', { text: 'Stop' }).addEventListener('click', () => {
			this.cancelled = true;
			// Left open so the run can finish the item in flight and report; closing
			// here would leave the user watching nothing while it wound down.
			this.statusEl?.setText('Stopping after the current item…');
		});
	}

	update(done: number, latest: string): void {
		if (this.cancelled) return;
		this.statusEl?.setText(`${done} of ${this.total} — ${latest}`);
		if (this.barEl) this.barEl.value = done;
	}

	isCancelled(): boolean {
		return this.cancelled;
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** The failures, so a run over hundreds of notes says which ones need attention. */
class SyncReportModal extends Modal {
	constructor(
		app: App,
		private readonly report: BulkReport<Sendable>,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Sent to Tome' });
		contentEl.createEl('p', { text: describeReport(this.report) });

		if (this.report.failed.length > 0) {
			contentEl.createEl('h4', { text: 'Not sent' });
			const list = contentEl.createEl('ul', { cls: 'tome-connector-sync-failures' });
			for (const failure of this.report.failed) {
				list.createEl('li', {
					text: `${failure.item.label} (${failure.item.path}) — ${failure.message ?? failure.reason ?? 'unknown error'}`,
				});
			}
		}

		contentEl
			.createDiv({ cls: 'tome-connector-sync-buttons' })
			.createEl('button', { text: 'Close', cls: 'mod-cta' })
			.addEventListener('click', () => this.close());
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Scans, asks, sends, reports.
 *
 * Ids are deliberately **not** written back into notes. The single-block buttons
 * do that because they know exactly which fence they came from and the file is
 * open in front of the user; doing it here would mean rewriting hundreds of files
 * a scan only read, and every one of these endpoints upserts on name or title
 * anyway, so a second run updates rather than duplicates.
 */
export const runVaultSync = oneAtATime(
	async (plugin: TomeConnectorPlugin, scope: SyncScope): Promise<void> => {
		const choice = await loadCampaignChoice(plugin);
		if (choice === null) return;

		const notice = new TomeProgressNotice('Tome connector: scanning…');
		let sendables: Sendable[];
		try {
			sendables = await scan(plugin.app, scope, (done, total) => notice.setProgress(done, total));
		} finally {
			notice.hide();
		}

		// Awaited, not fired from the callback: the guard has to hold through the send.
		const campaignId = await new Promise<string | null>((resolve) => {
			new ConfirmSyncModal(plugin.app, sendables, scope, choice, resolve).open();
		});
		if (campaignId === null) return;

		void rememberCampaign(plugin, campaignId);
		await send(plugin, sendables, campaignId);
	},
	() => new Notice('Tome connector: a sync is already running.'),
);

async function send(
	plugin: TomeConnectorPlugin,
	sendables: Sendable[],
	campaignId: string,
): Promise<void> {
	const progress = new SyncProgressModal(plugin.app, sendables.length);
	progress.open();

	const apiKey = getApiKey(plugin);
	const items: BulkItem<Sendable>[] = sendables.map((sendable) => ({
		label: sendable.label,
		path: sendable.path,
		value: sendable,
	}));

	try {
		const report = await runBulkSend<Sendable>({
			items,
			sleep,
			throttleMs: THROTTLE_MS,
			maxAttempts: MAX_ATTEMPTS,
			isCancelled: () => progress.isCancelled(),
			onProgress: (done, _total, latest) => progress.update(done, latest.item.label),
			send: async (item) => {
				// Throwing here is how `runBulkSend` learns an item is unresolvable
				// rather than merely refused, so it does not retry it.
				return sendSendable(
					plugin.app,
					item.value,
					{ baseUrl: plugin.settings.baseUrl, apiKey, campaignId },
					plugin.settings.downscaleImages,
				);
			},
		});

		progress.close();
		new SyncReportModal(plugin.app, report).open();
	} catch (error) {
		progress.close();
		console.error('Tome Connector: bulk sync failed', error);
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Tome connector: ${message}`);
	}
}
