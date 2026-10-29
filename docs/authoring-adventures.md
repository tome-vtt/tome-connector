# Writing an adventure by hand

The **Import as a Tome Storybook adventure** command (folder right-click, or the command
palette's "Import the current note's folder as a Storybook adventure") was built to ingest
[`ttrpg-convert-cli`](https://github.com/ebullient/ttrpg-convert-cli) output, but the format it
reads is a small, documented subset of plain Obsidian markdown - nothing here requires the CLI, a
particular plugin, or any frontmatter you don't already understand. This is that format, written
for someone authoring an adventure by hand rather than converting one from a published book.

## The shape

```
Adventures/
  The Ashen Bell/                     ← one folder = one adventure
    01 - Arrival in Milbrook.md       ← one note = one chapter
    02 - The Bell Tower.md
```

- **One folder is one adventure.** Its name becomes the adventure's title.
- **One note is one chapter.** Numbering the filenames (`01 - `, `02 - `, `01.`, `01)` are all
  recognised) is what puts them in the right order - a plain folder listing sorts `10 - Epilogue`
  before `2 - Goblin Arrows`, which is why the prefix matters. A note with no recognisable prefix
  still imports, just after every prefixed one and alphabetically among any others like it, so
  forgetting a number on one chapter doesn't cost you the rest of the folder.
- **Each `##` heading inside a chapter note is a scene.** Anything written before the first `##`
  becomes its own scene, titled after the chapter.

```markdown
## The Village Square

The square is empty except for a cart, abandoned mid-load.

> [!readaloud]
> A bell tolls once from the tower, though no rope moves.

> [!gm]
> Bram is lying about the well. Insight DC 14 catches the hesitation.

![[bell-tower-map.png|The Bell Tower]]

The party is ambushed by [[Goblin Boss]] and two [[Goblin]]s.
```

That one scene, read top to bottom, becomes: a GM-only prose block, a boxed read-aloud block, a
GM-note block, a Map or Prop node (see below), and an NPC node once per creature. No frontmatter
is required anywhere in this example.

## The three text shapes

| Written as | Becomes |
|---|---|
| A plain paragraph | A GM-only prose block |
| `> [!readaloud]` | Boxed text, sent to the players' table |
| Any other callout (`[!gm]`, `[!note]`, anything you invent) | A GM-only note |

There is no list of callout names to memorise beyond `readaloud` itself - every callout type that
isn't `readaloud` becomes a GM note, on the reasoning that guessing wrong the other way means
reading a secret out loud.

## Pictures and links

**A picture standing alone on its own line** - `![[file.png]]` or `![alt](file.png)`, nothing else
on that line - becomes its own Map or Prop node rather than staying words on the page. Tome guesses
Map when the filename or caption says so (`map`, `battlemap`, a `-dm`/`-player` naming pair),
or when an image is wider than it is tall and at least 1,000 pixels wide and 600 pixels high.
This size rule is a guess: large landscape art can qualify too. Other images default to Prop;
an unreadable image keeps its filename/caption guess. Explicit map/prop callouts take precedence
over the size rule, and every row's choice remains editable in the review.
A picture that shares its line with something else (a table cell, a list item)
stays put and flattens to its caption text.

**A wikilink to one of your own notes** - `[[Goblin Boss]]` - becomes an entity mention. Tome reads
the linked note to decide what it is:

- A note with a `statblock` fence, or frontmatter that declares one, becomes an **NPC**.
- A note shaped like a magic item or a piece of equipment becomes an **item**.
- Anything else is left unresolved - the block still sends, the mention still reads as prose, but
  no entity node is created for it. This is also what happens to a wikilink pointing at a note that
  doesn't exist.

The review screen that opens before anything sends is where a wrong guess gets corrected by hand,
same as any other row there. For the rare case where you'd rather state the destination outright -
the target note isn't written yet, or the guess keeps landing wrong - wrap the single link or
picture in its own callout instead:

```markdown
> [!npc]
> [[Goblin Boss]]

> [!map]
> ![[floorplan.png]]

> [!prop]
> ![[goblet.png]]
```

Each of these only fires when the callout contains *exactly* one link or one picture and nothing
else; a callout with more than that in it just becomes an ordinary GM note.

## Numbered headings

A heading shaped like a dungeon key - `B1: Guard Post`, `5A. Southwest Garden`, a bare `12` -
is pulled out of wherever it's nested and given its own scene, however deep it sits. This exists
for published dungeon crawls, where every room needs to stand alone at the table, and it can be a
surprise the first time you number a heading by hand and watch it move.

To turn it off for one chapter, add this to that chapter note's frontmatter:

```yaml
---
tome_room_promotion: false
---
```

Leaving it unset keeps today's behaviour - every existing CLI-imported chapter, which never sets
this, is unaffected.

## Renaming is safe

The first time a chapter or a scene heading is imported, Tome hands back an id and the connector
writes it into the note - `tome_chapter_id` in the chapter's own frontmatter, and a hidden
`%%tome_scene_id: ...%%` suffix on the scene's heading line. Neither is meant to be edited by
hand, and neither renders or prints - Obsidian hides `%%...%%` in both live preview and reading
view, the same way it already hides the CLI's own leftover comment stubs.

Once a chapter or scene carries one of these, renaming it in Obsidian and re-importing the folder
updates the same row in Tome rather than creating a new one beside the old one. Before this
existed, a rename produced an orphaned old chapter or scene and a new one in its place - if that
ever happens to you on an older import, the fix is a one-time manual cleanup in Tome, not something
that repeats once the ids are in place.

Two things worth knowing about the limit of this:

- **A chapter's un-headed lead-in scene has no heading to carry a marker.** It's always matched by
  title, the same way it always was - only scenes with their own `##` heading get rename tracking.
- **Copying a chapter or scene note also copies its id.** Tome resolves this safely (the first copy
  it sees keeps the id; the second falls back to matching by title, so nothing is silently merged),
  but if you're deliberately duplicating a chapter as a starting point for a new one, clear the
  copied `tome_chapter_id` line (or the `%%tome_scene_id: ...%%` suffixes) so the new copy gets its
  own identity on the next import rather than fighting the original for one.

Retitling the *adventure* itself - the book's own name, not a chapter or scene - is a separate,
already-existing rename path in Tome's own Storybook drawer; this format doesn't change it.

## An index note, if you want explicit control

Filename-prefix order is enough for most folders. If you want chapter order to be independent of
filenames - or you're used to the CLI's own convention - a note reading:

```markdown
# Index of The Ashen Bell

- [Arrival in Milbrook](./01-arrival.md)
- [The Bell Tower](./02-bell-tower.md)
```

anywhere in the folder is read first and, if found, wins outright: its own `# Index of <title>`
line becomes the adventure's title (overriding the folder name) and its link order becomes the
chapter order, filenames ignored entirely. This is the only way in for a folder whose chapter
notes have no numeric prefix at all, and it's what every CLI-generated adventure already ships
with.

## A worked example, start to finish

A minimal two-chapter folder that exercises everything above, with no index note:

```
The Ashen Bell/
  01 - Arrival in Milbrook.md
  02 - The Bell Tower.md
```

`01 - Arrival in Milbrook.md`:

```markdown
## The Village Square

The square is empty except for a cart, abandoned mid-load.

> [!readaloud]
> A bell tolls once from the tower, though no rope moves.

The party is ambushed by [[Goblin Boss]] and two [[Goblin]]s.
```

`02 - The Bell Tower.md`:

```markdown
## The Tower Interior

Rope, dust, and a ladder missing its bottom rungs.

### B1: Bell Chamber

The bell itself, cracked along one side.
```

Importing this folder produces one adventure, **The Ashen Bell** (the folder's own name, since
there's no index note), with two chapters in filename order. The second chapter's `### B1: Bell
Chamber` heading is a numbered-room shape, so it gets promoted to its own scene, sibling to "The
Tower Interior" rather than nested inside it - unless that chapter's frontmatter sets
`tome_room_promotion: false`, in which case it stays exactly where it's written. `[[Goblin Boss]]`
resolves to an NPC if a note by that name exists somewhere in the vault with a statblock in it;
otherwise it's plain prose with nothing sent for it, and the review screen is where that gets
corrected before anything goes out.

Re-import the same folder after renaming "The Village Square" to "The Bell Ringer's Square," and
because the connector already wrote a `%%tome_scene_id: ...%%` marker onto that heading the first
time through, the re-import updates that same scene's title in Tome rather than creating a second
one beside it.

## What this doesn't cover

This document is about the folder-import command specifically. Sending one thing at a time (a
statblock, a map, an encounter) and bulk-sending a folder or a vault into your libraries are
separate features with their own conventions - see the main `README.md` and Tome's own How To
("The Obsidian connector" chapter) for those.
