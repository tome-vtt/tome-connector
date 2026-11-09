import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sync tag command's fallback: with no tag set it opens the connector's own settings
 * tab and puts the cursor in the sync tag field. `app.setting` is not in the public
 * typings, so it is faked here the way Obsidian shapes it.
 */

vi.mock('obsidian', () => ({
	PluginSettingTab: class {
		constructor(
			readonly app: unknown,
			readonly plugin: unknown,
		) {}
	},
	SecretComponent: class {},
	Setting: class {},
}));

const { TomeConnectorSettingTab } =
	await import('../src/tomeConnectorSettings');

function setup() {
	const calls: string[] = [];
	const app = {
		setting: {
			open: () => calls.push('open'),
			openTabById: (id: string) => calls.push(`openTabById:${id}`),
		},
	};
	const plugin = {
		manifest: { id: 'tome-connector' },
		settings: { syncTag: '' },
		saveSettings: vi.fn(),
	};
	const tab = new TomeConnectorSettingTab(app as never, plugin as never);

	const input = { focus: vi.fn() };
	const text = {
		inputEl: input,
		setPlaceholder: () => text,
		setValue: () => text,
		onChange: () => text,
	};
	const setting = {
		descEl: {
			createDiv: () => ({ setText: vi.fn(), toggleClass: vi.fn() }),
		},
		addText: (cb: (t: typeof text) => unknown) => (cb(text), setting),
	};
	const syncTag = tab
		.getSettingDefinitions()
		.find((d) => 'name' in d && d.name === 'Sync tag');
	(syncTag as unknown as { render(s: unknown): void }).render(setting);

	return { tab, calls, input };
}

describe('opening the settings at the sync tag field', () => {
	beforeEach(() => {
		// Tests run without a DOM; read on each call, so the faked timer is the one used.
		vi.stubGlobal('window', {
			get setTimeout() {
				return setTimeout;
			},
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("opens Obsidian's settings, then selects the connector's tab by its manifest id", () => {
		vi.useFakeTimers();
		const { tab, calls } = setup();

		tab.openAtSyncTag();

		expect(calls).toEqual(['open', 'openTabById:tome-connector']);
	});

	it('focuses the sync tag input once the pane has had time to render', () => {
		vi.useFakeTimers();
		const { tab, input } = setup();

		tab.openAtSyncTag();
		expect(input.focus).not.toHaveBeenCalled();

		vi.advanceTimersByTime(50);
		expect(input.focus).toHaveBeenCalledOnce();
	});
});
