import { describe, expect, it } from 'vitest';

import { renderBlockText } from '../src/adventure/adventureLinkRewrite';
import type { BlockRef } from '../src/adventure/adventurePlan';

describe('renderBlockText link rewriting', () => {
	it('turns a resolved ref back into a Tome link', () => {
		const text = 'A Goblin attacks.';
		const refs: BlockRef[] = [{ entity: 'bestiary/goblin.md', text: 'Goblin', start: 2, end: 8 }];
		const resolved = new Map([['bestiary/goblin.md', { libraryKind: 'NonPlayerCharacter', id: 'abc-123' }]]);

		expect(renderBlockText(text, refs, [], resolved, new Set())).toBe('A [Goblin](tome:NonPlayerCharacter/abc-123) attacks.');
	});

	it('leaves an unresolved ref as the flat text it already is', () => {
		const text = 'A Goblin attacks.';
		const refs: BlockRef[] = [{ entity: 'bestiary/goblin.md', text: 'Goblin', start: 2, end: 8 }];

		expect(renderBlockText(text, refs, [], new Map(), new Set())).toBe(text);
	});

	it('rewrites several refs without letting an earlier splice invalidate a later offset', () => {
		const text = 'The Goblin guards a Bag of Holding.';
		const refs: BlockRef[] = [
			{ entity: 'bestiary/goblin.md', text: 'Goblin', start: 4, end: 10 },
			{ entity: 'items/bag.md', text: 'Bag of Holding', start: 20, end: 34 },
		];
		const resolved = new Map([
			['bestiary/goblin.md', { libraryKind: 'NonPlayerCharacter', id: 'npc-1' }],
			['items/bag.md', { libraryKind: 'MagicItem', id: 'item-1' }],
		]);

		expect(renderBlockText(text, refs, [], resolved, new Set())).toBe(
			'The [Goblin](tome:NonPlayerCharacter/npc-1) guards a [Bag of Holding](tome:MagicItem/item-1).',
		);
	});

	it('leaves text with no refs untouched', () => {
		expect(renderBlockText('Nothing to rewrite.', [], [], new Map(), new Set())).toBe('Nothing to rewrite.');
	});
});
