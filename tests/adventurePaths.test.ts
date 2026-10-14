import { describe, expect, it } from 'vitest';

import { basename, stem } from '../src/adventure/adventurePaths';

describe('basename and stem', () => {
	it('take the last path segment, with and without its extension', () => {
		expect(basename('maps/room-1.webp')).toBe('room-1.webp');
		expect(stem('maps/room-1.webp')).toBe('room-1');
	});

	it('leave a bare name alone and strip only the last extension', () => {
		expect(basename('cover.png')).toBe('cover.png');
		expect(stem('a.b.png')).toBe('a.b');
		expect(stem('dir.d/noext')).toBe('noext');
	});
});
