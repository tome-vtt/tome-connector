import { describe, expect, it } from 'vitest';

import { PLAYER_CHARACTER_PROPERTIES, playerCharacterBody } from '../src/playerCharacterBody';
import { parsePcSheet } from '../src/tomePcSheetParser';

describe('PLAYER_CHARACTER_PROPERTIES', () => {
	/**
	 * The send path passes only these frontmatter properties to the mapper. A key the mapper
	 * reads but the list drops passes every body test and silently sends nothing, so the keys
	 * are observed being read rather than restated.
	 */
	it('is exactly the frontmatter the body mapper reads', () => {
		const read = new Set<string>();
		const frontmatter = new Proxy<Record<string, unknown>>(
			{},
			{
				get: (_target, key) => {
					if (typeof key === 'string') read.add(key);
					return undefined;
				},
				has: (_target, key) => {
					if (typeof key === 'string') read.add(key);
					return false;
				},
			},
		);

		playerCharacterBody(frontmatter, parsePcSheet(''));

		expect([...read].sort()).toEqual([...PLAYER_CHARACTER_PROPERTIES].sort());
	});
});
