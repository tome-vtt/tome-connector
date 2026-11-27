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
	const readWithBody = async (path: string): Promise<{ note: Note; body: string }> => {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`"${path}" no longer exists in the vault.`);
		const content = await app.vault.read(file);
		const info = getFrontMatterInfo(content);
		const frontmatter = info.exists ? frontmatterMap(info.frontmatter) : null;
		return { note: { path, content, frontmatter }, body: content.slice(info.contentStart) };
	};

	return {
		paths: () => app.vault.getMarkdownFiles().map((file) => file.path),
		tags: async (path) => {
			// A tag or book scan asks this of every note in the vault: one that cannot be read
			// (gone from disk while Obsidian still lists it) has no tags, so the scan goes on.
			const read = await readWithBody(path).catch(() => null);
			if (!read) return [];
			return [...new Set([...(parseFrontMatterTags(read.note.frontmatter) ?? []), ...inlineTags(read.body)])];
		},
		read: async (path) => (await readWithBody(path)).note,
	};
}

/** Parsed frontmatter, or null when it is not a YAML map: what Obsidian's cache gives such a note. */
function frontmatterMap(yaml: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = parseYaml(yaml);
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * The `#tags` written in a note's body, each with its `#`, as Obsidian would index them.
 *
 * ponytail: a regex over the body with code and `%%comments%%` removed, not Obsidian's
 * own parser; it can differ on rare markup (a fence inside a callout or list, indented
 * code, an HTML comment). Obsidian offers no tag parser for raw text; adopt one if it does.
 */
function inlineTags(body: string): string[] {
	const prose = body
		.replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
		.replace(/`[^`\n]*`/g, '')
		.replace(/%%[\s\S]*?%%/g, '');
	return [...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)]
		.map((match) => match[1] ?? '')
		.filter((tag) => /[^\d]/.test(tag))
		.map((tag) => `#${tag}`);
}
