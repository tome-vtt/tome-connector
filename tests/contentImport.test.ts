import { describe, expect, it } from 'vitest';

import { scanCompendium, suggestedKey, suggestedName, uploadPackage, type ImportHttp } from '../src/contentImport';
import { isEmpty } from '../src/recognizers/compendium/package';
import { describeScope, type NoteSource } from '../src/scopeReader';
import type { SendResult } from '../src/tomeHttp';

const srdSource =
	"*Source: Player's Handbook (2024) p. 185. Available in the <span title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*";

const files: Record<string, string> = {
	'CLI/feats/alert-xphb.md': `# Alert\n${srdSource}\n\nYou gain the following benefits.\n\n**Initiative Proficiency.** You add your bonus.`,
	'CLI/races/aasimar-xphb.md': `# Aasimar\n${srdSource}\n\n- **Size**: Medium\n- **Speed**: 30 ft.\n\n## Traits\n\n### Darkvision\n\nYou see.\n\n## Description\n\nCelestial blood.`,
};
const cssClasses: Record<string, string> = {
	'CLI/feats/alert-xphb.md': 'json5e-feat',
	'CLI/races/aasimar-xphb.md': 'json5e-race',
};

function vault(): NoteSource & { reads: string[] } {
	const reads: string[] = [];
	return {
		reads,
		paths: () => Object.keys(files),
		tags: () => Promise.resolve([]),
		read: (path) => {
			reads.push(path);
			return Promise.resolve({
				path,
				content: files[path] ?? '',
				frontmatter: { cssclasses: [cssClasses[path]], tags: ['ttrpg-cli/compendium/src/5e/xphb'] },
			});
		},
	};
}

const scope = { kind: 'vault' as const };

describe('scanCompendium', () => {
	it('reports what the scope holds, counting SRD content Tome already ships as left out', async () => {
		const scan = await scanCompendium(vault(), scope);
		const report = scan.assemble({});
		expect(isEmpty(report)).toBe(true);
		expect(report.alreadyShipped).toBe(2);
	});

	it('rebuilds the report for a toggle without reading the vault again', async () => {
		const source = vault();
		const scan = await scanCompendium(source, scope);
		const withSrd = scan.assemble({ includeSrdContent: true });

		expect(withSrd.counts).toMatchObject({ feats: 1, species: 1 });
		expect(source.reads).toHaveLength(2);
	});

	it('reports read progress', async () => {
		const progress: [number, number][] = [];
		await scanCompendium(vault(), scope, (done, total) => progress.push([done, total]));
		expect(progress).toEqual([
			[1, 2],
			[2, 2],
		]);
	});
});

describe('uploadPackage', () => {
	const manifest = { key: 'my-books', name: 'My books', license: 'CC-BY-4.0' };
	const reply = (result: Partial<SendResult>): SendResult => ({
		ok: false,
		status: 0,
		id: null,
		message: null,
		retryable: false,
		...result,
	});

	async function report() {
		return (await scanCompendium(vault(), scope)).assemble({ includeSrdContent: true });
	}

	it('posts one multipart request carrying the manifest and the package under the manifest key', async () => {
		const sent: { path: string; body: string; contentType: string }[] = [];
		const http: ImportHttp = (path, body, contentType) => {
			sent.push({ path, body: new TextDecoder().decode(body), contentType });
			return Promise.resolve(reply({ ok: true, status: 200 }));
		};

		const outcome = await uploadPackage(http, manifest, await report());

		expect(outcome).toEqual({ ok: true });
		expect(sent).toHaveLength(1);
		expect(sent[0]?.contentType).toContain('multipart/form-data');
		expect(sent[0]?.body).toContain('my-books');
		expect(sent[0]?.body).toContain('Alert');
	});

	it("reports the server's own refusal", async () => {
		const http: ImportHttp = () => Promise.resolve(reply({ status: 403, message: 'Plan limit reached.' }));
		expect(await uploadPackage(http, manifest, await report())).toEqual({
			ok: false,
			message: 'Plan limit reached.',
		});
	});

	it('names the status when the server gave no explanation', async () => {
		const http: ImportHttp = () => Promise.resolve(reply({ status: 500 }));
		expect(await uploadPackage(http, manifest, await report())).toEqual({
			ok: false,
			message: 'import failed (500)',
		});
	});

	it('reports a thrown error, handing it back for logging', async () => {
		const boom = new Error('socket closed');
		const http: ImportHttp = () => Promise.reject(boom);
		expect(await uploadPackage(http, manifest, await report())).toEqual({
			ok: false,
			message: 'socket closed',
			thrown: boom,
		});
	});
});

/**
 * A vault converted from two books: each book's reading notes in a folder of its
 * own, every book's feats in one shared folder.
 */
function twoBookVault(prefix: string): NoteSource {
	const notes: Record<string, { cssclass: string; source: string; content: string }> = {
		'compendium/books/players-handbook-2024/01-introduction.md': {
			cssclass: 'json5e-note',
			source: 'xphb',
			content: '# Introduction\n\nWelcome.',
		},
		'compendium/books/players-handbook-2024/02-feats.md': {
			cssclass: 'json5e-note',
			source: 'xphb',
			content: '# Feats\n\nFeats are special.',
		},
		'compendium/books/world-of-warcraft/01-azeroth.md': {
			cssclass: 'json5e-note',
			source: 'wow',
			content: '# Azeroth\n\nA world.',
		},
		'compendium/feats/alert-xphb.md': {
			cssclass: 'json5e-feat',
			source: 'xphb',
			content: `# Alert\n${srdSource}\n\nYou gain the following benefits.\n\n**Initiative Proficiency.** You add your bonus.`,
		},
		'compendium/feats/musician-xphb.md': {
			cssclass: 'json5e-feat',
			source: 'xphb',
			content: "# Musician\n*Source: Player's Handbook (2024) p. 202*\n\nYou gain the following benefits.\n\n**Encouraging Song.** You play.",
		},
		'compendium/feats/brewmaster-wow.md': {
			cssclass: 'json5e-feat',
			source: 'wow',
			content: '# Brewmaster\n*Source: World of Warcraft p. 10*\n\nYou gain the following benefits.\n\n**Brew.** You brew.',
		},
	};
	const tagsOf = (path: string): string[] => [`${prefix}compendium/src/5e/${notes[path]?.source ?? ''}`];
	return {
		paths: () => Object.keys(notes),
		tags: (path) => Promise.resolve(tagsOf(path).map((tag) => `#${tag}`)),
		read: (path) =>
			Promise.resolve({
				path,
				content: notes[path]?.content ?? '',
				frontmatter: { cssclasses: [notes[path]?.cssclass], tags: tagsOf(path) },
			}),
	};
}

const bookFolder = (name: string) => ({
	kind: 'folder' as const,
	folder: { path: `compendium/books/${name}`, name },
});

describe.each(['ttrpg-cli/', ''])('scanCompendium on a book folder (tag prefix "%s")', (prefix) => {
	it("imports the book's entries from every folder, and no other book's", async () => {
		const scan = await scanCompendium(twoBookVault(prefix), bookFolder('players-handbook-2024'));
		const report = scan.assemble({ includeSrdContent: true });

		expect(report.counts).toMatchObject({ feats: 2 });
		expect(report.package.feats?.map((feat) => feat.name).sort()).toEqual(['Alert', 'Musician']);
	});

	it('names the book as the scope, with the key and name defaulting to it', async () => {
		const scan = await scanCompendium(twoBookVault(prefix), bookFolder('players-handbook-2024'));

		expect(describeScope(scan.scope)).toBe('"Players Handbook 2024"');
		expect(suggestedKey(scan.scope)).toBe('players-handbook-2024');
		expect(suggestedName(scan.scope)).toBe('Players Handbook 2024');
	});
});

describe('scanCompendium on a book folder with a folder listing', () => {
	it('reads the folder as the book, whatever tags its listing carries', async () => {
		const source = twoBookVault('ttrpg-cli/');
		const listing = 'compendium/books/players-handbook-2024/index.md';
		const withListing: NoteSource = {
			...source,
			paths: () => [...source.paths(), listing],
			read: (path) =>
				path === listing
					? Promise.resolve({ path, content: '# Index', frontmatter: { cssclasses: ['json5e-index'] } })
					: source.read(path),
		};
		const scan = await scanCompendium(withListing, bookFolder('players-handbook-2024'));

		expect(describeScope(scan.scope)).toBe('"Players Handbook 2024"');
	});
});

describe('scanCompendium on an ordinary folder', () => {
	it('keeps a folder of compendium entries as the scope', async () => {
		const scope = { kind: 'folder' as const, folder: { path: 'compendium/feats', name: 'feats' } };
		const scan = await scanCompendium(twoBookVault('ttrpg-cli/'), scope);

		expect(scan.scope).toBe(scope);
		expect(scan.assemble({ includeSrdContent: true }).counts).toMatchObject({ feats: 3 });
	});

	it("keeps a folder of one book's entries as the scope", async () => {
		const scope = { kind: 'folder' as const, folder: { path: 'compendium/feats', name: 'feats' } };
		const source = twoBookVault('ttrpg-cli/');
		const oneBook: NoteSource = { ...source, paths: () => source.paths().filter((path) => !path.endsWith('-wow.md')) };
		const scan = await scanCompendium(oneBook, scope);

		expect(scan.scope).toBe(scope);
	});

	it('keeps a folder of reading notes from two books as the scope', async () => {
		const scope = { kind: 'folder' as const, folder: { path: 'compendium/books', name: 'books' } };
		const scan = await scanCompendium(twoBookVault('ttrpg-cli/'), scope);

		expect(scan.scope).toBe(scope);
		expect(describeScope(scan.scope)).toBe('"books"');
	});

	it('keeps a folder where one reading note carries no book tag as the scope', async () => {
		const scope = bookFolder('players-handbook-2024');
		const source = twoBookVault('ttrpg-cli/');
		const untagged: NoteSource = {
			...source,
			read: async (path) =>
				path.endsWith('02-feats.md')
					? { ...(await source.read(path)), frontmatter: { cssclasses: ['json5e-note'] } }
					: source.read(path),
		};
		const scan = await scanCompendium(untagged, scope);

		expect(scan.scope).toBe(scope);
	});
});
