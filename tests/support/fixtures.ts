import { test as base, expect, type Page } from '@playwright/test';
import { resolveEnv } from '../../lib/env.mjs';
import { getSession } from '../../lib/auth.mjs';
import { Api } from '../../lib/api.mjs';
import { attachSocketRecorder, attachHealthRecorder, type SocketRecorder, type HealthRecorder } from './ui';

type Fixtures = {
  env: ReturnType<typeof resolveEnv>;
  api: Api;
  /** Page already signed in as the learner (session injected, no UI login → no rate-limit cost). */
  learnerPage: Page;
  socketLog: SocketRecorder;
  health: HealthRecorder;
};

export const test = base.extend<Fixtures>({
  env: async ({}, use) => use(resolveEnv()),

  api: async ({ env }, use) => use(await Api.as('learner', env)),

  learnerPage: async ({ page, env }, use) => {
    const s = await getSession('learner', env);
    // The app keeps the access token + user in sessionStorage (tab-scoped), so storageState
    // can't carry it; seed it before any app script runs.
    await page.addInitScript(
      ([token, user]) => {
        sessionStorage.setItem('c1.accessToken', token);
        sessionStorage.setItem('c1.user', user);
      },
      [s.accessToken, JSON.stringify(s.user)] as const,
    );
    await use(page);
  },

  socketLog: async ({ page }, use) => use(attachSocketRecorder(page)),

  health: async ({ page }, use, testInfo) => {
    const h = attachHealthRecorder(page);
    await use(h);
    await testInfo.attach('page-health.json', { body: JSON.stringify(h.summary(), null, 2), contentType: 'application/json' });
  },
});

export { expect };
