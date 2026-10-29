import { describe, expect, it, vi } from 'vitest';

import type TomeConnectorPlugin from '../src/main';
import type { SyncScope } from '../src/scopeReader';

/**
 * The "Send to Tome" confirm dialog's wording, for a folder and for one note.
 *
 * `obsidian` is replaced by a `Modal` that records its text and its buttons; the
 * campaign list and the scan are stubbed, since only the wording is under test.
 */

const shown = { texts: [] as string[], buttons: new Map<string, () => void>() };

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
			shown.buttons.clear();
			this.onOpen();
		}
		close(): void {
			this.onClose();
		}
	}

	return { Modal, Notice: class {}, parseYaml: () => ({}) };
});

vi.mock('../src/tomeProgressNotice', () => ({
	TomeProgressNotice: class {
		setProgress(): void {}
		hide(): void {}
	},
}));
vi.mock('../src/tomeCampaigns', () => ({
	loadCampaignChoice: () => Promise.resolve({ campaigns: [{ id: 'c1', name: 'Campaign' }], campaignId: 'c1' }),
	renderCampaignSelector: () => undefined,
}));
vi.mock('../src/vaultNotes', () => ({ vaultNotes: () => ({}) }));
vi.mock('../src/obsidianSendPorts', () => ({ obsidianSendPorts: () => ({}) }));
vi.mock('../src/tomeConnectorSettings', () => ({ getApiKey: () => '' }));
vi.mock('../src/vaultSyncSteps', () => ({
	scanScope: () =>
		Promise.resolve({ sendables: [{ kind: 'creature', label: 'Goblin', path: 'Bestiary/Goblin.md' }], warnings: [] }),
}));

const { runVaultSync } = await import('../src/syncVaultToTome');

const plugin = { app: {}, settings: {} } as unknown as TomeConnectorPlugin;

/** Opens the dialog for `scope`, returns its text, and cancels it. */
async function dialogText(scope: SyncScope): Promise<string> {
	shown.texts = [];
	shown.buttons.clear();
	const run = runVaultSync(plugin, scope);
	await vi.waitFor(() => expect(shown.buttons.has('Cancel')).toBe(true));
	const text = shown.texts.join('\n');
	shown.buttons.get('Cancel')?.();
	await run;
	return text;
}

describe('the send confirm dialog', () => {
	it('names a folder and warns that a large one takes a while', async () => {
		const text = await dialogText({ kind: 'folder', folder: { path: 'Bestiary', name: 'Bestiary' } });

		expect(text).toContain('Found 1 creature in "Bestiary".');
		expect(text).toContain('This can take a while for a large folder.');
	});

	it('names a single note without its extension and drops the large-folder hint', async () => {
		const text = await dialogText({ kind: 'note', note: { path: 'Bestiary/Goblin.md', basename: 'Goblin' } });

		expect(text).toContain('Found 1 creature in "Goblin".');
		expect(text).not.toContain('large folder');
	});
});
