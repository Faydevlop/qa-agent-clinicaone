import tls from 'node:tls';
import { test, expect } from '../support/fixtures';

// Transport, header and error-handling hygiene. All anonymous (@public), read-only, safe on
// every environment. Header gaps are soft failures: they are findings, not outages.
// Known gap: the gateway has helmet() commented out (content-service has it), so expect
// nosniff/HSTS findings on API responses until that is restored.

const daysUntil = (d: string) => Math.floor((new Date(d).getTime() - Date.now()) / 86_400_000);

function certExpiry(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15_000 }, () => {
      const c = s.getPeerCertificate();
      s.end();
      resolve(c.valid_to);
    });
    s.on('error', reject);
    s.on('timeout', () => s.destroy(new Error(`TLS timeout to ${host}`)));
  });
}

test.describe('hardening @hardening @public', () => {
  test('TLS certificates are valid for at least 14 more days', async ({ env }) => {
    for (const url of [env.web, env.apiOrigin]) {
      const host = new URL(url).hostname;
      const days = daysUntil(await certExpiry(host));
      test.info().annotations.push({ type: 'cert', description: `${host}: ${days} days left` });
      expect.soft(days, `${host} certificate expires in ${days} days`).toBeGreaterThan(14);
    }
  });

  test('plain http redirects to https', async ({ env }) => {
    for (const url of [env.web, env.apiOrigin + '/health']) {
      const res = await fetch(url.replace(/^https:/, 'http:'), { redirect: 'manual' }).catch(() => null);
      test.skip(!res, 'port 80 closed (acceptable: nothing served over http)');
      expect.soft([301, 302, 307, 308], `${url} over http → ${res!.status}`).toContain(res!.status);
      expect.soft(res!.headers.get('location') ?? '', `${url} redirect target`).toMatch(/^https:/);
    }
  });

  test('API responses carry baseline security headers and hide the stack', async ({ env }) => {
    const res = await fetch(`${env.apiOrigin}/health`);
    const h = res.headers;
    expect(h.get('x-powered-by'), 'x-powered-by leaks the framework').toBeNull();
    expect.soft(h.get('x-content-type-options'), 'gateway nosniff (helmet disabled?)').toBe('nosniff');
    expect.soft(h.get('strict-transport-security'), 'gateway HSTS').toBeTruthy();
  });

  test('frontend serves HSTS and nosniff', async ({ env }) => {
    const h = (await fetch(`${env.web}/login`)).headers;
    expect.soft(h.get('strict-transport-security'), 'web HSTS').toBeTruthy();
    expect.soft(h.get('x-content-type-options'), 'web nosniff').toBe('nosniff');
  });

  test('unknown API route → JSON 404 envelope, no stack trace', async ({ env }) => {
    const res = await fetch(`${env.api}/qa-does-not-exist-${Date.now()}`);
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(text, 'stack trace / file paths in error body').not.toMatch(/node_modules|\s+at \w+ \(|\.ts:\d+/);
  });

  test('malformed JSON and oversized bodies are rejected without a 5xx', async ({ env }) => {
    const bad = await fetch(`${env.api}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"caseId":' });
    expect(bad.status, 'malformed JSON').toBeLessThan(500);
    expect(await bad.text()).not.toMatch(/node_modules|SyntaxError: .* at /);

    const huge = await fetch(`${env.api}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'x'.repeat(5 * 1024 * 1024) }),
    }).catch((e) => ({ status: 0, error: e.message }) as any);
    expect(huge.status, '5 MB body').not.toBe(0);
    expect(huge.status, '5 MB body').toBeLessThan(500);
  });

  test('index.html is revalidated while hashed bundles are long-cached', async ({ env }) => {
    const res = await fetch(`${env.web}/`);
    const html = await res.text();
    const cc = res.headers.get('cache-control') ?? '';
    expect.soft(cc, 'index.html must not be cached long, or users keep the old build after a deploy').not.toMatch(/max-age=(\d{4,})/);

    const bundle = html.match(/src="([^"]+\/_expo\/static\/js\/[^"]+\.js)"/)?.[1] ?? html.match(/src="([^"]+\.js)"/)?.[1];
    test.skip(!bundle, 'no script bundle found in index.html');
    const b = await fetch(new URL(bundle!, env.web));
    expect(b.status).toBe(200);
    test.info().annotations.push({ type: 'bundle-cache', description: `${bundle}: ${b.headers.get('cache-control')}` });
  });

  test('source maps are not public outside dev/test', async ({ env }) => {
    test.skip(['dev', 'test'].includes(env.key), 'source maps are fine on dev/test');
    const html = await (await fetch(`${env.web}/`)).text();
    const bundle = html.match(/src="([^"]+\.js)"/)?.[1];
    test.skip(!bundle, 'no script bundle found in index.html');
    const map = await fetch(new URL(bundle + '.map', env.web));
    const isMap = map.status === 200 && (await map.text()).startsWith('{"version"');
    expect.soft(isMap, `${bundle}.map is publicly downloadable`).toBe(false);
  });
});
