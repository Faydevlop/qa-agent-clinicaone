import { test, expect } from '../support/fixtures';
import { sel } from '../support/ui';
import { flags } from '../../lib/env.mjs';

test.describe('home + case library @e2e', () => {
  test('dashboard total matches API and links to the library', async ({ learnerPage: page, api, health }) => {
    const total = (await api.get('/dashboard')).data.totalCases;
    await page.goto('/home');
    const card = page.getByLabel(/^Total cases: \d+/);
    await expect(card).toHaveAttribute('aria-label', new RegExp(`Total cases: ${total}\\b`));
    await page.getByText('Explore Case Library').click();
    await expect(page).toHaveURL(/\/cases$/);
    expect(health.pageErrors).toEqual([]);
  });

  test('search, open detail panel and close it', async ({ learnerPage: page }) => {
    await page.goto('/cases');
    await sel.cases.search(page).fill(flags.defaultCase);
    const card = page.getByLabel(new RegExp(`^Open case .*${flags.defaultCase}`, 'i')).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(sel.cases.startNow(page)).toBeVisible();
    await page.getByLabel('Close case details').click();
    await expect(sel.cases.startNow(page)).toBeHidden();
  });

  test('empty search shows the empty state', async ({ learnerPage: page }) => {
    await page.goto('/cases');
    await sel.cases.search(page).fill('zz-no-such-case-qa');
    await expect(page.getByText('No cases match your search.')).toBeVisible();
  });

  test('sidebar navigation reaches every shell route', async ({ learnerPage: page }) => {
    await page.goto('/home');
    await sel.nav.caseLibrary(page).click();
    await expect(page).toHaveURL(/\/cases$/);
    await sel.nav.assessment(page).click();
    await expect(page).toHaveURL(/\/question-bank$/);
    await sel.nav.overview(page).click();
    await expect(page).toHaveURL(/\/home$/);
  });
});
