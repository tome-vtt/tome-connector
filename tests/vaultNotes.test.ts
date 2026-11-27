import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

// Obsidian ships no runtime; these stand in for its frontmatter helpers as documented.
vi.mock('obsidian', () => {
	class TFile {
		constructor(public path: string) {}
	}
	const getFrontMatterInfo = (content: string) => {
		const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
		return match
			? { exists: true, frontmatter: match[1], contentStart: match[0].length }
			: { exists: false, frontmatter: '', contentStart: 0 };
	};
	const parseFrontMatterTags = (frontmatter: Record<string, unknown> | null) => {
		const tags = frontmatter?.tags;
		if (tags == null) return null;
		return (Array.isArray(tags) ? tags : (tags as string).split(/[,\s]+/)).map((tag) => `#${String(tag)}`);
	};
	return { TFile, getFrontMatterInfo, parseFrontMatterTags, parseYaml: parse };
});

import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { vaultNotes } from '../src/vaultNotes';

const path = 'compendium/feats/brewmaster.md';

/**
 * A vault an outside tool rewrote behind Obsidian's back: the file on disk says
 * the 2024 source, while Obsidian's cached copy and metadata still hold the old one.
 */
function staleVault(): App {
	const file = new (TFile as unknown as new (path: string) => TFile)(path);
	const disk =
		'---\ntags: [compendium/src/5e/wow-2024]\nsource: World of Warcraft (2024)\n---\n' +
		'# Brewmaster\n\nYou brew. #homebrew\n\n```\n#not-a-tag\n```\n';
	const cached = '---\ntags: [compendium/src/5e/wow]\nsource: World of Warcraft\n---\n# Brewmaster\n';
	const staleCache = {
		frontmatter: { tags: ['compendium/src/5e/wow'], source: 'World of Warcraft' },
		tags: [],
	};
	return {
		vault: {
			getMarkdownFiles: () => [file],
			getAbstractFileByPath: (wanted: string) => (wanted === path ? file : null),
			read: async () => disk,
			cachedRead: async () => cached,
		},
		metadataCache: { getFileCache: () => staleCache, getCache: () => staleCache },
	} as unknown as App;
}

describe('vaultNotes on a note rewritten outside Obsidian', () => {
	it('packages the content and frontmatter on disk, not the stale cached copy', async () => {
		const note = await vaultNotes(staleVault()).read(path);

		expect(note.content).toContain('You brew.');
		expect(note.frontmatter).toEqual({
			tags: ['compendium/src/5e/wow-2024'],
			source: 'World of Warcraft (2024)',
		});
	});

	it("takes the note's tags from the same disk read, frontmatter and inline, skipping code", async () => {
		expect(await vaultNotes(staleVault()).tags(path)).toEqual(['#compendium/src/5e/wow-2024', '#homebrew']);
	});

	it('reads a note with no frontmatter as null frontmatter', async () => {
		const app = staleVault();
		(app.vault as unknown as { read: () => Promise<string> }).read = async () => '# Plain\n\nNo tags here.';

		const notes = vaultNotes(app);

		expect((await notes.read(path)).frontmatter).toBeNull();
		expect(await notes.tags(path)).toEqual([]);
	});
});

describe('vaultNotes on a note whose frontmatter is not a map', () => {
	it.each([
		['broken YAML', '---\ntitle: Foo: Bar\n---\n# Note #kept\n'],
		['a bare string', '---\njust words\n---\n# Note #kept\n'],
		['a list', '---\n- a\n- b\n---\n# Note #kept\n'],
	])('reads %s as no frontmatter, as Obsidian does, and still finds body tags', async (_, disk) => {
		const app = staleVault();
		(app.vault as unknown as { read: () => Promise<string> }).read = async () => disk;
		const notes = vaultNotes(app);

		expect((await notes.read(path)).frontmatter).toBeNull();
		expect(await notes.tags(path)).toEqual(['#kept']);
	});
});
