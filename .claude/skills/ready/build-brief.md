# Build brief (shared by ready and revision)

You are a subagent building **one** Linear issue that the orchestrator has already
claimed for you. You cannot ask the user anything. Your brief gives you: the issue
identifier, title, description and comments, `$repo`, `$target` (the branch to
merge into), `$branch`, `$wt` (your worktree) and `$marker`.

## 1. Create your worktree

Pull `$target` first, so you build on what is on GitHub. The pull moves the shared main
tree, so it runs under the `merge` lock (see step 5 for why the marker matters):

```powershell
$env:TOME_AGENT_MARKER = $marker
.claude/scripts/lock.ps1 run merge -Command "git -C $repo pull --ff-only origin $target"
git -C $repo worktree add $wt -b $branch $target
```

`--ff-only` either moves the branch or changes nothing, so it can never leave the shared
tree mid-merge. If it refuses (local commits not yet pushed, or another agent's uncommitted
edit in the way), branch from local `$target` anyway — step 5 pulls properly.

Every command from here runs with `-C $wt` or inside it. **Never touch the main
working tree** except inside the merge lock (step 5). **Never copy `node_modules`**:
run `npm ci` in `$wt/tomevtt.client` if you need client tooling.

## 2. Read the skills before writing code

Call the Skill tool for each. Matt Pocock skills (`mattpocock-skills:<name>` if the
bare name does not resolve), in this order when several apply:

| The issue is… | Read |
|---|---|
| naming, vocabulary, a `CONTEXT.md` or an ADR | `domain-modeling` |
| dependent on API/library facts you would otherwise guess | `research` |
| a state model or UI shape still an open question | `prototype` |
| a bug, regression or performance complaint | `diagnosing-bugs` |
| about where an interface or seam belongs | `codebase-design` |
| anything built or fixed (always) | `tdd` |

Then **always** `ponytail` — the simplest change that satisfies the issue, nothing
speculative.

`tdd` wants seams confirmed with the user and you cannot ask: name the seams you
tested in your report. If the seams are genuinely ambiguous rather than merely
unstated, hand the issue back (step 6) instead of guessing.

Repository rules that land here:

- **A UI change gets an interactive demo** in `docs/design/<feature>/`. Build the
  demo and the component, and say in your report the demo is there to accept or reject.
- **Every interface works on phones and tablets.**
- Follow the invariants for your area from the project context loaded at session
  start, and read `docs/findings.md` before anything structural — several obvious
  refactors are declined there.
- **Tome How To** stays current (`tomevtt.client/src/app/features/how-to/AUTHORING.md`).

## 3. Build

Vertical slices; **commit after each section of work**, in the worktree.

## 4. Gate

Take the shared `tests` lock around every test-shaped command (a hook refuses a bare
one). `lock.ps1` needs **`pwsh`**, not Windows PowerShell 5.1 (5.1 fails *after*
taking the lock and strands it). Set your marker in **every** shell that calls it:

```powershell
$env:TOME_AGENT_MARKER = $marker
.claude/scripts/lock.ps1 run tests -Command "npm --prefix $wt/tomevtt.client run lint"
.claude/scripts/lock.ps1 run tests -Command "npm --prefix $wt/tomevtt.client run typecheck"
.claude/scripts/lock.ps1 run tests -Command "npm --prefix $wt/tomevtt.client test -- --watch=false"
.claude/scripts/lock.ps1 run tests -Command "dotnet test $wt/TomeVTT.Server.Tests/TomeVTT.Server.Tests.csproj -p:BuildSpaWithMsBuild=false"
```

Run the projects you touched (`ci.yml`'s `client`, `server`, `connector`, `desktop`
jobs). Server tests need Docker. Expect to wait for the lock — that is correct.

**A failing check means change the code.** Loosening a rule, raising a baseline or
adding an exemption is the user's decision, not yours.

Then self-review: read `mattpocock-skills:code-review` and `ponytail-review` and
apply them to `git -C $wt diff $target...HEAD`. Fix what they find.

## 5. Merge under the `merge` lock

Hold the lock across the **whole** sequence. Without your own `TOME_AGENT_MARKER`,
sibling subagents share one session id, the lock counts as re-entrant, and the
exclusion silently does nothing.

Run these one at a time, checking each answer, and **release the lock on every exit
path** — the pull, the merge and the push can each stop you, and a conflict is resolved
while you still hold it.

```powershell
$env:TOME_AGENT_MARKER = $marker
git -C $wt status --porcelain                          # must be empty
.claude/scripts/lock.ps1 acquire merge
git -C $repo branch --show-current                     # must be $target, else release and hand back
git -C $repo pull --no-rebase origin $target
git -C $repo merge --no-ff $branch -m "Merge $branch"
git -C $repo rev-parse HEAD                            # the merge commit, for the Linear comment
git -C $repo push origin $target                       # rejected? pull as above, push once more
git -C $repo worktree remove $wt
git -C $repo branch -d $branch
git -C $repo worktree prune
.claude/scripts/lock.ps1 release merge
```

**Every merge is pulled before and pushed after**, inside the lock, so the branch on
GitHub always has your merge and the `Merge:` sha on Linear is one anybody can fetch.
Pull with `--no-rebase`, never `--rebase`: a rebase rewrites the `--no-ff` merge commits
and the sha you record would stop existing. Pushes go out under the machine's GitHub
login (`.claude/README.md`); never force-push.

On a conflict (in the pull or the merge), read `mattpocock-skills:resolving-merge-conflicts`
and resolve it while still holding the lock; stage only your own files, never
`git add -A`, never stash or reset anyone else's work, then carry on with the push. If you
cannot resolve it, `git -C $repo merge --abort`, release the lock, and hand the issue back
(step 6). If the second push still fails, the merge stays local: say so in the Linear
comment and your report, and leave the push to the orchestrator.

## 6. Update Linear

Finished — one `save_issue` write: `state: "Needs-Review"`, assignee and delegate cleared. Then a
comment starting with this line exactly, so the reviewer can find the change:

```
Merge: <merge-sha> into <target> (branch <branch>)
```

followed by: what changed and why, the seams tested, which checks passed, anything
offered for acceptance (a UI demo), and anything deliberately left out.

Not finished — **put it back rather than sitting on it**: return it to the status
it was claimed from (your brief says which) with the assignee and delegate cleared, comment what
you learned and what blocked you, then `git -C $repo worktree remove $wt --force`
and `git -C $repo branch -D $branch` — unless the work is worth keeping, in which
case name the branch in the comment and keep it.

**Label the hand-back by who can unblock it.** If only the user can — a decision, a
credential, a dashboard, an outside account — the same `save_issue` write also takes
`removeLabels: ["ready-for-agent"]` and `addLabels: ["ready-for-human"]`, and the comment
says exactly what the user has to do. If another agent could pick it up (a conflict, a
flaky gate, running out of room), leave `ready-for-agent` on it.

## 7. Report

Your final message is all the orchestrator sees: identifier and title, branch,
merge sha (or why not merged), checks passed, seams tested, demos offered, and the
status you left the issue in.
