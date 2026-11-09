import { describe, expect, it, vi } from 'vitest';

import type TomeConnectorPlugin from '../src/main';
import type { NoteSource } from '../src/scopeReader';

/**
 * Every caller starts a vault or folder sync with `void`, so an error thrown while it
 * reads notes or shows its dialog would otherwise be an unhandled rejection the user
 * never sees.
 */

const notices: string[] = [];
vi.mock('obsidian', () => ({
	Modal: class {},
	Notice: class {
		constructor(message: string) {
			notices.push(message);
		}
	},
	parseYaml: () => ({}),
}));
vi.mock('../src/tomeProgressNotice', () => ({
	TomeProgressNotice: class {
		setProgress(): void {}
		hide(): void {}
	},
}));
vi.mock('../src/tomeCampaigns', () => ({
	loadCampaignChoice: () =>
		Promise.resolve({
			campaigns: [{ id: 'c1', name: 'Campaign' }],
			campaignId: 'c1',
		}),
	renderCampaignSelector: () => undefined,
}));
vi.mock('../src/obsidianSendPorts', () => ({ obsidianSendPorts: () => ({}) }));
vi.mock('../src/tomeConnectorSettings', () => ({ getApiKey: () => '' }));
const sendToTome = vi.hoisted(() => vi.fn());
vi.mock('../src/sendModule', () => ({ sendToTome }));

const vault: NoteSource = {
	paths: () => ['Bestiary/gone.md'],
	tags: () => [],
	read: () =>
		Promise.reject(
			new Error('"Bestiary/gone.md" no longer exists in the vault.'),
		),
};
vi.mock('../src/vaultNotes', () => ({ vaultNotes: () => vault }));

const { runVaultSync } = await import('../src/syncVaultToTome');

const plugin = { app: {}, settings: {} } as unknown as TomeConnectorPlugin;

describe('a vault sync that fails before it sends', () => {
	it('shows a notice and sends nothing when a note cannot be read', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await runVaultSync(plugin, { kind: 'vault' });

		expect(notices).toEqual([
			'Tome connector: "Bestiary/gone.md" no longer exists in the vault.',
		]);
		expect(sendToTome).not.toHaveBeenCalled();
	});
});
