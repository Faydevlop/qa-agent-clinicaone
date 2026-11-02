import { test, expect } from '../support/fixtures';
import { flags } from '../../lib/env.mjs';
import { collectUrls } from '../../lib/cases.mjs';

// Case library + content contracts, and asset availability for every published case.
// Read-only: safe on every environment.

test.describe('content @api', () => {
  test('case list is paginated and only returns published cases', async ({ api }) => {
    const r = await api.post('/cases', { pagination: { page: 1, limit: 5 } });
    expect(r.status).toBe(200);
    expect(r.json.pagination).toMatchObject({ page: 1, limit: 5, total: expect.any(Number), totalPages: expect.any(Number) });
    expect(r.tableData.length).toBeLessThanOrEqual(5);
    for (const c of r.tableData) {
      expect(c).toHaveProperty('title');
      expect(c).toHaveProperty('patient');
      if ('status' in c) expect(c.status).toBe('published');
    }
  });

  test('dashboard totalCases matches the case list total (catches the mock-data fallback)', async ({ api }) => {
    const [dash, list] = await Promise.all([api.get('/dashboard'), api.post('/cases', { pagination: { page: 1, limit: 1 } })]);
    expect(dash.status).toBe(200);
    expect(dash.data.totalCases).toBe(list.json.pagination.total);
  });

  test('search narrows results and sort accepts allowed fields', async ({ api }) => {
    const term = flags.defaultCase;
    const r = await api.post('/cases', { search: { term }, sort: { field: 'title', order: 'asc' } });
    expect(r.status).toBe(200);
    for (const c of r.tableData) expect(JSON.stringify(c).toLowerCase()).toContain(term.toLowerCase().split(' ')[0]);
  });

  test('pagination limit above 100 is rejected or clamped', async ({ api }) => {
    const r = await api.post('/cases', { pagination: { page: 1, limit: 500 } });
    if (r.status === 200) expect(r.tableData.length).toBeLessThanOrEqual(100);
    else expect(r.status).toBe(400);
  });

  test('unknown case id → 404 envelope', async ({ api }) => {
    const r = await api.get('/cases/000000000000000000000000');
    expect([400, 404]).toContain(r.status);
    expect(r.json).toHaveProperty('message');
  });

  test('default case: detail, actions, history, layout, evidence', async ({ api }) => {
    const c = await api.findCase(flags.defaultCase);
    const [detail, actions, history, layout, evidence] = await Promise.all([
      api.get(`/cases/${c.id}`),
      api.get(`/cases/${c.id}/actions`),
      api.get(`/cases/${c.id}/view-history`),
      api.get(`/cases/${c.id}/view-layout`),
      api.get(`/cases/${c.id}/evidence-packs`),
    ]);
    expect(detail.status).toBe(200);
    expect(detail.data).toHaveProperty('title');

    expect(actions.status).toBe(200);
    expect(actions.tableData.length).toBeGreaterThan(0);
    for (const a of actions.tableData) expect(a).toMatchObject({ id: expect.any(String), name: expect.any(String), actionType: expect.any(String) });
    const names = actions.tableData.map((a: any) => a.name.toLowerCase());
    expect.soft(new Set(names).size, 'duplicate action names in catalog').toBe(names.length);

    expect(history.status).toBe(200);
    expect(layout.status).toBe(200);
    expect.soft(layout.data?.hasViewLayout, 'case has no authored view layout').not.toBe(false);
    expect(evidence.status).toBe(200);
  });

  test('constants expose lab reference ranges', async ({ api }) => {
    const r = await api.get('/constants');
    expect(r.status).toBe(200);
    for (const row of r.data.labReferenceRanges.abg ?? []) {
      expect(row).toMatchObject({ key: expect.any(String), unit: expect.anything() });
      expect(row.referenceRange.min).toBeLessThanOrEqual(row.referenceRange.max);
    }
  });
});

test.describe('assets @api @assets', () => {
  test('every view-layout asset of every published case is reachable', async ({ api, env }) => {
    test.setTimeout(600_000);
    const list = await api.post('/cases', { pagination: { page: 1, limit: 100 } });
    const problems: string[] = [];
    let checked = 0;

    for (const c of list.tableData) {
      const id = c.id ?? c._id;
      const layout = await api.get(`/cases/${id}/view-layout`);
      const urls = [...collectUrls(layout.data)];
      if (c.patient?.imageUrl) urls.push(c.patient.imageUrl);
      for (const url of urls) {
        checked++;
        const t0 = Date.now();
        const res = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-1023', origin: env.web } }).catch((e) => ({ status: `ERR ${e.message}` }) as any);
        const ms = Date.now() - t0;
        // The loading screen gives each asset 8 s (+1 retry) before giving up.
        if (typeof res.status !== 'number' || res.status >= 400) problems.push(`[${c.title}] ${res.status} ${url}`);
        else if (ms > 8000) problems.push(`[${c.title}] slow ${ms}ms ${url}`);
      }
    }
    test.info().annotations.push({ type: 'assets-checked', description: String(checked) });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('evidence-pack PDFs are reachable and CORS-enabled for pdf.js', async ({ api, env }) => {
    const list = await api.post('/cases', { pagination: { page: 1, limit: 100 } });
    const problems: string[] = [];
    for (const c of list.tableData) {
      const ev = await api.get(`/cases/${c.id ?? c._id}/evidence-packs`);
      for (const p of ev.tableData ?? []) {
        if (!p.fileUrl) { problems.push(`[${c.title}] pack "${p.title}" has no fileUrl`); continue; }
        const res = await fetch(p.fileUrl, { headers: { origin: env.web, range: 'bytes=0-1023' } });
        if (res.status >= 400) problems.push(`[${c.title}] ${res.status} ${p.fileUrl}`);
        else if (!res.headers.get('access-control-allow-origin')) problems.push(`[${c.title}] no CORS header (pdf.js will fail) ${p.fileUrl}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
