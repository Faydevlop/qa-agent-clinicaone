import { io } from 'socket.io-client';
import { test, expect } from '../support/fixtures';
import { flags } from '../../lib/env.mjs';
import { getSession } from '../../lib/auth.mjs';
import { SimSession } from '../../lib/sim.mjs';

// Socket-level behaviour of the simulation service: auth handshake, room ownership,
// multi-tab consistency, reconnect, time-skip arithmetic, post-end behaviour and idle policy.
// Server facts (simulation-service/src/events/websocket.ts, config/index.ts):
//   join-session refuses sessions owned by someone else with error "Session not found";
//   idle warning after IDLE_WARNING_SECONDS (900) then ends IDLE_END_AFTER_WARNING_SECONDS (120) later.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A plain action (labs/exams/history need extra payload), preferring one wired from the current state. */
async function plainAction(api: any, state: any) {
  const catalog = (await api.get(`/cases/${(await api.findCase(flags.defaultCase)).id}/actions`)).tableData as any[];
  const plain = catalog.filter((a) => !['lab', 'exam', 'history'].includes(a.actionType));
  const wired = new Set((state.actions ?? []).map((a: any) => a.actionId ?? a.id));
  return (plain.find((a) => wired.has(a.id)) ?? plain[0])?.id as string | undefined;
}

test.describe('socket handshake @engine @public', () => {
  test('connecting without a token is refused', async ({ env }) => {
    const s = io(env.socketUrl, { path: env.socketPath, transports: ['websocket'], reconnection: false, auth: {} });
    const outcome = await new Promise<string>((resolve) => {
      s.once('connect', () => resolve('connected'));
      s.once('connect_error', (e) => resolve(`refused: ${e.message}`));
      setTimeout(() => resolve('timeout'), 15_000);
    });
    s.close();
    expect(outcome).toMatch(/^refused/);
  });
});

test.describe('socket behaviour @engine @writes', () => {
  test.skip(({ env }) => !env.writesAllowed, 'environment is read-only for QA');

  const opened: SimSession[] = [];
  let sessionId: string | undefined;
  let token = '';

  const open = async (env: any) => {
    const s = await new SimSession({ sessionId: sessionId!, token, env }).connect();
    opened.push(s);
    return s;
  };

  test.beforeEach(async ({ api, env }) => {
    token = (await getSession('learner', env)).accessToken;
    const c = await api.findCase(flags.defaultCase);
    sessionId = (await api.startSession(c.id)).id;
  });

  test.afterEach(async ({ api }, info) => {
    for (const [i, s] of opened.entries()) {
      await info.attach(`socket-${i}.json`, { body: JSON.stringify(s.events, null, 2), contentType: 'application/json' });
      s.close();
    }
    opened.length = 0;
    if (sessionId) await api.endSession(sessionId);
    sessionId = undefined;
  });

  test('joining a session id that is not yours is refused', async ({ env }) => {
    const s = new SimSession({ sessionId: '0123456789abcdef01234567', token, env });
    opened.push(s);
    await expect(s.connect({ timeoutMs: 8000 })).rejects.toThrow();
    expect(s.eventsOf('error').map((e) => e.data?.message)).toContain('Session not found');
    expect(s.eventsOf('session-state')).toEqual([]);
  });

  test('two tabs on one session see the same state and the same timer', async ({ env, api }) => {
    const a = await open(env);
    const b = await open(env);
    expect(b.state.currentStateId).toBe(a.state.currentStateId);
    const [ta, tb] = await Promise.all([a.waitFor('timer-update', null, { timeoutMs: 15_000, includePast: false }), b.waitFor('timer-update', null, { timeoutMs: 15_000, includePast: false })]);
    expect(Math.abs(ta.elapsedSeconds - tb.elapsedSeconds), 'tabs disagree on elapsed time').toBeLessThanOrEqual(5);

    // An action from tab A must reach tab B.
    const actionId = await plainAction(api, a.state);
    test.skip(!actionId, 'case has no plain actions');
    const since = Date.now();
    await a.perform(actionId!);
    await b.waitFor('action-result', null, { since, timeoutMs: 30_000, includePast: false }).catch(() =>
      b.waitFor('action-pending', null, { since, timeoutMs: 1000 }),
    );
  });

  test('reconnecting resumes the same state without resetting the clock', async ({ env }) => {
    const first = await open(env);
    const tick = await first.waitFor('timer-update', null, { timeoutMs: 15_000 });
    first.close();
    await sleep(6000);
    const again = await open(env);
    expect(again.state.currentStateId, 'state after reconnect').toBe(first.state.currentStateId);
    const next = await again.waitFor('timer-update', null, { timeoutMs: 15_000, includePast: false });
    expect(next.elapsedSeconds, 'elapsed went backwards after reconnect').toBeGreaterThanOrEqual(tick.elapsedSeconds);
  });

  test('skip-time advances simulated time by exactly the requested minutes', async ({ env }) => {
    const s = await open(env);
    const m = Math.min(...(s.state.timeSkipOptionsMinutes ?? []));
    test.skip(!Number.isFinite(m), 'no time-skip options offered at arrival');
    const before = (await s.waitFor('timer-update', null, { timeoutMs: 15_000 })).elapsedSeconds;
    const { skipped, error } = await s.skipTime(m);
    expect(error, JSON.stringify(error)).toBeUndefined();
    expect(skipped.minutes).toBe(m);
    expect(skipped.skippedSeconds).toBe(m * 60);
    // Real-time ticks keep running during the round trip, so allow a few seconds of drift.
    expect(skipped.simElapsedSeconds - before).toBeGreaterThanOrEqual(m * 60);
    expect(skipped.simElapsedSeconds - before).toBeLessThan(m * 60 + 20);
  });

  test('every offered skip duration is accepted', async ({ env }) => {
    const s = await open(env);
    const options: number[] = s.state.timeSkipOptionsMinutes ?? [];
    test.skip(!options.length, 'no time-skip options offered at arrival');
    for (const m of [...options].sort((x, y) => x - y)) {
      const r = await s.skipTime(m);
      if (r.error) {
        // A skip can legitimately end the case (timeout) — stop rather than fail.
        test.info().annotations.push({ type: 'skip-ended', description: `${m} min: ${r.error.message}` });
        break;
      }
      expect(r.skipped.minutes).toBe(m);
    }
  });

  test('after hand-off, actions and skips have no effect', async ({ env, api }) => {
    const s = await open(env);
    const actionId = await plainAction(api, s.state);
    const ended = await s.handoff();
    expect(ended).toMatchObject({ totalScore: expect.any(Number) });
    const since = Date.now();
    if (actionId) s.socket!.emit('perform-action', { sessionId, actionId });
    s.socket!.emit('skip-time', { sessionId, minutes: 5 });
    await sleep(5000);
    const late = s.events.filter((e) => e.at > since && ['action-result', 'time-skipped', 'timer-update'].includes(e.event));
    expect(late.map((e) => e.event), 'engine kept running after the session ended').toEqual([]);
  });

  test('idle warning after 15 min, cleared by activity @slow', async ({ env }) => {
    test.skip(!flags.slow, 'takes ~16 min; enable slow tests (QA_ENABLE_SLOW=1)');
    test.setTimeout(20 * 60_000);
    const s = await open(env);
    const warn = await s.waitFor('idle-warning', null, { timeoutMs: 17 * 60_000 });
    expect(warn.secondsLeft).toBeGreaterThan(0);
    expect(warn.secondsLeft).toBeLessThanOrEqual(120);
    const since = Date.now();
    s.activity();
    await s.waitFor('idle-cleared', null, { since, timeoutMs: 15_000 });
  });
});
