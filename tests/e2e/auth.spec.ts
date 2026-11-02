import { test, expect } from '../support/fixtures';
import { sel, uiLogin } from '../support/ui';
import { credentials } from '../../lib/env.mjs';

// Real login form. Spends one auth request — keep this the only UI login in the suite.

test.describe('auth UI @e2e', () => {
  test('client-side validation runs before any request @public', async ({ page }) => {
    await page.goto('/login');
    let loginCalls = 0;
    // POST + /api/v1 only: the login background image lives at .../images/auth/login-bg.png.
    page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/v1/auth/login') && loginCalls++);
    await sel.login.submit(page).click();
    await expect(page.getByText('Email address is required')).toBeVisible();
    await sel.login.email(page).fill('not-an-email');
    await sel.login.password(page).fill('short');
    await sel.login.submit(page).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    expect(loginCalls).toBe(0);
  });

  test('learner logs in through the form and lands on Home', async ({ page, env, health }) => {
    const { email, password } = credentials('learner', env.key);
    await uiLogin(page, email, password);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByText('Explore Case Library')).toBeVisible();
    expect(health.pageErrors).toEqual([]);
  });

  test('protected route while logged out falls back to Login @public', async ({ page }) => {
    await page.goto('/cases');
    await expect(page.getByText('Sign in')).toBeVisible();
  });

  test('logout clears the session', async ({ learnerPage: page }) => {
    await page.goto('/home');
    await sel.nav.logout(page).click();
    await expect(page.getByText('Sign in')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('c1.accessToken'))).toBeNull();
  });
});
