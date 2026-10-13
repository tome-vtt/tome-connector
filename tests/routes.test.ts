import { describe, expect, it } from 'vitest';

import { TOME_ROUTES } from '../src/routes';

/**
 * These assertions restate the paths rather than importing them into the expectation,
 * which is the point: `routes.ts` and this file are two independent statements of the
 * same values, so a typo in one is caught by the other. Reading a constant back through
 * itself would prove nothing.
 */
describe('TOME_ROUTES', () => {
	it('addresses the endpoints the server exposes', () => {
		expect(TOME_ROUTES).toEqual({
			campaigns: '/api/campaigns',
			addNonPlayerCharacter: '/api/nonplayercharacters/addnonplayercharacter',
			addEncounter: '/api/encounters/addencounter',
			addMap: '/api/maps/addmap',
			addMagicItem: '/api/MagicItems/AddMagicItem',
			addEquipmentItem: '/api/EquipmentItems/AddEquipmentItem',
			addSpell: '/api/Spells/AddSpell',
			addPlayerCharacter: '/api/playercharacters/addplayercharacter',
			importVaultCharacter: '/api/vault/characters/import',
			addProp: '/api/props/addprop',
			uploadReference: '/api/references/uploadreference',
			importContentSource: '/api/ContentSources/import',
			importAdventure: '/api/Storybook/ImportAdventure',
			resolveLinks: '/api/Storybook/ResolveLinks',
		});
	});

	it('keeps every path rooted at /api', () => {
		for (const path of Object.values(TOME_ROUTES)) {
			expect(path.startsWith('/api/')).toBe(true);
			expect(path.endsWith('/')).toBe(false);
		}
	});
});
