// Condenses reports/results.json (Playwright JSON reporter) + reports/run.json (written by
// the qa CLI) into reports/summary.md: what ran, against which build, what failed and why.
import fs from 'node:fs';
import path from 'node:path';

export const REPORTS = path.resolve(import.meta.dirname, '..', 'reports');
/** Last result per env + case, shown by `qa cases` and the wizard's case picker. */
export const CASE_RESULTS = path.resolve(import.meta.dirname, '..', '.qa', 'case-results.json');

// Describe titles that carry a case name: case-generic, case-scenarios, e2e journey.
const CASE_SUITE = /^(?:case checks|case|simulation journey): (.+?) @/;
const strip = (s = '') => s.replace(/\u001b\[[0-9;]*m/g, '');

function* walk(suite, file = suite.file, parents = []) {
  const chain = [...parents, suite.title];
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) yield { file: spec.file ?? file, title: spec.title, line: spec.line, test: t, chain };
  }
  for (const s of suite.suites ?? []) yield* walk(s, s.file ?? file, chain);
}

export function summarize({ write = true } = {}) {
  const resultsFile = path.join(REPORTS, 'results.json');
  if (!fs.existsSync(resultsFile)) return { text: 'No reports/results.json yet: run some tests first.', exitCode: 1 };
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const run = fs.existsSync(path.join(REPORTS, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(REPORTS, 'run.json'), 'utf8')) : null;

  const failed = [];
  const flaky = [];
  const skipped = new Map();
  const notes = [];
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  /** @type {Map<string, {passed:number, failed:number, skipped:number, failures:string[]}>} */
  const perCase = new Map();
  for (const suite of results.suites ?? []) {
    for (const r of walk(suite)) {
      const last = r.test.results?.at(-1);
      const caseTitle = r.chain.map((t) => t?.match(CASE_SUITE)?.[1]).find(Boolean);
      if (caseTitle) {
        const pc = perCase.get(caseTitle) ?? { passed: 0, failed: 0, skipped: 0, failures: [] };
        if (r.test.status === 'skipped') pc.skipped++;
        else if (r.test.status === 'unexpected') (pc.failed++, pc.failures.push(r.title));
        else pc.passed++;
        perCase.set(caseTitle, pc);
      }
      const where = `${r.test.projectName} › ${r.file}:${r.line} › ${r.title}`;
      for (const a of r.test.annotations ?? []) {
        if (a.type !== 'skip' && a.description) notes.push(`${r.title} — ${a.type}: ${a.description}`);
      }
      if (r.test.status === 'skipped') {
        counts.skipped++;
        const why = r.test.annotations?.find((a) => a.type === 'skip')?.description || 'filtered or skipped';
        skipped.set(why, (skipped.get(why) ?? 0) + 1);
      } else if (r.test.status === 'flaky') {
        counts.flaky++;
        flaky.push(where);
      } else if (r.test.status === 'unexpected') {
        counts.failed++;
        const err = strip(last?.error?.message ?? last?.errors?.[0]?.message ?? 'no error message').split('\n').filter(Boolean).slice(0, 6).join('\n    ');
        failed.push(`- **${where}**\n    ${err}`);
      } else counts.passed++;
    }
  }

  const s = results.stats ?? {};
  const md = [
    `# QA run summary`,
    '',
    run
      ? `**Target:** ${run.env.key} (${run.env.web}) · **Mode:** ${run.mode} · **Suites:** ${run.suites.join(', ')} · **Opt-ins:** ${Object.entries(run.toggles).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`
      : null,
    run?.builds ? `**Builds:** web ${run.builds.web ?? '?'} · api ${run.builds.api ?? '?'}` : null,
    `**Started:** ${s.startTime ?? run?.startedAt ?? '?'} · **Duration:** ${Math.round((s.duration ?? 0) / 1000)} s`,
    '',
    `| passed | failed | flaky | skipped |`,
    `|---|---|---|---|`,
    `| ${counts.passed} | ${counts.failed} | ${counts.flaky} | ${counts.skipped} |`,
    '',
    perCase.size
      ? `## Cases\n\n| case | passed | failed | skipped | failing checks |\n|---|---|---|---|---|\n${[...perCase]
          .map(([t, p]) => `| ${t} | ${p.passed} | ${p.failed} | ${p.skipped} | ${p.failures.join('; ') || '-'} |`)
          .join('\n')}\n`
      : null,
    failed.length ? `## Failures\n\n${failed.join('\n')}\n` : '## Failures\n\nNone.\n',
    flaky.length ? `## Flaky (passed on retry)\n\n${flaky.map((f) => `- ${f}`).join('\n')}\n` : '',
    skipped.size ? `## Skipped\n\n${[...skipped].map(([why, n]) => `- ${n} × ${why}`).join('\n')}\n` : '',
    notes.length ? `## Measurements and notes\n\n${notes.slice(0, 60).map((n) => `- ${n}`).join('\n')}\n` : '',
    `Full report: \`npm run report\` (reports/html). Traces for failures are in test-results/.`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  if (write) {
    fs.writeFileSync(path.join(REPORTS, 'summary.md'), md + '\n');
    if (perCase.size && run?.env?.key) {
      fs.mkdirSync(path.dirname(CASE_RESULTS), { recursive: true });
      const store = fs.existsSync(CASE_RESULTS) ? JSON.parse(fs.readFileSync(CASE_RESULTS, 'utf8')) : {};
      for (const [t, p] of perCase) {
        store[`${run.env.key}|${t.toLowerCase()}`] = { title: t, env: run.env.key, at: run.startedAt, builds: run.builds, ...p };
      }
      fs.writeFileSync(CASE_RESULTS, JSON.stringify(store, null, 2));
    }
  }
  return { text: md, counts, exitCode: counts.failed ? 1 : 0 };
}
