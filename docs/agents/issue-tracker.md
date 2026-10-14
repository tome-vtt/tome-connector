# Issue tracker: Spider

Issues and specs for this repo live in the Spider tracker, not Linear or GitHub Issues. `silk.yml` sets `tracker: { type: spider, prefix: TC }`, so ticket ids look like `TC-S5-T1`. Hand-driven sessions use the Spider plugin's tracker tools (`mcp__plugin_spider_tracker__*`) with `repo: "tome-connector"`. A Spider job has none: its outcome marker carries what it finds.

The old Linear team (`TC-123` ids) is no longer worked; its tickets were not imported.

Spider groups tickets into **strands** (a feature, bug or chore). Every ticket belongs to one strand.

## Conventions

- **Search before filing**: `search` (`query`, `openOnly: true`). Comment on an existing ticket instead of filing a duplicate.
- **Create a strand**: `create_strand` (`kind`: `feature` | `bug` | `chore`, `title`, `description`).
- **Create a ticket**: `file_ticket` (`strandId`, `title`, `description`, optional `blockerIds`, `labels`, `priority`). It lands in `Unsorted`. Pass `state: "Backlog"` only when Bart asked for the ticket.
- **Descriptions**: markdown. Open with a non-empty `## In short` section of plain sentences, then the ticket layout.
- **Read a ticket**: `read_ticket` (`id`).
- **List a queue**: `list_queue` (`state`).
- **Comment**: `comment`.
- **Change state**: `transition` (`id`, `state`).
- **Labels**: `add_label` / `remove_label` / `set_labels`.
- **Blockers**: `add_blocker` / `remove_blocker` / `set_blockers`.

## Dispatch queues

Spider runs agent jobs on tickets in the `queue` states of `silk.yml`'s `stages`: `Needs-Build`, `Needs-Review`, `Needs-Revision`, `Needs-Triage`. Moving a ticket into one starts a job, so only Bart moves a ticket to `Needs-Build`. `Backlog` and `Unsorted` are never dispatched. `Stuck` and `Asked` wait on a person. `Landed` is done; `Wont-Do`, `Duplicate` and `Superseded` are dropped.
