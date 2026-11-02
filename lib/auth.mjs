// Login with a cached token. The gateway allows only 10 auth requests per 15 min per IP and
// locks an account after 5 bad passwords, so every suite shares one cached session per
// env+role instead of logging in per test.
import fs from 'node:fs';
import path from 'node:path';
import { resolveEnv, credentials } from './env.mjs';

const CACHE_DIR = path.resolve(import.meta.dirname, '..', '.auth');
// Access tokens live 15 min; refresh a bit early.
const MAX_AGE_MS = 12 * 60 * 1000;

const cacheFile = (envKey, role) => path.join(CACHE_DIR, `${envKey}.${role}.json`);

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(file, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function refreshCookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  const c = raw.find((h) => h.startsWith('refreshToken='));
  return c ? c.split(';')[0] : null;
}

/** POST /auth/login. Returns { accessToken, user, refreshCookie } or throws with the server message. */
export async function login({ email, password }, env = resolveEnv()) {
  const res = await fetch(`${env.api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const retry = res.headers.get('retry-after');
    throw new Error(
      `Login failed on ${env.key} (${res.status}): ${body.message ?? res.statusText}` +
        (retry ? ` — retry after ${retry}s (auth rate limit / lockout)` : ''),
    );
  }
  return { accessToken: body.data.accessToken, user: body.data.user, refreshCookie: refreshCookieFrom(res) };
}

async function refresh(refreshCookie, env) {
  const res = await fetch(`${env.api}/auth/refresh`, { method: 'POST', headers: { cookie: refreshCookie } });
  if (!res.ok) return null;
  const body = await res.json();
  return { accessToken: body.data.accessToken, refreshCookie: refreshCookieFrom(res) ?? refreshCookie };
}

/**
 * Returns a valid session for the role: cached → refreshed (rotating cookie) → fresh login.
 * { accessToken, user, refreshCookie, obtainedAt }
 */
export async function getSession(role = 'learner', env = resolveEnv(), { force = false } = {}) {
  const file = cacheFile(env.key, role);
  const cached = force ? null : readCache(file);
  if (cached && Date.now() - cached.obtainedAt < MAX_AGE_MS) return cached;

  if (cached?.refreshCookie) {
    const r = await refresh(cached.refreshCookie, env).catch(() => null);
    if (r) {
      const s = { ...cached, ...r, obtainedAt: Date.now() };
      writeCache(file, s);
      return s;
    }
  }
  const s = { ...(await login(credentials(role, env.key), env)), obtainedAt: Date.now() };
  writeCache(file, s);
  return s;
}
