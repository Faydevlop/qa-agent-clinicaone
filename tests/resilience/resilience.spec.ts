import { test, expect } from '../support/fixtures';
import { sel, autoAcceptDialogs, startCaseFromLibrary, passGates } from '../support/ui';
import { flags, resolveEnv } from '../../lib/env.mjs';

// How the learner app behaves when things go wrong: backend errors, slow or dropped network,
// stale tokens, flaky socket. The bar is "no white screen, no uncaught exception, and the
// learner can recover", not a specific error design.

const env = resolveEnv();
const API = new RegExp('^' + env.api.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test.describe('resilience @resilience', () => {
  test('stale or garbage token falls back to Login instead of a stuck spinner @public', async ({ page, health }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('c1.accessToken', 'garbage.token.value');
      sessionStorage.setItem('c1.user', JSON.stringify({ id: 'x', email: 'qa@example.com', role: 'learner' }));
    });
    await page.goto('/home');
    await expect(page.getByText('Sign in')).toBeVisible({ timeout: 30_000 });
    expect(health.pageErrors).toEqual([]);
  });

  test('case list survives a 500 from the API', async ({ learnerPage: page, health }) => {
    await page.route((u) => API.test(u.toString()) && u.pathname.endsWith('/cases'), (r) =>
      r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":500,"message":"QA injected"}' }) : r.continue(),
    );
    await page.goto('/cases');
    await expect(sel.nav.caseLibrary(page), 'app shell still rendered').toBeVisible({ timeout: 30_000 });
    await expect(sel.cases.search(page)).toBeVisible();
    expect(health.pageErrors, 'uncaught exception on API 500').toEqual([]);
  });

  test('home renders on a slow network (3 s API latency)', async ({ learnerPage: page, health }) => {
    await page.route((u) => API.test(u.toString()), async (r) => {
      await new Promise((res) => setTimeout(res, 3000));
      await r.continue();
    });
    await page.goto('/home');
    await expect(page.getByText('Explore Case Library')).toBeVisible({ timeout: 45_000 });
    expect(health.pageErrors).toEqual([]);
  });

  test('double-clicking Start Now creates one session, not two @writes', async ({ learnerPage: page, api }) => {
    test.skip(!env.writesAllowed, 'environment is read-only for QA');
    autoAcceptDialogs(page);
    const created: string[] = [];
    page.on('response', async (r) => {
      if (r.url().endsWith('/sessions') && r.request().method() === 'POST' && r.status() === 201) created.push((await r.json()).data.id);
    });
    await page.goto('/cases');
    await sel.cases.search(page).fill(flags.defaultCase);
    await page.getByLabel(new RegExp(`^Open case .*${flags.defaultCase}`, 'i')).first().click();
    await sel.cases.startNow(page).dblclick();
    await page.waitForURL(/\/simulation\//, { timeout: 90_000 }).catch(() => {});
    for (const id of created) await api.endSession(id);
    expect(created.length, `sessions created by a double click: ${created.join(', ')}`).toBe(1);
  });

  test('simulation recovers after a 10 s network drop @writes', async ({ learnerPage: page, context, socketLog, api, health }) => {
    test.skip(!env.writesAllowed, 'environment is read-only for QA');
    autoAcceptDialogs(page);
    const session = await startCaseFromLibrary(page, flags.defaultCase);
    try {
      await page.waitForURL(/\/simulation\//, { timeout: 90_000 });
      await passGates(page);
      await socketLog.waitFor('timer-update', undefined, 20_000);
      const before = socketLog.last('timer-update').elapsedSeconds;
      const joinsBefore = socketLog.of('join-session', 'out').length;

      await context.setOffline(true);
      await page.waitForTimeout(10_000);
      await context.setOffline(false);

      // The client must rejoin the room on reconnect, or the timer/vitals silently freeze.
      await expect
        .poll(() => socketLog.of('join-session', 'out').length, { timeout: 45_000, message: 'client re-sent join-session after reconnect' })
        .toBeGreaterThan(joinsBefore);
      const after = await socketLog.waitFor('timer-update', (d) => d.elapsedSeconds > before, 30_000);
      expect(after.elapsedSeconds).toBeGreaterThan(before);
      expect(health.pageErrors).toEqual([]);
    } finally {
      await api.endSession(session.id);
    }
  });
});
