// What the qa CLI can run. One entry per Playwright project; toggles map to tags + env flags.
// Keep in sync with playwright.config.ts projects and the tags documented in docs/test-catalog.md.

/**
 * @typedef {{ id: string, project: string, title: string, about: string, publicTests: boolean,
 *   loginTests: boolean, browser: boolean, usesCases?: boolean, minutes: string }} Suite
 */

/** @type {Suite[]} */
export const SUITES = [
  { id: 'smoke', project: 'smoke', title: 'Smoke', about: 'health, versions, deep links, CORS, login page', publicTests: true, loginTests: true, browser: true, minutes: '<1' },
  { id: 'hardening', project: 'hardening', title: 'Hardening', about: 'TLS expiry, https redirect, security headers, error leakage, caching', publicTests: true, loginTests: false, browser: false, minutes: '<1' },
  { id: 'api', project: 'api', title: 'API contract', about: 'auth, cases, assets, sessions, quiz (+ AI / security when enabled)', publicTests: true, loginTests: true, browser: false, minutes: '1-3' },
  { id: 'engine', project: 'engine', title: 'Simulation engine', about: 'socket: timers, deterioration, scoring, multi-tab, reconnect, case scenarios', publicTests: true, loginTests: true, browser: false, usesCases: true, minutes: '5-10' },
  { id: 'e2e', project: 'e2e', title: 'Browser E2E', about: 'login UI, library, quiz, full simulation journey, a11y', publicTests: true, loginTests: true, browser: true, usesCases: true, minutes: '8-15' },
  { id: 'resilience', project: 'resilience', title: 'Resilience', about: 'API 500s, slow network, network drop mid-case, stale token, double clicks', publicTests: true, loginTests: true, browser: true, usesCases: true, minutes: '3-5' },
  { id: 'perf', project: 'perf', title: 'Performance budgets', about: 'API p95, page TTFB/LCP/JS weight, case media weight', publicTests: true, loginTests: true, browser: true, usesCases: true, minutes: '1-2' },
  { id: 'mobile', project: 'e2e-mobile', title: 'Mobile layout', about: 'landscape phone viewport overflow checks', publicTests: false, loginTests: true, browser: true, minutes: '1-2' },
];

/**
 * Opt-in toggles. `tag` tests are excluded unless the toggle is on; `env` is exported to the run.
 * `cost` is shown in the wizard so the QA engineer knows what they are paying for.
 */
export const TOGGLES = [
  { id: 'ai', tag: '@ai', title: 'AI patient conversations', cost: 'PAID: real LLM calls (~8 per run, hard-capped)', login: true, default: false, env: { QA_ENABLE_AI: '1' } },
  { id: 'writes', tag: '@writes', title: 'Create test data (sessions, quiz attempts, notes)', cost: 'adds rows to the env DB under the QA learner', login: true, default: true, env: {} },
  { id: 'security', tag: '@security', title: 'Security probes (IDOR, exposed routes)', cost: 'dev/test only; findings are confidential', login: true, default: false, env: { QA_ENABLE_SECURITY: '1' } },
  { id: 'slow', tag: '@slow', title: 'Slow tests (idle timeout)', cost: '~16 extra minutes', login: true, default: false, env: { QA_ENABLE_SLOW: '1' } },
  { id: 'visual', tag: '@visual', title: 'Visual screenshot comparison', cost: 'first run per env creates the baseline', login: false, default: false, env: {} },
];

export const suiteById = (id) => SUITES.find((s) => s.id === id);
