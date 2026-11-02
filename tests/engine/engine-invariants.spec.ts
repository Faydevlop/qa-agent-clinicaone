import { test, expect } from '../support/fixtures';
import { flags } from '../../lib/env.mjs';
import { getSession } from '../../lib/auth.mjs';
import { SimSession } from '../../lib/sim.mjs';

// Case-agnostic engine rules, driven over Socket.IO against the default case.
// Each test starts its own session and always ends it.

test.describe('simulation engine invariants @engine @writes', () => {
  test.skip(({ env }) => !env.writesAllowed, 'environment is read-only for QA');

  let sim: SimSession | undefined;
  let sessionId: string | undefined;

  test.beforeEach(async ({ api, env }) => {
    const c = await api.findCase(flags.defaultCase);
    const s = await api.startSession(c.id);
    sessionId = s.id;
    sim = await new SimSession({ sessionId: s.id, token: (await getSession('learner', env)).accessToken, env }).connect();
  });

  test.afterEach(async ({ api }, info) => {
    if (sim) await info.attach('socket-events.json', { body: JSON.stringify(sim.events, null, 2), contentType: 'application/json' });
    sim?.close();
    if (sessionId) await api.endSession(sessionId);
    sim = sessionId = undefined;
  });

  test('join delivers a complete session-state snapshot', async () => {
    const st = sim!.state;
    expect(st).toMatchObject({
      currentStateId: expect.any(String),
      currentStateName: expect.any(String),
      isTerminal: false,
      vitals: expect.any(Object),
      criticalTimeLimitSeconds: expect.any(Number),
      simElapsedSeconds: expect.any(Number),
    });
    expect(st.actions.length + (st.hintActionIds?.length ?? 0), 'no actions wired at arrival').toBeGreaterThan(0);
    for (const k of ['heartRate', 'spO2']) {
      if (k in st.vitals) expect(typeof st.vitals[k]).toBe('number');
    }
  });

  test('timer ticks roughly every 5 s and elapsed time never goes backwards', async () => {
    await sim!.waitFor('timer-update', null, { timeoutMs: 15000 });
    await new Promise((r) => setTimeout(r, 16000));
    const ticks = sim!.eventsOf('timer-update');
    expect(ticks.length, 'expected ≥3 timer-update ticks in ~16 s').toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].data.elapsedSeconds).toBeGreaterThanOrEqual(ticks[i - 1].data.elapsedSeconds);
      const gap = ticks[i].at - ticks[i - 1].at;
      expect.soft(gap, `tick gap ${gap}ms`).toBeGreaterThan(3000);
      expect.soft(gap, `tick gap ${gap}ms`).toBeLessThan(9000);
    }
    expect(sim!.eventsOf('vitals-update').length, 'vitals-update should accompany ticks').toBeGreaterThan(0);
  });

  test('untreated patient deteriorates when time is skipped past the state timer', async () => {
    const st = sim!.state;
    test.skip(!st.stateTimer, `arrival state "${st.currentStateName}" has no timer edge`);
    const options: number[] = st.timeSkipOptionsMinutes ?? [];
    test.skip(!options.length, 'no time-skip options offered at arrival');

    const before = { id: st.currentStateId, vitals: { ...st.vitals } };
    const max = Math.max(...options);
    const r = await sim!.skipTime(max);
    expect(r.error, `skip-time refused: ${r.error?.message}`).toBeUndefined();
    expect(r.skipped.skippedSeconds).toBeGreaterThan(0);

    const next = await sim!.waitFor('session-state', (d: any) => d.currentStateId !== before.id, { timeoutMs: 20000 });
    test.info().annotations.push({ type: 'transition', description: `${st.currentStateName} → ${next.currentStateName} via ${next.enteredByTimer?.transitionType}` });
    expect(next.enteredByTimer, 'state change after skip must be timer-driven').toBeTruthy();
    expect(['deterioration', 'improving', 'stabilizing']).toContain(next.enteredByTimer.transitionType);
    expect(JSON.stringify(next.vitals), 'vitals should change on a timer transition').not.toBe(JSON.stringify(before.vitals));
  });

  test('skip-time with an unsupported duration is refused', async () => {
    const r = await sim!.skipTime(7);
    expect(r.error, 'skip-time accepts only the offered minute options').toBeTruthy();
  });

  test('an action not wired from the current state is penalised as wrong_state', async ({ api }) => {
    const catalog = (await api.get(`/cases/${(await api.findCase(flags.defaultCase)).id}/actions`)).tableData as any[];
    const wired = new Set([...(sim!.state.hintActionIds ?? []), ...sim!.state.actions.map((a: any) => a.actionId ?? a.id)]);
    const wrong = catalog.find((a) => !wired.has(a.id) && !['lab', 'exam', 'history'].includes(a.actionType));
    test.skip(!wrong, 'every catalog action is wired at arrival');

    const r = await sim!.perform(wrong.id);
    expect(r.error).toBeUndefined();
    const result = r.result ?? (await sim!.waitFor('action-result', (d: any) => d.actionId === wrong.id));
    expect(result.classification).toBe('wrong_state');
    expect(result.scoreDelta).toBeLessThanOrEqual(0);
  });

  test('hand-off ends the session with a consistent score payload', async ({ api }) => {
    const ended = await sim!.handoff();
    expect(ended).toMatchObject({ totalScore: expect.any(Number), maxPossibleScore: expect.any(Number), passed: expect.any(Boolean), reason: 'handoff' });
    expect(['success', 'partial', 'slow']).toContain(ended.outcome);
    expect(ended.passed).toBe(ended.totalScore > 0);
    expect(ended.scorePercentage).toBe(Math.min(100, Math.max(0, Math.round((ended.totalScore / ended.maxPossibleScore) * 100))));

    const rest = await api.endSession(sessionId!);
    expect(rest.data.totalScore, 'REST re-score must match socket result').toBe(ended.totalScore);
  });

  test('lab orders without panels are refused', async ({ api }) => {
    const catalog = (await api.get(`/cases/${(await api.findCase(flags.defaultCase)).id}/actions`)).tableData as any[];
    const lab = catalog.find((a) => a.actionType === 'lab');
    test.skip(!lab, 'case has no lab action');
    const r = await sim!.perform(lab.id);
    expect(r.error ?? r.result?.classification === 'wrong_state', 'lab without selectedLabPanels should be rejected').toBeTruthy();
  });
});
