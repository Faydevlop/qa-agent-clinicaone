// Thin REST client for the ClinicaOne gateway (/api/v1). Returns status + parsed envelope so
// tests can assert on both. Envelopes: {statusCode, alertMessage, message, data | tableData}.
import { resolveEnv } from './env.mjs';
import { getSession } from './auth.mjs';

export class Api {
  /** @param {{ env?: ReturnType<typeof resolveEnv>, token?: string | null, role?: string }} [opts] */
  constructor({ env = resolveEnv(), token = null, role = 'learner' } = {}) {
    this.env = env;
    /** @type {string | null} */
    this.token = token;
    this.role = role;
    /** @type {any} */
    this.user = null;
  }

  static async as(role = 'learner', env = resolveEnv()) {
    const s = await getSession(role, env);
    const api = new Api({ env, token: s.accessToken, role });
    api.user = s.user;
    return api;
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ body?: any, headers?: Record<string, string>, auth?: boolean }} [opts]
   * @returns {Promise<{ status: number, ok: boolean, json: any, text: string, headers: Headers, ms: number, data: any, tableData: any }>}
   */
  async request(method, path, { body, headers = {}, auth = true } = {}) {
    const started = performance.now();
    const res = await fetch(`${this.env.api}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth && this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const ms = Math.round(performance.now() - started);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, ok: res.ok, json, text, headers: res.headers, ms, data: json?.data, tableData: json?.tableData };
  }

  /** @param {string} p @param {{ headers?: Record<string, string>, auth?: boolean }} [o] */
  get(p, o) { return this.request('GET', p, o); }
  /** @param {string} p @param {any} [body] @param {{ headers?: Record<string, string>, auth?: boolean }} [o] */
  post(p, body, o = {}) { return this.request('POST', p, { ...o, body }); }
  /** @param {string} p @param {any} [body] @param {{ headers?: Record<string, string>, auth?: boolean }} [o] */
  put(p, body, o = {}) { return this.request('PUT', p, { ...o, body }); }

  /** Guard for any state-changing call. Prod is read-only unless QA_ALLOW_PROD_WRITES=1. */
  assertWritable(what = 'this write') {
    if (!this.env.writesAllowed) throw new Error(`Refusing ${what} on ${this.env.key}: environment is read-only for QA.`);
  }

  /** Finds a published case by (partial) title via POST /cases search. */
  async findCase(title) {
    const r = await this.post('/cases', { pagination: { page: 1, limit: 50 }, search: { term: title } });
    if (!r.ok) throw new Error(`POST /cases failed (${r.status}): ${r.json?.message}`);
    const rows = r.tableData ?? [];
    const exact = rows.find((c) => c.title?.toLowerCase() === title.toLowerCase());
    const hit = exact ?? rows.find((c) => c.title?.toLowerCase().includes(title.toLowerCase()));
    if (!hit) throw new Error(`No published case matching "${title}" on ${this.env.key}. Found: ${rows.map((c) => c.title).join(', ') || 'none'}`);
    return { ...hit, id: hit.id ?? hit._id };
  }

  async startSession(caseId) {
    this.assertWritable('starting a session');
    const r = await this.post('/sessions', { caseId });
    if (r.status !== 201) throw new Error(`POST /sessions failed (${r.status}): ${r.json?.message}`);
    return r.data;
  }

  /** Ends a session; safe to call twice (idempotent server-side). */
  async endSession(sessionId) {
    return this.post(`/sessions/${sessionId}/end`);
  }
}
