import { test, expect } from '../support/fixtures';
import { collectUrls } from '../../lib/cases.mjs';
import { flags } from '../../lib/env.mjs';
import type { Page } from '@playwright/test';

// Performance budgets. Read-only. Budgets are soft (a slow env is a finding, not a broken
// build) except where noted; every measurement is attached as an annotation so trends can be
// compared across builds. Numbers include this machine's network, so compare like with like.

const BUDGET = {
  healthP95: 500,
  profileP95: 800,
  caseListP95: 1500,
  ttfb: 1500,
  domContentLoaded: 5000,
  lcp: 4000,
  jsTransferKb: 6000,
  imageKb: 2048,
  videoMb: 30,
};

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)];
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

async function timeIt(n: number, fn: () => Promise<{ ok: boolean }>) {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const r = await fn();
    ms.push(Math.round(performance.now() - t));
    expect(r.ok, `call ${i + 1} failed`).toBe(true);
  }
  return { p95: p95(ms), max: Math.max(...ms), all: ms };
}

async function pageMetrics(page: Page) {
  // LCP is only reported to observers, so read it with a buffered observer after load.
  return page.evaluate(async () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const lcp = await new Promise<number>((resolve) => {
      let last = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (last = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => resolve(last), 1500);
    });
    const js = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
      .reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0);
    return { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), lcp: Math.round(lcp), jsKb: Math.round(js / 1024) };
  });
}

test.describe('perf @perf', () => {
  test('gateway /health p95 @public', async ({ env }) => {
    const r = await timeIt(10, () => fetch(`${env.apiOrigin}/health`));
    note('health-ms', JSON.stringify(r));
    expect.soft(r.p95, `/health p95 ${r.p95}ms`).toBeLessThan(BUDGET.healthP95);
  });

  test('login page load budget (TTFB, DCL, LCP, JS weight) @public', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'load' });
    const m = await pageMetrics(page);
    note('login-page', JSON.stringify(m));
    expect.soft(m.ttfb, 'TTFB').toBeLessThan(BUDGET.ttfb);
    expect.soft(m.dcl, 'DOMContentLoaded').toBeLessThan(BUDGET.domContentLoaded);
    expect.soft(m.lcp, 'LCP').toBeLessThan(BUDGET.lcp);
    expect.soft(m.jsKb, 'JS transferred (KB)').toBeLessThan(BUDGET.jsTransferKb);
  });

  test('authenticated API latency (profile, case list)', async ({ api }) => {
    const profile = await timeIt(5, () => api.get('/auth/profile'));
    const list = await timeIt(5, () => api.post('/cases', { pagination: { page: 1, limit: 20 } }));
    note('api-ms', JSON.stringify({ profile, list }));
    expect.soft(profile.p95, '/auth/profile p95').toBeLessThan(BUDGET.profileP95);
    expect.soft(list.p95, 'POST /cases p95').toBeLessThan(BUDGET.caseListP95);
  });

  test('home page load budget when signed in', async ({ learnerPage: page }) => {
    await page.goto('/home', { waitUntil: 'load' });
    await expect(page.getByText('Explore Case Library')).toBeVisible({ timeout: 30_000 });
    const m = await pageMetrics(page);
    note('home-page', JSON.stringify(m));
    expect.soft(m.lcp, 'LCP').toBeLessThan(BUDGET.lcp);
  });

  test('case media weight: no oversized images or videos', async ({ api }) => {
    // Every asset is prefetched on the loading screen, so heavy files directly lengthen it.
    const c = await api.findCase(flags.defaultCase);
    const layout = (await api.get(`/cases/${c.id}/view-layout`)).data;
    const urls = [...collectUrls(layout)];
    const heavy: string[] = [];
    let totalMb = 0;
    for (const u of urls) {
      const res = await fetch(u, { method: 'HEAD' }).catch(() => null);
      const bytes = Number(res?.headers.get('content-length') ?? 0);
      totalMb += bytes / 1048576;
      const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(u);
      if (isVideo ? bytes > BUDGET.videoMb * 1048576 : /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) && bytes > BUDGET.imageKb * 1024) {
        heavy.push(`${(bytes / 1048576).toFixed(1)} MB ${u}`);
      }
    }
    note('case-media', `${urls.length} files, ${totalMb.toFixed(1)} MB total`);
    expect.soft(heavy, 'assets over budget').toEqual([]);
  });
});
