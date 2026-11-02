import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';

// Accessibility (WCAG 2.1 AA via axe) on the shell screens, layout sanity on small /
// landscape viewports (the area with the most recent responsive fixes), and a visual
// baseline for the static login screen.

async function axeSerious(p: Page, name: string) {
  await p.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await test.info().attach(`axe-${name}.json`, { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
  return results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

test('a11y: login has no serious/critical violations @e2e @a11y @public', async ({ page }) => {
  await page.goto('/login');
  expect(await axeSerious(page, 'login')).toEqual([]);
});

for (const [name, path] of [['home', '/home'], ['case library', '/cases'], ['question bank', '/question-bank']] as const) {
  test(`a11y: ${name} has no serious/critical violations @e2e @a11y`, async ({ learnerPage: page }) => {
    await page.goto(path);
    expect(await axeSerious(page, name)).toEqual([]);
  });
}

for (const vp of [
  { w: 1366, h: 768 },
  { w: 1280, h: 600 },
  { w: 915, h: 412 },
]) {
  test(`layout: no horizontal overflow at ${vp.w}x${vp.h} @e2e @responsive`, async ({ learnerPage: page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const path of ['/home', '/cases', '/question-bank']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect.soft(overflow, `${path} horizontal overflow at ${vp.w}x${vp.h}`).toBeLessThanOrEqual(1);
    }
  });
}

// First run per env writes the baseline: npx playwright test -g @visual --update-snapshots
test('visual: login screen matches baseline @e2e @visual @public', async ({ page, env }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot(`login-${env.key}.png`, { maxDiffPixelRatio: 0.01 });
});
