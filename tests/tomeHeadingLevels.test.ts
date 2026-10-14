import { describe, expect, it } from 'vitest';
import { planHeadingLevels } from '../src/tomeHeadingLevels';

describe('planHeadingLevels', () => {
	it('returns nothing for a note with no headings', () => {
		expect(planHeadingLevels([], 1)).toEqual([]);
	});

	it('nests a well-formed note under its chapter heading', () => {
		expect(planHeadingLevels([1, 2, 2, 3, 1], 1)).toEqual([2, 3, 3, 4, 2]);
	});

	it('closes the gap when a note never uses a top-level heading', () => {
		// Reserving `#` for the title and starting at `##` is common; the
		// result must still sit directly under the chapter.
		expect(planHeadingLevels([2, 3], 1)).toEqual([2, 3]);
	});

	it('treats repeated levels as siblings', () => {
		expect(planHeadingLevels([3, 3, 3], 2)).toEqual([3, 3, 3]);
	});

	it('normalizes a skipped level in the source', () => {
		// `##` then `####` then `###`: the last is a sibling of the middle one,
		// not a child of it.
		expect(planHeadingLevels([2, 4, 3], 1)).toEqual([2, 3, 3]);
	});

	it('clamps rather than dropping headings past the maximum', () => {
		expect(planHeadingLevels([1, 2, 3, 4], 5)).toEqual([6, 6, 6, 6]);
	});

	it('reopens the correct depth after returning to a shallower heading', () => {
		expect(planHeadingLevels([1, 2, 1], 3)).toEqual([4, 5, 4]);
	});

	it('maps the deepest source level onto the chapter’s first free level', () => {
		expect(planHeadingLevels([6, 6], 1)).toEqual([2, 2]);
	});

	it('does not mutate the input', () => {
		const levels = [1, 2, 3];
		planHeadingLevels(levels, 2);
		expect(levels).toEqual([1, 2, 3]);
	});
});
