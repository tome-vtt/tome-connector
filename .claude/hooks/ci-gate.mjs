#!/usr/bin/env node
/**
 * Stop hook: run what .github/workflows/lint.yml runs against the current changes before a
 * turn is allowed to end.
 *
 * Scope is `build + unit tests + lint`, and only when the change touches something CI reads
 * (not docs, not .claude/). Ported from TomeVTT, where it gates several projects; here
 * PROJECTS has one entry.
 *
 * Three things about this are load-bearing:
 *
 *  - It takes the shared `tests` lock through .claude/scripts/lock.ps1 around every
 *    test-shaped check, because several agents share one working tree and two concurrent
 *    vitest runs produce failures that look like regressions and are not. Build and lint
 *    run unlocked - they contend with nothing. It passes `-OwnerPid` as *this* process, which
 *    lives for the whole gate, so the lock is live exactly as long as the gate is.
 *
 *  - It caches a per-project fingerprint of the last passing run. Without it, a turn that
 *    only edited a doc still re-runs the whole suite because the *branch* diff is
 *    unchanged and still names client files.
 *
 *  - It blocks once per *distinct* failure rather than MAX_BLOCKS times per turn. The tree is
 *    shared, so a red may belong to another agent's half-finished edit; repeating the demand
 *    cannot make that fixable, and a gate that cannot be escaped is a session nobody can end.
 *    A genuinely new failure still blocks on its first appearance, which is stricter than a
 *    plain attempt counter - it does not spend the session's tries on one immovable red.
 *
 * Escape hatches: TOME_CI_GATE=off, or `touch .claude/locks/ci-gate.off`. TOME_CI_GATE=dry
 * prints the plan and runs nothing, which is how to check the path mapping without paying for
 * a suite.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MAX_BLOCKS = 3;
const LOCK_WAIT_MINUTES = 20;
const LOCK_POLL_SECONDS = 5;
const EXCERPT_LINES = 120;
const EXCERPT_CHARS = 8000;
const TOTAL_CHARS = 24000;

// ---------------------------------------------------------------- repository

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const root = git(['rev-parse', '--show-toplevel']).out;
if (!root) {
  process.exit(0); // not a checkout; nothing to gate
}

const commonDir = git(['rev-parse', '--git-common-dir']).out;
const locksDir = path.join(
  commonDir ? path.dirname(path.resolve(root, commonDir)) : root,
  '.claude',
  'locks',
);
fs.mkdirSync(locksDir, { recursive: true });

// ---------------------------------------------------------------- hook input

let input = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw.trim()) input = JSON.parse(raw);
} catch {
  /* a hook with no stdin still runs; every field below has a default */
}
const sessionId = String(input.session_id ?? 'unknown').replace(/[^\w.-]/g, '_');

if (process.env.TOME_CI_GATE === 'off' || fs.existsSync(path.join(locksDir, 'ci-gate.off'))) {
  process.exit(0);
}

// ---------------------------------------------------------------- gate state

const statePath = path.join(locksDir, `ci-gate-${sessionId}.json`);

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { blocks: 0, passed: {} };
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {
    /* the gate still works without a cache */
  }
}

const state = readState();
state.passed ??= {};
state.blocks ??= 0;

// ---------------------------------------------------------------- change set

function baseRef() {
  for (const ref of ['origin/master', 'master', 'origin/main', 'main']) {
    const verified = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (verified.code !== 0) continue;
    const base = git(['merge-base', ref, 'HEAD']);
    if (base.code === 0 && base.out) return base.out;
  }
  return null;
}

function changedFiles() {
  const files = new Set();
  const base = baseRef();
  if (base) {
    for (const f of git(['diff', '--name-only', base, '--']).out.split('\n')) {
      if (f) files.add(f);
    }
  }
  // Working tree and index, including untracked. -z keeps paths with spaces intact and
  // sidesteps git's quoting of non-ASCII names.
  const porcelain = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const entries = porcelain.out.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    if (entry[2] !== ' ') continue;
    files.add(entry.slice(3));
    // A rename or copy is emitted as "XY <new>\0<old>\0" - the source path is its own
    // NUL-delimited field with no status prefix, so it has to be consumed here rather than
    // parsed as a record of its own.
    if (status.includes('R') || status.includes('C')) {
      i += 1;
      if (entries[i]) files.add(entries[i]);
    }
  }
  return [...files];
}

// ---------------------------------------------------------------- projects

// A check is either an executable plus an argument vector, or - when `shell` is set - one
// command line handed to the platform shell. npm needs the second form on Windows: since the
// command-injection fix (CVE-2024-27980) Node refuses to spawn the `npm.cmd` shim without a
// shell, returning EINVAL and a null status, which reads as a failed check with no output at
// all. That is how this was found - the gate blocked a turn with a blank excerpt. It is one
// string rather than shell:true plus an args array because that combination is DEP0190 and
// puts a deprecation warning in the middle of every report.
//
// One project: the plugin. The checks are lint.yml's steps in its order. Docs and agent files
// change nothing CI runs, so they do not select it.
const PROJECTS = [
  {
    key: 'plugin',
    label: 'Plugin',
    cwd: '.',
    owns: (f) => !f.startsWith('docs/') && !f.startsWith('.claude/') && !/\.md$/i.test(f),
    nodeModules: 'node_modules',
    checks: [
      { name: 'npm run build', cmd: 'npm run build', shell: true },
      { name: 'npm test', cmd: 'npm test', shell: true, lock: true },
      { name: 'npm run lint', cmd: 'npm run lint', shell: true },
    ],
  },
];

const changed = changedFiles();
const selected = PROJECTS.filter((p) => changed.some(p.owns));

if (selected.length === 0) {
  process.exit(0);
}

if (process.env.TOME_CI_GATE === 'dry') {
  process.stdout.write(
    `CI gate (dry run): ${changed.length} changed path(s)\n` +
      selected
        .map(
          (p) =>
            `  ${p.label} [${p.cwd}]\n` +
            p.checks
              .map((c) => `      ${[c.cmd, ...(c.args ?? [])].join(' ')}${c.lock ? '   (takes the lock)' : ''}`)
              .join('\n'),
        )
        .join('\n') +
      '\n',
  );
  process.exit(0);
}

// ---------------------------------------------------------------- fingerprint

// Content, not just names: the branch diff still names client files on a turn that only
// touched a doc, so a name-only fingerprint would never go stale and never re-run.
function fingerprint(project) {
  const h = createHash('sha256');
  h.update(git(['rev-parse', 'HEAD']).out);
  for (const f of changed.filter(project.owns).sort()) {
    h.update('\0');
    h.update(f);
    try {
      const st = fs.statSync(path.join(root, f));
      h.update(`:${st.size}:${st.mtimeMs}`);
    } catch {
      h.update(':deleted');
    }
  }
  return h.digest('hex');
}

// ---------------------------------------------------------------- tests lock

// Taken through .claude/scripts/lock.ps1 itself rather than a copy of its protocol. A copy drifted
// once already: it kept the 45-minute expiry and the "unreadable means free" read after lock.ps1
// dropped both, and each side would then have broken the other's live lock. The owner is *this*
// process, which lives for the whole gate, and the session is pinned so the release matches.
const lockScript = path.join(root, '.claude', 'scripts', 'lock.ps1');
const lockEnv = {
  ...process.env,
  TOME_AGENT_MARKER:
    process.env.TOME_AGENT_MARKER || process.env.CLAUDE_CODE_SESSION_ID || `ci-gate:${process.pid}`,
};
let holdingLock = false;

function lockPs1(args) {
  const r = spawnSync('pwsh', ['-NoProfile', '-File', lockScript, ...args], {
    encoding: 'utf8',
    env: lockEnv,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function acquireLock(notes) {
  if (holdingLock) return true;
  const r = lockPs1([
    'acquire', 'tests',
    '-OwnerPid', String(process.pid),
    '-WaitMinutes', String(LOCK_WAIT_MINUTES),
    '-PollSeconds', String(LOCK_POLL_SECONDS),
  ]);
  if (r.code !== 0) {
    notes.push(
      `could not take the 'tests' lock and ran anyway - a concurrent suite can make these results unreliable: ${r.out}`,
    );
    return false;
  }
  if (/waiting for/.test(r.out)) notes.push(`waited for the shared 'tests' lock`);
  // A lock this session already held stays with whoever took it; releasing it here would pull
  // it out from under the agent's own run.
  holdingLock = !/already held/.test(r.out);
  return true;
}

function releaseLock() {
  if (!holdingLock) return;
  holdingLock = false;
  lockPs1(['release', 'tests']);
}

process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => {
    releaseLock();
    process.exit(130);
  });
}

// ---------------------------------------------------------------- run

function tail(text) {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  let out = lines.slice(-EXCERPT_LINES).join('\n');
  if (out.length > EXCERPT_CHARS) out = `…\n${out.slice(-EXCERPT_CHARS)}`;
  return out.trim();
}

const failures = [];
const notes = [];
const ran = [];

try {
  for (const project of selected) {
    if (project.nodeModules && !fs.existsSync(path.join(root, project.nodeModules))) {
      notes.push(`${project.label}: skipped - ${project.nodeModules} is missing (run npm ci)`);
      continue;
    }
    const print = fingerprint(project);
    if (state.passed[project.key] === print) {
      notes.push(`${project.label}: unchanged since it last passed`);
      continue;
    }

    let projectFailed = false;
    for (const check of project.checks) {
      if (check.lock) acquireLock(notes);
      const started = Date.now();
      const r = spawnSync(check.cmd, check.args ?? [], {
        cwd: path.join(root, project.cwd),
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        shell: check.shell ?? false,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
      });
      if (check.lock) releaseLock();

      const seconds = Math.round((Date.now() - started) / 1000);
      // A missing executable is a machine problem, not a red build.
      if (r.error && r.error.code === 'ENOENT') {
        notes.push(`${project.label} / ${check.name}: skipped - '${check.cmd}' is not on PATH`);
        break;
      }
      if (r.status === 0) {
        ran.push(`${project.label} / ${check.name} (${seconds}s)`);
        continue;
      }
      projectFailed = true;
      // r.error covers the case where the process never started at all, which leaves both
      // pipes empty. Reporting that as a bare "FAILED" with nothing under it is what the
      // npm.cmd EINVAL above looked like, and it is unactionable.
      const spawnError = r.error ? `could not run '${check.cmd}': ${r.error.message}` : '';
      failures.push({
        label: `${project.label} / ${check.name}`,
        seconds,
        output: tail(`${spawnError}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`) || '(no output)',
      });
      // CI steps are sequential within a job: a failed build never reaches the tests. Stop
      // this project here, but keep going through the others, which CI runs in parallel.
      break;
    }

    if (!projectFailed) state.passed[project.key] = print;
    else delete state.passed[project.key];
  }
} finally {
  releaseLock();
}

// ---------------------------------------------------------------- report

if (failures.length === 0) {
  state.blocks = 0;
  delete state.signature;
  writeState(state);
  const summary = [
    `CI gate: ${ran.length} check(s) passed.`,
    ...ran.map((r) => `  ok  ${r}`),
    ...notes.map((n) => `  --  ${n}`),
  ].join('\n');
  process.stdout.write(`${summary}\n`);
  process.exit(0);
}

// A signature over what failed, not how long it took. Blocking on the same red twice is the
// one case where blocking teaches nothing: this tree is shared, so the failure may sit in a
// file this session never opened, and repeating the demand cannot make it fixable.
const signature = createHash('sha256')
  .update(failures.map((f) => `${f.label}::${f.output}`).join('\n---\n'))
  .digest('hex');
const repeated = state.signature === signature;

state.blocks = repeated ? state.blocks + 1 : 1;
state.signature = signature;
writeState(state);

const parts = [
  `CI gate: ${failures.length} check(s) that GitHub Actions runs are failing on this tree.`,
  '',
];
for (const f of failures) {
  parts.push(`FAILED  ${f.label}  (${f.seconds}s)`, '', f.output, '');
}
if (ran.length) parts.push(`Passed: ${ran.join(', ')}`);
for (const n of notes) parts.push(`Note: ${n}`);

let report = parts.join('\n');
if (report.length > TOTAL_CHARS) report = `${report.slice(0, TOTAL_CHARS)}\n…output truncated`;

if (repeated || state.blocks > MAX_BLOCKS) {
  // Let the turn end. A red that survived an attempt unchanged is either not this session's
  // to fix or not fixable from here, and a gate that cannot be escaped is a session nobody
  // can end.
  process.stdout.write(
    `${report}\n\nCI gate: unchanged since the last run - not blocking again. This will still ` +
      'fail on GitHub, so fix it before pushing, or say whose it is if another agent is ' +
      'working the same tree.\n',
  );
  process.exit(0);
}

process.stderr.write(
  `${report}\n\nFix these before ending the turn, then let the gate re-run. If the failure is ` +
    'in a file this session never touched, say so rather than editing around another agent - ' +
    'an unchanged failure does not block a second time.\n',
);
process.exit(2);
