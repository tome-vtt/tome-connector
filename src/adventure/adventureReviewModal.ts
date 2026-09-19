import { App, Modal, normalizePath } from 'obsidian';

import { groupEntities, groupImages, setAllEntities, setAllImages, summariseImport } from './adventureReviewRows';
import type {
	AdventurePlan,
	EntityDestination,
	ImageDestination,
	PlannedEntity,
	PlannedImage,
} from './adventurePlan';
import { renderCampaignSelector, type CampaignChoice } from '../tomeCampaigns';

/**
 * Shows what an adventure folder parsed into and waits for a yes, following
 * the `ConfirmSyncModal` idiom in `syncVaultToTome.ts`.
 *
 * **Groups collapsed by default, 50 rows at a time when expanded.** A big
 * book can carry a few hundred entities and images; the opening screen is a
 * handful of group headers, each `N creatures -> Send as NPCs` with a
 * set-all control beside it, and most runs never need to expand one at all.
 *
 * Image rows carry a thumbnail, because deciding whether a picture is a
 * battle map or a piece of scene art is a question about the picture and its
 * filename rarely answers it. See {@link renderThumbnail} for why that costs
 * nothing until a row is actually on screen.
 */

interface SelectOption<TTo extends string> {
	value: TTo;
	label: string;
}

/**
 * Short labels, not "Send as NPC" - the group header already names the
 * category ("31 creatures"), so the pill only has to name the destination.
 * That is also what keeps four of these plus a name fitting on one line at
 * Obsidian's default modal width; see the CSS rule this feeds for the rest
 * of the story.
 */
const ENTITY_OPTIONS: SelectOption<EntityDestination['to']>[] = [
	{ value: 'NonPlayerCharacter', label: 'NPC' },
	{ value: 'MagicItem', label: 'Magic item' },
	{ value: 'EquipmentItem', label: 'Equipment' },
	{ value: 'skip', label: 'Skip' },
];

const IMAGE_OPTIONS: SelectOption<ImageDestination['to']>[] = [
	{ value: 'Map', label: 'Map' },
	{ value: 'Prop', label: 'Prop' },
	{ value: 'skip', label: 'Skip' },
];

const PAGE_SIZE = 50;

/** Unique per call, so two rows' (or a group header's) radio inputs never group with each other. */
let choiceGroupCounter = 0;

/**
 * A strip of radio pills - every option named and visible, one click away.
 * Used both for a row's own destination and for a group header's set-all
 * control, so the two look identical and a set-all button says what it does
 * without a tooltip or opening the group to watch a row change.
 *
 * `current` is `null` for a set-all control: there is no single destination
 * that already applies to the whole group, only an action each pill performs.
 * Clicking one still lands on it looking checked, the same way a row's pill
 * does - it just also means "and everyone in this group now matches it".
 */
function renderChoices<TTo extends string>(
	parent: HTMLElement,
	options: SelectOption<TTo>[],
	current: TTo | null,
	onChange: (to: TTo) => void,
): void {
	const group = parent.createDiv({ cls: 'tome-connector-adventure-choices' });
	const name = `tome-adventure-choice-${choiceGroupCounter++}`;

	for (const option of options) {
		const pill = group.createEl('label', { cls: 'tome-connector-adventure-choice' });
		const input = pill.createEl('input', { attr: { type: 'radio', name } });
		input.checked = option.value === current;
		pill.toggleClass('is-checked', input.checked);
		// Checking a radio unchecks its group sibling without an event on the
		// loser, so the class is cleared across the whole group here rather
		// than each pill tending its own.
		input.addEventListener('change', () => {
			for (const sibling of Array.from(group.children)) {
				sibling.toggleClass('is-checked', sibling === pill);
			}
			onChange(option.value);
		});
		pill.createSpan({ text: option.label });
	}
}

function renderGroup<TTo extends string>(
	parent: HTMLElement,
	label: string,
	count: number,
	options: SelectOption<TTo>[],
	current: TTo,
	onSetAll: (to: TTo) => void,
	renderRows: (body: HTMLElement) => void,
): void {
	const details = parent.createEl('details', { cls: 'tome-connector-adventure-group' });
	const summary = details.createEl('summary');
	summary.createSpan({ text: `${count} ${label}` });

	const actions = summary.createDiv({ cls: 'tome-connector-adventure-group-actions' });
	// The pills sit inside <summary>, which toggles the details on any click -
	// without this, setting the whole group also collapses it underneath you.
	actions.addEventListener('click', (event) => event.stopPropagation());
	const body = details.createDiv({ cls: 'tome-connector-adventure-group-body' });

	// Defaults to the group's own key - a group is items sharing one
	// suggested destination, and `chosen` starts equal to `suggested`, so
	// that pill is what the library already says about every row inside it
	// until something is changed. Overriding a row still shows here as a
	// mismatch waiting to happen rather than a lie: clicking any pill sets
	// every row back to matching it, same as it always did.
	renderChoices(actions, options, current, (to) => {
		onSetAll(to);
		renderRows(body);
	});

	renderRows(body);
}

/**
 * A thumbnail served straight from the vault, never read into JavaScript.
 *
 * `getResourcePath` returns the `app://` URL Obsidian already serves vault
 * files to its own renderer on, so the browser does the fetching and
 * decoding and this costs no `readBinary` at all - which is what makes a
 * couple of hundred of them affordable. `loading="lazy"` then means the rows
 * below the fold are never fetched in the first place, so opening a group of
 * 240 illustrations pays for the handful actually in view.
 *
 * The alt text is empty on purpose: the label beside it already names the
 * image, and a screen reader should not read the same thing twice.
 */
function renderThumbnail(app: App, row: HTMLElement, path: string): void {
	const img = row.createEl('img', { cls: 'tome-connector-adventure-thumb' });
	img.src = app.vault.adapter.getResourcePath(normalizePath(path));
	img.loading = 'lazy';
	img.alt = '';
}

export class AdventureReviewModal extends Modal {
	private confirmed = false;
	private coverSection!: HTMLElement;
	private campaignId: string;

	constructor(
		app: App,
		private readonly plan: AdventurePlan,
		private readonly choice: CampaignChoice,
		/** The chosen campaign on Send (the plan is edited in place), null on Cancel or Close. */
		private readonly onDone: (campaignId: string | null) => void,
	) {
		super(app);
		this.campaignId = choice.campaignId;
	}

	override onOpen(): void {
		this.modalEl.addClass('tome-connector-adventure-modal');
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: `Import "${this.plan.title}"` });
		renderCampaignSelector(contentEl, this.choice, (campaignId) => {
			this.campaignId = campaignId;
		});
		contentEl.createEl('p', { text: summariseImport(this.plan) });

		// First, above every group: a cover is a decision about the whole book,
		// not one row among the images inside it. Defaulted by adventureCover.ts
		// before the modal ever opens - a cover-named file if the folder has one,
		// otherwise a random non-map picture - so this always starts on a real
		// answer for the GM to verify or override, never on an empty prompt.
		this.coverSection = contentEl.createDiv({ cls: 'tome-connector-adventure-cover' });
		this.renderCover();

		for (const group of groupEntities(this.plan.entities)) {
			renderGroup(
				contentEl,
				group.label,
				group.items.length,
				ENTITY_OPTIONS,
				group.key,
				(to) => setAllEntities(group.items, { to }),
				(body) => this.renderEntityRows(body, group.items),
			);
		}
		for (const group of groupImages(this.plan.images)) {
			renderGroup(
				contentEl,
				group.label,
				group.items.length,
				IMAGE_OPTIONS,
				group.key,
				(to) => setAllImages(group.items, { to }),
				(body) => this.renderImageRows(body, group.items),
			);
		}

		this.renderButtons(contentEl);
	}

	private renderEntityRows(body: HTMLElement, items: PlannedEntity[], shown = PAGE_SIZE): void {
		body.empty();
		for (const item of items.slice(0, shown)) {
			const row = body.createDiv({ cls: 'tome-connector-adventure-row' });
			row.createSpan({ cls: 'tome-connector-adventure-label', text: item.tomeName });
			renderChoices(row, ENTITY_OPTIONS, item.chosen.to, (to) => {
				item.chosen = { to };
			});
		}
		this.renderShowMore(body, items.length, shown, () => this.renderEntityRows(body, items, shown + PAGE_SIZE));
	}

	private renderImageRows(body: HTMLElement, items: PlannedImage[], shown = PAGE_SIZE): void {
		body.empty();
		for (const item of items.slice(0, shown)) {
			const row = body.createDiv({ cls: 'tome-connector-adventure-row' });
			renderThumbnail(this.app, row, item.dmPath);

			const text = row.createDiv({ cls: 'tome-connector-adventure-label' });
			text.createDiv({ text: item.label });
			// The filename is what distinguishes two images whose alt text is the
			// same word, which in a gallery of room maps is most of them.
			text.createDiv({ cls: 'tome-connector-adventure-sub', text: item.dmPath.split('/').pop() ?? item.dmPath });
			if (item.playerPath) {
				text.createDiv({ cls: 'tome-connector-adventure-sub', text: 'has a player version' });
			}

			renderChoices(row, IMAGE_OPTIONS, item.chosen.to, (to) => {
				item.chosen = { to };
			});
		}
		this.renderShowMore(body, items.length, shown, () => this.renderImageRows(body, items, shown + PAGE_SIZE));
	}

	private renderShowMore(body: HTMLElement, total: number, shown: number, onClick: () => void): void {
		if (total <= shown) return;
		body
			.createEl('button', { text: `Show ${Math.min(PAGE_SIZE, total - shown)} more` })
			.addEventListener('click', onClick);
	}

	/** The cover row: a thumbnail and label, or "No cover" - plus a "Change..." button when the book has any images to choose among. */
	private renderCover(): void {
		const section = this.coverSection;
		section.empty();
		section.createEl('h4', { text: 'Cover Image' });

		const row = section.createDiv({ cls: 'tome-connector-adventure-cover-row' });
		const cover = this.plan.images.find((image) => image.key === this.plan.coverKey);
		if (cover) {
			renderThumbnail(this.app, row, cover.dmPath);
			row.createSpan({ cls: 'tome-connector-adventure-label', text: cover.label });
		} else {
			row.createSpan({ cls: 'tome-connector-adventure-sub', text: 'No cover' });
		}

		// Nothing to change to - a folder with no pictures at all stays uncovered,
		// and the client shows its own book-icon placeholder for that.
		if (this.plan.images.length === 0) return;

		const change = section.createEl('button', { text: 'Change...' });
		change.addEventListener('click', () => this.renderCoverPicker());
	}

	/** Replaces the "Change..." button with every image in the book, one click each - same idiom as an entity/image group, minus the destination pills. */
	private renderCoverPicker(): void {
		const picker = this.coverSection.createDiv({ cls: 'tome-connector-adventure-cover-picker' });

		const none = picker.createEl('button', { text: 'No cover' });
		none.addEventListener('click', () => {
			this.plan.coverKey = null;
			this.renderCover();
		});

		this.renderCoverOptions(picker.createDiv(), this.plan.images);
	}

	private renderCoverOptions(body: HTMLElement, items: PlannedImage[], shown = PAGE_SIZE): void {
		body.empty();
		for (const image of items.slice(0, shown)) {
			const option = body.createDiv({ cls: 'tome-connector-adventure-cover-option' });
			renderThumbnail(this.app, option, image.dmPath);
			option.createSpan({ text: image.label });
			option.addEventListener('click', () => {
				this.plan.coverKey = image.key;
				this.renderCover();
			});
		}
		this.renderShowMore(body, items.length, shown, () => this.renderCoverOptions(body, items, shown + PAGE_SIZE));
	}

	private renderButtons(parent: HTMLElement): void {
		const buttons = parent.createDiv({ cls: 'tome-connector-sync-buttons' });
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());

		const send = buttons.createEl('button', { text: 'Send', cls: 'mod-cta' });
		send.addEventListener('click', () => {
			this.confirmed = true;
			this.close();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onDone(this.confirmed ? this.campaignId : null);
	}
}
