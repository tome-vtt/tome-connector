import { describe, expect, it } from 'vitest';

import { mapToEncounterPayload, parseCreatureEntry } from '../src/recognizers/encounter';

describe('parseCreatureEntry', () => {
	/** The form Initiative Tracker's own README leads with. */
	it('reads a count-prefixed entry', () => {
		expect(parseCreatureEntry({ 3: 'Goblin' })).toEqual({ name: 'Goblin', count: 3 });
	});

	it('reads a bare name as one', () => {
		expect(parseCreatureEntry('Bugbear')).toEqual({ name: 'Bugbear', count: 1 });
	});

	it('reads a name with overrides as one, discarding the overrides', () => {
		expect(parseCreatureEntry({ Goblin: { hp: 12, ac: 15 } })).toEqual({
			name: 'Goblin',
			count: 1
		});
	});

	it('reads the long form', () => {
		expect(parseCreatureEntry({ name: 'Goblin', quantity: 4 })).toEqual({
			name: 'Goblin',
			count: 4
		});
	});

	/**
	 * The plugin rolls `1d4` itself. The connector cannot, and importing four
	 * goblins because the die might have said four would be worse than importing
	 * one the GM can duplicate.
	 */
	it('treats a dice-roll count as one rather than guessing', () => {
		expect(parseCreatureEntry({ '1d4': 'Goblin' })).toEqual({ name: 'Goblin', count: 1 });
	});

	it.each([[''], ['   '], [null], [42], [[]]])('rejects %o', (input) => {
		expect(parseCreatureEntry(input)).toBeNull();
	});

	it('never returns a count below one', () => {
		expect(parseCreatureEntry({ 0: 'Goblin' })?.count).toBe(1);
	});
});

describe('mapToEncounterPayload', () => {
	it('maps an Initiative Tracker block', () => {
		const payload = mapToEncounterPayload({
			name: 'Goblin Ambush',
			creatures: [{ 3: 'Goblin' }, 'Bugbear']
		});

		expect(payload).toEqual({
			name: 'Goblin Ambush',
			encounterNpcs: [
				{ name: 'Goblin', quantity: 3 },
				{ name: 'Bugbear', quantity: 1 }
			]
		});
	});

	/**
	 * Tome tracks its own party and rolls its own initiative, so carrying these
	 * would imply an authority the import does not have.
	 */
	it('ignores party, players and the tracker-only fields', () => {
		const payload = mapToEncounterPayload({
			name: 'Ambush',
			party: 'The Company',
			players: ['Lyra'],
			rollHP: true,
			xp: 450,
			round: 2,
			creatures: ['Goblin']
		});

		expect(payload).toEqual({ name: 'Ambush', encounterNpcs: [{ name: 'Goblin', quantity: 1 }] });
	});

	/** Two groups of the same creature is a normal way to write an encounter. */
	it('combines repeated creatures rather than dropping one', () => {
		const payload = mapToEncounterPayload({
			name: 'Ambush',
			creatures: [{ 3: 'Goblin' }, { 3: 'Goblin' }]
		});

		expect(payload?.encounterNpcs).toEqual([{ name: 'Goblin', quantity: 6 }]);
	});

	it('accepts an encounter with no creatures yet', () => {
		expect(mapToEncounterPayload({ name: 'Empty' })).toEqual({
			name: 'Empty',
			encounterNpcs: []
		});
	});

	it.each([[{}], [{ name: '  ' }], [null], [['a']]])('rejects %o as unsendable', (input) => {
		expect(mapToEncounterPayload(input)).toBeNull();
	});

	it('carries an id so a re-send updates rather than duplicating', () => {
		const id = '3e8f6c30-0000-4000-8c00-000000000001';
		expect(mapToEncounterPayload({ name: 'A', id, creatures: [] })?.id).toBe(id);
	});

	it('drops a non-GUID id, which would fail model binding', () => {
		expect(mapToEncounterPayload({ name: 'A', id: 'abc', creatures: [] })).not.toHaveProperty('id');
	});
});
