import { test, expect } from '../support/fixtures';

// MCQ question bank UI. Starting a quiz requests fullscreen; leaving fullscreen pauses the quiz.

test.describe('question bank UI @e2e', () => {
  test('lists categories from the API', async ({ learnerPage: page, api }) => {
    const cats = (await api.get('/quiz-categories')).data.categories;
    await page.goto('/question-bank');
    for (const c of cats.slice(0, 5)) await expect.soft(page.getByText(c.name, { exact: true }).first()).toBeVisible();
  });

  test('open a quiz, select an option, save and exit @writes', async ({ learnerPage: page, api, env }) => {
    test.skip(!env.writesAllowed, 'environment is read-only for QA');
    const data = (await api.get('/quiz-categories')).data;
    const cat = data.categories.find((c: any) => c.status === 'in_progress') ?? (data.inProgressCount < 3 ? data.categories.find((c: any) => c.questionCount > 0) : null);
    test.skip(!cat, 'no category available without exceeding the in-progress limit');

    await page.goto('/question-bank');
    const row = page.getByText(cat.name, { exact: true }).first();
    await row.scrollIntoViewIfNeeded();
    await page.getByText(cat.status === 'in_progress' ? 'Resume' : 'Start', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/question-bank\/.+/);

    // Headless Chromium may refuse fullscreen and show the pause overlay.
    const back = page.getByText('Return to Full Screen');
    if (await back.isVisible({ timeout: 2000 }).catch(() => false)) await back.click().catch(() => {});

    await page.getByLabel(/^Option /).first().click();
    await expect(page.getByLabel(/^Question 1,/)).toBeVisible();
    await page.getByText('Save and Exit', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/question-bank$/);
  });
});
