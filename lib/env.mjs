// Resolves which ClinicaOne environment we are testing and which credentials to use.
// Shared by Playwright suites and the node scripts in scripts/.
import 'dotenv/config';

/**
 * Known environments. Pattern: web = <env>.clinicaone.app, api = <env>-backend.clinicaone.app.
 * Branch = the git branch each env deploys from (frontend + backend share the branch name).
 * preprod/prod hostnames are not in any repo yet — set QA_WEB_URL / QA_API_URL until they are.
 */
export const ENVIRONMENTS = {
  dev: { web: 'https://dev.clinicaone.app', api: 'https://dev-backend.clinicaone.app/api/v1', branch: 'dev', writes: true },
  test: { web: 'https://test.clinicaone.app', api: 'https://test-backend.clinicaone.app/api/v1', branch: 'testing', writes: true },
  uat: { web: 'https://uat.clinicaone.app', api: 'https://uat-backend.clinicaone.app/api/v1', branch: 'uat', writes: true },
  preprod: { web: null, api: null, branch: 'pre-prod', writes: true },
  prod: { web: null, api: null, branch: 'main', writes: false },
};

export const ROLES = ['learner'];

/** Turns "https://test.clinicaone.app/login" or "test" into an env key, or null if unknown. */
export function envKeyFrom(target) {
  if (!target) return null;
  const t = String(target).trim().toLowerCase();
  if (ENVIRONMENTS[t]) return t;
  let host;
  try {
    host = new URL(t.startsWith('http') ? t : `https://${t}`).hostname;
  } catch {
    return null;
  }
  for (const [key, e] of Object.entries(ENVIRONMENTS)) {
    if (e.web && new URL(e.web).hostname === host) return key;
    if (e.api && new URL(e.api).hostname === host) return key;
  }
  const m = host.match(/^([a-z0-9]+)(?:-backend)?\.clinicaone\.app$/);
  if (m && m[1] === 'pre-prod') return 'preprod';
  if (m) return m[1];
  return null;
}

/** Derives the backend API base from a frontend URL using the <sub>-backend convention. */
export function apiFromWeb(webUrl) {
  const u = new URL(webUrl);
  const [sub, ...rest] = u.hostname.split('.');
  return `https://${sub}-backend.${rest.join('.')}/api/v1`;
}

/** The fully resolved target. Throws with a helpful message when something is missing. */
export function resolveEnv(target = process.env.QA_TARGET || 'dev') {
  const key = envKeyFrom(target) ?? 'custom';
  const known = ENVIRONMENTS[key] ?? { web: null, api: null, branch: null, writes: true };
  const isUrl = /^https?:\/\//i.test(String(target));

  const web = process.env.QA_WEB_URL || known.web || (isUrl ? new URL(target).origin : null);
  const api = process.env.QA_API_URL || known.api || (web ? apiFromWeb(web) : null);
  if (!web || !api) {
    throw new Error(
      `Cannot resolve URLs for QA_TARGET="${target}". Set QA_WEB_URL and QA_API_URL in .env ` +
        `(preprod/prod hostnames are not documented in the repos yet).`,
    );
  }
  const apiOrigin = new URL(api).origin;
  return {
    key,
    web: web.replace(/\/$/, ''),
    api: api.replace(/\/$/, ''),
    apiOrigin,
    socketUrl: apiOrigin,
    socketPath: '/api/v1/websocket',
    branch: known.branch,
    isProd: key === 'prod',
    writesAllowed:
      process.env.QA_READ_ONLY === '1' ? false : key === 'prod' ? process.env.QA_ALLOW_PROD_WRITES === '1' : known.writes,
  };
}

/** Credentials for a role, preferring <ENV>_<ROLE>_EMAIL over <ROLE>_EMAIL. */
export function credentials(role = 'learner', envKey = resolveEnv().key) {
  const R = role.toUpperCase();
  const E = envKey.toUpperCase();
  const email = process.env[`${E}_${R}_EMAIL`] || process.env[`${R}_EMAIL`];
  const password = process.env[`${E}_${R}_PASSWORD`] || process.env[`${R}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `Missing credentials for role "${role}" on "${envKey}". Set ${R}_EMAIL / ${R}_PASSWORD ` +
        `(or ${E}_${R}_EMAIL / ${E}_${R}_PASSWORD) in qa-agent/.env.`,
    );
  }
  return { email, password };
}

export const flags = {
  /** QA_MODE=public: no credentials are used; only @public tests are selected by the CLI. */
  publicOnly: process.env.QA_MODE === 'public',
  ai: process.env.QA_ENABLE_AI === '1',
  /** Hard cap on paid AI patient calls per run (each message = one LLM completion). */
  aiMaxCalls: Number(process.env.QA_AI_MAX_CALLS || 15),
  security: process.env.QA_ENABLE_SECURITY === '1',
  slow: process.env.QA_ENABLE_SLOW === '1',
  readOnly: process.env.QA_READ_ONLY === '1',
  // First case picked in the CLI wins, so e2e follows the same selection as the engine suite.
  defaultCase: (process.env.QA_CASES ?? '').split(',')[0].trim() || process.env.QA_DEFAULT_CASE || 'Pneumothorax',
};
