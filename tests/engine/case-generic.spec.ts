import { test, expect } from '../support/fixtures';
import { resolveEnv } from '../../lib/env.mjs';
import { getSession } from '../../lib/auth.mjs';
import { SimSession } from '../../lib/sim.mjs';
import { collectUrls } from '../../lib/cases.mjs';

// Generic checks for any case the QA engineer picks (QA_CASES, set by `npm run qa`), whether or
// not it has a saved spec in cases/. They only rely on rules every authored case must follow:
// content is complete, assets load, every reachable state has a scene, an untreated patient
// changes over time, wrong actions never score, and the end-of-case score is consistent.
// Case-specific expectations live in cases/*.case.json (case-scenarios.spec.ts).

const env = resolveEnv();
const titles = (process.env.QA_CASES ?? '').split(',').map((t) => t.trim()).filter(Boolean);

// Loose physiological bounds: a value outside these is an authoring typo, not a sick patient.
const PLAUSIBLE: Record<string, [number, number]> = {
  heartRate: [0, 300],
  bpSystolic: [0, 300],
  bpDiastolic: [0, 200],
  respRate: [0, 80],
  spO2: [0, 100],
  temperature: [25, 45],
  gcs: [3, 15],
};

const implausible = (v: any) =>
  Object.entries(PLAUSIBLE)
    .filter(([k, [lo, hi]]) => typeof v?.[k] === 'number' && (v[k] < lo || v[k] > hi))
    .map(([k]) => `${k}=${v[k]}`);

for (const title of titles) {
  test.describe(`case checks: ${title} @engine @case`, () => {
    test('content is complete and every asset loads', async ({ api }) => {
      test.setTimeout(300_000);
      const c = await api.findCase(title);
      const [detail, actions, layout, evidence] = await Promise.all([
        api.get(`/cases/${c.id}`),
        api.get(`/cases/${c.id}/actions`),
        api.get(`/cases/${c.id}/view-layout`),
        api.get(`/cases/${c.id}/evidence-packs`),
      ]);
      expect(detail.status, 'case detail').toBe(200);
      const catalog = (actions.tableData ?? []) as any[];
      expect(catalog.length, 'action catalog is empty').toBeGreaterThan(0);
      const dupes = catalog.map((a) => a.name).filter((n, i, all) => all.indexOf(n) !== i);
      expect.soft(dupes, 'duplicate action names confuse learners and specs').toEqual([]);
      expect(Object.keys(layout.data?.states ?? {}).length, 'view-layout has no states').toBeGreaterThan(0);

      const urls = [...collectUrls(layout.data)];
      if (c.patient?.imageUrl) urls.push(c.patient.imageUrl);
      const problems: string[] = [];
      for (const url of urls) {
        const t0 = Date.now();
        const res = await fetch(url, { headers: { range: 'bytes=0-1023' } }).catch((e) => ({ status: `ERR ${e.message}` }) as any);
        const ms = Date.now() - t0;
        if (typeof res.status !== 'number' || res.status >= 400) problems.push(`${res.status} ${url}`);
        else if (ms > 8000) problems.push(`slow ${ms}ms ${url}`);
      }
      for (const p of evidence.tableData ?? []) {
        const res = p.fileUrl ? await fetch(p.fileUrl, { headers: { range: 'bytes=0-1023' } }).catch(() => null) : null;
        if (!res || res.status >= 400) problems.push(`evidence "${p.title}" ${res?.status ?? 'no fileUrl'}`);
      }
      test.info().annotations.push({ type: 'content', description: `${catalog.length} actions, ${Object.keys(layout.data.states).length} scenes, ${urls.length} assets, ${(evidence.tableData ?? []).length} evidence packs` });
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test.describe('live session @writes', () => {
      test.skip(!env.writesAllowed, 'environment is read-only for QA');

      let sim: SimSession | undefined;
      let sessionId: string | undefined;
      let caseId = '';
      let layoutStates: Record<string, unknown> = {};

      test.beforeEach(async ({ api }) => {
        const c = await api.findCase(title);
        caseId = c.id;
        layoutStates = (await api.get(`/cases/${c.id}/view-layout`)).data?.states ?? {};
        sessionId = (await api.startSession(c.id)).id;
        sim = await new SimSession({ sessionId: sessionId!, token: (await getSession('learner', env)).accessToken, env }).connect();
      });

      test.afterEach(async ({ api }, info) => {
        if (sim) await info.attach('socket-events.json', { body: JSON.stringify(sim.events, null, 2), contentType: 'application/json' });
        sim?.close();
        if (sessionId) await api.endSession(sessionId);
        sim = sessionId = undefined;
      });

      test('arrival: plausible vitals, wired actions, a scene and a running clock', async () => {
        const st = sim!.state;
        test.info().annotations.push({ type: 'arrival', description: `${st.currentStateName}: ${JSON.stringify(st.vitals)}` });
        expect(st.isTerminal, 'case starts in a terminal state').toBe(false);
        expect(st.criticalTimeLimitSeconds, 'no critical time limit').toBeGreaterThan(0);
        expect(st.actions.length + (st.hintActionIds?.length ?? 0), 'no actions wired at arrival').toBeGreaterThan(0);
        expect(implausible(st.vitals), 'implausible arrival vitals').toEqual([]);
        expect(layoutStates[st.currentStateId], `no scene authored for arrival state "${st.currentStateName}"`).toBeTruthy();
        await sim!.waitFor('timer-update', null, { timeoutMs: 15_000 });
      });

      test('untreated: the patient changes over time and every state reached has a scene', async () => {
        const path: string[] = [sim!.state.currentStateName];
        const problems: string[] = [];
        // Skip up to 3 times using the largest offered option; stop at terminal or when no timer.
        for (let i = 0; i < 3; i++) {
          const st = sim!.state;
          const options: number[] = st.timeSkipOptionsMinutes ?? [];
          if (st.isTerminal || !st.stateTimer || !options.length) break;
          const since = Date.now();
          const r = await sim!.skipTime(Math.max(...options));
          if (r.error) break; // e.g. the skip ran into the critical time limit
          const next = await sim!.waitFor('session-state', (d: any) => d.currentStateId !== st.currentStateId, { since, timeoutMs: 20_000 }).catch(() => null);
          if (!next) break;
          path.push(`${next.currentStateName} (${next.enteredByTimer?.transitionType ?? '?'})`);
          if (!layoutStates[next.currentStateId]) problems.push(`no scene for "${next.currentStateName}" (scene/animation mismatch)`);
          problems.push(...implausible(next.vitals).map((x) => `${next.currentStateName}: implausible ${x}`));
        }
        test.info().annotations.push({ type: 'untreated-path', description: path.join(' → ') });
        test.skip(path.length === 1 && !sim!.state.stateTimer, 'arrival state has no timer: nothing happens untreated by design');
        expect(path.length, 'untreated patient never changed state').toBeGreaterThan(1);
        expect(problems, problems.join('\n')).toEqual([]);
      });

      test('an unrelated action never scores', async ({ api }) => {
        const catalog = (await api.get(`/cases/${caseId}/actions`)).tableData as any[];
        const wired = new Set([...(sim!.state.hintActionIds ?? []), ...sim!.state.actions.map((a: any) => a.actionId ?? a.id)]);
        const wrong = catalog.find((a) => !wired.has(a.id) && !['lab', 'exam', 'history'].includes(a.actionType));
        test.skip(!wrong, 'every catalog action is wired at arrival');
        const r = await sim!.perform(wrong.id);
        const res = r.result ?? (await sim!.waitFor('action-result', (d: any) => d.actionId === wrong.id));
        test.info().annotations.push({ type: 'wrong-action', description: `${wrong.name} → ${res.classification} (${res.scoreDelta})` });
        expect(['wrong_state', 'general']).toContain(res.classification);
        expect(res.scoreDelta).toBeLessThanOrEqual(0);
      });

      test('immediate hand-off gives a consistent, non-passing score', async ({ api }) => {
        const ended = await sim!.handoff();
        expect(ended).toMatchObject({ totalScore: expect.any(Number), maxPossibleScore: expect.any(Number), reason: 'handoff' });
        expect(ended.maxPossibleScore, 'case has no scoring').toBeGreaterThan(0);
        expect(ended.passed).toBe(ended.totalScore > 0);
        expect(ended.passed, 'doing nothing should not pass').toBe(false);
        const rest = await api.endSession(sessionId!);
        expect(rest.data.totalScore, 'REST re-score must match socket result').toBe(ended.totalScore);
      });
    });
  });
}

if (!titles.length) {
  test('case checks @case', () => test.skip(true, 'no case picked: npm run qa → "Specific case(s)", or --cases "Title"'));
}
