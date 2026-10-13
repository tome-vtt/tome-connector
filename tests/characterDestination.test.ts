import { describe, expect, it } from 'vitest';

import {
	destinationOptions,
	encodeDestination,
	initialDestinationValue,
	parseDestination,
	recallDestination,
	requestFor,
	VAULT_DESTINATION_LABEL,
	VAULT_DESTINATION_VALUE,
	type DestinationCampaign,
} from '../src/characterDestination';

const CAMPAIGNS: DestinationCampaign[] = [
	{ id: '11111111-1111-1111-1111-111111111111', name: 'Ashen Coast' },
	{ id: '22222222-2222-2222-2222-222222222222', name: 'The Long Winter' },
];

describe('destinationOptions', () => {
	it('offers the vault first, then every campaign', () => {
		expect(destinationOptions(CAMPAIGNS)).toEqual([
			{ value: VAULT_DESTINATION_VALUE, label: VAULT_DESTINATION_LABEL },
			{ value: CAMPAIGNS[0]!.id, label: 'Ashen Coast' },
			{ value: CAMPAIGNS[1]!.id, label: 'The Long Winter' },
		]);
	});

	/** The account this feature exists for: a player who has never run a table. */
	it('still offers the vault when the account has no campaigns', () => {
		expect(destinationOptions([])).toEqual([
			{ value: VAULT_DESTINATION_VALUE, label: VAULT_DESTINATION_LABEL },
		]);
	});

	/**
	 * The sentinel shares a dropdown with campaign ids, so it must be a value no campaign id
	 * can take. Restated here rather than read off the constant, the way `routes.test.ts` does.
	 */
	it('uses a sentinel that cannot collide with a campaign id', () => {
		expect(VAULT_DESTINATION_VALUE).toBe('vault');
		expect(CAMPAIGNS.some((campaign) => campaign.id === VAULT_DESTINATION_VALUE)).toBe(false);
	});
});

describe('parseDestination', () => {
	it('reads the sentinel back as the vault', () => {
		expect(parseDestination(VAULT_DESTINATION_VALUE)).toEqual({ kind: 'vault' });
	});

	it('reads anything else back as that campaign', () => {
		expect(parseDestination(CAMPAIGNS[1]!.id)).toEqual({
			kind: 'campaign',
			campaignId: CAMPAIGNS[1]!.id,
		});
	});
});

describe('initialDestinationValue', () => {
	it('opens on the vault when that is what was chosen last', () => {
		const opened = initialDestinationValue(CAMPAIGNS, {
			destination: VAULT_DESTINATION_VALUE,
			campaignId: CAMPAIGNS[0]!.id,
		});

		expect(opened).toBe(VAULT_DESTINATION_VALUE);
	});

	it('opens on the remembered campaign when it is still there', () => {
		const opened = initialDestinationValue(CAMPAIGNS, {
			destination: 'campaign',
			campaignId: CAMPAIGNS[1]!.id,
		});

		expect(opened).toBe(CAMPAIGNS[1]!.id);
	});

	/**
	 * A remembered campaign can be deleted in Tome. Opening on it would show a dropdown whose
	 * displayed value is not one of its own options.
	 */
	it('falls back to the first campaign when the remembered one is gone', () => {
		const opened = initialDestinationValue(CAMPAIGNS, {
			destination: 'campaign',
			campaignId: 'a-campaign-that-was-deleted',
		});

		expect(opened).toBe(CAMPAIGNS[0]!.id);
	});

	it('falls back to the vault when there is no campaign to fall back to', () => {
		const opened = initialDestinationValue([], {
			destination: 'campaign',
			campaignId: CAMPAIGNS[0]!.id,
		});

		expect(opened).toBe(VAULT_DESTINATION_VALUE);
	});
});

/**
 * Routes restated rather than read off `TOME_ROUTES`, the way `routes.test.ts` does. The two
 * frontmatter properties are independent on purpose: a note sent to both destinations is two
 * characters in Tome, and one id must not overwrite the other's record.
 */
describe('requestFor', () => {
	/**
	 * My Characters is account-scoped: no campaign id, so no `X-Campaign-Id` header. Sending the
	 * remembered campaign anyway would 401 the whole request when the key owner no longer owns it.
	 */
	it('sends My Characters to the vault import, unscoped, recorded under tome_vault_id', () => {
		expect(requestFor({ kind: 'vault' })).toEqual({
			route: '/api/vault/characters/import',
			campaignId: undefined,
			frontmatterKey: 'tome_vault_id',
		});
	});

	it('sends a campaign to AddPlayerCharacter, scoped to that campaign, recorded under tome_id', () => {
		expect(requestFor({ kind: 'campaign', campaignId: CAMPAIGNS[1]!.id })).toEqual({
			route: '/api/playercharacters/addplayercharacter',
			campaignId: CAMPAIGNS[1]!.id,
			frontmatterKey: 'tome_id',
		});
	});
});

describe('remembered destination', () => {
	it('stores My Characters as the sentinel and a campaign as "campaign"', () => {
		expect(encodeDestination({ kind: 'vault' })).toBe('vault');
		expect(encodeDestination({ kind: 'campaign', campaignId: CAMPAIGNS[0]!.id })).toBe('campaign');
	});

	it('round-trips My Characters, whatever campaign is remembered beside it', () => {
		const stored = encodeDestination({ kind: 'vault' });

		expect(recallDestination({ destination: stored, campaignId: CAMPAIGNS[0]!.id })).toEqual({ kind: 'vault' });
	});

	/** The campaign's id lives in the shared `campaignId` setting, not in the stored value. */
	it('round-trips a campaign through the shared campaignId setting', () => {
		const campaign = { kind: 'campaign', campaignId: CAMPAIGNS[1]!.id } as const;
		const stored = encodeDestination(campaign);

		expect(recallDestination({ destination: stored, campaignId: campaign.campaignId })).toEqual(campaign);
	});

	/**
	 * An install from before the vault existed back-fills to 'campaign'; anything else unknown
	 * reads the same way, since a campaign is where every send went before this choice existed.
	 */
	it.each(['', 'Vault', 'something-from-a-future-version'])(
		'reads the unknown value %j as the remembered campaign',
		(value) => {
			expect(recallDestination({ destination: value, campaignId: CAMPAIGNS[0]!.id })).toEqual({
				kind: 'campaign',
				campaignId: CAMPAIGNS[0]!.id,
			});
		},
	);
});
