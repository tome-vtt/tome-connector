#!/usr/bin/env node
/**
 * Table test for the test-lock hook. Run: node .claude/hooks/test-lock.test.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide } from './test-lock.mjs';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${expected.padEnd(5)} <- ${label}${ok ? '' : ` (got ${actual})`}`);
}
const verdict = (command, holds = false) => (decide(command, { holdsLock: () => holds }) === 'allow' ? 'allow' : 'deny');

console.log('refused without the lock');
for (const c of [
  'npm test',
  'npm test -- --watch=false',
  'npm --prefix tomevtt.client test -- --watch=false',
  'cd tomevtt.client && npm test -- --watch=false --include "src/app/**/*.spec.ts"',
  'npm run test:ci',
  'npm run e2e',
  'npm --prefix tomevtt.client run e2e',
  'dotnet test TomeVTT.Server.Tests/TomeVTT.Server.Tests.csproj --filter "FullyQualifiedName~X"',
  "$env:X='1'; dotnet test TomeVTT.Server.Tests",
  'CI=1 npx vitest run src/foo.spec.ts',
  'npx playwright test',
  'node scripts/e2e.mjs',
  'git status; npm test',
  // Merely naming the lock invocation is not using it - and the docs and this hook's own refusal
  // message both print that string, so these are the ordinary shapes rather than adversarial ones.
  'echo "see .claude/scripts/lock.ps1 run tests"; npm test',
  'git commit -m "lock.ps1 run tests" && dotnet test',
  '# .claude/scripts/lock.ps1 run tests\nnpm --prefix tomevtt.client test -- --watch=false',
]) check(c, verdict(c), 'deny');

console.log('let through');
for (const c of [
  ".claude/scripts/lock.ps1 run tests -Command 'npm --prefix tomevtt.client test -- --watch=false'",
  "& .claude/scripts/lock.ps1 run tests -Command 'dotnet test TomeVTT.Server.Tests/TomeVTT.Server.Tests.csproj'",
  'npm run lint',
  'npm run typecheck',
  'npm install',
  'npm run build',
  'dotnet build TomeVTT.Server/TomeVTT.Server.csproj',
  'grep -rn "npm test" docs',
  'git commit -m "run dotnet test before merging"',
  "git commit -F - <<'EOF'\nFix a flake\n\ndotnet test passes now\nEOF",
  "git commit -m @'\nFix\nnpm test is green\n'@",
  'node .claude/hooks/gate.test.mjs',
  'pwsh -NoProfile -File .claude/scripts/lock.test.ps1',
]) check(c, verdict(c), 'allow');

console.log('a session already holding the lock');
check('npm test while holding', verdict('npm test', true), 'allow');

console.log('over a pipe, as Claude Code calls it');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lock-hook-'));
spawnSync('git', ['init', '-q'], { cwd: dir });
const hook = path.join(import.meta.dirname, 'test-lock.mjs');
const pipe = (command, session = 's1') => {
  const env = { ...process.env };
  delete env.TOME_AGENT_MARKER;
  delete env.CLAUDE_CODE_SESSION_ID;
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: session, cwd: dir, tool_name: 'Bash', tool_input: { command } }),
    env,
    encoding: 'utf8',
  });
  return r.status === 2 ? 'deny' : r.status === 0 ? 'allow' : `exit ${r.status}`;
};
try {
  check('npm test, no lock', pipe('npm test'), 'deny');
  check('npm run lint', pipe('npm run lint'), 'allow');
  fs.mkdirSync(path.join(dir, '.claude', 'locks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'locks', 'tests.lock'), JSON.stringify({ OwnerPid: 1, Session: 's1' }));
  check('npm test, this session holds it', pipe('npm test', 's1'), 'allow');
  check('npm test, another session holds it', pipe('npm test', 's2'), 'deny');
  fs.writeFileSync(path.join(dir, '.claude', 'locks', 'test-lock-hook.off'), '');
  check('npm test, hook switched off', pipe('npm test', 's2'), 'allow');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
