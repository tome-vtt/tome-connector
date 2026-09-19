import { TFile } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TomeConnectorPlugin from './main';
import { writeTomeIdIntoNote, type TomeBlockKind } from './tomeIdWriteBack';

/**
 * Finds the rendered block's lines in its note and writes Tome's id into it;
 * the text edit itself is `writeTomeIdIntoNote`'s.
 */
export async function writeTomeIdToYamlBlock(
	plugin: TomeConnectorPlugin,
	ctx: MarkdownPostProcessorContext,
	sectionEl: HTMLElement,
	kind: TomeBlockKind,
	id: string,
): Promise<void> {
	const sectionInfo = ctx.getSectionInfo(sectionEl);
	if (!sectionInfo) return;

	const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return;

	await plugin.app.vault.process(file, (content) =>
		writeTomeIdIntoNote(content, sectionInfo.lineStart, sectionInfo.lineEnd, kind, id),
	);
}
