import { test, expect } from '../support/fixtures';
import { resolveEnv } from '../../lib/env.mjs';
import { getSession } from '../../lib/auth.mjs';
import { SimSession } from '../../lib/sim.mjs';
import { loadCaseSpecs, appliesTo, resolveAction, activeScenarios, vitalsFailures } from '../../lib/cases.mjs';

// Data-driven: every cases/*.case.json scenario becomes a test. See cases/README.md for the format.
// Scenarios saved by the QA engineer through Claude (qa-case-memory) run here too.

const env = resolveEnv();
const specs = loadCaseSpecs().filter((s) => appliesTo(s, env.key));

/** Latest vitals the server sent: vitals-update (patientState.vitals) or session-state (vitals). */
function latestVitals(sim: SimSession) {
  const e = [...sim.events].reverse().find((x) => x.event === 'vitals-update' || x.event === 'session-state');
  return e?.event === 'vitals-update' ? e.data?.patientState?.vitals : e?.data?.vitals;
}

/** Vitals ramp between ticks, so poll until the condition holds or the timeout passes. */
async function expectVitals(sim: SimSession, cond: any, label: string, timeoutMs = 20000) {
  await expect
    .poll(() => vitalsFailures(latestVitals(sim), cond), { timeout: timeoutMs, message: `${label} vitals ${JSON.stringify(cond)}` })
    .toEqual([]);
}

for (const spec of specs) {
  test.describe(`case: ${spec.title} @engine @case`, () => {
    test.skip(!env.writesAllowed, 'environment is read-only for QA');

    for (const sc of activeScenarios(spec)) {
      test(sc.name, async ({ api }, info) => {
        if (spec.verified === false) info.annotations.push({ type: 'unverified-spec', description: `${spec.file}: expectations not yet confirmed against Case Builder` });
        if (sc.request) info.annotations.push({ type: 'saved-check', description: `"${sc.request}" (added ${sc.addedOn ?? '?'} by ${sc.addedBy ?? 'QA'})` });
        if (sc.status === 'draft') info.annotations.push({ type: 'draft-check', description: 'not yet confirmed by a passing run' });
        const c = await api.findCase(spec.title);
        const catalog = (await api.get(`/cases/${c.id}/actions`)).tableData as any[];
        const s = await api.startSession(c.id);
        const sim = await new SimSession({ sessionId: s.id, token: (await getSession('learner', env)).accessToken, env }).connect();
        let ended: any = null;
        let lastPendingReportId: string | undefined;

        try {
          for (const [i, step] of sc.steps.entries()) {
            const label = `step ${i + 1}`;
            const stateBefore = sim.state;

            if (step.action) {
              const a = resolveAction(step.action, catalog);
              const r = await sim.perform(a.id, { selectedLabPanels: step.labPanels, selectedExamSystems: step.examSystems });
              if (step.expect?.refused) {
                expect(r.error, `${label} "${a.name}" should be refused`).toBeTruthy();
                continue;
              }
              expect(r.error, `${label} "${a.name}" refused: ${r.error?.message}`).toBeUndefined();
              if (r.pending) lastPendingReportId = r.pending.reportId;
              const res = r.result ?? (step.waitForResult ? await sim.waitFor('action-result', (d: any) => d.actionId === a.id, { timeoutMs: 60000 }) : null);
              info.annotations.push({ type: label, description: `${a.name} → ${res?.classification ?? 'pending'} (${res?.scoreDelta ?? 0})` });
              if (step.expect?.classification) expect(res?.classification, `${label} ${a.name}`).toBe(step.expect.classification);
              if (step.expect?.scoreDelta !== undefined) expect(res?.scoreDelta, `${label} ${a.name} scoreDelta`).toBe(step.expect.scoreDelta);
            } else if (step.skipTime) {
              const r = await sim.skipTime(step.skipTime);
              if (step.expect?.refused) { expect(r.error).toBeTruthy(); continue; }
              expect(r.error, `${label} skip-time refused: ${r.error?.message}`).toBeUndefined();
            } else if (step.wait) {
              // Real seconds: lets timers tick or clips play without skipping sim time.
              await new Promise((r) => setTimeout(r, step.wait * 1000));
            } else if (step.skipLabWait) {
              expect(lastPendingReportId, `${label} no pending lab to skip`).toBeTruthy();
              await sim.skipLabWait(lastPendingReportId!);
            } else if (step.handoff !== undefined) {
              let optionId: string | undefined;
              if (step.handoff) {
                const opt = (sim.state.endOptions ?? []).find((o: any) => o.label?.toLowerCase() === String(step.handoff).toLowerCase() || o.id === step.handoff);
                expect(opt, `${label} end option "${step.handoff}" not offered in ${sim.state.currentStateName}`).toBeTruthy();
                optionId = opt.id;
              }
              ended = await sim.handoff(optionId);
              continue;
            }

            if (step.expect?.toState) {
              const st = await sim.waitFor('session-state', (d: any) => d.currentStateName === step.expect.toState, { timeoutMs: step.expect.timeoutMs ?? 30000 });
              expect(st.currentStateName).toBe(step.expect.toState);
            }
            if (step.expect?.enteredBy) {
              const st = await sim.waitFor('session-state', (d: any) => d.currentStateId !== stateBefore.currentStateId, { timeoutMs: 30000 });
              expect(st.enteredByTimer?.transitionType, `${label} transition type`).toBe(step.expect.enteredBy);
            }
            if (step.expect?.isTerminal !== undefined) expect(sim.state.isTerminal).toBe(step.expect.isTerminal);
            if (step.expect?.stateIn) expect(step.expect.stateIn, `${label} current state`).toContain(sim.state.currentStateName);
            if (step.expect?.notState) expect(sim.state.currentStateName, `${label} current state`).not.toBe(step.expect.notState);
            if (step.expect?.vitals) await expectVitals(sim, step.expect.vitals, label, step.expect.timeoutMs);
          }

          const e = sc.expect ?? {};
          if (e.finalState && !ended) expect(sim.state.currentStateName, 'final state').toBe(e.finalState);
          if (e.vitals && !ended) await expectVitals(sim, e.vitals, 'final', e.timeoutMs);
          if (e.reachesTerminal !== undefined && !ended) expect(sim.state.isTerminal, 'reaches terminal state').toBe(e.reachesTerminal);
          if (ended) {
            info.annotations.push({ type: 'result', description: `score ${ended.totalScore}/${ended.maxPossibleScore} ${ended.outcome} passed=${ended.passed}` });
            if (e.passed !== undefined) expect(ended.passed).toBe(e.passed);
            if (e.scoreMin !== undefined) expect(ended.totalScore).toBeGreaterThanOrEqual(e.scoreMin);
            if (e.scoreMax !== undefined) expect(ended.totalScore).toBeLessThanOrEqual(e.scoreMax);
            if (e.maxPossibleScore !== undefined) expect(ended.maxPossibleScore).toBe(e.maxPossibleScore);
            if (e.outcomeIn) expect(e.outcomeIn).toContain(ended.outcome);
            if (e.reason) expect(ended.reason).toBe(e.reason);
          }
        } finally {
          await info.attach('socket-events.json', { body: JSON.stringify(sim.events, null, 2), contentType: 'application/json' });
          sim.close();
          await api.endSession(s.id);
        }
      });
    }
  });
}

if (!specs.length) test('no case specs for this environment', () => test.skip(true, 'add cases/*.case.json (see cases/README.md)'));
