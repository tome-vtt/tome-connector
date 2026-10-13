/**
 * The server endpoints this plugin calls.
 *
 * One module because the paths were previously spread over eight files - a private
 * `ROUTES` map inside `sendablePayload.ts` that nothing else could reach, plus a
 * `CONTROLLER_PATH`/`ADD_CONTROLLER_PATH`/`IMPORT_PATH` const beside each sync entry
 * point, three of which were character-for-character copies of a `ROUTES` entry.
 *
 * Deliberately free of any `obsidian` import. The connector's tests run on Vitest
 * defaults with no module alias and no `obsidian` mock, so a module that reaches for it
 * cannot be imported from a test at all - which is why nothing currently covers the sync
 * entry points. Keeping this file dependency-free is what lets `routes.test.ts` assert
 * these values directly.
 *
 * The leading slash is cosmetic: `joinUrl` strips leading slashes from the path and
 * trailing ones from the base URL. It is kept for readability.
 *
 * Casing is inconsistent across these values and that is fine - ASP.NET matches routes
 * case-insensitively, and the two PascalCase entries match how their controllers are
 * spelled. They are recorded here exactly as the server sees them rather than
 * normalised, so this file can be compared against the controllers by eye.
 */
export const TOME_ROUTES = {
	/** `CampaignsController`, the one GET: the campaigns owned by the account behind the API key. */
	campaigns: '/api/campaigns',
	/** `NonPlayerCharactersController.AddNonPlayerCharacter` */
	addNonPlayerCharacter: '/api/nonplayercharacters/addnonplayercharacter',
	/** `EncountersController.AddEncounter` */
	addEncounter: '/api/encounters/addencounter',
	/** `MapsController.AddMap` */
	addMap: '/api/maps/addmap',
	/** `MagicItemsController.AddMagicItem` */
	addMagicItem: '/api/MagicItems/AddMagicItem',
	/** `EquipmentItemsController.AddEquipmentItem` */
	addEquipmentItem: '/api/EquipmentItems/AddEquipmentItem',
	/** `SpellsController.AddSpell` */
	addSpell: '/api/Spells/AddSpell',
	/** `PlayerCharactersController.AddPlayerCharacter` */
	addPlayerCharacter: '/api/playercharacters/addplayercharacter',
	/**
	 * `CharacterVaultController.Import`.
	 *
	 * The account's own shelf rather than a campaign library, so a send to it carries no
	 * `X-Campaign-Id` header at all - that absence is what makes the request account-scoped.
	 * Like `importContentSource` below, the trailing segment is a literal route rather than an
	 * action name.
	 */
	importVaultCharacter: '/api/vault/characters/import',
	/** `PropsController.AddProp` */
	addProp: '/api/props/addprop',
	/** `ReferencesController.UploadReference` */
	uploadReference: '/api/references/uploadreference',
	/**
	 * `ContentSourcesController.Import`.
	 *
	 * The one route that is not `api/{controller}/{action}`: that controller is routed
	 * `[Route("api/[controller]")]` and the action carries `[HttpPost("import")]`, so
	 * `import` is a literal segment rather than an action name. Any helper that builds a
	 * path from a controller and action pair would get this one wrong.
	 */
	importContentSource: '/api/ContentSources/import',
	/** `StorybookController.ImportAdventure` */
	importAdventure: '/api/Storybook/ImportAdventure',
	/** `StorybookController.ResolveLinks` */
	resolveLinks: '/api/Storybook/ResolveLinks',
} as const;

/** Any path in {@link TOME_ROUTES}. */
export type TomeRoute = (typeof TOME_ROUTES)[keyof typeof TOME_ROUTES];
