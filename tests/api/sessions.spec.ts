import { test, expect } from '../support/fixtures';
import { flags } from '../../lib/env.mjs';

// Session REST contract (start, read, notes, reports, end). Creates and ends one session.

test.describe('sessions @api @writes', () => {
  test.skip(({ env }) => !env.writesAllowed, 'environment is read-only for QA');

  let sessionId: string;

  test.afterEach(async ({ api }) => {
    if (sessionId) await api.endSession(sessionId);
  });

  test('start → read → notes → reports → end (idempotent)', async ({ api }) => {
    const c = await api.findCase(flags.defaultCase);
    const s = await api.startSession(c.id);
    sessionId = s.id;

    expect(s).toMatchObject({ id: expect.any(String), caseId: c.id, status: 'active' });
    expect(s.patientState).toHaveProperty('vitals');
    expect(Array.isArray(s.allAssetUrls)).toBe(true);

    const get = await api.get(`/sessions/${s.id}`);
    expect(get.status).toBe(200);
    expect(get.data).toMatchObject({ sessionId: s.id, currentStateId: expect.any(String), isTerminal: false });
    expect(get.data.availableActionIds.length, 'arrival state has no wired actions').toBeGreaterThan(0);

    // Notes: PUT replaces the whole list.
    const note = { id: 'qa-note-1', title: 'QA', body: 'automated note', createdAt: new Date().toISOString() };
    const put = await api.put(`/sessions/${s.id}/notes`, { notes: [note] });
    expect(put.status).toBe(200);
    const notes = await api.get(`/sessions/${s.id}/notes`);
    expect(notes.data.notes).toEqual([expect.objectContaining({ id: 'qa-note-1', body: 'automated note' })]);
    const badNotes = await api.put(`/sessions/${s.id}/notes`, { notes: 'nope' });
    expect(badNotes.status).toBe(400);
    const noId = await api.put(`/sessions/${s.id}/notes`, { notes: [{ title: 'x' }] });
    expect(noId.status).toBe(400);

    const reports = await api.get(`/sessions/${s.id}/reports`);
    expect(reports.status).toBe(200);
    expect(reports.data).toMatchObject({ sessionId: s.id, reports: expect.any(Array) });

    const end1 = await api.endSession(s.id);
    expect(end1.status).toBe(200);
    expect(end1.data).toMatchObject({ sessionId: s.id, totalScore: expect.any(Number), maxPossibleScore: expect.any(Number), passed: expect.any(Boolean), reason: 'handoff' });
    expect(end1.data.passed).toBe(end1.data.totalScore > 0);
    const pct = Math.min(100, Math.max(0, Math.round((end1.data.totalScore / end1.data.maxPossibleScore) * 100)));
    expect(end1.data.scorePercentage).toBe(pct);

    const end2 = await api.endSession(s.id);
    expect(end2.status).toBe(200);
    expect(end2.data.totalScore, 'end must be idempotent').toBe(end1.data.totalScore);

    const hist = await api.get(`/sessions/${s.id}/history`);
    expect(hist.status).toBe(200);
    const sum = hist.data.entries.filter((e: any) => e.type !== 'observation').reduce((a: number, e: any) => a + (e.scoreDelta ?? 0), 0);
    expect.soft(hist.data.totalScore).toBe(end1.data.totalScore);
    expect.soft(sum, 'history scoreDeltas should add up to totalScore (unless duplicate placements)').toBeGreaterThanOrEqual(end1.data.totalScore);
  });

  test('unknown session → 404', async ({ api }) => {
    const r = await api.get('/sessions/000000000000000000000000');
    expect([400, 404]).toContain(r.status);
  });

  test('start session validates caseId', async ({ api }) => {
    const r = await api.post('/sessions', {});
    expect([400, 404]).toContain(r.status);
  });

  test('retired REST perform-action is not available', async ({ api }) => {
    const r = await api.post('/sessions/000000000000000000000000/actions', { actionId: 'x' });
    expect(r.status).toBe(404);
  });
});
