// Prints the Authorization header for a pipeline agent's Linear MCP connection (a headersHelper).
//
// The Linear half of agent-token.mjs: a computer with TOME_AGENT_APP=<slug> installed reaches Linear
// as that slug's OAuth app (Settings > API, client credentials on), whose { clientId,
// clientSecret } live outside the repo in ~/.tome-agents/<slug>/linear.json. The token is an
// `app` actor - a Linear agent user, which is not a billed seat. It lasts 30 days with no refresh
// token, so it is cached beside linear.json and re-minted within three days of expiring.
//
// No process.exit after a fetch: on Windows it trips a libuv assertion and exits 127, which
// headersHelper reads as failure.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const slug = process.env.TOME_AGENT_APP;
const dir = join(homedir(), '.tome-agents', slug ?? '');
const cache = join(dir, 'linear-token.json');

let held = null;
try { held = JSON.parse(readFileSync(cache, 'utf8')); } catch {}

if (!slug) {
  console.error('linear-token: TOME_AGENT_APP is not set');
  process.exitCode = 1;
} else {
  if (!held || held.expiresAt - Date.now() < 3 * 24 * 60 * 60 * 1000) {
    const { clientId, clientSecret } = JSON.parse(readFileSync(join(dir, 'linear.json'), 'utf8'));
    const r = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'read,write,app:assignable,app:mentionable',
      }),
    });
    const json = await r.json();
    if (r.ok) {
      held = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
      writeFileSync(cache, JSON.stringify(held));
    } else {
      console.error(`linear-token: ${slug} answered ${r.status}: ${JSON.stringify(json)}`);
      held = null;
      process.exitCode = 1;
    }
  }
  if (held) console.log(JSON.stringify({ Authorization: `Bearer ${held.token}` }));
}
