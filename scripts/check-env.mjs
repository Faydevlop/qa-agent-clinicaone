#!/usr/bin/env node
// Usage: npm run env:check [-- <link-or-env>] [--role learner]
// Verifies .env is complete for the target and the credentials work, WITHOUT printing secrets.
// Uses the cached session when possible so repeated checks don't burn the auth rate limit.
import fs from 'node:fs';
import { resolveEnv, credentials, ROLES } from '../lib/env.mjs';
import { getSession } from '../lib/auth.mjs';
import { Api } from '../lib/api.mjs';

const args = process.argv.slice(2);
const roleIdx = args.indexOf('--role');
const role = roleIdx >= 0 ? args[roleIdx + 1] : 'learner';
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--role');
if (target) process.env.QA_TARGET = target;

const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.log(`  ✘ ${m}`); process.exitCode = 1; };

console.log('ClinicaOne QA environment check\n');
if (!fs.existsSync(new URL('../.env', import.meta.url))) bad('.env not found — copy .env.example to .env');

let env;
try {
  env = resolveEnv();
  ok(`target ${env.key}: web ${env.web}  api ${env.api}  ${env.writesAllowed ? '' : '(READ-ONLY)'}`);
} catch (e) {
  bad(e.message);
  process.exit(1);
}

for (const [label, url] of [['api /health', `${env.apiOrigin}/health`], ['web /version.json', `${env.web}/version.json`]]) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    r.ok ? ok(`${label} ${r.status}`) : bad(`${label} ${r.status}`);
  } catch (e) {
    bad(`${label} unreachable: ${e.cause?.code ?? e.message} (VPN / TLS / DNS?)`);
  }
}

if (!ROLES.includes(role)) console.log(`  ! role "${role}" is not in lib/env.mjs ROLES yet`);
try {
  const { email } = credentials(role, env.key);
  ok(`${role} credentials present for ${email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);
  const s = await getSession(role, env);
  ok(`login ok — user ${s.user?.name ?? ''} role=${s.user?.role}`);
  const api = new Api({ env, token: s.accessToken });
  const prof = await api.get('/auth/profile');
  prof.ok ? ok('GET /auth/profile 200') : bad(`GET /auth/profile ${prof.status}`);
  const cases = await api.post('/cases', { pagination: { page: 1, limit: 100 } });
  cases.ok ? ok(`${cases.json.pagination.total} published cases: ${cases.tableData.map((c) => c.title).join(', ')}`) : bad(`POST /cases ${cases.status}`);
  s.refreshCookie ? ok('refresh cookie issued') : console.log('  ! no refresh cookie in login response (sessions will not survive >15 min)');
} catch (e) {
  bad(e.message);
}

console.log(process.exitCode ? '\nFix the ✘ items above.' : '\nReady.');
