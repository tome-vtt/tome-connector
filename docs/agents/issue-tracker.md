# Issue tracker: Linear

Issues and specs for this repo live in Linear: team **Tome VTT** (key `TVVT`), project **Tome Connector** (https://linear.app/tomegaming/project/tome-connector-0db69abd67d4). Use the `linear-agent` MCP tools (load via ToolSearch if deferred); never `gh issue`.

The team is shared with other Tome repos, so every issue for this repo belongs to the **Tome Connector** project. Filter on it when listing.

## Conventions

- **Create an issue**: `save_issue` with `team: "Tome VTT"`, `project: "Tome Connector"`, markdown `description` (real newlines, no `\n` escapes).
- **Read an issue**: `get_issue` with the identifier (`TVVT-123`), then `list_comments`.
- **List issues**: `list_issues` with `project: "Tome Connector"`, plus state/label filters.
- **Comment**: `save_comment`.
- **Apply / remove labels**: `save_issue` with the issue id and the full new label set. Create a missing label with `create_issue_label` first.
- **Close**: `save_comment` with the reason, then `save_issue` with a `state` of Done (resolved) or Canceled (wontfix/duplicate).

Reference issues as `TVVT-123`. A GitHub PR that resolves one puts `Fixes TVVT-123` in its body.

## Pull requests as a triage surface

**PRs as a request surface: no.** PRs live on GitHub (`tome-vtt/tome-connector`) and aren't triaged.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team Tome VTT, project Tome Connector.

## When a skill says "fetch the relevant ticket"

`get_issue` and `list_comments` for the `TVVT-<n>` identifier.
