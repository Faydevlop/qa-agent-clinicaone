import { test, expect } from '../support/fixtures';

// MCQ question bank. Starting a quiz on a category resumes the existing one, so this never
// exceeds the 3-in-progress limit by itself. Answering is permanent for that attempt.

test.describe('quiz @api', () => {
  test('categories shape and in-progress limit', async ({ api }) => {
    const r = await api.get('/quiz-categories');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ categories: expect.any(Array), inProgressCount: expect.any(Number), maxInProgress: 3 });
    expect(r.data.inProgressCount).toBeLessThanOrEqual(3);
    for (const c of r.data.categories) {
      expect(c).toMatchObject({ id: expect.any(String), name: expect.any(String), questionCount: expect.any(Number) });
      expect(['not_started', 'in_progress', 'completed']).toContain(c.status);
    }
  });

  test('start/resume → visit → draft → answer → validation @writes', async ({ api, env }) => {
    test.skip(!env.writesAllowed, 'environment is read-only for QA');
    const cats = (await api.get('/quiz-categories')).data;
    const cat =
      cats.categories.find((c: any) => c.status === 'in_progress' && c.questionCount > 0) ??
      (cats.inProgressCount < 3 ? cats.categories.find((c: any) => c.status === 'not_started' && c.questionCount > 0) : null);
    test.skip(!cat, 'no category available without exceeding the in-progress limit');

    const start = await api.post('/quizzes', { categoryId: cat.id });
    expect([200, 201]).toContain(start.status);
    const quiz = start.data;
    expect(quiz.resumed).toBe(start.status === 200);

    const detail = await api.get(`/quizzes/${quiz.id}`);
    expect(detail.status).toBe(200);
    const q = (detail.data.questions ?? []).find((x: any) => !x.result && !x.submitted) ?? detail.data.questions?.[0];
    test.skip(!q, 'quiz exposes no open question');

    expect((await api.post(`/quizzes/${quiz.id}/visit`, { questionId: q.id })).status).toBe(200);

    const opt = q.options?.[0]?.id;
    const draft = await api.put(`/quizzes/${quiz.id}/draft`, { questionId: q.id, optionIds: [opt] });
    if (draft.status !== 409) expect(draft.status).toBe(200);

    const emptyAnswer = await api.post(`/quizzes/${quiz.id}/answers`, { questionId: q.id, optionIds: [] });
    expect(emptyAnswer.status, 'answers require ≥1 option').toBe(400);

    const ans = await api.post(`/quizzes/${quiz.id}/answers`, { questionId: q.id, optionIds: [opt] });
    expect([200, 409]).toContain(ans.status);
    if (ans.status === 200) {
      const again = await api.post(`/quizzes/${quiz.id}/answers`, { questionId: q.id, optionIds: [opt] });
      expect(again.status, 'one submit per question').toBe(409);
    }
  });

  test('unknown category → 404, missing body → 400', async ({ api, env }) => {
    test.skip(!env.writesAllowed, 'environment is read-only for QA');
    expect((await api.post('/quizzes', { categoryId: '000000000000000000000000' })).status).toBe(404);
    expect([400, 404]).toContain((await api.post('/quizzes', {})).status);
  });
});
