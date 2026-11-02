import { defineConfig, devices } from '@playwright/test';
import { resolveEnv } from './lib/env.mjs';

const env = resolveEnv();

// One worker by default: suites share one learner account and the gateway rate-limits auth,
// and parallel simulations on one account make server logs hard to read when triaging.
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: Number(process.env.QA_RETRIES ?? 0),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/support/global-setup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  use: {
    baseURL: env.web,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.HEADED !== '1',
  },
  projects: [
    { name: 'smoke', testDir: './tests/smoke' },
    { name: 'api', testDir: './tests/api' },
    { name: 'engine', testDir: './tests/engine', timeout: 300_000 },
    { name: 'hardening', testDir: './tests/hardening' },
    { name: 'perf', testDir: './tests/perf', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    {
      name: 'resilience',
      testDir: './tests/resilience',
      timeout: 300_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      timeout: 300_000,
      use: {
        ...devices['Desktop Chrome'],
        // The HUD is authored on a 1920x1080 canvas.
        viewport: { width: 1920, height: 1080 },
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      name: 'e2e-mobile',
      testDir: './tests/e2e',
      grep: /@responsive/,
      timeout: 300_000,
      use: { ...devices['Pixel 7 landscape'] },
    },
  ],
});
