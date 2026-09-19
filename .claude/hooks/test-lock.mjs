#!/usr/bin/env node
/**
 * PreToolUse hook: refuse a test run that is not holding the shared `tests` lock.
 *
 * Several agents share one working tree, and two concurrent vitest or dotnet test runs fail
 * specs neither of them touched. CLAUDE.md asks for `.claude/scripts/lock.ps1 run tests`, and an
 * instruction is only as good as the agent's memory of it; this is the part that does not forget.
 *
 * It only ever says no to a test-shaped command, and says exactly what to run instead. Anything
 * else passes through silently (exit 0, no output), so it is safe project-wide in a way the
 * pipeline's gate.mjs is not. A command is let through when:
 *
 *   - it goes through lock.ps1 (`lock.ps1 run tests -Command '...'`), or
 *   - this session already holds the lock (`lock.ps1 acquire tests` earlier).
 *
 * Escape hatch: `.claude/locks/test-lock-hook.off` exists.
 * Tests: node .claude/hooks/test-lock.test.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Where a new command starts: line start, or after ; & | ( or a PowerShell/bash call operator.
const AT_COMMAND = String.raw`(?:^|[;&|(\n]|\bthen\b|\bdo\b)\s*(?:[A-Za-z_]\w*=\S*\s+)*`;

const TEST_COMMANDS = [
  // npm test, npm t, npm --prefix tomevtt.client test, npm run test:ci, npm run e2e
  String.raw`npm(?:\.cmd)?\b[^;&|\n]*?\s(?:test|t|run(?:-script)?\s+(?:test|e2e)[\w:-]*)(?=\s|$|[;&|)])`,
  String.raw`dotnet\s+test\b`,
  String.raw`(?:npx\s+)?vitest\b`,
  String.raw`(?:npx\s+)?playwright\s+test\b`,
  String.raw`(?:npx\s+)?ng\s+test\b`,
  String.raw`node\s+\S*e2e\.mjs\b`,
].map((body) => new RegExp(AT_COMMAND + body, 'i'));

// Where the lock script itself is invoked. Anchored at a command start like the patterns above:
// substring-matching the whole command let any text merely *quoting* the invocation stand in for
// using it, and both the repo's docs and this hook's own refusal message print that string - so
// `git commit -m "lock.ps1 run tests" && dotnet test` disabled the gate by accident.
const LOCK_RUN = new RegExp(
  AT_COMMAND + String.raw`(?:&\s+)?['"]?[.\\/\w:-]*lock\.ps1['"]?\s+run\s+tests\b`,
  'i',
);

// Text that is data rather than commands: heredoc bodies, PowerShell here-strings and comments,
// which is where a commit message that mentions `dotnet test` lives.
function stripLiterals(command) {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2\b/g, ' ')
    .replace(/@'[\s\S]*?\n'@/g, ' ')
    .replace(/@"[\s\S]*?\n"@/g, ' ')
    .replace(/^\s*#.*$/gm, ' ');
}

export function isTestCommand(command) {
  const code = stripLiterals(command);
  return TEST_COMMANDS.some((re) => re.test(code));
}

export function usesLockScript(command) {
  return LOCK_RUN.test(stripLiterals(command));
}

/** 'allow' or a refusal message. */
export function decide(command, { holdsLock = () => false } = {}) {
  if (!command || !isTestCommand(command)) return 'allow';
  if (usesLockScript(command)) return 'allow';
  if (holdsLock()) return 'allow';
  return [
    'Test runs take the shared `tests` lock - other agents share this working tree, and two',
    'concurrent suites fail specs neither touched. Run it through the lock instead:',
    '',
    `  .claude/scripts/lock.ps1 run tests -Command '${command.trim().replace(/'/g, "''")}'`,
    '',
    'or `.claude/scripts/lock.ps1 acquire tests` first and `release tests` after.',
    '`.claude/scripts/lock.ps1 status` shows who holds it.',
  ].join('\n');
}

function lockDirectory(cwd) {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' });
  const common = (r.stdout || '').trim();
  if (r.status !== 0 || !common) return null;
  return path.join(path.dirname(path.resolve(cwd, common)), '.claude', 'locks');
}

function sessionHoldsLock(dir, sessions) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'tests.lock'), 'utf8'));
    return sessions.includes(lock.Session);
  } catch {
    return false;
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return 0;
  }
  const command = input?.tool_input?.command;
  if (typeof command !== 'string' || !isTestCommand(command)) return 0;

  const cwd = input.cwd || process.cwd();
  const dir = lockDirectory(cwd);
  if (dir && fs.existsSync(path.join(dir, 'test-lock-hook.off'))) return 0;

  // lock.ps1's Get-Session: the pipeline marker first, then the Claude session id.
  const sessions = [process.env.TOME_AGENT_MARKER, process.env.CLAUDE_CODE_SESSION_ID, input.session_id].filter(Boolean);
  const verdict = decide(command, { holdsLock: () => (dir ? sessionHoldsLock(dir, sessions) : false) });
  if (verdict === 'allow') return 0;
  process.stderr.write(verdict + '\n');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
