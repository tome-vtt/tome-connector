import { TOME_PRINT_CSS } from './tomePrintStyles';

/**
 * Prints a serialized HTML document to PDF using Chromium's own print
 * pipeline, by way of an off-screen `<webview>`.
 *
 * The alternative - laying out pages by hand over a PDF library - would give
 * up everything Obsidian's reading view already does correctly: callouts,
 * tables, code blocks, Mermaid, and the user's theme.
 */

/**
 * The slice of Electron's `<webview>` tag this plugin uses.
 *
 * Declared here rather than imported from `electron` so the plugin carries no
 * Electron dependency at all - not even a type-level one, which would pull a
 * package into `devDependencies` for a single interface and break
 * `tsc -noEmit`. Nothing here is a runtime `require`, so the bundle stays
 * loadable on mobile and `manifest.json` stays honest at
 * `isDesktopOnly: false`; the caller gates the feature on
 * `Platform.isDesktopApp`.
 */
interface PrintableWebview extends HTMLElement {
	src: string;
	executeJavaScript(code: string): Promise<unknown>;
	printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
}

export interface PrintRequest {
	/** Serialized markup for the document body. */
	bodyHtml: string;
	/** Class list to stamp on the guest's `<body>`, carrying Obsidian's theme hooks. */
	bodyClass: string;
	/** The host document's `<head>` markup - app CSS, theme, snippets, plugin styles. */
	headHtml: string;
}

/** How long to wait for the guest page to come up before giving up. */
const DOM_READY_TIMEOUT_MS = 30_000;

/** How long to wait for fonts and any remote images inside the guest. */
const GUEST_SETTLE_TIMEOUT_MS = 8000;

/**
 * Any real export is at least a page tall. Anything shorter means the content
 * never laid out at all.
 */
const MIN_LAID_OUT_HEIGHT_PX = 400;

/** Slack for sub-pixel rounding when comparing the document to its content. */
const HEIGHT_TOLERANCE_PX = 4;

/**
 * What the guest reports back about the document it is about to print.
 * Gathered on every run to feed the guards below, and logged only when one of
 * them trips - the failure they catch, a correctly sized and correctly
 * paginated but entirely blank PDF, is otherwise invisible until someone
 * opens the file.
 */
interface GuestDiagnostics {
	chapters: number;
	documentScrollHeight: number;
	rootScrollHeight: number;
}

export async function printHtmlToPdf(request: PrintRequest): Promise<Uint8Array> {
	// The guest is only created, laid out and rasterized if it is attached and
	// has real dimensions. `display: none`, `visibility: hidden` and a 1x1 box
	// all produce either no guest or a blank page, so it is parked off-screen
	// at a realistic size instead.
	const host = document.body.createDiv({ cls: 'tome-print-host' });

	try {
		// `webview` is an Electron tag and so is absent from
		// HTMLElementTagNameMap; the assertion only satisfies `createEl`'s
		// generic, and the element actually created is a real <webview>.
		const webview = createEl('webview' as 'div', {
			cls: 'tome-print-webview',
		}) as unknown as PrintableWebview;
		// An app:// origin, so the stylesheet and font URLs copied out of the
		// host's <head> resolve inside the guest.
		webview.src = 'app://obsidian.md/help.html';
		host.appendChild(webview);

		// Electron defines these on the element as soon as it is attached, even
		// though they may not be *called* until dom-ready. Checking now means a
		// build without webview support fails immediately instead of after the
		// dom-ready timeout below.
		if (typeof webview.printToPDF !== 'function') {
			throw new Error(
				'this build of Obsidian does not expose the PDF printer needed to export a folder.',
			);
		}

		await waitForDomReady(webview);

		await webview.executeJavaScript(buildInjectionScript(request));
		// After the settle, so linked stylesheets have finished loading and
		// their rules are actually enumerable.
		await webview.executeJavaScript(GUEST_SETTLE_SCRIPT);
		await webview.executeJavaScript(NEUTRALIZE_PRINT_MEDIA_SCRIPT);

		const guest = (await webview.executeJavaScript(
			DIAGNOSTIC_SCRIPT,
		)) as GuestDiagnostics;

		// A blank export used to sail through and upload a book-shaped PDF full
		// of empty pages, so these invariants are checked before printing
		// rather than discovered by opening the file. The measurements are only
		// logged when one of them fails - that is when they are worth reading.
		if (guest.chapters === 0) {
			throw failure('the print renderer received no content.', request, guest);
		}
		if (guest.rootScrollHeight < MIN_LAID_OUT_HEIGHT_PX) {
			throw failure(
				`the print renderer laid the content out as only ${guest.rootScrollHeight}px tall, so the PDF would be blank.`,
				request,
				guest,
			);
		}
		// The document has to be at least as tall as the content inside it.
		// When it is not, something up the tree - CSS containment, or an
		// out-of-flow root - is hiding the content's height from the page box,
		// and Chromium paginates only what it can see.
		if (
			guest.documentScrollHeight <
			guest.rootScrollHeight - HEIGHT_TOLERANCE_PX
		) {
			throw failure(
				`the print renderer clipped the document to ${guest.documentScrollHeight}px while its content is ${guest.rootScrollHeight}px tall, so most of the PDF would be blank.`,
				request,
				guest,
			);
		}

		const pdf = await webview.printToPDF({
			pageSize: 'Letter',
			printBackground: true,
			landscape: false,
			scale: 1,
			displayHeaderFooter: false,
			margins: {
				marginType: 'custom',
				top: 0.5,
				bottom: 0.5,
				left: 0.6,
				right: 0.6,
			},
			// Chromium builds the bookmark outline from the heading hierarchy;
			// `tomeExportDocument` shapes the headings so notes nest correctly
			// beneath their chapter and subfolder titles.
			generateDocumentOutline: true,
			// Kept on despite Electron documenting the two as independent.
			// Turning it off produced no outline at all, and saved little
			// enough space that it was not a trade worth making. Chromium
			// appears to derive the outline from the same structure tree that
			// tagging builds, so treat these two as a pair.
			generateTaggedPDF: true,
		});

		// Detach from whatever buffer the guest handed back before it goes away.
		return pdf.slice();
	} finally {
		// Removing the element destroys the guest, on the error path too.
		host.remove();
	}
}

/**
 * Reports why a print was abandoned. The message reaches the user as a
 * Notice, so the measurements go to the console instead of into it.
 */
function failure(
	message: string,
	request: PrintRequest,
	guest: GuestDiagnostics,
): Error {
	console.error('Tome Connector: print guest diagnostics', {
		sentHtmlBytes: request.bodyHtml.length,
		...guest,
	});
	return new Error(`${message} See the console for the printer diagnostics.`);
}

/**
 * Builds the class list for the guest's body.
 *
 * Printing is forced to the light theme: with `printBackground` on, a dark
 * theme yields a solid black page, and with it off the same theme's light
 * text becomes near-invisible on white. Isolated here so a settings toggle is
 * a small change later.
 */
export function printBodyClass(hostBodyClass: string): string {
	const classes = hostBodyClass
		.split(/\s+/)
		.filter((name) => name && name !== 'theme-dark');
	if (!classes.includes('theme-light')) {
		classes.push('theme-light');
	}
	return classes.join(' ');
}

function waitForDomReady(webview: PrintableWebview): Promise<void> {
	return new Promise((resolve, reject) => {
		const finish = (error?: Error) => {
			window.clearTimeout(timer);
			webview.removeEventListener('dom-ready', onReady);
			if (error) reject(error);
			else resolve();
		};
		const onReady = () => finish();
		const timer = window.setTimeout(
			() => finish(new Error('timed out preparing the PDF renderer.')),
			DOM_READY_TIMEOUT_MS,
		);
		webview.addEventListener('dom-ready', onReady);
	});
}

/**
 * `JSON.stringify` is the escaping mechanism for both payloads. The print
 * stylesheet is appended last, after the copied head, so its page-break rules
 * win over the theme and any snippets.
 */
export function buildInjectionScript(request: PrintRequest): string {
	return `(function () {
	document.head.innerHTML = ${JSON.stringify(request.headHtml)};
	document.body.className = ${JSON.stringify(request.bodyClass)};
	document.body.innerHTML = ${JSON.stringify(request.bodyHtml)};
	const style = document.createElement('style');
	style.textContent = ${JSON.stringify(TOME_PRINT_CSS)};
	document.head.appendChild(style);
	return true;
})();`;
}

/**
 * Strips every `@media print` block out of the guest's stylesheets.
 *
 * `getComputedStyle` always reports the *screen* styles, while `printToPDF`
 * renders under Chromium's print media emulation. Obsidian ships print rules
 * for its own single-note export, which hide the application chrome and reveal
 * a dedicated print container - so a document that measures perfectly on
 * screen can still rasterize to nothing.
 *
 * Removing the blocks outright, rather than trying to out-specify them, means
 * the printed page matches the tree that was just measured and verified. Our
 * own stylesheet is deliberately media-agnostic, so it survives this pass.
 */
export const NEUTRALIZE_PRINT_MEDIA_SCRIPT = `(function () {
	for (const sheet of Array.from(document.styleSheets)) {
		let rules = null;
		try {
			rules = sheet.cssRules;
		} catch (error) {
			continue; // A stylesheet this document is not allowed to read.
		}
		if (!rules) continue;

		for (let index = rules.length - 1; index >= 0; index--) {
			const rule = rules[index];
			if (!rule || rule.type !== 4) continue; // CSSRule.MEDIA_RULE
			const condition = (rule.media && rule.media.mediaText) || '';
			// Plain substring rather than a regex: this whole script is a
			// template literal that is then re-parsed as JavaScript in the
			// guest, and backslash escapes have to survive both hops intact.
			if (condition.toLowerCase().indexOf('print') === -1) continue;
			try {
				sheet.deleteRule(index);
			} catch (error) {
				// Leave it; a rule this document may not edit cannot be removed.
			}
		}
	}
	return true;
})();`;

/**
 * Reports what the guards in {@link printHtmlToPdf} read: how many chapters
 * reached the guest and how tall the content and the document laid out.
 */
export const DIAGNOSTIC_SCRIPT = `(function () {
	const root = document.querySelector('.tome-export-root');
	return {
		chapters: document.querySelectorAll('.tome-chapter').length,
		documentScrollHeight: document.documentElement.scrollHeight,
		rootScrollHeight: root ? root.scrollHeight : 0,
	};
})();`;

/**
 * Local attachments arrive as data URIs and need no wait, but web fonts and
 * any images the note referenced by URL still have to load, or they print
 * blank. Bounded, because one unreachable host must not stall the export.
 */
export const GUEST_SETTLE_SCRIPT = `(function () {
	const timeout = new Promise((resolve) => setTimeout(resolve, ${GUEST_SETTLE_TIMEOUT_MS}));
	const images = Array.from(document.images).map((image) =>
		image.complete
			? Promise.resolve()
			: new Promise((resolve) => {
					image.addEventListener('load', resolve, { once: true });
					image.addEventListener('error', resolve, { once: true });
				}),
	);
	const ready = Promise.all([document.fonts.ready].concat(images));
	return Promise.race([ready, timeout]).then(() => true);
})();`;
