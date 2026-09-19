# Tome Connector

Tome Connector is an Obsidian plugin that sends selected note content to a
Tome server. Content is sent only when you select a **Send to Tome** button
or the character sync action.

## Requirements

- Obsidian 1.11.4 or later
- A reachable Tome server from 11 September 2026 or later (see below)
- A Tome API key for the account receiving the content

### Server compatibility

From version 1.1.0 the connector sends every creature, character, spell, magic
item and piece of equipment with its rules inside one named record - `dnd5e`
for D&D 5e, `pf2e` for Pathfinder 2e - beside the parts that belong to no rule
set, such as the name, the picture and the D&D Beyond ID. That is the only
shape a current Tome server accepts: it refuses the flat fields earlier
connectors sent, saying the note came from an out-of-date connector.

A Tome server older than that change does not read the named record, so
1.1.0 cannot fill in anything but names there. Keep 1.0.4 for such a server.

## Installation

Copy these release files into `.obsidian/plugins/tome-connector/` in your
vault:

- `main.js`
- `manifest.json`
- `styles.css`

Reload Obsidian, then enable **Tome Connector** under
**Settings -> Community plugins**.

## Configuration

Open **Settings -> Tome Connector** and configure:

- **Tome base URL**: The server origin. Defaults to the hosted service at
  `https://tomegaming.com/`; change it only if you run your own Tome server.
  Do not include an API action path.
- **API key**: Select or create an entry in Obsidian SecretStorage. The key is
  sent in the `X-Api-Key` header and is not stored in the plugin's `data.json`.
- **Sync tag**: A tag such as `#tome`. Notes carrying it are included by the
  *Send notes with the sync tag to Tome* command. Leave it empty and that
  command hides itself; the folder and vault commands never consult it.
- **Downscale images before sending**: On by default. See below.

The API key determines the Tome account. Before every campaign-scoped import, the
connector loads that account's campaigns and asks which one should receive the content.
It sends the selected id in the `X-Campaign-Id` header.

### Image size

By default, pictures are shrunk to fit Tome before they are uploaded - maps to
3072px on the longest edge, tokens to 1024px, cover art to 1600px - and
re-encoded as WebP, but only when that actually produces a smaller file. An
image already inside its cap is sent exactly as it is, and so are GIFs and SVGs,
which lose too much to a canvas to be worth re-encoding.

Turn **Downscale images before sending** off to upload originals untouched.
Before you do, know what Tome accepts:

| What you are sending | Ceiling | What happens above it |
| --- | --- | --- |
| Map background | 50 MB | Refused, with a message |
| Prop | 5 MB | Refused, with a message |
| Statblock, character, item or adventure cover art | 5 MB | **The entry is created without its picture, and nothing says so** |

The last row is the one worth remembering: an oversized token or item
illustration does not fail the send, it just quietly does not arrive. The
setting says as much the moment you switch it off.

This setting covers uploads only. Compiling a folder into a PDF reference is a
separate feature with its own image handling, described under *Send a folder as
a PDF reference*, and is not affected either way.

## Supported Content

The plugin adds send controls for:

- Fantasy Statblocks `statblock` YAML blocks
- Encounter `encounter` YAML blocks
- Map View `zoommap` and Leaflet `leaflet` YAML blocks
- Prop `prop` YAML blocks
- An image file, from its menu in the file explorer, as a map or a prop
- Player-character note properties
- JSON blocks containing a top-level `tome` encounter object
- Whole folders, compiled into a single PDF reference (see below)
- Whole folders, imported as a Storybook adventure - see
  [`docs/authoring-adventures.md`](docs/authoring-adventures.md) for the format, whether the
  folder came from `ttrpg-convert-cli` or was written by hand

An `image` in a statblock, map or prop block may be a vault path or a wikilink
(`image: [[Goblin.png]]`), resolved from the note the block is in, wherever in the
vault the file is. **An image that cannot be read stops that send** - for every kind,
including a magic item, equipment or spell in a vault sync, which used to go without its
art. Nothing is sent in its place, and a vault sync lists it as unresolvable.

Example JSON encounter:

```json
{
  "tome": {
    "name": "Goblin ambush",
    "encounterNpcs": [
      { "name": "Goblin", "quantity": 4 }
    ]
  }
}
```

On creation, Tome Connector writes the returned ID back into encounter, NPC,
map, and prop source blocks, as `id` - except a Leaflet block, whose `id` is
Leaflet's own map name, where it goes under `tome_id` instead. Only an ID Tome
issued (a GUID) is sent back on a later send. Player-character IDs are stored in the note's
frontmatter: `tome_id` for a character sent to a campaign, and `tome_vault_id`
for one sent to **My Characters**. They are separate properties because a note
can be sent to both, and those are two characters in Tome that do not sync to
each other. Later sends use those IDs where the API supports identity-based
updates.

A player-character send asks where it should go before it sends: **My
Characters**, the account's own shelf, or any campaign the API key's account
owns. Re-sending the same note updates the character it made the first time
rather than adding another, on either destination.

#### Character note properties

A player-character send reads these frontmatter properties, and no others: `name`, `race`,
`class`, `level`, `background`, `alignment`, `gender`, `xp`, `hp_max`, `hp_current`,
`hp_temp`, `ac`, `speed`, `proficiency_bonus`, the six ability scores (`str` to `cha`),
`dndbeyond_id`, `image`, and `classes`. Everything else on the sheet - proficiencies,
attacks, spells, features, inventory - is read from the tables in the note body.

A note with no `ac` sends no armour class at all, rather than zero: Tome gives a new
character its default and leaves an existing one's armour class as it was.

`class` is free text and is sent as written: `Barbarian 3`, `Rogue (Thief)` or
`Fighter (Champion) 3 / Rogue 2` are all fine, and Tome reads the classes out of the line
itself. A character with more than one class needs nothing further. The optional `classes`
property is for a note that wants to name each class explicitly, as a list of
`{ class, subclass, level }` objects or of strings written the way Tome prints them:

```yaml
classes:
  - { class: Fighter, subclass: Champion, level: 3 }
  - Wizard 2
```

### Send a folder as a PDF reference

Right-click a folder in the File Explorer and select **Send to Tome**. Every
note in the folder, including those in subfolders, is compiled into one PDF and
uploaded to the campaign's Reference library.

- Each note becomes a chapter that starts on a new page, and each subfolder
  becomes a part divider. The PDF's bookmark outline mirrors that structure,
  with each note's own headings nested beneath its chapter.
- Notes and folders are ordered as the File Explorer shows them, so `Chapter 2`
  comes before `Chapter 10`.
- Folders containing no notes, such as attachment folders, are skipped.
- Images and other attachments are resolved wherever they live in the vault and
  embedded in the PDF, so it is self-contained. They are first scaled down to
  fit 1600px on their longest edge - about 220 DPI across a Letter text column,
  past what the page can resolve - and re-encoded as JPEG. Artwork that is
  opaque apart from anti-aliased edges is flattened onto white, which the page
  already is; only images whose transparency is genuinely load-bearing, such as
  a cut-out token over a coloured callout, stay lossless PNG. An image is only
  replaced when the result is actually smaller, and SVGs are left as vector.
  The notice at the end reports the saving.
- The reference is named after the folder. Sending the same folder again
  replaces the existing reference rather than creating a second one.

Two limitations worth knowing:

- This action is **desktop only**. It prints through Chromium's PDF engine,
  which Obsidian's mobile app does not provide, so the menu item does not
  appear there. Every other feature of this plugin still works on mobile.
- The PDF is always rendered in the light theme. A dark theme prints as either
  a solid black page or near-invisible text.

## Data And Privacy

Tome Connector does not send data automatically. A send action transmits the
selected block, allowed character properties, or - for a folder export - the
rendered text of every note in the chosen folder to the configured Tome server.
Referenced images are read from the vault and embedded as base64 data. Unless
**Downscale images before sending** has been turned off, they are shrunk and
re-encoded first, so what reaches the server is smaller than what is in the
vault - see *Image size*. Nothing is uploaded to any third party at any point;
the resizing happens on your own machine, in Obsidian.

For block and character sends, a referenced image that cannot be read cancels
the request; local vault paths are not sent as a fallback. A folder export
instead drops the unreadable image and continues, marking the spot with a
"Missing attachment" placeholder that names only the link as written in the
note. A single stale link should not discard a book-length render, and because
the element is removed rather than left broken, no local filesystem path is
included either way. Unreadable images and notes are summarised in a notice and
listed in the developer console.

Images a note references by URL are left as URLs and are fetched by the PDF
renderer at print time, exactly as the reading view already fetches them.

A vault, tag, or folder send begins by enumerating the vault.
`getMarkdownFiles()` returns every markdown path in the vault, and a folder or
tag scope filters that list before anything is read; notes left in scope are
then read with `cachedRead` to find what can be sent. This runs only when you
invoke one of those commands, and it stops at a confirmation modal that names
what it found - nothing leaves the machine until you approve it.

The file list itself is not transmitted. A note's vault path is dropped when its
library entry is built, so a local path never reaches the server; paths appear
only in the local progress and failure reports. A content-source import uses
each note's filename as the entry key, so the name travels but the folder it sat
in does not.

Payloads and API keys are not written to the developer console. Failed server
responses may be logged to help diagnose API errors.

## Development

Install dependencies and run the checks from this directory:

```bash
npm ci
npm run build
npm test
npm run lint
```

Use `npm run dev` for a watch build. Production release artifacts are
`main.js`, `manifest.json`, and `styles.css`; `main.js` is generated and should
not be committed.

## Release

Releases are driven by the version in `manifest.json`. Bump it with `npm
version`, which updates `package.json`, `manifest.json`, and `versions.json`
together so the three stay aligned:

```bash
npm version patch    # or minor / major
git push --follow-tags
```

On every push to `main`, the `Release Obsidian plugin` workflow reads the
version from `manifest.json` and checks whether a release with that tag already
exists. If one does, the workflow stops there, so ordinary pushes that do not
change the version are a no-op. Otherwise it builds the plugin, attests build
provenance, and opens a **draft** release tagged with the version, with
`main.js`, `manifest.json`, and `styles.css` attached as assets.

Publish that draft to finish the release. Two rules matter for the Obsidian
plugin review:

- The tag must match the version exactly, with no `v` prefix.
- `main.js` and `manifest.json` must be attached to the release as assets. The
  review bot only reads published releases, so a draft holding the assets will
  be reported as missing them.

Never create a second release reusing a tag that already exists. GitHub allows a
draft to share a tag name with a published release, and the review bot will read
whichever one is published, even if it has no assets.
