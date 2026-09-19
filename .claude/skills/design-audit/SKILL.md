---
name: design-audit
description: One-shot read-only audit of tomevtt.client's design layer - SCSS duplication and drift, phone/tablet layout, accessibility, and correctness across the nine themes. Writes an interactive HTML report, then offers the high-severity findings as Linear issues.
disable-model-invocation: true
---

# Design Audit

Audit `tomevtt.client` for what **lint cannot see**. You are read-only: the
only file you write is the report, and the only outward action is Step 6, after
a yes. Run end to end in one session.

## Step 1 - Guards

Lint already fails the build on a class of design faults; a finding it would
catch is noise. Read the guards before judging anything:

- `tomevtt.client/.stylelintrc.json` - colour and z-index literals,
  `!important`, `::ng-deep`, nesting depth, `pointer` media queries.
- Every `tomevtt.client/scripts/verify-*.mjs` header comment - themes, tokens
  (tracking, motion), viewport units, geometry, file sizes.
- `tomevtt.client/src/app/shared/styles/_*.scss` and the structural `:root`
  block in `src/styles.scss` - the mixins and tokens that already exist.
  Recommendations route to these; a finding proposing what exists is invalid.
- The previous report: the newest `docs/design/*-audit-report.html`. Parse its
  `const REPORT`. Its findings are the **baseline**.

What this leaves is the audit's territory: a guard's *exemption comments* and
`EXCEPTIONS` lists (are the reasons still true?), and everything in Step 3.

**Done when:** you can state, per guard, the one-line rule it enforces, and
the baseline findings are loaded (or no prior report exists).

## Step 2 - Inventory

Every `.scss`, every inline `styles:`, and every component `.html` under
`tomevtt.client/src`. Templates matter as much as stylesheets - three of the
four passes read them.

**Done when:** the stylesheet count equals a glob of the tree, and each
excluded directory (`vendor/`, generated) is listed with its reason.

## Step 3 - Passes

Every pass over every inventoried file. A finding carries: id, pass, severity,
evidence (file, line, snippet), sites affected, and a recommendation concrete
enough to implement - a proposed name and API, or the exact token to use.
The majority pattern is the convention: a value most files hardcode is one
token-level finding, never one per file.

**Dispatch the four passes as four parallel subagents**, one `Agent` call
each in a single message, `general-purpose`. A subagent starts blank, so each
brief carries everything it needs and nothing from the other passes:

- its pass table below, verbatim, with the pass's preamble and the severity guide;
- the Step 1 guard rules, one line each, and the existing mixins and tokens -
  so it skips what lint catches and routes to what exists;
- the Step 2 inventory as a file list - the whole list, it covers every file;
- the baseline findings that belong to its pass, to mark `resolved`, `open`
  or `regressed`;
- read-only: it writes to the scratchpad alone (A1's script lives there);
- the return shape: one JSON array of findings in the fields above, plus the
  list of files it read. No prose.

Merge on return. A file missing from a subagent's read list is a gap: send
that subagent back for it (`SendMessage`) rather than covering it yourself.
Two passes flagging one site - S2 and T1 on the same button - is one finding
under the more severe pass, citing both ids. Spot-check each `high` against
the file before it enters the report; a subagent's line number is a claim.

### S - SCSS structure

| ID | Finding |
|----|---------|
| S1 | The same whitespace-normalized declaration block 3+ times across 2+ files, ignoring media-query wrappers and selector renames. |
| S2 | One UI concept (button, card, dialog header, badge, list row) styled with divergent spacing, radii or type sizes. |
| S3 | A literal repeated 4+ times across 3+ files with no token: spacing, font size, radius, shadow recipe, dimension. Cluster by frequency. |
| S4 | The same template structure plus styles in 2+ features - a standalone component, named, with its inputs. Style duplication is often template duplication wearing a wig. |
| S5 | Style *behaviour* without markup (hover lift, drag affordance, truncate-with-title) restated by hand - an attribute directive or a `shared/styles` mixin. |
| S6 | A hand-written copy of something `shared/styles` already provides. |

Every S recommendation states its budget cost: a component stylesheet is
capped at 6 kB **per file**, and `.ts`/`.html` at 700 lines. An extraction
that pushes a file over is the wrong extraction.

### R - Phone and tablet

Breakpoints are `$bp-*` in `_breakpoints.scss`; touch mode is the
`.coarse-pointer` class, never a media query.

| ID | Finding |
|----|---------|
| R1 | A fixed `width`/`min-width`/`height` above 320px, or a grid/flex track that cannot shrink, with no `$bp-*` rule answering it. |
| R2 | A feature whose stylesheets contain no narrow-width rule at all. List the feature; say what it does at 375px. |
| R3 | An interactive control under 44x44 CSS px with no `.coarse-pointer` enlargement. |
| R4 | A function reachable only by `:hover`, right-click, or a keyboard shortcut - nothing a thumb can do. `(hover: hover)` guarding a *decoration* is correct and is not a finding. |
| R5 | Overflow risk: `white-space: nowrap`, a long unbroken token, or a table with no scroll container or wrap rule. |
| R6 | A dialog's CDK `width`/`maxWidth` config string in `.ts` that ignores narrow screens. |

### A - Accessibility

| ID | Finding |
|----|---------|
| A1 | **Contrast.** For each foreground/background token pairing that stylesheets actually put together, compute the WCAG ratio in **all nine palettes** - write a scratchpad node script over `styles.scss`. Under 4.5:1 for text, 3:1 for large text and control boundaries. Report per pairing, listing the palettes that fail. |
| A2 | A focusable element with `outline: none` and no `focus-ring` mixin, or a custom control with no visible focus state. |
| A3 | A `<div>`/`<span>` with `(click)` and no role, `tabindex` and key handler; an icon-only button with no accessible name. |
| A4 | Motion longer than `--motion-feedback`, or any looping animation, with no `prefers-reduced-motion` answer. |
| A5 | State carried by colour alone - selected, error, owned, disabled - with no icon, text or shape beside it. |
| A6 | A form control with no associated label; a dialog with no `aria-labelledby` or title. |

### T - Theme correctness

`verify-themes.mjs` proves every palette declares every token. It cannot prove
a pairing *works*.

| ID | Finding |
|----|---------|
| T1 | A token used outside its role: `--color-on-accent` on a fill that is not accent, danger-solid or action; a text token as a border; a panel token as an input fill. |
| T2 | A rule guarded on one `[data-theme]` that is unsafe, or missing, in another of the same `color-scheme`. |
| T3 | A colour reaching a `<canvas>` by any route other than `board-visual-tokens.ts`. |
| T4 | A pinned-theme surface (auth card, `/confirm-email`, `/reset-password`, `/setup`, `/welcome`) reading a token from the document's theme rather than its own stamp (or, on `/welcome`, its `--lp-*` palette). |
| T5 | A `var(--token, <fallback>)` whose fallback would draw visibly wrong in a light palette. |
| T6 | A lint exemption comment or `EXCEPTIONS` entry whose stated reason the code no longer supports. |

Severity: `high` - a user on some device or theme cannot read or reach
something, or 3+ sites pay ongoing maintenance; `medium` - real, bounded;
`low` - polish, single file.

**Done when:** the four read lists together cover every inventoried file for every applicable pass,
A1's script has run against all nine palettes, and each baseline finding is
marked `resolved`, `open` or `regressed` with current evidence.

## Step 4 - Statistics

- Findings by pass and severity; baseline delta (resolved / open / regressed / new).
- Contrast matrix: pairing x palette, pass/fail with ratio.
- Narrow-width coverage: features with and without an R2 answer.
- Top 10 duplicated blocks and top 10 untokenized literals.
- Hot files by finding density.
- Opportunity table per S4/S5/S6 proposal: sites, lines removed, artifact, name, budget headroom after.

## Step 5 - Report

One self-contained file, `docs/design/design-audit-report.html`, replacing any
previous one (git keeps the history). Vanilla HTML/CSS/JS, no network, data
inline as `const REPORT = {...}`. It must itself work at 375px and in both
colour schemes - an audit that fails its own passes is not credible.

- Stat cards and plain-CSS bar charts: by pass, by severity, baseline delta.
- Contrast matrix, failing cells first.
- Findings: filter chips for pass, severity and baseline status; text search
  over paths and recommendations; expandable cards with evidence, sites with
  line numbers, and the proposed code in a copyable block.
- Sortable table: severity, pass, sites, lines saved.
- Opportunity panel, sorted by lines saved.

**Done when:** `REPORT` re-parses as JSON from the written file, every Step 3
finding appears exactly once, and the file is sent to the user with
`SendUserFile`. Then five lines: worst accessibility failure, worst
phone/tablet gap, worst theme fault, biggest duplication, top extraction.

## Step 6 - Linear

Ask, through the question interface, which findings to file: all `high`, a
picked subset, or none. File only on a yes.

Follow `docs/agents/issue-tracker.md`, through `mcp__linear-agent__*` alone.
Before each create, `list_issues` with the finding's key file or token as
`query`; an existing open issue gets a comment instead of a twin. Each issue:

- `team: "Tome VTT"`, state `Backlog`, labels `Improvement` plus
  `needs-triage` - the audit proposes, a person decides. No assignee, no
  delegate.
- Title: the fault, in the user's terms ("Initiative tracker unreadable at
  375px"), never the finding id.
- Description: evidence with `path:line`, the recommendation, the sites, the
  budget cost, and the finding id with the report path.
- One issue per finding; findings sharing one fix are one issue listing both.

**Done when:** every chosen finding maps to an issue id or a commented
existing issue, and the list of ids is given to the user.
