import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type TomeConnectorPlugin from '../src/main';
import type { NoteSource } from '../src/scopeReader';

/**
 * The "Import a content source" dialog, driven the way a person drives it.
 *
 * `obsidian` has no runtime outside the app, so it is replaced by just enough of
 * `Modal`, `Setting` and `Notice` to type into a field, flip a toggle and press a
 * button. Everything between the vault and the request is the real code.
 */

type Field = { value: string; onChange: (value: string) => void };
type Toggle = { onChange: (on: boolean) => void };

/** What the open dialog shows: its text, fields, toggles and buttons. */
const shown = {
	texts: [] as string[],
	fields: new Map<string, Field>(),
	toggles: new Map<string, Toggle>(),
	buttons: new Map<string, () => void>(),
};
const notices: string[] = [];
let opened: () => void = () => undefined;

vi.mock('obsidian', () => {
	const element = (): Record<string, unknown> => {
		const el: Record<string, unknown> = {
			empty: () => undefined,
			createDiv: () => el,
			createEl: (_tag: string, info?: { text?: string }) => {
				if (info?.text !== undefined) shown.texts.push(info.text);
				const child = element();
				child.addEventListener = (_type: string, listener: () => void) => {
					if (info?.text !== undefined) shown.buttons.set(info.text, listener);
				};
				return child;
			},
		};
		return el;
	};

	class Modal {
		contentEl = element();
		constructor(readonly app: unknown) {}
		onOpen(): void {}
		onClose(): void {}
		open(): void {
			shown.texts = [];
			shown.fields.clear();
			shown.toggles.clear();
			shown.buttons.clear();
			this.onOpen();
			opened();
		}
		close(): void {
			this.onClose();
		}
	}

	class Setting {
		private name = '';
		constructor(readonly containerEl: unknown) {}
		setName(name: string): this {
			this.name = name;
			return this;
		}
		setDesc(): this {
			return this;
		}
		addText(build: (text: unknown) => void): this {
			const field: Field = { value: '', onChange: () => undefined };
			shown.fields.set(this.name, field);
			const text = {
				setValue: (value: string) => ((field.value = value), text),
				onChange: (listener: (value: string) => void) => {
					field.onChange = (value) => ((field.value = value), listener(value));
					return text;
				},
			};
			build(text);
			return this;
		}
		addToggle(build: (control: unknown) => void): this {
			const toggle: Toggle = { onChange: () => undefined };
			shown.toggles.set(this.name, toggle);
			const control = {
				setValue: () => control,
				onChange: (listener: (on: boolean) => void) => ((toggle.onChange = listener), control),
			};
			build(control);
			return this;
		}
	}

	class Notice {
		constructor(message: string) {
			notices.push(message);
		}
	}

	return { Modal, Setting, Notice };
});

vi.mock('../src/tomeProgressNotice', () => ({
	TomeProgressNotice: class {
		setProgress(): void {}
		hide(): void {}
	},
}));
vi.mock('../src/tomeConnectorSettings', () => ({ getApiKey: () => '' }));

/** Each request body as text, its form parts readable by eye. */
const posted: string[] = [];
vi.mock('../src/tomeApiClient', () => ({
	tomeHttp: {
		postMultipart: (_request: unknown, body: ArrayBuffer) => {
			posted.push(new TextDecoder().decode(body));
			return Promise.resolve({ ok: true, status: 201, body: '{}' });
		},
	},
}));

const srdSource =
	"*Source: Player's Handbook (2024) p. 185. Available in the <span title='Systems Reference Document (5.2)'>SRD</span> and the Free Rules (2024)*";

/** A 2014 domain filed under the 2024 Cleric, granting its first feature at level 1. */
const files: Record<string, { content: string; cssclass: string; tags: string[] }> = {
	'CLI/classes/cleric-phb-life-domain-phb.md': {
		cssclass: 'json5e-class',
		tags: ['ttrpg-cli/compendium/src/5e/phb', 'ttrpg-cli/subclass/cleric/life-domain'],
		content:
			"# Life Domain\n*Source: Player's Handbook p. 60*\n\n## Subclass Features\n\n" +
			'### Disciple of Life (Level 1)\n\nYour healing spells are more effective.\n\n' +
			'### Preserve Life (Level 2)\n\nYou channel divinity to heal.',
	},
	'CLI/feats/alert-xphb.md': {
		cssclass: 'json5e-feat',
		tags: ['ttrpg-cli/compendium/src/5e/xphb'],
		content: `# Alert\n${srdSource}\n\nYou gain the following benefits.\n\n**Initiative Proficiency.** You add your bonus.`,
	},
};

const vault: NoteSource = {
	paths: () => Object.keys(files),
	tags: () => [],
	read: (path) =>
		Promise.resolve({
			path,
			content: files[path]?.content ?? '',
			frontmatter: { cssclasses: [files[path]?.cssclass], tags: files[path]?.tags },
		}),
};
vi.mock('../src/vaultNotes', () => ({ vaultNotes: () => vault }));

const { runContentImport } = await import('../src/importContentSource');

const plugin = { app: {}, settings: { baseUrl: 'http://tome.test' } } as unknown as TomeConnectorPlugin;

/** Resolves when the dialog next opens, first time or reopened by a toggle. */
function nextOpen(): Promise<void> {
	return new Promise((resolve) => (opened = resolve));
}

function type(field: string, value: string): void {
	const shownField = shown.fields.get(field);
	if (!shownField) throw new Error(`No "${field}" field is shown.`);
	shownField.onChange(value);
}

function flip(name: string): void {
	const toggle = shown.toggles.get(name);
	if (!toggle) throw new Error(`No "${name}" toggle is shown.`);
	toggle.onChange(true);
}

describe('Import a content source', () => {
	let run: Promise<void> = Promise.resolve();

	beforeEach(() => {
		notices.length = 0;
		posted.length = 0;
	});

	// One import at a time: a test that fails with the dialog open must still close it.
	afterEach(async () => {
		shown.buttons.get('Cancel')?.();
		await run;
	});

	it.each(['Move early subclass features to level 3', 'Include SRD content'])(
		'keeps the typed fields when "%s" is ticked',
		async (toggle) => {
			const firstOpen = nextOpen();
			run = runContentImport(plugin, { kind: 'vault' });
			await firstOpen;

			type('Key', 'my-books');
			type('Name', 'My books');
			type('Licence', 'own-work');
			type('Attribution', 'Me');
			type('Version', '2.0.0');
			type('Publisher', 'Myself');

			const reopened = nextOpen();
			flip(toggle);
			await reopened;

			expect(shown.fields.get('Key')?.value).toBe('my-books');
			expect(shown.fields.get('Name')?.value).toBe('My books');
			expect(shown.fields.get('Licence')?.value).toBe('own-work');
			expect(shown.fields.get('Attribution')?.value).toBe('Me');
			expect(shown.fields.get('Version')?.value).toBe('2.0.0');
			expect(shown.fields.get('Publisher')?.value).toBe('Myself');

			shown.buttons.get('Import')?.();
			await run;

			expect(notices.join('\n')).not.toContain('Say what licence');
			expect(posted).toHaveLength(1);
			expect(posted[0]).toMatch(/name="license"\r\n\r\nown-work\r\n/);
			expect(posted[0]).toMatch(/name="key"\r\n\r\nmy-books\r\n/);
		},
	);

	it('updates the counts and notices when a toggle changes them', async () => {
		const firstOpen = nextOpen();
		run = runContentImport(plugin, { kind: 'vault' });
		await firstOpen;

		expect(shown.texts.join('\n')).toContain('will not be offered');
		expect(shown.texts.join('\n')).toContain('1 more are SRD content');

		let reopened = nextOpen();
		flip('Move early subclass features to level 3');
		await reopened;
		expect(shown.texts.join('\n')).toContain('will be moved to level 3');

		reopened = nextOpen();
		flip('Include SRD content');
		await reopened;
		expect(shown.texts.join('\n')).toContain('1 feat');
		expect(shown.texts.join('\n')).not.toContain('more are SRD content');

	});
});
