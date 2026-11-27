import { TFile, getFrontMatterInfo, parseFrontMatterTags, parseYaml } from 'obsidian';
import type { App } from 'obsidian';

import type { NoteSource } from './scopeReader';
import type { Note } from './recognizers/note';

/**
 * The vault as a {@link NoteSource}: the Obsidian side of the scope reader.
 *
 * Every note is read from disk (`read`, not `cachedRead`), and its frontmatter and
 * tags are parsed from that same text rather than taken from the metadata cache:
 * when an outside tool rewrites a vault in bulk, Obsidian's watcher can miss it and
 * both caches keep the old note, so an import would send stale content. Scans run
 * only when the user starts one, so the extra disk reads are worth it.
 */
export function vaultNotes(app: App): NoteSource {
	const read = async (path: string): Promise<Note> => {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`"${path}" no longer exists in the vault.`);
		const content = await app.vault.read(file);
		const info = getFrontMatterInfo(content);
		const frontmatter = info.exists ? (parseYaml(info.frontmatter) as Record<string, unknown> | null) : null;
		return { path, content, frontmatter };
	};

	return {
		paths: () => app.vault.getMarkdownFiles().map((file) => file.path),
		tags: async (path) => {
			const note = await read(path);
			const body = note.content.slice(getFrontMatterInfo(note.content).contentStart);
			return [...new Set([...(parseFrontMatterTags(note.frontmatter) ?? []), ...inlineTags(body)])];
		},
		read,
	};
}

/**
 * The `#tags` written in a note's body, each with its `#`, as Obsidian would index them.
 *
 * ponytail: a regex over the body with code removed, not Obsidian's own parser; it can
 * differ on rare markup (a tag inside a comment or HTML). Obsidian offers no tag parser
 * for raw text, so adopt one if it ever does.
 */
function inlineTags(body: string): string[] {
	const prose = body.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');
	return [...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)]
		.map((match) => match[1] ?? '')
		.filter((tag) => /[^\d]/.test(tag))
		.map((tag) => `#${tag}`);
}
