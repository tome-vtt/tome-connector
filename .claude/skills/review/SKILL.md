---
name: review
description: >
  Claims N issues in the Tome Connector team's Needs-Review column on Linear, moves
  each to In-Progress, and reviews the merged work in parallel — one subagent per
  issue — then comments the review and moves each to Finished if it is clean or
  Needs-Revision with documented findings. Use when the user invokes
  Review-<n>, /review <n>, or asks to work the
  review queue.
disable-model-invocation: true
---

Claim N issues awaiting review, review each in parallel, then pass or bounce them.

Linear flow: **Needs-Review → In-Progress → Finished** (clean) **or Needs-Revision**
(findings). Builds come from `ready`; fixes from
`revision`.

Reviewing is **read-only**. No worktree, no edits, no commits, no merges — the
reviewer reads commits by sha, which do not move when the branch does.

## How many subagents

`Review-3` means three; `/review 3` likewise. No number:
ask once (AskUserQuestion, offering 2 / 3 / 5). Clamp to 5 and to what the queue
holds.

## 1. Claim the whole batch first

1. `list_issues` with `team: "Tome Connector"`, `project: "TC"`, `state: "Needs-Review"`,
   `assignee: "null"`, `label: "ready-for-agent"`, then drop any whose `delegate` is set —
   it is claimed. `ready-for-human` and unlabelled issues are not claimed; name them in the
   report.
2. Take the top N by priority, or the issues the user named (verify each is still
   Needs-Review, labelled `ready-for-agent`, with no assignee or delegate).
3. Claim each in **one** `save_issue` write — the **claim** from `docs/agents/issue-tracker.md` and
   `state: "In-Progress"` — one at a time, checking each answer; drop any lost race
   and take the next.
4. For each, `get_issue` and `list_comments`. Find the `Merge: <sha> into <branch>`
   lines. **No `Merge:` line** means there is nothing identifiable to review: put
   it back in Needs-Review unassigned with a comment asking which commit to review,
   and do not dispatch for it.
5. **Pre-screen before dispatching**, by the rule in `.claude/skills/ready/SKILL.md`
   step 2.5: if the review itself cannot be done without a person (the issue demands a
   human sign-off, or checking needs a login or a CAPTCHA an agent cannot pass), hand it
   back to Needs-Review `ready-for-human` with what the user has to check, and do not
   dispatch. A review that merely *finds* user-only work is still dispatched; the brief
   below labels that.

Empty queue: say so and stop. **Never dispatch for an issue you did not claim.**

Before dispatching, `git -C $repo fetch origin` so a merge pushed from another machine
resolves by sha. Fetch only — never pull, merge or push from a review.

## 2. Dispatch

One background Agent call per issue, all in one message. Each prompt carries the
identifier, title, description, every comment, the repo path
`$repo` (`git rev-parse --show-toplevel`, spelled out), and the brief below.

### The review brief

> You are reviewing Linear issue `<id>` read-only. Do not edit files, commit, merge,
> stash or check anything out — other agents are working in this tree.
>
> **The change.** For each `Merge: <sha>` line, the change is
> `git -C $repo diff <sha>^1 <sha>`. If this is a re-review (there is an earlier
> `Review:` comment), review the newest merge in full **and** check every blocking
> finding in the previous review was fixed or convincingly declined.
>
> **Read the skills first**, with the Skill tool:
> `mattpocock-skills:code-review` (Standards and Spec — the spec is the issue body
> and its comments) and `ponytail:ponytail-review` (over-engineering). Apply both to the
> diff. Also check it against `AGENTS.md` and the repository rules in
> `.claude/skills/ready/build-brief.md` step 2, and that tests cover the change.
>
> You may run checks against the merge commit if a finding depends on it, but only
> read-only (`git show`, `git grep`) — do not build or run suites in the main tree.
>
> **Verify every finding** against the code before reporting it; drop what you
> cannot confirm. Classify each as **blocking** (wrong behaviour, a broken
> invariant, a spec requirement missed, missing tests for new behaviour, needless
> complexity `ponytail:ponytail-review` would cut) or **non-blocking** (a suggestion the
> author may take or leave).
>
> **Update Linear.** Post a comment that starts with the line
> `Review: <newest-merge-sha> — PASS` or `Review: <newest-merge-sha> — CHANGES REQUESTED`,
> then the findings as a numbered list, each with file:line, what is wrong, and what
> would fix it, blocking ones first and marked as such; then one line on what you
> checked. Then one `save_issue` write with the assignee and delegate cleared and:
>
> - no blocking findings → `state: "Finished"` and
>   `removeLabels: ["ready-for-agent", "ready-for-human"]`;
> - blocking findings an agent can fix → `state: "Needs-Revision"`, labels untouched;
> - any blocking finding only the user can resolve (a product decision, a credential, an
>   outside account) → `state: "Needs-Revision"` with `removeLabels: ["ready-for-agent"]`
>   and `addLabels: ["ready-for-human"]`, and mark those findings **(yours)** in the comment.
>
> If you cannot finish the review, put it back in `Needs-Review` unassigned with a
> comment saying why.
>
> **Report**: identifier, verdict, the status you left it in, and the blocking
> findings in one line each.

## 3. Verify and report

Confirm on Linear that each issue left In-Progress and is unassigned, with a
`Review:` comment. Report briefly: one line per issue (Finished / Needs-Revision
with the count of blocking findings and whether it waits on the user / handed back), the
skipped `ready-for-human` and unlabelled issues, and a short section explaining
the outcome for a non-technical reader.
