import { describe, expect, it } from 'vitest';

import { scanCompendium, uploadPackage, type ImportHttp } from '../src/contentImport';
import type { NoteSource } from '../src/scopeReader';
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
		tags: () => [],
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
		expect(report.counts.feats + report.counts.species).toBe(0);
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
