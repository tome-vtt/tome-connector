import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

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
	return {
		TFile,
		getFrontMatterInfo,
		parseFrontMatterTags: () => null,
		parseYaml: parse,
		requestUrl: vi.fn(),
		PluginSettingTab: class {},
		Setting: class {},
		Notice: class {},
		Modal: class {},
	};
});

import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { obsidianSendPorts } from '../src/obsidianSendPorts';

describe('obsidianSendPorts.readNote', () => {
	it('sends the note on disk, not the stale cached copy', async () => {
		const file = new (TFile as unknown as new (path: string) => TFile)('Party/Thrall.md');
		const app = {
			vault: {
				getAbstractFileByPath: () => file,
				read: async () => '---\nlevel: 5\n---\nNew text',
				cachedRead: async () => '---\nlevel: 4\n---\nOld text',
			},
			metadataCache: { getFileCache: () => ({ frontmatter: { level: 4 } }) },
		} as unknown as App;

		expect(await obsidianSendPorts(app, false).readNote('Party/Thrall.md')).toEqual({
			frontmatter: { level: 5 },
			content: '---\nlevel: 5\n---\nNew text',
		});
	});
});
