// Turns run options (from the wizard, flags or a preset) into a Playwright command + env.
// Pure apart from reading .env through lib/env.mjs, so `qa plan` can show exactly what
// `qa run` would do.
import { resolveEnv, credentials } from '../lib/env.mjs';
import { SUITES, TOGGLES, suiteById } from './catalog.mjs';

/**
 * @typedef {{ target: string, mode: 'login' | 'public', role: string, suites: string[],
 *   ai: boolean, aiMaxCalls: number, writes: boolean, security: boolean, slow: boolean,
 *   visual: boolean, cases: string[], headed: boolean, retries: number, grep?: string,
 *   updateSnapshots?: boolean, focus?: 'app' | 'cases', caseDepth?: 'quick' | 'full' }} RunOptions
 */

/** @returns {RunOptions} */
export function defaults() {
  return {
    target: process.env.QA_TARGET || 'dev',
    mode: 'login',
    role: 'learner',
    suites: ['smoke', 'api'],
    ai: false,
    aiMaxCalls: Number(process.env.QA_AI_MAX_CALLS || 15),
    writes: true,
    security: false,
    slow: false,
    visual: false,
    cases: [],
    headed: false,
    retries: 0,
    focus: 'app',
    caseDepth: 'quick',
  };
}

/**
 * Case focus: the QA engineer picked specific cases. Runs only @case tests (generic case checks,
 * that case's saved scenarios, and with depth "full" the browser journey), plus the AI patient
 * for the first case when AI is on.
 * @param {RunOptions} o
 */
function caseSuites(o) {
  return ['engine', ...(o.caseDepth === 'full' ? ['e2e'] : []), ...(o.ai ? ['api'] : [])];
}

/** Whether credentials for role@env exist, without exposing them. */
export function hasCredentials(role, envKey) {
  try {
    credentials(role, envKey);
    return true;
  } catch {
    return false;
  }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {RunOptions} o */
export function buildPlan(o) {
  const warnings = [];
  const errors = [];

  // resolveEnv reads QA_TARGET; set it first so lib code and the child process agree.
  process.env.QA_TARGET = o.target;
  let env;
  try {
    env = resolveEnv(o.target);
  } catch (e) {
    errors.push(e.message);
    return { ok: false, errors, warnings };
  }

  const caseFocus = o.focus === 'cases';
  if (caseFocus) {
    o = { ...o, suites: caseSuites(o) };
    if (o.mode === 'public') errors.push('Testing a specific case needs login (it starts real sessions).');
    if (!o.cases?.length) errors.push('Pick at least one case (--cases "Title", or `npm run qa -- cases` to list them).');
  }

  const unknown = o.suites.filter((s) => !suiteById(s));
  if (unknown.length) errors.push(`Unknown suite(s): ${unknown.join(', ')}. Known: ${SUITES.map((s) => s.id).join(', ')}`);
  if (!o.suites.length) errors.push('Pick at least one suite.');

  const isPublic = o.mode === 'public';
  let suites = o.suites.map(suiteById).filter(Boolean);
  if (isPublic) {
    const dropped = suites.filter((s) => !s.publicTests);
    if (dropped.length) warnings.push(`Without login, skipping suites that only have login tests: ${dropped.map((s) => s.id).join(', ')}`);
    suites = suites.filter((s) => s.publicTests);
    for (const t of TOGGLES.filter((t) => t.login && o[t.id] && t.id !== 'writes')) warnings.push(`"${t.title}" needs login; ignored in public mode.`);
  } else if (!hasCredentials(o.role, env.key)) {
    errors.push(
      `No ${o.role} credentials for "${env.key}". Add ${o.role.toUpperCase()}_EMAIL / ${o.role.toUpperCase()}_PASSWORD ` +
        `(or ${env.key.toUpperCase()}_${o.role.toUpperCase()}_EMAIL / _PASSWORD) to qa-agent/.env, or run without login.`,
    );
  }

  // Effective toggles after mode + environment rules.
  const on = {
    ai: !isPublic && o.ai,
    writes: !isPublic && o.writes && env.writesAllowed,
    security: !isPublic && o.security,
    slow: !isPublic && o.slow,
    visual: o.visual,
  };
  if (!isPublic && o.writes && !env.writesAllowed) warnings.push(`${env.key} is read-only for QA: @writes tests excluded.`);
  if (on.security && !['dev', 'test'].includes(env.key)) {
    warnings.push(`Security probes only run on dev/test; on ${env.key} they will be skipped.`);
  }
  if (on.ai && env.key === 'prod') warnings.push('AI calls on prod spend production budget and show in prod usage metrics.');
  if (on.ai && !(o.aiMaxCalls > 0)) errors.push('AI max calls must be a positive number.');
  if (on.slow && !suites.some((s) => s.id === 'engine')) warnings.push('Slow tests live in the engine suite, which is not selected.');

  // Tag filters: public mode includes only @public; disabled toggles exclude their tag.
  const include = [];
  if (isPublic) include.push('@public');
  if (caseFocus) include.push(on.ai ? '(@case|@ai)' : '@case');
  if (o.grep) include.push(escape(o.grep));
  const exclude = TOGGLES.filter((t) => !on[t.id]).map((t) => t.tag);

  const args = ['playwright', 'test', ...suites.map((s) => `--project=${s.project}`)];
  if (include.length) args.push(`--grep=${include.length === 1 ? include[0] : include.map((x) => `(?=.*${x})`).join('') + '.*'}`);
  if (exclude.length) args.push(`--grep-invert=${exclude.join('|')}`);
  if (o.updateSnapshots) args.push('--update-snapshots');
  if (o.headed) args.push('--headed');

  const childEnv = {
    QA_TARGET: o.target,
    QA_MODE: isPublic ? 'public' : 'login',
    QA_ROLE: o.role,
    QA_ENABLE_AI: on.ai ? '1' : '0',
    QA_AI_MAX_CALLS: String(o.aiMaxCalls),
    QA_ENABLE_SECURITY: on.security ? '1' : '0',
    QA_ENABLE_SLOW: on.slow ? '1' : '0',
    QA_READ_ONLY: on.writes ? '0' : '1',
    QA_RETRIES: String(o.retries ?? 0),
    ...(o.cases?.length ? { QA_CASES: o.cases.join(',') } : {}),
    ...(o.headed ? { HEADED: '1' } : {}),
  };

  const browser = suites.some((s) => s.browser);
  const authCalls = isPublic ? 0 : 1 + (suites.some((s) => s.id === 'api') ? 1 : 0) + (suites.some((s) => s.id === 'e2e') ? 1 : 0);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    env: { key: env.key, web: env.web, api: env.api, writesAllowed: env.writesAllowed },
    suites: suites.map((s) => s.id),
    toggles: on,
    browser,
    authCalls,
    args,
    childEnv,
    command: `npx ${args.map((a) => (/[\s|()*?]/.test(a) ? `"${a}"` : a)).join(' ')}`,
    options: o,
  };
}
