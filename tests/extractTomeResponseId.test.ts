import { describe, expect, it } from 'vitest';
import { extractResponseId } from '../src/tomeHttp';

const ID = '115051de-2f9f-4a8f-a9f7-c7decd622da2';

describe('extractResponseId', () => {
	it('extracts an id from an entity response', () => {
		expect(extractResponseId(JSON.stringify({ id: ID, name: 'Goblin' }))).toBe(
			ID,
		);
	});

	it('accepts a PascalCase entity id', () => {
		expect(extractResponseId(JSON.stringify({ Id: ID }))).toBe(ID);
	});

	it('unwraps a JSON string response', () => {
		expect(extractResponseId(JSON.stringify(ID))).toBe(ID);
	});

	it('accepts a bare id response', () => {
		expect(extractResponseId(ID)).toBe(ID);
	});

	it.each(['', '  ', '{}', '{"name":"Goblin"}', 'null']) (
		'returns null when the response has no id: %s',
		(response) => {
			expect(extractResponseId(response)).toBeNull();
		},
	);
});
