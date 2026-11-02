#!/usr/bin/env node
// ClinicaOne QA CLI.
//   npm run qa                         interactive wizard (target → login? → suites → paid/risky opt-ins → cases → run)
//   npm run qa -- run  [flags]         non-interactive (what Claude uses)
//   npm run qa -- plan [flags]         show the exact command + env without running
//   npm run qa -- doctor [target]      .env / connectivity / login check
//   npm run qa -- last                 re-run the previous selection
//   npm run qa -- cases [--env e]      list published cases + what is saved for each + last result
//   npm run qa -- case "<title>" ...   test specific case(s) [--full adds the browser journey]
//   npm run qa -- presets | suites | summary
// Flags: --env <key|link> --public | --login [--role learner] --suites a,b | --preset name
//        --ai [--ai-max N] --security --no-writes --slow --visual --cases "A,B" --grep text
//        --headed --retries N --update-snapshots --full --yes --json
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ENVIRONMENTS, ROLES, resolveEnv } from '../lib/env.mjs';
import { findSpec, activeScenarios } from '../lib/cases.mjs';
import { Api } from '../lib/api.mjs';
import { SUITES, TOGGLES } from './catalog.mjs';
import { defaults, buildPlan, hasCredentials } from './plan.mjs';
import { summarize, REPORTS, CASE_RESULTS } from './summary.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE_DIR = path.join(ROOT, '.qa');
const LAST = path.join(STATE_DIR, 'last.json');
const PRESETS_DIR = path.join(ROOT, 'presets');
const PW_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

// Plain text when piped (Claude reads the output) or NO_COLOR is set.
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { b: paint(1), dim: paint(2), red: paint(31), yel: paint(33), grn: paint(32) };

// ---------------------------------------------------------------------------
// Options: defaults ← .qa/last.json (wizard only) ← preset ← flags
// ---------------------------------------------------------------------------
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

function presets() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs.readdirSync(PRESETS_DIR).filter((f) => f.endsWith('.json')).map((f) => ({ name: f.replace(/\.json$/, ''), ...readJson(path.join(PRESETS_DIR, f)) }));
}

function loadPreset(name) {
  const p = presets().find((x) => x.name === name);
  if (!p) throw new Error(`Unknown preset "${name}". Available: ${presets().map((x) => x.name).join(', ')}`);
  const { name: _n, description: _d, ...opts } = p;
  return opts;
}

function optionsFromFlags(v, base) {
  const o = { ...base };
  if (v.preset) Object.assign(o, loadPreset(v.preset));
  if (v.env) o.target = v.env;
  if (v.public) o.mode = 'public';
  if (v.login) o.mode = 'login';
  if (v.role) o.role = v.role;
  if (v.suites) o.suites = v.suites === 'all' ? SUITES.map((s) => s.id) : v.suites.split(',').map((s) => s.trim()).filter(Boolean);
  if (v.ai) o.ai = true;
  if (v['ai-max']) o.aiMaxCalls = Number(v['ai-max']);
  if (v.security) o.security = true;
  if (v['no-writes']) o.writes = false;
  if (v.slow) o.slow = true;
  if (v.visual) o.visual = true;
  if (v.cases) o.cases = v.cases.split(',').map((s) => s.trim()).filter(Boolean);
  // --cases without --suites/--preset means "test these cases", not "whole app filtered to them".
  if (v.cases && !v.suites && !v.preset) o.focus = 'cases';
  if (v.full) o.caseDepth = 'full';
  if (v.grep) o.grep = v.grep;
  if (v.headed) o.headed = true;
  if (v.retries) o.retries = Number(v.retries);
  if (v['update-snapshots']) o.updateSnapshots = true;
  return o;
}

// ---------------------------------------------------------------------------
// Cases: live list from the env + what is saved in cases/ + last result
// ---------------------------------------------------------------------------
/** Published case titles on the env, or null when we can't log in. Uses the cached session. */
async function liveCases(target, role = 'learner') {
  try {
    const api = await Api.as(role, resolveEnv(target));
    const r = await api.post('/cases', { pagination: { page: 1, limit: 100 } });
    return r.ok ? r.tableData.map((c) => c.title) : null;
  } catch {
    return null;
  }
}

function caseInfo(title, envKey) {
  const spec = findSpec(title);
  const results = readJson(CASE_RESULTS) ?? {};
  const last = results[`${envKey}|${title.toLowerCase()}`];
  const saved = spec
    ? `${activeScenarios(spec).length} saved checks${spec.manualChecks?.length ? `, ${spec.manualChecks.length} manual` : ''}${spec.knownIssues?.length ? `, ${spec.knownIssues.length} known issues` : ''}${spec.verified ? '' : ' (unverified)'}`
    : 'nothing saved yet (generic checks only)';
  const lastRun = last ? `last on ${envKey}: ${last.failed ? `${last.failed} failed` : 'all passed'} ${last.at.slice(0, 10)}` : 'never run here';
  return { spec, saved, lastRun };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function printPlan(plan) {
  if (!plan.env) {
    plan.errors.forEach((e) => console.log(c.red(`  ✘ ${e}`)));
    return;
  }
  const o = plan.options;
  console.log(`\n${c.b('Run plan')}`);
  console.log(`  target    ${plan.env.key}  ${c.dim(`${plan.env.web}  |  ${plan.env.api}`)}`);
  console.log(`  mode      ${o.mode === 'public' ? 'without login (public checks only)' : `logged in as ${o.role}`}`);
  console.log(`  suites    ${plan.suites.join(', ') || c.red('none')}`);
  const t = plan.toggles;
  console.log(`  opt-ins   AI ${t.ai ? c.yel(`ON (max ${o.aiMaxCalls} calls)`) : 'off'} · writes ${t.writes ? 'on' : 'off'} · security ${t.security ? c.yel('ON') : 'off'} · slow ${t.slow ? 'on' : 'off'} · visual ${t.visual ? 'on' : 'off'}`);
  if (o.cases?.length) console.log(`  cases     ${o.cases.join(', ')}${o.focus === 'cases' ? ` (case focus, ${o.caseDepth === 'full' ? 'with browser journey' : 'socket + content only'})` : ''}`);
  if (plan.authCalls) console.log(`  logins    ~${plan.authCalls} of the 10 / 15 min allowed per IP`);
  plan.warnings.forEach((w) => console.log(c.yel(`  ! ${w}`)));
  plan.errors.forEach((e) => console.log(c.red(`  ✘ ${e}`)));
  console.log(c.dim(`  ${plan.command}`));
}

function countTests(plan) {
  const r = spawnSync(process.execPath, [PW_CLI, ...plan.args.slice(1), '--list'], {
    cwd: ROOT,
    env: { ...process.env, ...plan.childEnv },
    encoding: 'utf8',
  });
  const m = (r.stdout ?? '').match(/Total: (\d+) tests? in (\d+) files?/);
  return m ? { tests: Number(m[1]), files: Number(m[2]) } : null;
}

async function buildVersions(env) {
  const get = async (u) => {
    try {
      const v = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json();
      return `${v.version ?? ''} ${v.commit ?? ''}`.trim();
    } catch {
      return null;
    }
  };
  return { web: await get(`${env.web}/version.json`), api: await get(`${new URL(env.api).origin}/version`) };
}

async function execute(plan) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(LAST, JSON.stringify(plan.options, null, 2));
  const builds = await buildVersions(plan.env);
  fs.writeFileSync(
    path.join(REPORTS, 'run.json'),
    JSON.stringify({ startedAt: new Date().toISOString(), env: plan.env, mode: plan.options.mode, suites: plan.suites, toggles: plan.toggles, builds, command: plan.command }, null, 2),
  );
  console.log(c.b(`\nRunning against ${plan.env.key} (web ${builds.web ?? '?'}, api ${builds.api ?? '?'})\n`));
  const r = spawnSync(process.execPath, [PW_CLI, ...plan.args.slice(1)], { cwd: ROOT, env: { ...process.env, ...plan.childEnv }, stdio: 'inherit' });
  const s = summarize();
  console.log(`\n${s.text}\n`);
  console.log(c.dim(`Summary saved to reports/summary.md`));
  return r.status ?? s.exitCode;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------
async function wizard() {
  const { select, checkbox, confirm, input, number } = await import('@inquirer/prompts');
  const last = readJson(LAST);
  const o = { ...defaults(), ...(last ?? {}) };

  console.log(c.b('\nClinicaOne QA\n'));
  if (last) {
    const again = await select({
      message: 'Start from',
      choices: [
        { name: 'A new selection', value: 'new' },
        { name: `Last run (${last.target}, ${last.focus === 'cases' ? `cases: ${last.cases.join(', ')}` : `${last.mode}, ${last.suites.join('+')}`})`, value: 'last' },
        ...presets().map((p) => ({ name: `Preset: ${p.name}`, value: `preset:${p.name}`, description: p.description })),
      ],
    });
    if (again === 'last') return finish(o);
    if (again.startsWith('preset:')) return finish({ ...o, ...loadPreset(again.slice(7)) }, { askTarget: true });
  }

  // 1. Target
  const envChoices = Object.entries(ENVIRONMENTS)
    .filter(([, e]) => e.web)
    .map(([k, e]) => ({ name: `${k.padEnd(6)} ${c.dim(e.web)}`, value: k }));
  const pick = await select({ message: 'Which environment?', choices: [...envChoices, { name: 'Paste a link…', value: 'link' }], default: ENVIRONMENTS[o.target] ? o.target : undefined });
  o.target = pick === 'link' ? await input({ message: 'Frontend link', default: /^https?:/.test(o.target) ? o.target : 'https://' , validate: (v) => /^https?:\/\/.+/.test(v) || 'Enter a full https:// link' }) : pick;

  // 2. Login
  const envKey = resolveEnv(o.target).key;
  o.mode = await select({
    message: 'Run with login?',
    choices: [
      { name: 'With login (full coverage)', value: 'login', description: 'Needs credentials in .env' },
      { name: 'Without login (public checks only)', value: 'public', description: 'Health, headers, login page, anonymous API rules. Nothing is written.' },
    ],
    default: o.mode,
  });
  if (o.mode === 'login') {
    o.role = ROLES.length > 1 ? await select({ message: 'Role', choices: ROLES.map((r) => ({ name: r, value: r })), default: o.role }) : ROLES[0];
    if (!hasCredentials(o.role, envKey)) {
      console.log(c.yel(`\n  No ${o.role} credentials for ${envKey} in .env. Add ${o.role.toUpperCase()}_EMAIL and ${o.role.toUpperCase()}_PASSWORD, then re-run.\n`));
      if (!(await confirm({ message: 'Continue without login instead?', default: true }))) return 1;
      o.mode = 'public';
    }
  }
  const isPublic = o.mode === 'public';

  // 3. Whole app or specific cases
  o.focus = isPublic
    ? 'app'
    : await select({
        message: 'What do you want to test?',
        choices: [
          { name: 'The whole app', value: 'app', description: 'Pick suites: smoke, API, engine, browser...' },
          { name: 'Specific case(s)', value: 'cases', description: 'Pick cases on this environment; runs their saved checks + generic case checks' },
        ],
        default: o.focus ?? 'app',
      });

  if (o.focus === 'cases') {
    console.log(c.dim('  Loading published cases...'));
    const live = await liveCases(o.target, o.role);
    if (!live?.length) {
      console.log(c.yel('  Could not load the case list (login or network). Type titles instead.'));
      o.cases = (await input({ message: 'Case titles, comma-separated', default: (o.cases ?? []).join(', ') })).split(',').map((t) => t.trim()).filter(Boolean);
    } else {
      o.cases = await checkbox({
        message: 'Which cases?',
        required: true,
        pageSize: 15,
        choices: live.map((t) => {
          const i = caseInfo(t, envKey);
          return { name: `${t.padEnd(36)} ${c.dim(`${i.saved} · ${i.lastRun}`)}`, value: t, checked: (o.cases ?? []).includes(t) };
        }),
      });
    }
    o.caseDepth = await select({
      message: 'How deep?',
      choices: [
        { name: 'Quick: content, assets, engine checks and saved checks (~2-4 min per case)', value: 'quick' },
        { name: 'Full: also plays the case in the browser: scene, animation, timer, report (~6-10 min per case)', value: 'full' },
      ],
      default: o.caseDepth ?? 'quick',
    });
    const extras = await checkbox({
      message: 'Opt-ins (cost / risk)',
      choices: [
        { name: `${'AI patient conversations (first case)'.padEnd(48)} ${c.dim('PAID: real LLM calls, hard-capped')}`, value: 'ai', checked: !!o.ai },
        { name: `${'Create test data (sessions)'.padEnd(48)} ${c.dim('needed for everything except content checks')}`, value: 'writes', checked: o.writes !== false },
      ],
    });
    o.ai = extras.includes('ai');
    o.writes = extras.includes('writes');
    if (o.ai) o.aiMaxCalls = await number({ message: 'Max AI calls for this run (hard stop)', default: o.aiMaxCalls || 15, min: 1, max: 100, required: true });
    if (o.caseDepth === 'full') o.headed = await confirm({ message: 'Show the browser while it runs?', default: o.headed });
    return finish(o);
  }

  // 4. Suites
  const available = SUITES.filter((s) => (isPublic ? s.publicTests : true));
  o.suites = await checkbox({
    message: 'Which suites?',
    required: true,
    choices: available.map((s) => ({
      name: `${s.title.padEnd(20)} ${c.dim(`${s.about} · ~${s.minutes} min${isPublic && s.loginTests ? ' · public part only' : ''}`)}`,
      value: s.id,
      checked: o.suites.includes(s.id),
    })),
  });

  // 5. Cost / risk switches
  const toggles = TOGGLES.filter((t) => !isPublic || !t.login);
  const picked = await checkbox({
    message: 'Opt-ins (cost / risk)',
    choices: toggles.map((t) => ({ name: `${t.title.padEnd(48)} ${c.dim(t.cost)}`, value: t.id, checked: !!o[t.id] })),
  });
  for (const t of TOGGLES) o[t.id] = picked.includes(t.id);
  if (o.ai) {
    o.aiMaxCalls = await number({ message: 'Max AI calls for this run (hard stop)', default: o.aiMaxCalls || 15, min: 1, max: 100, required: true });
  }
  o.cases = [];

  // 6. Browser
  if (o.suites.some((id) => SUITES.find((s) => s.id === id)?.browser)) {
    o.headed = await confirm({ message: 'Show the browser while it runs?', default: o.headed });
  }
  o.retries = await select({ message: 'Retries for failed tests', choices: [{ name: '0 (see every failure)', value: 0 }, { name: '1 (separate flaky from broken)', value: 1 }], default: o.retries ?? 0 });

  return finish(o);
}

async function finish(o, { askTarget = false } = {}) {
  const { select, input } = await import('@inquirer/prompts');
  if (askTarget) o.target = await input({ message: 'Environment (key or link)', default: o.target });
  const plan = buildPlan(o);
  printPlan(plan);
  if (!plan.ok) return 1;
  const n = countTests(plan);
  if (n) console.log(`  ${c.b(`${n.tests} tests`)} in ${n.files} files\n`);
  const next = await select({
    message: 'Go?',
    choices: [
      { name: 'Run now', value: 'run' },
      { name: 'Save as preset, then run', value: 'save' },
      { name: 'Just print the command', value: 'print' },
      { name: 'Cancel', value: 'cancel' },
    ],
  });
  if (next === 'cancel') return 0;
  if (next === 'print') {
    console.log(`\n${Object.entries(plan.childEnv).map(([k, v]) => `${k}=${v}`).join(' ')} ${plan.command}\n`);
    return 0;
  }
  if (next === 'save') {
    const name = await input({ message: 'Preset name', validate: (v) => /^[a-z0-9-]+$/.test(v) || 'lowercase letters, digits, dashes' });
    const { target: _t, ...rest } = o;
    fs.mkdirSync(PRESETS_DIR, { recursive: true });
    fs.writeFileSync(path.join(PRESETS_DIR, `${name}.json`), JSON.stringify({ description: `saved ${new Date().toISOString().slice(0, 10)}`, ...rest }, null, 2));
    console.log(c.grn(`  saved presets/${name}.json`));
  }
  return execute(plan);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    env: { type: 'string', short: 'e' },
    public: { type: 'boolean' },
    login: { type: 'boolean' },
    role: { type: 'string' },
    suites: { type: 'string', short: 's' },
    preset: { type: 'string', short: 'p' },
    ai: { type: 'boolean' },
    'ai-max': { type: 'string' },
    security: { type: 'boolean' },
    'no-writes': { type: 'boolean' },
    slow: { type: 'boolean' },
    visual: { type: 'boolean' },
    cases: { type: 'string' },
    grep: { type: 'string', short: 'g' },
    headed: { type: 'boolean' },
    retries: { type: 'string' },
    'update-snapshots': { type: 'boolean' },
    full: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [cmd = '', arg] = positionals;

function help() {
  const head = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  console.log(`${head}\n\nSuites:  ${SUITES.map((s) => s.id).join(', ')}, all\nPresets: ${presets().map((p) => p.name).join(', ') || 'none'}`);
}

async function main() {
  if (v.help || cmd === 'help') return help(), 0;

  switch (cmd) {
    case '': {
      if (!process.stdin.isTTY) {
        console.log('Not an interactive terminal: use `npm run qa -- run <flags>` (or `plan` to preview).\n');
        help();
        return 2;
      }
      return wizard();
    }
    case 'run':
    case 'plan': {
      const plan = buildPlan(optionsFromFlags(v, defaults()));
      if (v.json) {
        const { options, ...rest } = plan;
        console.log(JSON.stringify({ ...rest, options, tests: plan.ok ? countTests(plan) : null }, null, 2));
        if (cmd === 'plan' || !plan.ok) return plan.ok ? 0 : 1;
      } else {
        printPlan(plan);
        if (!plan.ok) return 1;
        const n = countTests(plan);
        if (n) console.log(`  ${c.b(`${n.tests} tests`)} in ${n.files} files\n`);
        if (cmd === 'plan') return 0;
      }
      return execute(plan);
    }
    case 'cases': {
      const target = v.env ?? arg ?? defaults().target;
      const envKey = resolveEnv(target).key;
      const live = await liveCases(target);
      if (!live) console.log(c.yel(`Could not load published cases on ${envKey} (no credentials or network). Showing saved specs only.\n`));
      const titles = live ?? [];
      for (const t of titles) {
        const i = caseInfo(t, envKey);
        console.log(`  ${c.b(t)}\n    ${i.saved} · ${i.lastRun}`);
      }
      const saved = fs
        .readdirSync(path.join(ROOT, 'cases'))
        .filter((f) => f.endsWith('.case.json') && !f.startsWith('_'))
        .map((f) => readJson(path.join(ROOT, 'cases', f)).title)
        .filter((t) => !titles.some((x) => x.toLowerCase() === String(t).toLowerCase()));
      for (const t of live ? [] : saved) console.log(`  ${c.b(t)}\n    ${caseInfo(t, envKey).saved}`);
      if (live && saved.length) console.log(`\n  Saved here but not published on ${envKey}: ${saved.join(', ')}`);
      return 0;
    }
    case 'case': {
      const titles = positionals.slice(1).flatMap((t) => t.split(',')).map((t) => t.trim()).filter(Boolean);
      if (!titles.length) return console.log('Usage: npm run qa -- case "<title>" ["<title2>"] [--env test] [--full] [--ai]'), 2;
      const plan = buildPlan({ ...optionsFromFlags(v, defaults()), focus: 'cases', cases: titles });
      if (v.json) return console.log(JSON.stringify(plan, null, 2)), plan.ok ? 0 : 1;
      printPlan(plan);
      if (!plan.ok) return 1;
      const n = countTests(plan);
      if (n) console.log(`  ${c.b(`${n.tests} tests`)} in ${n.files} files\n`);
      return execute(plan);
    }
    case 'last': {
      const last = readJson(LAST);
      if (!last) return console.log('No previous run recorded.'), 1;
      const plan = buildPlan(optionsFromFlags(v, last));
      printPlan(plan);
      return plan.ok ? execute(plan) : 1;
    }
    case 'doctor': {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-env.mjs'), ...(arg ? [arg] : v.env ? [v.env] : [])], { cwd: ROOT, stdio: 'inherit' });
      const browsers = spawnSync(process.execPath, [PW_CLI, 'install', '--dry-run', 'chromium'], { cwd: ROOT, encoding: 'utf8' });
      const dir = (browsers.stdout ?? '').match(/Install location:\s*(.+)/)?.[1]?.trim();
      console.log(dir && fs.existsSync(dir) ? c.grn('  ✔ Playwright Chromium installed') : c.yel('  ! Chromium not installed: npm run setup'));
      return r.status ?? 1;
    }
    case 'presets':
      for (const p of presets()) console.log(`  ${c.b(p.name.padEnd(14))} ${p.description ?? ''}\n  ${c.dim(`${p.mode} · ${p.suites.join(', ')}${p.ai ? ' · AI' : ''}${p.security ? ' · security' : ''}`)}`);
      return 0;
    case 'suites':
      for (const s of SUITES) console.log(`  ${c.b(s.id.padEnd(11))} ${s.about} ${c.dim(`(~${s.minutes} min${s.publicTests ? ', has public tests' : ''})`)}`);
      console.log('\n  Opt-ins:');
      for (const t of TOGGLES) console.log(`  ${c.b(`--${t.id}`.padEnd(11))} ${t.title} ${c.dim(t.cost)}`);
      return 0;
    case 'summary': {
      const s = summarize();
      console.log(s.text);
      return s.exitCode;
    }
    default:
      console.log(`Unknown command "${cmd}".`);
      help();
      return 2;
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((e) => {
    if (e?.name === 'ExitPromptError') process.exit(130); // Ctrl+C in a prompt
    console.error(c.red(e.message));
    process.exit(1);
  });
