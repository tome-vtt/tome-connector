#!/usr/bin/env node
/**
 * Table test for agent-token.mjs's identity guard. Run: node .claude/hooks/agent-token.test.mjs
 *
 * The hook is spawned for real, with a home directory holding a fresh hosts.yml so a command the
 * guard lets through exits 0 without minting anything.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-token.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-token-test-'));
fs.mkdirSync(path.join(home, '.tome-agents', 'test-agent', 'gh'), { recursive: true });
fs.writeFileSync(path.join(home, '.tome-agents', 'test-agent', 'gh', 'hosts.yml'), '');

let failures = 0;
function check(label, input, expected) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(input),
    env: { ...process.env, USERPROFILE: home, HOME: home, TOME_AGENT_APP: 'test-agent' },
  });
  const actual = r.status === 2 ? 'deny' : r.status === 0 ? 'allow' : `exit ${r.status}`;
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${expected.padEnd(5)} <- ${label}${ok ? '' : ` (got ${actual})`}`);
}
const shell = (command) => ({ tool_name: 'PowerShell', tool_input: { command } });
const connector = 'mcp__00000000-0000-4000-8000-000000000000__'; // claude.ai connectors are UUID-named

console.log('refused');
for (const c of [
  "$env:GH_CONFIG_DIR=''; gh pr list",
  'GH_TOKEN=x gh api user',
  'Remove-Item Env:\\GH_CONFIG_DIR; gh auth status',
  "[Environment]::SetEnvironmentVariable('TOME_AGENT_APP', $null, 'User')",
  'unset GH_CONFIG_DIR && gh pr list',
  'env -u GH_CONFIG_DIR gh pr list',
  'git -c credential.helper=manager push origin HEAD',
  'git -c credential.https://github.com.helper=manager push',
  'git config credential.helper manager',
  'pwsh .claude/scripts/as-me.ps1',
  'powershell.exe -NoProfile -File .claude\\scripts\\as-me.ps1 -Command "git push"',
  'git status; & .\\.claude\\scripts\\install-identity.ps1 -Uninstall',
  'gh auth login',
  'git config --global user.name x',
  'git config user.email bart@example.com',
  'git config --local user.name "Bart"',
  'git add -A && git config user.name Bart && git commit -m x',
  'git -c user.name=Bart -c user.email=b@example.com commit -m x',
  'git commit --author="Bart <b@example.com>" -m x',
  "$env:GIT_AUTHOR_NAME='Bart'; git commit -m x",
  'GIT_COMMITTER_EMAIL=b@example.com git commit -m x',
]) check(c, shell(c), 'deny');
for (const t of ['save_issue', 'save_comment', 'create_attachment', 'delete_comment', 'merge_diff', 'mark_notification'])
  check(`person's connector ${t}`, { tool_name: connector + t, tool_input: {} }, 'deny');

console.log('let through');
for (const c of [
  'git status',
  'git config --get user.name',
  'git config user.name',
  'git config --get user.email && git log -1',
  'git log --author=tome-agent-two --oneline',
  'git push origin HEAD',
  'git add .claude/scripts/as-me.ps1 .claude/scripts/install-identity.ps1',
  'git diff -- .claude/scripts/install-identity.ps1',
  'git commit -m "Shrink the refusal sweeps"',
  'gh pr list',
  'gh auth status',
]) check(c, shell(c), 'allow');
for (const t of ['get_issue', 'list_issues', 'list_comments'])
  check(`person's connector ${t}`, { tool_name: connector + t, tool_input: {} }, 'allow');
check('linear-agent save_issue', { tool_name: 'mcp__linear-agent__save_issue', tool_input: {} }, 'allow');
check('docs connector update', { tool_name: connector + 'update', tool_input: {} }, 'allow');
check('unparseable input', 'not json', 'allow');

fs.rmSync(home, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
