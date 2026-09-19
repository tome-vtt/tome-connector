import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';

import type TomeConnectorPlugin from './main';
import {
	assemblePackage,
	describeCounts,
	isEmpty,
	packageKeyFrom,
	type AssembleOptions,
	type PackageReport,
	type ScannedNote,
} from './recognizers/compendium/package';
import {
	buildImportRequest,
	IMPORT_PATH,
	validateManifest,
	type ImportManifest,
} from './recognizers/compendium/importRequest';
import { oneAtATime } from './oneAtATime';
import { describeScope, filesInScope, type SyncScope } from './syncVaultToTome';
import { createMultipartBoundary } from './tomeMultipartBody';
import { postMultipartToTome } from './tomeApiClient';
import { getApiKey } from './tomeConnectorSettings';
import { TomeProgressNotice } from './tomeProgressNotice';

/**
 * Importing a `ttrpg-convert-cli` compendium as a content source.
 *
 * The sibling of `syncVaultToTome`, and deliberately not the same thing. That one
 * sends N notes as N requests, because a creature is a row in a library. This
 * sends one request: species, backgrounds, feats and spells are not rows, they are
 * *a ruleset*, and the server takes them as a single package it can switch on and
 * off for a campaign.
 *
 * The parsing, the assembly and the licence reading are all in
 * `recognizers/compendium/`, tested against the real corpus. This file scans,
 * asks, posts and reports.
 */

/** Import on a yes, reassemble on a toggle, null on Cancel or Close. */
type ImportAnswer = { manifest: ImportManifest } | { options: AssembleOptions } | null;

/**
 * Reads every note in scope.
 *
 * `cachedRead` for the same reason the bulk sync uses it: the widest scope touches
 * every markdown file in the vault, and the cache is what stops that being a few
 * thousand disk reads.
 */
async function readScope(
	app: App,
	scope: SyncScope,
	onProgress?: (done: number, total: number) => void,
): Promise<ScannedNote[]> {
	const notes: ScannedNote[] = [];
	const files = filesInScope(app, scope);

	for (const [index, file] of files.entries()) {
		notes.push({
			path: file.path,
			content: await app.vault.cachedRead(file),
			frontmatter: app.metadataCache.getFileCache(file)?.frontmatter ?? null,
		});
		onProgress?.(index + 1, files.length);
	}

	return notes;
}

/** A sensible package key from the scope, so the field is rarely edited. */
function suggestedKey(scope: SyncScope): string {
	return packageKeyFrom(
		scope.kind === 'folder' ? scope.folder.name : scope.kind === 'tag' ? scope.tag : '',
	);
}

/**
 * Shows what was found, collects the manifest, and waits for a yes.
 *
 * Nothing is uploaded before this. The counts are the important half: a scan that
 * reports "391 spells" and then imports 388 of them is the failure this whole
 * pipeline is built to make visible, so the unparseable notes are listed here
 * rather than mentioned afterwards.
 */
class ConfirmImportModal extends Modal {
	private confirmed = false;
	/** Set when a toggle closes the dialog to be reassembled under new options. */
	private nextOptions: AssembleOptions | null = null;
	private readonly manifest: ImportManifest;

	constructor(
		app: App,
		private readonly report: PackageReport,
		// Not `scope`: Modal already has one, for hotkeys.
		private readonly importScope: SyncScope,
		/** The options this report was built with, so the toggles show their state. */
		private readonly options: AssembleOptions,
		private readonly onDone: (answer: ImportAnswer) => void,
	) {
		super(app);

		this.manifest = {
			key: suggestedKey(importScope),
			name: importScope.kind === 'folder' ? importScope.folder.name : 'My compendium',
			version: '1.0.0',
			publisher: '',
			// Prefilled only when every note said it is SRD content. Book content
			// arrives blank on purpose - see `suggestedLicense`.
			license: report.suggested.license ?? '',
			attribution: report.suggested.attribution ?? '',
			url: '',
		};
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Import a content source' });

		if (isEmpty(this.report)) {
			this.renderEmpty(contentEl);
			return;
		}

		contentEl.createEl('p', {
			text: `Found ${describeCounts(this.report.counts)} in ${describeScope(this.importScope)}.`,
		});

		this.renderNotImported(contentEl);
		this.renderLicenceNotice(contentEl);
		this.renderToggles(contentEl);
		this.renderFields(contentEl);
		this.addButtons(contentEl, true);
	}

	private renderEmpty(contentEl: HTMLElement): void {
		contentEl.createEl('p', {
			text: `No compendium content in ${describeScope(this.importScope)}.`,
		});
		contentEl.createEl('p', {
			cls: 'tome-connector-sync-hint',
			text:
				'Looked for notes written by ttrpg-convert-cli: species, backgrounds, feats and ' +
				'spells, identified by their cssclasses.',
		});
		this.addButtons(contentEl, false);
	}

	/** What is in the scope but not in the package, so the numbers add up out loud. */
	private renderNotImported(contentEl: HTMLElement): void {
		const skipped = describeCounts(this.report.unsupported);
		if (skipped !== '') {
			contentEl.createEl('p', {
				cls: 'tome-connector-sync-hint',
				text: `Not included: ${skipped}. Creatures go to the bestiary with "Send folder to Tome" instead.`,
			});
		}

		// The single most useful line in the dialog: it turns "391 spells" into "74
		// spells you do not already have", which is both the truth and the better
		// answer. Rerunning with the box ticked is a full rescan, which is cheap.
		if (this.report.alreadyShipped > 0) {
			contentEl.createEl('p', {
				cls: 'tome-connector-sync-hint',
				text:
					`${this.report.alreadyShipped} more are SRD content Tome already provides, so they ` +
					'were left out - importing them would give you two of each. Tick the box below to ' +
					'use your own text instead.',
			});
		}

		// Subclasses for a class Tome does not have - the Artificer's, most likely.
		// The server drops them either way; saying so is the difference between
		// content that is missing and content that vanished.
		const orphaned = this.report.orphanedSubclasses;
		if (orphaned.length > 0) {
			contentEl.createEl('p', {
				cls: 'tome-connector-sync-hint',
				text:
					`${orphaned.length} subclass(es) belong to a class Tome does not have and cannot ` +
					`be imported: ${orphaned.slice(0, 4).join(', ')}${orphaned.length > 4 ? '…' : ''}`,
			});
		}

		// 2014 subclasses filed under a 2024 class. What happens to them is the
		// toggle below; this says which way it is currently set.
		const unreachable = this.report.unreachableSubclasses;
		if (unreachable.length > 0) {
			contentEl.createEl('p', {
				cls: 'tome-connector-sync-hint',
				text:
					this.options.raiseEarlySubclassFeatures === true
						? `${unreachable.length} older subclass(es) grant a feature before level 3; ` +
							'those features will be moved to level 3 so a character actually gets them.'
						: `${unreachable.length} subclass(es) grant a feature before level 3, where a ` +
							'subclass is chosen — those features will not be offered. These are older ' +
							'subclasses filed under a 2024 class.',
			});
		}

		if (this.report.failed.length === 0) return;

		contentEl.createEl('p', {
			cls: 'tome-connector-sync-hint',
			text: `${this.report.failed.length} note(s) could not be read and will be left out:`,
		});
		const list = contentEl.createEl('ul', { cls: 'tome-connector-sync-failures' });
		for (const path of this.report.failed.slice(0, 10)) {
			list.createEl('li', { text: path });
		}
	}

	/**
	 * Says plainly whether this content can be shared.
	 *
	 * The point of reading the source lines at all. Someone importing the Player's
	 * Handbook should be told it stays on their account, and someone importing SRD
	 * content should be told the attribution is a licence condition rather than a
	 * nicety - neither is obvious from a form with a "Licence" box on it.
	 */
	private renderLicenceNotice(contentEl: HTMLElement): void {
		const { sources } = this.report;

		if (sources.allSrd) {
			contentEl.createEl('p', {
				cls: 'tome-connector-sync-hint',
				text:
					'Every note says it is SRD content, so this can be offered under CC-BY-4.0. ' +
					'The attribution below is the licence condition, not a courtesy.',
			});
			return;
		}

		contentEl.createEl('p', {
			cls: 'tome-connector-sync-hint',
			text:
				`${sources.nonSrdCount} of these notes are book content rather than SRD` +
				`${sources.books.length > 0 ? ` (${sources.books.join('; ')})` : ''}. ` +
				'It stays private to your account and cannot be shared. Say what licence you hold it under.',
		});
	}

	/** The two choices that change what gets sent, each re-running the scan. */
	private renderToggles(contentEl: HTMLElement): void {
		const toggle = (
			name: string,
			description: string,
			value: boolean,
			apply: (on: boolean) => AssembleOptions,
		): void => {
			new Setting(contentEl)
				.setName(name)
				.setDesc(description)
				.addToggle((control) =>
					control.setValue(value).onChange((on) => {
						// Reopened on a fresh report rather than patched in place: the
						// counts, the licence notice and the prefilled fields all move
						// together.
						this.nextOptions = apply(on);
						this.close();
					}),
				);
		};

		if (this.report.alreadyShipped > 0 || this.options.includeSrdContent === true) {
			toggle(
				'Include SRD content',
				'Import the notes Tome already provides too. Their text replaces the built-in copy, ' +
					'which also loses the damage and saving-throw data the built-in spells carry.',
				this.options.includeSrdContent === true,
				(on) => ({ ...this.options, includeSrdContent: on }),
			);
		}

		if (this.report.unreachableSubclasses.length === 0) return;

		toggle(
			'Move early subclass features to level 3',
			'Older subclasses grant features at level 1 or 2, when a 2024 character has not chosen ' +
				'a subclass yet. Turning this on grants them at level 3 instead, which is where the ' +
				'2024 versions put them. Leave it off to import them exactly as written.',
			this.options.raiseEarlySubclassFeatures === true,
			(on) => ({ ...this.options, raiseEarlySubclassFeatures: on }),
		);
	}

	private renderFields(contentEl: HTMLElement): void {
		const field = (
			name: string,
			description: string,
			get: () => string,
			set: (value: string) => void,
		): void => {
			new Setting(contentEl).setName(name).setDesc(description).addText((text) =>
				text.setValue(get()).onChange((value) => {
					set(value);
				}),
			);
		};

		field('Key', 'Re-importing the same key replaces this source.', () => this.manifest.key, (v) => {
			this.manifest.key = v;
		});
		field('Name', 'What it is called in the content list.', () => this.manifest.name, (v) => {
			this.manifest.name = v;
		});
		field('Licence', 'CC-BY-4.0 for SRD content, or own-work if it is yours.', () => this.manifest.license, (v) => {
			this.manifest.license = v;
		});
		field('Attribution', 'Who to credit.', () => this.manifest.attribution ?? '', (v) => {
			this.manifest.attribution = v;
		});
		field('Version', 'Your own version for this package.', () => this.manifest.version ?? '', (v) => {
			this.manifest.version = v;
		});
		field('Publisher', 'Optional.', () => this.manifest.publisher ?? '', (v) => {
			this.manifest.publisher = v;
		});
	}

	private addButtons(contentEl: HTMLElement, canImport: boolean): void {
		const buttons = contentEl.createDiv({ cls: 'tome-connector-sync-buttons' });
		buttons
			.createEl('button', { text: canImport ? 'Cancel' : 'Close' })
			.addEventListener('click', () => this.close());

		if (!canImport) return;

		buttons.createEl('button', { text: 'Import', cls: 'mod-cta' }).addEventListener('click', () => {
			// Checked here rather than only on the server: a 391-spell package would
			// otherwise cross the wire before being refused for a missing licence.
			const problems = validateManifest(this.manifest);
			if (problems.length > 0) {
				new Notice(`Tome connector: ${problems.join(' ')}`);
				return;
			}

			this.confirmed = true;
			this.close();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onDone(
			this.confirmed
				? { manifest: this.manifest }
				: this.nextOptions !== null
					? { options: this.nextOptions }
					: null,
		);
	}
}

/**
 * Scans the scope, assembles a package, asks, and posts it.
 *
 * One request, so there is no throttle, no retry ladder and no progress modal -
 * the parts `syncVaultToTome` needs because it sends hundreds.
 */
export const runContentImport = oneAtATime(
	async (plugin: TomeConnectorPlugin, scope: SyncScope): Promise<void> => {
		// Read once and re-assemble from the same notes if the SRD toggle is flipped:
		// the parse is fast, and re-reading a 2,974-note vault to answer a checkbox is
		// not.
		const notice = new TomeProgressNotice('Tome connector: reading the compendium…');
		let notes: ScannedNote[];
		try {
			notes = await readScope(plugin.app, scope, (done, total) => notice.setProgress(done, total));
		} finally {
			notice.hide();
		}

		// Awaited, not fired from a callback: the guard has to hold through the upload.
		let options: AssembleOptions = {};
		for (;;) {
			const report = assemblePackage(notes, suggestedKey(scope), options);
			const answer = await new Promise<ImportAnswer>((resolve) => {
				new ConfirmImportModal(plugin.app, report, scope, options, resolve).open();
			});
			if (answer === null) return;
			if ('options' in answer) {
				options = answer.options;
				continue;
			}
			await upload(plugin, report, answer.manifest);
			return;
		}
	},
	() => new Notice('Tome connector: an import is already running.'),
);

async function upload(
	plugin: TomeConnectorPlugin,
	report: PackageReport,
	manifest: ImportManifest,
): Promise<void> {
	const notice = new TomeProgressNotice('Tome connector: importing…');

	try {
		// The document key is the manifest's key: the person may have renamed it in
		// the form, and the two disagreeing would file the package under one name and
		// describe it under another.
		const body = buildImportRequest(
			manifest,
			{ ...report.package, documentKey: manifest.key },
			createMultipartBoundary(),
		);

		const result = await postMultipartToTome(
			plugin.settings.baseUrl,
			IMPORT_PATH,
			body.body,
			body.contentType,
			getApiKey(plugin),
		);

		notice.hide();

		if (result.ok) {
			new Notice(
				`Tome connector: imported ${describeCounts(report.counts)}. ` +
					'Switch it on for a campaign in Tome to use it.',
			);
			return;
		}

		// The server explains itself - a plan ceiling, third-party content switched
		// off, a licence it would not take - and those are things the person can act
		// on, so they belong in the Notice rather than the console.
		new Notice(`Tome connector: ${result.message ?? `import failed (${result.status})`}`);
	} catch (error) {
		notice.hide();
		console.error('Tome Connector: content import failed', error);
		new Notice(`Tome connector: ${error instanceof Error ? error.message : String(error)}`);
	}
}
