---
name: revision
description: >
  Claims N issues in the Tome Connector team's Needs Revision column on Linear, moves
  each to In Progress, and fixes the review findings in parallel — one subagent
  and one isolated git worktree per issue — merging each into the current
  branch, removing its worktree, commenting a summary and moving it back to
  Needs Review. Use when the user invokes Revision-<n>,
  /revision <n>, or asks to work the revision queue.
disable-model-invocation: true
---

Claim N issues that failed review, fix what the reviewer found, merge, hand back to
review.

Linear flow: **Needs Revision → In Progress → Needs Review**. A revision is new code,
so it always goes back to a reviewer — this skill never moves an issue to Finished.

This is `ready` with three differences. **Read
`.claude/skills/ready/SKILL.md` and follow it**, substituting:

1. **Queue.** Step 2 lists and claims from `state: "Needs Revision"` instead of
   Ready (same `project: "TC"` filter) (still `label: "ready-for-agent"` only — a `ready-for-human` revision is the user's), and a claimed issue that cannot be finished goes back to
   **Needs Revision**, not Ready. Tell each subagent so. The pre-screen (step 2.5) judges
   the **latest review's blocking findings**: if every one needs a person, hand it back
   `ready-for-human` without dispatching.
2. **What gets built.** The work is the **latest review comment's findings**, not
   the issue from scratch. Each subagent's prompt must carry every comment, with
   the most recent `Review:` comment called out as the list to fix, plus every
   earlier `Merge:` line so the subagent can read what was already built
   (`git -C $repo show <sha>`). Add this to the prompt:

   > Address every blocking finding in the latest review, and only those. The
   > non-blocking ones are yours to take or leave; say which in your report. If a
   > finding is wrong, do not "fix" it — explain why in your Linear comment and the
   > reviewer will decide. If a finding needs a decision only the user can make,
   > hand the issue back to Needs Revision with the question in the comment,
   > swapping `ready-for-agent` for `ready-for-human` as the build brief says.

3. **The Linear comment.** After the `Merge:` line, list each finding from the
   review with what was done about it (fixed / declined and why), then the checks
   that passed. The subagent still moves the issue to **Needs Review** with the
   assignee and delegate cleared, exactly as the build brief says.

Everything else — clamping N, claiming the whole batch before any work, one
worktree/branch/marker per issue, the shared build brief, the merge lock, pulling
and pushing every merge, verifying before reporting — is unchanged.

Report briefly: one line per issue (revised and back in review / handed back and
why), whether every merge was pushed, and a short
section explaining the work for a non-technical reader.
