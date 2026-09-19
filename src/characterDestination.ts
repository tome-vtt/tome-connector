/**
 * Where an "Import as PC to Tome" send is going, and everything decided from that.
 *
 * Deliberately free of any `obsidian` import, for the reason `routes.ts` records: the
 * connector's tests run on Vitest defaults with no module alias and no `obsidian` mock, so a
 * module that reaches for it cannot be imported from a test at all. Splitting the choice from
 * the modal that presents it is what makes the interesting half testable - and the choice is
 * the interesting half, since it decides the endpoint, whether the request is campaign-scoped,
 * and which frontmatter property records the result ({@link requestFor}), and how the choice
 * is remembered in settings ({@link encodeDestination} / {@link recallDestination}).
 *
 * It is also why the campaign shape is declared structurally below rather than imported from
 * `tomeCampaigns.ts`, which does reach for `obsidian`.
 */

import { TOME_ROUTES, type TomeRoute } from './routes';

/** Just enough of a Tome campaign to name it in a dropdown. */
export interface DestinationCampaign {
	readonly id: string;
	readonly name: string;
}

export type CharacterDestination =
	| { readonly kind: 'vault' }
	| { readonly kind: 'campaign'; readonly campaignId: string };

/**
 * The dropdown value standing for the account's own shelf.
 *
 * Not a GUID, and that is the point: every other value in the list is a campaign id, so a
 * sentinel that cannot be one can never be confused for a campaign that happens to be named
 * this. It is also what gets stored in settings, where it has to survive being read back
 * beside a real campaign id.
 */
export const VAULT_DESTINATION_VALUE = 'vault';

/** The label the Tome hub uses for the vault. Said the same way here so the two agree. */
export const VAULT_DESTINATION_LABEL = 'My Characters';

/**
 * The picker's options, the vault first.
 *
 * First rather than last because it is the destination a player has, where campaigns are the
 * destination a GM has - and a note carrying a `dndbeyond_id` is far more often the former.
 */
export function destinationOptions(
	campaigns: readonly DestinationCampaign[],
): readonly { readonly value: string; readonly label: string }[] {
	return [
		{ value: VAULT_DESTINATION_VALUE, label: VAULT_DESTINATION_LABEL },
		...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
	];
}

/** Reads a dropdown value back into the destination it names. */
export function parseDestination(value: string): CharacterDestination {
	return value === VAULT_DESTINATION_VALUE
		? { kind: 'vault' }
		: { kind: 'campaign', campaignId: value };
}

/**
 * What the picker opens on: the remembered choice, degraded to the vault when it names a
 * campaign that is not there any more.
 *
 * The degrade is the whole reason this is a function. A remembered campaign can be deleted in
 * Tome, and an install that has never chosen anything has no campaigns to default to at all -
 * a player who has only ever kept their own characters. Opening on a stale id would present a
 * dropdown whose displayed value is not in its own list.
 */
export function initialDestinationValue(
	campaigns: readonly DestinationCampaign[],
	remembered: { readonly destination: string; readonly campaignId: string },
): string {
	const recalled = recallDestination(remembered);
	if (recalled.kind === 'vault') return VAULT_DESTINATION_VALUE;
	if (campaigns.some((campaign) => campaign.id === recalled.campaignId)) {
		return recalled.campaignId;
	}
	return campaigns[0]?.id ?? VAULT_DESTINATION_VALUE;
}

/**
 * The value stored in the `characterDestination` setting. A campaign's id is not in it: that
 * goes in the shared `campaignId` setting, which the other senders open on too.
 */
export function encodeDestination(destination: CharacterDestination): string {
	return destination.kind === 'vault' ? VAULT_DESTINATION_VALUE : 'campaign';
}

/**
 * Reads the two settings back into a destination. Anything but the vault sentinel - the
 * `'campaign'` default an install from before the vault back-fills to, or a value nobody
 * wrote - is the remembered campaign, since a campaign is where every send went before.
 */
export function recallDestination(remembered: {
	readonly destination: string;
	readonly campaignId: string;
}): CharacterDestination {
	return remembered.destination === VAULT_DESTINATION_VALUE
		? { kind: 'vault' }
		: { kind: 'campaign', campaignId: remembered.campaignId };
}

/** Everything a send to one destination is addressed by, and where its result is recorded. */
export interface DestinationRequest {
	readonly route: TomeRoute;
	/**
	 * The `X-Campaign-Id` to send, undefined for the vault - which is what makes that request
	 * account-scoped: `requestHeaders` omits the header when it is falsy, and the server's
	 * API-key handler adds the campaign claim only when the header is there. Sending the
	 * remembered campaign "harmlessly" would be worse than useless - a campaign the key owner no
	 * longer owns fails the whole request with a 401, on an endpoint that reads no campaign.
	 */
	readonly campaignId: string | undefined;
	/**
	 * The frontmatter property that records the id the send came back with.
	 *
	 * Two properties rather than one because a note can legitimately be in both places - a
	 * character kept on the shelf and also placed at somebody's table - and they are two
	 * separate characters in Tome that do not sync to each other. Writing one id over the other
	 * would lose the record of where the earlier copy went.
	 *
	 * Neither is read back: the server upserts on the D&D Beyond id on both paths, so these are
	 * provenance for whoever opens the note. Keep it that way - starting to send one as an
	 * address would break the "deleted in Tome, re-import re-creates it" recovery the upsert
	 * gives free.
	 */
	readonly frontmatterKey: 'tome_vault_id' | 'tome_id';
}

export function requestFor(destination: CharacterDestination): DestinationRequest {
	return destination.kind === 'vault'
		? { route: TOME_ROUTES.importVaultCharacter, campaignId: undefined, frontmatterKey: 'tome_vault_id' }
		: { route: TOME_ROUTES.addPlayerCharacter, campaignId: destination.campaignId, frontmatterKey: 'tome_id' };
}
