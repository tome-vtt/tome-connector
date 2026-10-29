import { describe, expect, it } from 'vitest';
import {
	buildChapterPlan,
	countChapters,
	type ExportItem,
	type FolderNode,
} from '../src/tomeChapterPlan';

function note(title: string, path?: string) {
	return { title, path: path ?? `${title}.md` };
}

function folder(
	name: string,
	notes: ReturnType<typeof note>[] = [],
	folders: FolderNode[] = [],
): FolderNode {
	return { name, notes, folders };
}

/** Compact view of a plan, so expectations read like the resulting outline. */
function outline(plan: ExportItem[]): string[] {
	return plan.map((item) => `${item.kind[0]}${item.level} ${item.title}`);
}

describe('buildChapterPlan', () => {
	it('emits the root folder’s notes as level 1 chapters, alphabetically', () => {
		const plan = buildChapterPlan(
			folder('Adventure', [note('Rooms'), note('Intro'), note('NPCs')]),
		);

		expect(outline(plan)).toEqual(['c1 Intro', 'c1 NPCs', 'c1 Rooms']);
	});

	it('emits no heading for the selected folder itself', () => {
		const plan = buildChapterPlan(folder('Adventure', [note('Intro')]));

		expect(plan.some((item) => item.kind === 'group')).toBe(false);
	});

	it('sorts numerically so "Chapter 2" precedes "Chapter 10"', () => {
		const plan = buildChapterPlan(
			folder('Adventure', [
				note('Chapter 10'),
				note('Chapter 2'),
				note('Chapter 1'),
			]),
		);

		expect(outline(plan)).toEqual([
			'c1 Chapter 1',
			'c1 Chapter 2',
			'c1 Chapter 10',
		]);
	});

	it('sorts case-insensitively', () => {
		const plan = buildChapterPlan(
			folder('Adventure', [note('banana'), note('Apple')]),
		);

		expect(outline(plan)).toEqual(['c1 Apple', 'c1 banana']);
	});

	it('emits subfolders before the folder’s own notes by default', () => {
		const plan = buildChapterPlan(
			folder('Adventure', [note('Intro')], [folder('Rooms', [note('Cellar')])]),
		);

		expect(outline(plan)).toEqual(['g1 Rooms', 'c2 Cellar', 'c1 Intro']);
	});

	it('nests three levels deep at group 1/2/3 and chapter 2/3/4', () => {
		const plan = buildChapterPlan(
			folder(
				'Root',
				[],
				[
					folder(
						'One',
						[note('A')],
						[folder('Two', [note('B')], [folder('Three', [note('C')])])],
					),
				],
			),
		);

		expect(outline(plan)).toEqual([
			'g1 One',
			'g2 Two',
			'g3 Three',
			'c4 C',
			'c3 B',
			'c2 A',
		]);
	});

	it('clamps group and chapter levels once nesting runs past the limit', () => {
		const deep = folder(
			'Root',
			[],
			[
				folder(
					'D1',
					[],
					[
						folder(
							'D2',
							[],
							[folder('D3', [], [folder('D4', [], [folder('D5', [note('X')])])])],
						),
					],
				),
			],
		);

		expect(outline(buildChapterPlan(deep))).toEqual([
			'g1 D1',
			'g2 D2',
			'g3 D3',
			'g3 D4',
			'g3 D5',
			'c4 X',
		]);
	});

	it('skips a subtree that holds no notes, so attachment folders stay out', () => {
		const plan = buildChapterPlan(
			folder(
				'Adventure',
				[note('Intro')],
				[folder('attachments'), folder('_resources', [], [folder('icons')])],
			),
		);

		expect(outline(plan)).toEqual(['c1 Intro']);
	});

	it('still emits a group whose only notes live in a grandchild', () => {
		const plan = buildChapterPlan(
			folder('Root', [], [folder('One', [], [folder('Two', [note('B')])])]),
		);

		expect(outline(plan)).toEqual(['g1 One', 'g2 Two', 'c3 B']);
	});

	it('returns an empty plan for an empty folder', () => {
		expect(buildChapterPlan(folder('Empty'))).toEqual([]);
	});

	it('keeps both notes when two subfolders share a basename', () => {
		const plan = buildChapterPlan(
			folder(
				'Root',
				[],
				[
					folder('One', [note('Rooms', 'Root/One/Rooms.md')]),
					folder('Two', [note('Rooms', 'Root/Two/Rooms.md')]),
				],
			),
		);

		expect(plan.filter((item) => item.kind === 'chapter')).toEqual([
			{
				kind: 'chapter',
				title: 'Rooms',
				path: 'Root/One/Rooms.md',
				level: 2,
			},
			{
				kind: 'chapter',
				title: 'Rooms',
				path: 'Root/Two/Rooms.md',
				level: 2,
			},
		]);
	});

	it('does not mutate the caller’s arrays while sorting', () => {
		const notes = [note('B'), note('A')];
		const root = folder('Root', notes);

		buildChapterPlan(root);

		expect(notes.map((n) => n.title)).toEqual(['B', 'A']);
	});
});

describe('countChapters', () => {
	it('counts only chapters, not group headings', () => {
		const plan = buildChapterPlan(
			folder('Root', [note('A')], [folder('One', [note('B')])]),
		);

		expect(countChapters(plan)).toBe(2);
	});

	it('is zero for an empty plan', () => {
		expect(countChapters([])).toBe(0);
	});
});
