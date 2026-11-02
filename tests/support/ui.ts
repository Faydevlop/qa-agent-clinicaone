import { expect, type Page, type Locator } from '@playwright/test';

// The learner app has no testIDs. React Native Web turns accessibilityLabel into aria-label,
// so prefer getByRole/getByLabel; fall back to placeholders and visible text. Keep every
// selector here so a UI copy change is fixed in one place.
export const sel = {
  login: {
    email: (p: Page) => p.getByPlaceholder('revin@gmail.com'),
    password: (p: Page) => p.getByPlaceholder('Password'),
    submit: (p: Page) => p.getByLabel('Log In'),
  },
  nav: {
    overview: (p: Page) => p.getByText('Overview', { exact: true }),
    caseLibrary: (p: Page) => p.getByText('Case Library', { exact: true }),
    assessment: (p: Page) => p.getByText('Assessment', { exact: true }),
    logout: (p: Page) => p.getByLabel('Log out'),
  },
  cases: {
    search: (p: Page) => p.getByPlaceholder('Search Case'),
    card: (p: Page, title: string) => p.getByLabel(`Open case ${title}`),
    start: (p: Page, title: string) => p.getByLabel(`Start case ${title}`),
    startNow: (p: Page) => p.getByLabel('Start Now'),
  },
  sim: {
    soundGate: (p: Page) => p.getByText('Start case', { exact: true }),
    actionSearch: (p: Page) => p.getByPlaceholder('Search an action'),
    handoff: (p: Page) => p.getByText('Hand-off', { exact: true }),
    showResult: (p: Page) => p.getByText('Show result', { exact: true }),
    reportTile: (p: Page) => p.getByLabel(/^Report/),
    attachMonitor: (p: Page) => p.getByText('Attach monitor'),
    chatInput: (p: Page) => p.getByPlaceholder('Ask the patient a question'),
    exitStay: (p: Page) => p.getByText('Stay', { exact: true }),
    exitLeave: (p: Page) => p.getByText('Leave', { exact: true }),
  },
  summary: {
    score: (p: Page) => p.getByText(/\d+\s*\/\s*\d+\s*points/),
    replay: (p: Page) => p.getByText('Replay case', { exact: true }),
    home: (p: Page) => p.getByText('Go to home screen', { exact: true }),
  },
};

/** Logs in through the real form. Costs one auth request — use the learnerPage fixture otherwise. */
export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await sel.login.email(page).fill(email);
  await sel.login.password(page).fill(password);
  await sel.login.submit(page).click();
}

/** Clicks a left-sidebar action row's Perform/Order button by the action's visible name. */
export async function performFromSidebar(page: Page, actionName: string) {
  await sel.sim.actionSearch(page).fill(actionName);
  const row: Locator = page.getByText(actionName, { exact: true }).first();
  await expect(row).toBeVisible();
  const container = row.locator('xpath=ancestor::div[.//*[normalize-space(text())="Perform" or normalize-space(text())="Order" or normalize-space(text())="Reorder"]][1]');
  await container.getByText(/^(Perform|Order|Reorder)$/).first().click();
}

// ---------------------------------------------------------------------------
// Socket.IO frame recorder: lets UI tests assert on what the server actually sent
// (state, score, timers) instead of reading pixels off the scaled canvas.
// ---------------------------------------------------------------------------
export type SocketEvent = { dir: 'in' | 'out'; event: string; data: any; at: number };
export type SocketRecorder = {
  events: SocketEvent[];
  of: (name: string, dir?: 'in' | 'out') => SocketEvent[];
  last: (name: string) => any;
  waitFor: (name: string, pred?: (d: any) => boolean, timeoutMs?: number) => Promise<any>;
};

function parseSocketIoFrame(payload: string | Buffer): { event: string; data: any } | null {
  const s = typeof payload === 'string' ? payload : payload.toString('utf8');
  // Engine.IO "4" = message, Socket.IO "2" = EVENT, optional "/ns," and ack id before the JSON array.
  const m = s.match(/^42(?:\/[^,]*,)?\d*(\[.*\])$/s);
  if (!m) return null;
  try {
    const [event, data] = JSON.parse(m[1]);
    return { event, data };
  } catch {
    return null;
  }
}

export function attachSocketRecorder(page: Page): SocketRecorder {
  const events: SocketEvent[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/websocket')) return;
    ws.on('framereceived', (f) => {
      const e = parseSocketIoFrame(f.payload);
      if (e) events.push({ dir: 'in', ...e, at: Date.now() });
    });
    ws.on('framesent', (f) => {
      const e = parseSocketIoFrame(f.payload);
      if (e) events.push({ dir: 'out', ...e, at: Date.now() });
    });
  });
  const of = (name: string, dir: 'in' | 'out' = 'in') => events.filter((e) => e.event === name && e.dir === dir);
  return {
    events,
    of,
    last: (name) => of(name).at(-1)?.data,
    waitFor: async (name, pred, timeoutMs = 30_000) => {
      const since = Date.now();
      await expect
        .poll(() => events.some((e) => e.dir === 'in' && e.event === name && e.at >= since - 1 && (!pred || pred(e.data))), {
          timeout: timeoutMs,
          message: `socket event "${name}"`,
        })
        .toBe(true);
      return events.filter((e) => e.dir === 'in' && e.event === name && (!pred || pred(e.data))).at(-1)!.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Page health: console errors, uncaught exceptions, failed / slow requests, broken media.
// ---------------------------------------------------------------------------
export type HealthRecorder = ReturnType<typeof attachHealthRecorder>;

export function attachHealthRecorder(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: { url: string; status: number | string; type: string }[] = [];
  const slowRequests: { url: string; ms: number }[] = [];
  const started = new Map<string, number>();

  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
  page.on('request', (r) => started.set(r.url() + r.method(), Date.now()));
  page.on('requestfailed', (r) => {
    // Media elements abort range requests routinely; only count real network failures.
    if (r.failure()?.errorText?.includes('ERR_ABORTED')) return;
    failedRequests.push({ url: r.url(), status: r.failure()?.errorText ?? 'failed', type: r.resourceType() });
  });
  page.on('response', (r) => {
    const t0 = started.get(r.url() + r.request().method());
    if (t0 && Date.now() - t0 > 5000) slowRequests.push({ url: r.url(), ms: Date.now() - t0 });
    if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status(), type: r.request().resourceType() });
  });

  return {
    consoleErrors,
    pageErrors,
    failedRequests,
    slowRequests,
    summary: () => ({ consoleErrors, pageErrors, failedRequests, slowRequests }),
    /** Asset/API failures excluding noise we have deliberately accepted. */
    realFailures: (ignore: RegExp[] = []) => failedRequests.filter((f) => !ignore.some((re) => re.test(f.url))),
  };
}

/** Accepts the browser's beforeunload prompt so navigating away from a simulation doesn't hang. */
export function autoAcceptDialogs(page: Page) {
  page.on('dialog', (d) => d.accept().catch(() => {}));
}

/** Collects every media src currently in the DOM (img/video/audio/source + CSS backgrounds). */
export async function domMediaUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const urls = new Set<string>();
    document.querySelectorAll('img,video,audio,source').forEach((el: any) => {
      if (el.currentSrc) urls.add(el.currentSrc);
      if (el.src) urls.add(el.src);
    });
    document.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
      if (m) urls.add(m[1]);
    });
    return [...urls];
  });
}

/** Reports images that failed to decode and videos stuck without data. */
export async function brokenMedia(page: Page) {
  return page.evaluate(() => {
    const broken: { tag: string; src: string; reason: string }[] = [];
    document.querySelectorAll('img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0 && img.src) broken.push({ tag: 'img', src: img.src, reason: 'failed to decode' });
    });
    document.querySelectorAll('video').forEach((v) => {
      if (v.error) broken.push({ tag: 'video', src: v.currentSrc, reason: `MediaError ${v.error.code}` });
    });
    return broken;
  });
}

// ---------------------------------------------------------------------------
// Simulation entry, shared by the e2e and resilience suites.
// ---------------------------------------------------------------------------
/** Starts a case the way a learner does (Library → detail → Start now) and returns the created session. */
export async function startCaseFromLibrary(page: Page, title: string) {
  await page.goto('/cases');
  await sel.cases.search(page).fill(title);
  await page.getByLabel(new RegExp(`^Open case .*${title}`, 'i')).first().click();
  const created = page.waitForResponse((r) => r.url().endsWith('/sessions') && r.request().method() === 'POST');
  await sel.cases.startNow(page).click();
  const res = await created;
  expect(res.status(), 'POST /sessions').toBe(201);
  return (await res.json()).data as { id: string; caseId: string; allAssetUrls: string[] };
}

export async function passGates(page: Page) {
  // Cases with audio show a one-tap "This case has sound" gate that also enters fullscreen.
  const gate = sel.sim.soundGate(page);
  if (await gate.isVisible({ timeout: 5000 }).catch(() => false)) await gate.click();
}
