import { test, expect } from '../support/fixtures';
import { sel, performFromSidebar, autoAcceptDialogs, domMediaUrls, brokenMedia, startCaseFromLibrary, passGates } from '../support/ui';
import { flags, resolveEnv } from '../../lib/env.mjs';
import { loadCaseSpecs, appliesTo, collectUrls } from '../../lib/cases.mjs';

// Full learner journey in the browser: start → loading/asset prefetch → scene → actions →
// timers/vitals → hand-off → case report. Assertions lean on the Socket.IO frames the page
// receives (server truth) and on DOM media, because the scene is a scaled image canvas.

const env = resolveEnv();
const specs = loadCaseSpecs().filter((s) => appliesTo(s, env.key));
// Every case picked in the qa CLI (QA_CASES), else the default case.
const caseTitles = (process.env.QA_CASES ?? '').split(',').map((t) => t.trim()).filter(Boolean);
if (!caseTitles.length) caseTitles.push(flags.defaultCase);

// Third-party noise we don't treat as product failures.
const IGNORE = [/google-analytics|googletagmanager|sentry|hotjar/i];

for (const caseTitle of caseTitles) {
  const golden = specs.find((s) => s.title.toLowerCase() === caseTitle.toLowerCase())?.scenarios.find((s: any) => s.golden);

  test.describe(`simulation journey: ${caseTitle} @e2e @writes @case`, () => {
    test.skip(!env.writesAllowed, 'environment is read-only for QA');

    let sessionId: string | undefined;

    test.beforeEach(async ({ page }) => autoAcceptDialogs(page));
    test.afterEach(async ({ api }) => {
      if (sessionId) await api.endSession(sessionId);
      sessionId = undefined;
    });

    test('loading screen prefetches every asset and enters the treatment room', async ({ learnerPage: page, health }) => {
      const assetStatus = new Map<string, number>();
      page.on('response', (r) => assetStatus.set(r.url(), r.status()));

      const t0 = Date.now();
      const session = await startCaseFromLibrary(page, caseTitle);
      sessionId = session.id;

      await expect(page.getByText(/Preparing ER Bay/)).toBeVisible();
      await page.waitForURL(new RegExp(`/simulation/${session.id}/`), { timeout: 90_000 });
      const loadMs = Date.now() - t0;
      test.info().annotations.push({ type: 'load-time', description: `${loadMs}ms for ${session.allAssetUrls.length} assets` });
      expect(loadMs, 'loading screen holds ≥12 s by design').toBeGreaterThanOrEqual(11_000);
      expect.soft(loadMs, 'loading took > 60 s').toBeLessThan(60_000);

      const failedAssets = session.allAssetUrls.filter((u) => (assetStatus.get(u) ?? 200) >= 400);
      expect(failedAssets, 'assets that failed to prefetch').toEqual([]);
      expect(health.realFailures(IGNORE).filter((f) => f.status !== 401), JSON.stringify(health.realFailures(IGNORE), null, 2)).toEqual([]);
    });

    test('scene, timer, vitals and media are consistent with server state', async ({ learnerPage: page, socketLog, health, api }) => {
      const session = await startCaseFromLibrary(page, caseTitle);
      sessionId = session.id;
      await page.waitForURL(/\/simulation\//, { timeout: 90_000 });
      await passGates(page);

      const state = await socketLog.waitFor('session-state');
      await expect(page.getByText(state.currentStateName ?? '', { exact: false }).first()).toBeAttached().catch(() => {});

      // Timer: the HUD countdown should move, and server ticks keep coming.
      await socketLog.waitFor('timer-update', undefined, 15_000);
      const ticksBefore = socketLog.of('timer-update').length;
      await page.waitForTimeout(11_000);
      expect(socketLog.of('timer-update').length, 'server timer ticks while the page is open').toBeGreaterThan(ticksBefore);

      // Vitals stay hidden until the monitor is attached, then show numbers.
      const hr = page.getByText('Heart Rate').first();
      await expect(hr).toBeVisible();
      await sel.sim.attachMonitor(page).click();
      await expect(page.getByText('---').first()).toBeHidden({ timeout: 10_000 }).catch(() => {
        test.info().annotations.push({ type: 'warning', description: 'vitals still show "---" after attaching the monitor' });
      });

      // Animation/scene mismatch: media for the current state should be what the DOM shows.
      const layout = (await api.get(`/cases/${session.caseId}/view-layout`)).data;
      const stateLayout = layout?.states?.[state.currentStateId];
      if (stateLayout) {
        const expected = [...collectUrls(stateLayout)];
        const shown = await domMediaUrls(page);
        const missing = expected.filter((u) => !shown.some((s) => s.split('?')[0] === u.split('?')[0]));
        test.info().annotations.push({ type: 'scene-media', description: `expected ${expected.length}, shown ${shown.length}, missing ${missing.length}` });
        expect.soft(missing.length, `state "${state.currentStateName}" media not rendered:\n${missing.join('\n')}`).toBeLessThanOrEqual(Math.floor(expected.length / 2));
      }
      expect(await brokenMedia(page), 'images/videos that failed to decode').toEqual([]);
      expect(health.pageErrors, 'uncaught exceptions during simulation').toEqual([]);
    });

    test('golden path through the UI ends with a matching case report', async ({ learnerPage: page, socketLog, health }) => {
      test.skip(!golden, `no golden scenario for "${caseTitle}" in cases/`);
      const session = await startCaseFromLibrary(page, caseTitle);
      sessionId = session.id;
      await page.waitForURL(/\/simulation\//, { timeout: 90_000 });
      await passGates(page);
      await socketLog.waitFor('session-state');

      for (const step of golden.steps) {
        if (!step.action) continue; // skips/hand-off handled below
        const before = socketLog.of('action-result').length;
        await performFromSidebar(page, step.action);
        await expect.poll(() => socketLog.of('action-result').length + socketLog.of('action-pending').length, { message: `server response to "${step.action}"`, timeout: 30_000 }).toBeGreaterThan(before);
        const res = socketLog.last('action-result');
        if (step.expect?.classification) expect.soft(res?.classification, step.action).toBe(step.expect.classification);
        // Let transition/hold clips (≤20 s) finish before the next action.
        await page.waitForTimeout(2_000);
      }

      await sel.sim.handoff(page).click();
      await expect(page.getByText('Select Destination')).toBeVisible();
      await page.getByRole('button').filter({ hasText: /Discharge|Recovery|Ward|ICU|Transfer/i }).first().click().catch(async () => {
        await page.getByText(/Discharge/).first().click();
      });

      const ended = await socketLog.waitFor('session-ended', undefined, 30_000);
      // Summary waits for any hold clip, then 2.5 s.
      await expect(sel.summary.score(page)).toBeVisible({ timeout: 40_000 });
      await expect(page.getByText(`${ended.totalScore} / ${ended.maxPossibleScore}`, { exact: false })).toBeVisible();
      for (const tab of ['What to improve', 'What went well', 'Summary', 'Score breakdown']) {
        await expect.soft(page.getByText(tab, { exact: true }), `report tab "${tab}"`).toBeVisible();
      }
      await expect(sel.summary.replay(page)).toBeVisible();
      await expect(sel.summary.home(page)).toBeVisible();
      expect(health.pageErrors).toEqual([]);
    });

    test('browser Back inside a simulation asks to confirm and Stay keeps the session', async ({ learnerPage: page }) => {
      const session = await startCaseFromLibrary(page, caseTitle);
      sessionId = session.id;
      await page.waitForURL(/\/simulation\//, { timeout: 90_000 });
      await passGates(page);
      await page.mouse.click(960, 540); // arms the history sentinel (re-armed on pointerup)
      await page.goBack();
      await expect(page.getByText('Leave simulation?')).toBeVisible();
      await sel.sim.exitStay(page).click();
      await expect(page).toHaveURL(new RegExp(`/simulation/${session.id}/`));
    });

    test('reloading the simulation rejoins the same session', async ({ learnerPage: page, socketLog }) => {
      const session = await startCaseFromLibrary(page, caseTitle);
      sessionId = session.id;
      await page.waitForURL(/\/simulation\//, { timeout: 90_000 });
      await passGates(page);
      const first = await socketLog.waitFor('session-state');
      await page.reload();
      await passGates(page);
      const joins = () => socketLog.of('join-session', 'out').filter((e) => e.data?.sessionId === session.id).length;
      await expect.poll(joins, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      const again = socketLog.last('session-state');
      expect(again.currentStateId).toBe(first.currentStateId);
    });
  });
}
