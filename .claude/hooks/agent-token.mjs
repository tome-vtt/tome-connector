// Keeps a pipeline agent's GitHub App installation token fresh.
//
// An agent launched with TOME_AGENT_APP=<slug> runs gh and git as that GitHub App, not as Bart.
// Its key lives outside the repo in ~/.tome-agents/<slug>/ (private-key.pem + app.json), and
// install-identity.ps1 points GH_CONFIG_DIR at ~/.tome-agents/<slug>/gh and git's credential helper
// at `gh auth git-credential`, so both read the token this writes into gh/hosts.yml.
//
// Installation tokens last an hour and gh cannot refresh one, so this runs as a PreToolUse hook
// before every shell command and re-mints once the file is 45 minutes old. With no
// TOME_AGENT_APP it exits at once, which is what keeps it silent in Bart's own sessions.
//
//   node agent-token.mjs          refresh if stale (the hook)
//   node agent-token.mjs --env <slug>   refresh now and print the git identity as JSON (install-identity)
import { createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const force = process.argv[2] === '--env';
const slug = force ? process.argv[3] : process.env.TOME_AGENT_APP;
if (!slug) process.exit(0);

const dir = join(homedir(), '.tome-agents', slug);

// On an identity machine the person's own credentials are still there - gh's keyring, the Windows
// credential manager, as-me.ps1 - and every command runs as the same Windows user, so an agent is
// one variable away from acting as them. Refuse the commands that would take it there. Settings'
// deny list covers the ones with a fixed prefix; these can sit anywhere in a command
// (`$env:GH_CONFIG_DIR=''; gh ...`), which a prefix rule cannot see. This is a guard against a
// session drifting, not a security boundary: a separate Windows user is the only real one.
if (!force) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')) ?? {}; } catch {}
  const tool = input.tool_name ?? '';
  if (tool.startsWith('mcp__')) {
    // ENABLE_CLAUDEAI_MCP_SERVERS=false does not keep the person's claude.ai connectors out of a
    // desktop-app session, and one signed in to Linear writes as the person. claude.ai connectors
    // are UUID-named; linear-agent is not. Reads stay open on purpose - the person sometimes wants
    // their own connectors here - so only a Linear write is refused.
    // ponytail: matched by Linear's tool nouns, so another connector's create_document is refused
    // too; key it on the connector's identity if that ever bites.
    if (/^mcp__[0-9a-f-]{36}__(save|create|delete|update|merge|submit|resolve|mark|retire|restore|share|unshare|prepare)_(issue|comment|project|document|milestone|attachment|status_update|release|diff|notification)/.test(tool)) {
      console.error(`agent-token: refused - this computer acts as ${slug}, and that connector writes to Linear as the person. Use the mcp__linear-agent__ tool of the same name.`);
      process.exit(2);
    }
    process.exit(0);
  }
  const command = input.tool_input?.command ?? '';
  const vars = 'GH_CONFIG_DIR|GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|TOME_AGENT_APP|ENABLE_CLAUDEAI_MCP_SERVERS';
  const escape = [
    new RegExp(`\\b(${vars})\\s*=`, 'i'),
    new RegExp(`\\benv:\\\\?(${vars})\\b`, 'i'),
    new RegExp(`\\b(unset|env\\s+(-u\\s*|--unset[=\\s]))\\s*(${vars})\\b`, 'i'),
    new RegExp(`SetEnvironmentVariable\\(\\s*['"](${vars})`, 'i'),
    /credential\.\S*helper'?\s*=/i,
    /\bGIT_ASKPASS\s*=|\bGIT_CONFIG_PARAMETERS\s*=|env:GIT_CONFIG_PARAMETERS\b/i,
    /(^|[;&|(]\s*|&\s*)[.\\/\w:-]*(as-me|install-identity)\.ps1\b/im,
    /\b(pwsh|powershell)(\.exe)?\b[^|;&\n]*(as-me|install-identity)\.ps1\b/i,
    /\bgh\s+auth\s+(login|logout|switch|token|refresh)\b/i,
    /\bgit\s+config\s+(--global|--system)\b/i,
    // A repository-local identity outranks the global one, and setting it is the reflex after a
    // failed commit. A write has a value after the key; `git config --get user.name` does not.
    /\bgit\s+config\b[^|;&\n]*\b(user\.(name|email)|credential\.\S*helper)\s+[^\s|;&)]/i,
    /\bgit\b[^|;&\n]*\s-c\s+['"]?user\./i,
    /\bgit\b[^|;&\n]*\bcommit\b[^|;&\n]*--author\b/i,
    /\bGIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)\b/i,
  ].find((re) => re.test(command));
  if (escape) {
    console.error(`agent-token: refused - this computer acts as ${slug}, and that command would switch identity or reach the person's own credentials. Ask the person to run it themselves.`);
    process.exit(2);
  }
}
const ghDir = join(dir, 'gh');
const hosts = join(ghDir, 'hosts.yml');
const STALE_MS = 45 * 60 * 1000;

if (!force && existsSync(hosts) && Date.now() - statSync(hosts).mtimeMs < STALE_MS) process.exit(0);

const fail = (msg) => {
  // exit 2 hands the message to the agent; the tool call is blocked, which is right: every gh
  // or git push after this would fail anyway, and less legibly.
  console.error(`agent-token: ${msg}`);
  process.exit(force ? 1 : 2);
};

let app;
try {
  app = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));
} catch {
  fail(`no app.json in ${dir}. Copy the app's folder from the machine it was created on.`);
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const body = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iat: now - 60, exp: now + 540, iss: String(app.id) })}`;
const jwt = `${body}.${createSign('RSA-SHA256').update(body).sign(readFileSync(join(dir, 'private-key.pem'), 'utf8'), 'base64url')}`;

const api = async (path, token, method = 'GET') => {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  const json = await r.json();
  if (!r.ok) fail(`${method} ${path} answered ${r.status}: ${json.message}`);
  return json;
};

const installation = await api(`/orgs/${app.owner}/installation`, jwt);
const { token } = await api(`/app/installations/${installation.id}/access_tokens`, jwt, 'POST');
const login = `${app.slug}[bot]`;

mkdirSync(ghDir, { recursive: true });
writeFileSync(hosts, `github.com:\n    users:\n        ${login}:\n            oauth_token: ${token}\n    oauth_token: ${token}\n    user: ${login}\n    git_protocol: https\n`);

if (force) {
  if (!app.botUserId) {
    app.botUserId = (await api(`/users/${encodeURIComponent(login)}`, token)).id;
    writeFileSync(join(dir, 'app.json'), JSON.stringify(app, null, 2));
  }
  console.log(JSON.stringify({ name: login, email: `${app.botUserId}+${login}@users.noreply.github.com`, ghConfigDir: ghDir }));
}
