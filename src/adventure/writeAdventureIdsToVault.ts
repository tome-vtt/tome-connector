import { App, TFile } from 'obsidian';

import type { AdventurePlan, ImportedChapterResultBody } from './adventurePlan';

/**
 * Writes the ids a successful import returned back into the vault - a
 * `tome_chapter_id` in each chapter note's frontmatter, and a
 * `%%tome_scene_id: ...%%` suffix on each scene's own heading line - so a
 * re-import can find the same rows again by id instead of by title, which is
 * what makes renaming a chapter or a scene heading in Obsidian a rename in
 * Tome rather than a new row beside the old one.
 *
 * **Best-effort, chapter by chapter.** A chapter with no `notePath` (a
 * fixture, or a note deleted between building the plan and this write) is
 * skipped rather than thrown on, and one chapter's failure does not stop the
 * rest - an id that never made it into a note simply falls back to matching
 * by title on the next import, exactly as it always did before this existed.
 */
export async function writeAdventureIdsToVault(
	app: App,
	plan: AdventurePlan,
	chapterResults: ImportedChapterResultBody[],
	sceneEdits: ((content: string) => string)[],
): Promise<void> {
	for (const [index, chapter] of plan.chapters.entries()) {
		const result = chapterResults[index];
		const sceneEdit = sceneEdits[index];
		if (!result || !sceneEdit || !chapter.notePath) continue;

		const file = app.vault.getAbstractFileByPath(chapter.notePath);
		if (!(file instanceof TFile)) continue;

		try {
			await writeChapterId(app, file, result.id);
			await writeSceneIds(app, file, sceneEdit);
		} catch (error) {
			console.warn(`Tome Connector: could not write ids back into "${chapter.notePath}".`, error);
		}
	}
}

async function writeChapterId(app: App, file: TFile, id: string): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		frontmatter['tome_chapter_id'] = id;
	});
}

async function writeSceneIds(app: App, file: TFile, edit: (content: string) => string): Promise<void> {
	await app.vault.process(file, edit);
}
