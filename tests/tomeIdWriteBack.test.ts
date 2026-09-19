import { describe, expect, it } from 'vitest';
import { existingTomeId, isTomeId, writeTomeIdIntoNote } from '../src/tomeIdWriteBack';

const GUID = '3e8f6c30-0000-4000-8c00-000000000001';
const OLD = '3e8f6c30-0000-4000-8c00-000000000002';

/** Joins lines with `eol`, so each case can be run with LF and CRLF alike. */
const note = (eol: string, ...lines: string[]) => lines.join(eol);

describe.each([
	['LF', '\n'],
	['CRLF', '\r\n'],
])('writeTomeIdIntoNote on a %s note', (_label, eol) => {
	const before = ['# Goblins', '', 'Some text before.', '```statblock'];
	const after = ['```', '', 'Text after.', ''];

	it('adds the id before the closing fence and leaves everything else byte-identical', () => {
		const text = note(eol, ...before, 'name: Goblin', 'hp: 7', ...after);
		expect(writeTomeIdIntoNote(text, 3, 6, 'creature', GUID)).toBe(
			note(eol, ...before, 'name: Goblin', 'hp: 7', `id: ${GUID}`, ...after),
		);
	});

	it('replaces an existing id in place', () => {
		const text = note(eol, ...before, 'name: Goblin', `id: ${OLD}`, 'hp: 7', ...after);
		expect(writeTomeIdIntoNote(text, 3, 7, 'encounter', GUID)).toBe(
			note(eol, ...before, 'name: Goblin', `id: ${GUID}`, 'hp: 7', ...after),
		);
	});

	it('leaves a nested id alone', () => {
		const text = note(eol, '```prop', 'name: Chest', 'owner:', '  id: someone', '```');
		expect(writeTomeIdIntoNote(text, 0, 4, 'prop', GUID)).toBe(
			note(eol, '```prop', 'name: Chest', 'owner:', '  id: someone', `id: ${GUID}`, '```'),
		);
	});

	it("keeps a Leaflet block's own id and writes Tome's under tome_id", () => {
		const text = note(eol, '```leaflet', 'id: my-map', 'image: [[Map.jpg]]', '```');
		expect(writeTomeIdIntoNote(text, 0, 3, 'leaflet', GUID)).toBe(
			note(eol, '```leaflet', 'id: my-map', 'image: [[Map.jpg]]', `tome_id: ${GUID}`, '```'),
		);
	});

	it("updates a Leaflet block's tome_id on a re-send", () => {
		const text = note(eol, '```leaflet', 'id: my-map', `tome_id: ${OLD}`, '```');
		expect(writeTomeIdIntoNote(text, 0, 3, 'leaflet', GUID)).toBe(
			note(eol, '```leaflet', 'id: my-map', `tome_id: ${GUID}`, '```'),
		);
	});

	it('writes a zoommap id under id', () => {
		const text = note(eol, '```zoommap', 'image: Assets/Map.jpg', '```');
		expect(writeTomeIdIntoNote(text, 0, 2, 'zoommap', GUID)).toBe(
			note(eol, '```zoommap', 'image: Assets/Map.jpg', `id: ${GUID}`, '```'),
		);
	});
});

describe('isTomeId', () => {
	it.each([[GUID], [GUID.toUpperCase()]])('accepts %s', (value) => {
		expect(isTomeId(value)).toBe(true);
	});

	it.each([['my-map'], ['abc'], [''], [undefined], [42], [`${GUID}x`]])('refuses %o', (value) => {
		expect(isTomeId(value)).toBe(false);
	});
});

describe('existingTomeId', () => {
	it('reads a GUID under id', () => {
		expect(existingTomeId({ id: GUID })).toBe(GUID);
	});

	it("ignores a Leaflet map's own id", () => {
		expect(existingTomeId({ id: 'my-map' })).toBeUndefined();
	});

	it('prefers tome_id over id', () => {
		expect(existingTomeId({ id: OLD, tome_id: GUID })).toBe(GUID);
		expect(existingTomeId({ id: 'my-map', tome_id: GUID })).toBe(GUID);
	});

	it('recognises a legacy GUID under a Leaflet block\'s id as already sent', () => {
		expect(existingTomeId({ id: OLD, image: '[[Map.jpg]]' })).toBe(OLD);
	});
});
