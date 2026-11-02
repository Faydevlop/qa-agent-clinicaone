import { test, expect } from '../support/fixtures';
import { Api } from '../../lib/api.mjs';
import { flags } from '../../lib/env.mjs';

// Authorization / exposure probes. Opt-in (QA_ENABLE_SECURITY=1), dev/test only unless the
// team lead approves. Failures here are security findings: report privately, not in public channels.

test.describe('security @security', () => {
  test.skip(!flags.security, 'set QA_ENABLE_SECURITY=1 to run security probes');
  test.skip(({ env }) => !['dev', 'test'].includes(env.key), 'security probes run on dev/test only');

  test('every protected route rejects anonymous calls @public', async ({ env }) => {
    const anon = new Api({ env });
    const routes: [string, string][] = [
      ['GET', '/auth/profile'], ['POST', '/cases'], ['GET', '/dashboard'], ['GET', '/actions'],
      ['GET', '/constants'], ['POST', '/sessions'], ['GET', '/quiz-categories'], ['POST', '/ai/conversations'],
    ];
    for (const [m, p] of routes) {
      const r = await anon.request(m, p, { auth: false, body: m === 'POST' ? {} : undefined });
      expect.soft(r.status, `${m} ${p}`).toBe(401);
    }
  });

  test('disallowed Origin is rejected by CORS @public', async ({ env }) => {
    const r = await fetch(`${env.api}/cases`, { method: 'POST', headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(403);
  });

  test('a learner cannot read or end another learner\'s session (IDOR)', async ({ env, api }) => {
    test.skip(!process.env.LEARNER2_EMAIL, 'set LEARNER2_EMAIL / LEARNER2_PASSWORD');
    const other = await Api.as('learner2', env);
    const c = await api.findCase(flags.defaultCase);
    const s = await api.startSession(c.id);
    try {
      for (const [m, p] of [['GET', `/sessions/${s.id}`], ['GET', `/sessions/${s.id}/history`], ['GET', `/sessions/${s.id}/notes`], ['GET', `/sessions/${s.id}/reports`]] as const) {
        const r = await other.request(m, p);
        expect.soft([403, 404], `${m} ${p} by another learner returned ${r.status}`).toContain(r.status);
      }
      const end = await other.post(`/sessions/${s.id}/end`);
      expect.soft([403, 404], `POST /end by another learner returned ${end.status}`).toContain(end.status);
    } finally {
      await api.endSession(s.id);
    }
  });

  test('content-service write routes are not open to learners via /internal-content', async ({ env, api }) => {
    // Empty body: if the role check exists we get 401/403; a 400 means only validation stopped us.
    const r = await fetch(`${env.apiOrigin}/internal-content/api/v1/cases/create`, {
      method: 'POST',
      headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect([401, 403, 404], `learner JWT reached content-service case creation (${r.status})`).toContain(r.status);
  });

  test('Swagger docs are not exposed outside dev/test', async ({ env }) => {
    const r = await fetch(`${env.api}/docs.json`);
    test.info().annotations.push({ type: 'swagger', description: `${env.key}: ${r.status}` });
    if (!['dev', 'test'].includes(env.key)) expect(r.status).toBe(404);
  });
});
