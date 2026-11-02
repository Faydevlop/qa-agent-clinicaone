#!/usr/bin/env node
// Usage: npm run versions [-- dev|test|uat|all]
// Shows what is deployed on each environment (frontend build, gateway, content-service) and,
// if CLINICAONE_REPOS_DIR points at the local repos, whether it matches the branch head.
// Answers "is the fix in this build?" before anyone files a bug against a stale deploy.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ENVIRONMENTS, resolveEnv } from '../lib/env.mjs';

const arg = process.argv[2] || process.env.QA_TARGET || 'all';
const keys = arg === 'all' ? Object.keys(ENVIRONMENTS).filter((k) => ENVIRONMENTS[k].web) : [resolveEnv(arg).key];
const reposDir = process.env.CLINICAONE_REPOS_DIR;

async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : { error: `HTTP ${r.status}` };
  } catch (e) {
    return { error: e.cause?.code ?? e.message };
  }
}

function remoteHead(repo, branch) {
  if (!reposDir) return null;
  try {
    const out = execFileSync('git', ['-C', path.join(reposDir, repo), 'ls-remote', 'origin', `refs/heads/${branch}`], { encoding: 'utf8', timeout: 20000 });
    return out.split('\t')[0] || null;
  } catch {
    return null;
  }
}

const rows = [];
for (const key of keys) {
  const e = resolveEnv(key);
  const [web, gw, content] = await Promise.all([
    getJson(`${e.web}/version.json`),
    getJson(`${e.apiOrigin}/version`),
    getJson(`${e.apiOrigin}/internal-content/version`),
  ]);
  const feHead = remoteHead('clinicaone-simulation-frontend', e.branch);
  const beHead = remoteHead('clinicaone-simulation-backend', e.branch);
  const mark = (v, head) => (!head || !v.commitFull ? '' : v.commitFull === head ? ' ✔ head' : ' ✘ behind/ahead of head');
  rows.push([key, 'frontend', web.version ?? '-', web.commit ?? web.error, web.builtAt ?? '', mark(web, feHead)]);
  rows.push([key, 'gateway', gw.version ?? '-', gw.commit ?? gw.error, gw.startedAt ?? '', mark(gw, beHead)]);
  rows.push([key, 'content', content.version ?? '-', content.commit ?? content.error, content.startedAt ?? '', mark(content, beHead)]);
}

const widths = [8, 9, 10, 10, 26];
console.log(['env', 'service', 'version', 'commit', 'built/started', 'vs branch'].map((h, i) => h.padEnd(widths[i] ?? 0)).join(' '));
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(widths[i] ?? 0)).join(' '));
if (!reposDir) console.log('\n(set CLINICAONE_REPOS_DIR to the folder holding the repos to compare against branch heads)');
