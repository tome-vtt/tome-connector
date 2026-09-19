# Issue tracker: Linear

Issues and specs for this repo live in Linear: team **Tome Connector** (key `TC`), project **TC** (https://linear.app/tomegaming/project/tc-0db69abd67d4). Use the `linear-agent` MCP tools (load via ToolSearch if deferred); never `gh issue`.

The team is this repo's own; every issue also belongs to the **TC** project. Filter on it when listing. Issues numbered `TVVT-…` were moved here and redirect to their `TC-…` ids.

## Conventions

- **Create an issue**: `save_issue` with `team: "Tome Connector"`, `project: "TC"`, markdown `description` (real newlines, no `\n` escapes).
- **Read an issue**: `get_issue` with the identifier (`TC-123`), then `list_comments`.
- **List issues**: `list_issues` with `project: "TC"`, plus state/label filters.
- **Comment**: `save_comment`.
- **Apply / remove labels**: `save_issue` with the issue id and the full new label set. Create a missing label with `create_issue_label` first.
- **Close**: `save_comment` with the reason, then `save_issue` with a `state` of `Finished` (resolved), `Canceled` (wontfix) or `Duplicate`.

The team's statuses: `Backlog`, `Ready`, `In-Progress`, `Needs-Review`, `Needs-Revision`, `Finished`, `Human-Review-Needed`, `Canceled`, `Duplicate`. The `ready`, `review` and `revision` skills in `.claude/skills/` move issues through them.

Reference issues as `TC-123`. A GitHub PR that resolves one puts `Fixes TC-123` in its body.

## Claiming as an agent app

A computer with an agent identity installed reaches Linear as that OAuth app's agent user (`tome-agent-one`, `tome-agent-two`): see `.claude/hooks/linear-token.mjs`. An app can never be an issue's assignee — Linear turns that into a delegation — so an agent claims by delegation alone and never names a person:

- **Claim**: `delegate: "me"` with `assignee: null`, in the same `save_issue` write as the state change. Read the answer back and check `delegateId` is the app before starting work.
- **Release / hand back**: `assignee: null` and `delegate: null`.
- **Queues**: drop every listed issue whose `delegate` is set. An issue with a delegate is claimed.

A session signed in as a person claims with `assignee: "me"` instead. Use only `mcp__linear-agent__*`; a connector signed in as a person writes as that person, and `.claude/hooks/agent-token.mjs` refuses it.

## Pull requests as a triage surface

**PRs as a request surface: no.** PRs live on GitHub (`tome-vtt/tome-connector`) and aren't triaged.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team Tome Connector, project TC.

## When a skill says "fetch the relevant ticket"

`get_issue` and `list_comments` for the `TC-<n>` identifier.
