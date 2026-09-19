---
name: ready
description: >
  Claims N issues in the Tome Connector project's Ready column on Linear, moves each to
  In-Process, and builds them in parallel — one subagent and one isolated git
  worktree per issue — merging each into the current branch, removing its
  worktree, commenting a summary and moving it to Needs-Review. Use when the
  user invokes Ready-<n>, /ready <n>, or asks to
  work the Ready queue, where n is the number of subagents.
disable-model-invocation: true
---

Claim N Ready issues, build them in parallel worktrees, merge each into the current
branch, hand each to review.

Linear flow: **Ready → In-Process → Needs-Review**. Reviews are
`review`; fixes after review are `revision`.

## How many subagents

`Ready-3` means three; `/ready 3` likewise.

- **No number: ask** once (AskUserQuestion, offering 2 / 3 / 5). Never default silently.
- **Clamp to 5.** Every subagent shares one `tests` lock and one machine.
- **Clamp to the queue.** Claim what exists, say so, run that many.

## Checklist

```
- [ ] 1. Record the target branch
- [ ] 2. Claim N issues (every claim before any work)
- [ ] 3. Assign a worktree, branch and marker per issue
- [ ] 4. Dispatch N subagents with the build brief
- [ ] 5. Verify and report
```

## 1. Record the target branch

`$target = git -C $repo branch --show-current` with
`$repo = git rev-parse --show-toplevel` (the main tree, not a worktree). That is "the current branch"
every merge goes into. Detached HEAD, or no `origin/$target` to pull from and push to
(`git -C $repo rev-parse --verify origin/$target`): stop and say so.

## 2. Claim the whole batch first

Nothing is read, planned or checked out until all N are claimed — another agent may
be reading the same queue.

1. `list_issues` with `team: "Tome VTT"`, `project: "Tome Connector"`, `state: "Ready"`, `assignee: "null"`,
   `label: "ready-for-agent"`, then drop any whose `delegate` is set — it is claimed. If
   that finds nothing unexpectedly, confirm the name with `list_issue_statuses`. **Only
   `ready-for-agent` is claimed**: a `ready-for-human` issue is waiting on the user, and one
   with neither label has not been triaged. List the queue once more without the label
   filter and name both kinds in the report; never claim or relabel them.
2. Take the top N by priority. If the user named issues, use those, but verify each
   is still Ready, labelled `ready-for-agent`, with no assignee or delegate, and say so if not.
3. Claim each in **one** `save_issue` write — the **claim** from `docs/agents/issue-tracker.md` **and**
   `state: "In-Process"` together — one issue at a time, checking each answer. If
   someone else got there first, drop it and take the next.
4. For each claimed issue, `get_issue` and `list_comments`. The subagent gets both;
   it must not re-fetch to learn what it is building.
5. **Pre-screen before dispatching.** Read each issue and its comments. If **every** part
   of the remaining work needs a person — a decision only the user can make, a credential,
   a CAPTCHA or Turnstile, an outside dashboard or account, a human judgement the issue
   insists on — do not start a subagent: it would stop at the same point. Hand it back in
   one `save_issue` write (the status it was claimed from, assignee and delegate cleared,
   `removeLabels: ["ready-for-agent"]`, `addLabels: ["ready-for-human"]`) and comment
   exactly what the user has to do, and what an agent can finish once they have. If any
   part is agent work, dispatch as usual and let the subagent hand back the rest. When in
   doubt, dispatch.

Empty queue: say so and stop. Do not widen to another status, project, team, or GitHub.
**Never dispatch for an issue you did not claim.**

## 3. Per-issue assignments

Decide before dispatching so no two subagents share a path:

| | Value |
|---|---|
| `$wt` | `$repo\.claude\worktrees\<identifier-lowercased>` |
| `$branch` | Linear's `gitBranchName` if set, else `<identifier-lowercased>-<short-slug>` |
| `$marker` | `<identifier-lowercased>` |

## 4. Dispatch

One Agent call per issue, all in one message, running in the background. Each prompt
carries: the identifier, title, description, all comments, `$repo`, `$target`,
`$branch`, `$wt`, `$marker`, the fact that the issue was claimed **from Ready**
(where it goes back to if unfinished), and this instruction:

> Read `$repo\.claude\skills\ready\build-brief.md` (with `$repo` spelled out)
> and follow it exactly.

Do not poll; results arrive as notifications.

## 5. Verify and report

A subagent's summary is a self-report. Check it:

```powershell
git -C $repo log --oneline $target -12      # the merge commits are there
git -C $repo fetch origin; git -C $repo status -sb   # not ahead of origin: every merge pushed
git -C $repo worktree list                  # no worktree left behind
.claude/scripts/lock.ps1 status             # no lock stranded
```

Confirm each issue on Linear is in Needs-Review (or back in Ready) and unassigned. A
stale lock left by a killed subagent shows as STALE; break it with
`.claude/scripts/lock.ps1 break <name>` only then. A worktree left behind by a dead
subagent: put its issue back in Ready, then remove the worktree.

Report briefly: one line per issue (merged / handed back and why, and whether it now
waits on the user as `ready-for-human`), the skipped `ready-for-human` and unlabelled
issues, demos awaiting acceptance, whether `$target` is pushed (name any merge a subagent could not push, and push it
yourself after a pull), and a short section
explaining the work for a non-technical reader.
