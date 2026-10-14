/**
 * Finds fenced code blocks in raw markdown.
 *
 * The existing sync paths all work from *rendered DOM* — a post processor hands
 * them a `<pre><code class="language-statblock">` that Obsidian has already
 * found. A vault scan has no rendered DOM: it reads file text, so it has to find
 * the fences itself.
 *
 * Pure and `obsidian`-free so vitest can reach it, per the rule in
 * `tomeBaseUrl.ts` and `tomeChapterPlan.ts`. Parsing the YAML *inside* a block
 * stays with the caller, because that needs Obsidian's `parseYaml`.
 */

export interface FencedBlock {
	/** Lower-cased info string up to the first space, e.g. `statblock`. Empty when absent. */
	language: string;
	/** The block's contents, without the fence lines. */
	source: string;
	/** 0-based line index of the opening fence, so a caller can write an id back. */
	startLine: number;
}

/**
 * A fence opens with three or more backticks or tildes and closes with at least
 * as many of the same character. Tracking the opening length matters: a block
 * containing ``` inside a longer ````-fence must not be cut short, which
 * happens in notes that document markdown.
 *
 * Up to three leading spaces are allowed, as CommonMark does. A `>` prefix is
 * deliberately *not* handled — a fence inside a callout belongs to the callout,
 * and `ttrpg-convert-cli` puts class tables there but never a statblock.
 */
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)/;

export function extractFencedBlocks(markdown: string): FencedBlock[] {
	const lines = markdown.split(/\r?\n/);
	const blocks: FencedBlock[] = [];

	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? '';
		const open = FENCE.exec(line);
		if (!open) {
			index += 1;
			continue;
		}

		const marker = open[2] ?? '';
		const fenceChar = marker[0] ?? '`';
		const language = (open[3] ?? '').toLowerCase();
		const startLine = index;

		const body: string[] = [];
		index += 1;
		while (index < lines.length) {
			const candidate = lines[index] ?? '';
			const close = FENCE.exec(candidate);
			if (
				close &&
				(close[2] ?? '').startsWith(fenceChar) &&
				(close[2] ?? '').length >= marker.length &&
				(close[3] ?? '') === ''
			) {
				index += 1;
				break;
			}
			body.push(candidate);
			index += 1;
		}

		// An unterminated fence runs to end of file, which is what a renderer does
		// too. Dropping it instead would silently lose the last block in a note
		// somebody forgot to close.
		blocks.push({ language, source: body.join('\n'), startLine });
	}

	return blocks;
}

/** The first block in `language`, or null. Most notes carry at most one. */
export function findFencedBlock(markdown: string, language: string): FencedBlock | null {
	const wanted = language.toLowerCase();
	return extractFencedBlocks(markdown).find((block) => block.language === wanted) ?? null;
}
