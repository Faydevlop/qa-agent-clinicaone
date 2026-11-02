import { test, expect } from '../support/fixtures';

// Fast, read-only checks that a deployed environment is alive and wired correctly.
// Safe on every environment including prod. Run first after every deploy.

test.describe('smoke @smoke', () => {
  test('gateway /health is ok @public', async ({ env }) => {
    const res = await fetch(`${env.apiOrigin}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('gateway /version reports the expected branch @public', async ({ env }) => {
    const v = await (await fetch(`${env.apiOrigin}/version`)).json();
    test.info().annotations.push({ type: 'api-build', description: `${v.version} ${v.commit} ${v.branch} ${v.startedAt}` });
    expect(v.commit, 'version read from git at service start').not.toBe('unknown');
    if (env.branch) expect(v.branch).toBe(env.branch);
  });

  test('content-service health is reachable via /internal-content @public', async ({ env }) => {
    const res = await fetch(`${env.apiOrigin}/internal-content/health`);
    expect(res.status).toBe(200);
  });

  test('frontend /version.json is served (not swallowed by SPA rewrite) @public', async ({ env }) => {
    const res = await fetch(`${env.web}/version.json`);
    expect(res.status).toBe(200);
    const v = await res.json();
    test.info().annotations.push({ type: 'web-build', description: `${v.version} ${v.commit} built ${v.builtAt}` });
    expect(v.commitFull).toMatch(/^[0-9a-f]{40}$/);
  });

  test('deep links return 200 without redirect (SPA 200-rewrite) @public', async ({ env }) => {
    // A 404-200 rule 301s to a trailing slash and breaks the simulation exit prompt.
    for (const path of ['/simulation/a/b', '/cases', '/question-bank/x', '/reset-password?token=x']) {
      const res = await fetch(`${env.web}${path}`, { redirect: 'manual' });
      expect.soft(res.status, `${path} status`).toBe(200);
      expect.soft(res.headers.get('location'), `${path} location header`).toBeNull();
    }
  });

  test('CORS allows the frontend origin with credentials @public', async ({ env }) => {
    const res = await fetch(`${env.api}/auth/refresh`, {
      method: 'OPTIONS',
      headers: { origin: env.web, 'access-control-request-method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(env.web);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  test('learner can authenticate and load profile', async ({ api }) => {
    const r = await api.get('/auth/profile');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ email: expect.any(String), role: expect.any(String) });
  });

  test('login page renders @public', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Sign in')).toBeVisible();
    await expect(page.getByPlaceholder('revin@gmail.com')).toBeVisible();
  });
});
