import { Component, Notice, Platform, TFile, TFolder } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { getApiKey } from './tomeConnectorSettings';
import {
	buildChapterPlan,
	countChapters,
	type FolderNode,
	type PlannedNote,
} from './tomeChapterPlan';
import { findUninlinedResources } from './tomeResourcePath';
import {
	buildExportDocument,
	type BuiltDocument,
} from './tomeExportDocument';
import { printBodyClass, printHtmlToPdf } from './tomePdfPrinter';
import { formatBytes, uploadReferencePdf } from './tomeReferenceUpload';
import { TomeProgressNotice } from './tomeProgressNotice';
import { oneAtATime } from './oneAtATime';
import { chooseCampaign } from './tomeCampaigns';
import { describeError } from './shared';
import { sentTo } from './tomeHttp';

const MENU_TITLE = 'Import as a Tome Reference';
const MENU_ICON = 'upload-cloud';

function canStartFolderExport(plugin: TomeConnectorPlugin): boolean {
	if (!plugin.settings.baseUrl) {
		new Notice('Tome connector: set a base URL in the plugin settings first.');
		return false;
	}
	if (!getApiKey(plugin)) {
		new Notice('Tome connector: set an API key in the plugin settings first.');
		return false;
	}
	return true;
}

/**
 * Adds "Import as a Tome Reference" to a folder's context menu in the File
 * Explorer. The folder's notes are compiled into one PDF, with each note a
 * chapter in the bookmark outline, and pushed to the campaign's Reference
 * library - phrased to match the other two imports on the same folder's menu
 * ("Import as a Tome content source", "Import as a Tome Storybook adventure"),
 * naming which library this one fills rather than just where it goes.
 */
export function registerFolderExportMenuItem(plugin: TomeConnectorPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			// The same event fires for notes and for menus opened from links.
			if (!(file instanceof TFolder)) return;
			// Printing goes through Electron's <webview>, which only exists in
			// the desktop app; on mobile the item is simply absent.
			if (!Platform.isDesktopApp) return;

			menu.addItem((item) =>
				item
					.setTitle(MENU_TITLE)
					.setIcon(MENU_ICON)
					.onClick(() => {
						void runFolderExport(plugin, file);
					}),
			);
		}),
	);
}

/**
 * Snapshots a folder subtree into the plain shape `tomeChapterPlan` works on.
 * This is the only place the export touches Obsidian's file types, which is
 * what keeps the ordering and heading-level rules unit testable.
 */
function toFolderNode(folder: TFolder): FolderNode {
	const folders: FolderNode[] = [];
	const notes: PlannedNote[] = [];

	for (const child of folder.children) {
		if (child instanceof TFolder) {
			folders.push(toFolderNode(child));
		} else if (child instanceof TFile && child.extension === 'md') {
			notes.push({ path: child.path, title: child.basename });
		}
	}

	return { name: folder.name, folders, notes };
}

/**
 * Anything still pointing at a vault resource is an image the printer will
 * fetch itself, at full resolution and past the optimizer. That is how an
 * export can report a large saving and still produce a huge PDF, so it is
 * worth naming rather than leaving to be discovered later.
 */
function warnUninlinedResources(bodyHtml: string): void {
	const escaped = findUninlinedResources(bodyHtml);
	if (escaped.count > 0) {
		console.warn(
			`Tome Connector: ${escaped.count} vault resource reference(s) were not inlined and will be embedded at full size.`,
			escaped.samples,
		);
	}
}

/**
 * Only one export at a time. Each run stands up a print guest and holds the
 * whole compiled book in memory twice - once as a DOM tree, once as markup -
 * so a concurrent second run would double both for no benefit.
 */
const runFolderExport = oneAtATime(
	async (plugin: TomeConnectorPlugin, folder: TFolder): Promise<void> => {
		if (!canStartFolderExport(plugin)) return;
		const campaign = await chooseCampaign(plugin, 'Import');
		if (campaign === null) return;

		// A vault-root folder has an empty name; use the vault's name.
		const title = folder.name || plugin.app.vault.getName();
		const plan = buildChapterPlan(toFolderNode(folder));
		const total = countChapters(plan);
		if (total === 0) {
			new Notice(`Tome connector: "${title}" has no notes to send.`);
			return;
		}

		const progress = new TomeProgressNotice(`Tome connector: preparing "${title}"…`);
		// One bar: each chapter, then building the PDF and uploading as a step each.
		const totalSteps = total + 2;
		progress.setProgress(0, totalSteps);
		const host = document.body.createDiv({ cls: 'tome-export-host' });
		const component = new Component();
		component.load();

		try {
			const built = await buildExportDocument(plugin, host, component, plan, (message, done) => {
				progress.setMessage(`Tome connector: ${message}`);
				if (done !== undefined) progress.setProgress(done, totalSteps);
			});

			progress.setMessage('Tome connector: building the PDF…');
			progress.setProgress(total, totalSteps);
			// `outerHTML`: the root div carries the classes the print stylesheet keys off.
			const bodyHtml = built.root.outerHTML;
			warnUninlinedResources(bodyHtml);
			const pdf = await printHtmlToPdf({
				bodyHtml,
				bodyClass: printBodyClass(document.body.className),
				headHtml: document.head.innerHTML,
			});

			progress.setMessage(`Tome connector: uploading "${title}" (${formatBytes(pdf.byteLength)})…`);
			progress.setProgress(total + 1, totalSteps);
			await uploadReferencePdf(plugin, pdf, title, campaign.id);
			progress.setProgress(totalSteps, totalSteps);

			progress.hide();
			reportSuccess(title, total, built, campaign.name);
		} catch (error) {
			progress.hide();
			console.error('Tome Connector: failed to export folder', error);
			const message = describeError(error);
			new Notice(`Tome connector: ${message}`);
		} finally {
			// The component owns every child renderer the post-processors created,
			// so it has to outlive serialization - but not this function.
			component.unload();
			host.remove();
		}
	},
	() => new Notice('Tome connector: an export is already running.'),
);

function reportSuccess(
	title: string,
	total: number,
	built: BuiltDocument,
	campaignName: string,
): void {
	const { failures, skipped } = built;
	const sent = sentTo(`"${title}" (${total} note${total === 1 ? '' : 's'})`, campaignName);
	// Only worth saying when the optimizer actually shrank something, which is
	// also the answer to "why is this export so much smaller than the vault".
	const saved =
		built.imageSourceBytes > built.imageEmbeddedBytes
			? ` Images reduced ${formatBytes(built.imageSourceBytes)} → ${formatBytes(built.imageEmbeddedBytes)}.`
			: '';

	// One summary rather than a notice per problem: a folder with fifty
	// renamed images would otherwise bury the screen.
	if (failures.length > 0 || skipped.length > 0) {
		if (failures.length > 0) {
			console.warn(
				'Tome Connector: attachments that could not be embedded',
				failures,
			);
		}
		if (skipped.length > 0) {
			console.warn('Tome Connector: notes that could not be rendered', skipped);
		}
		const problems = failures.length + skipped.length;
		new Notice(
			`Tome connector: ${sent}.${saved} ${problems} item${problems === 1 ? '' : 's'} could not be included — see the console.`,
			10000,
		);
		return;
	}

	new Notice(`Tome connector: ${sent}.${saved}`);
}
