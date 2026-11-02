// Loads data-driven case specs from cases/*.case.json. Specs reference cases by title so the
// same spec runs on dev/test/uat even though case ids differ per environment.
import fs from 'node:fs';
import path from 'node:path';

export const CASES_DIR = path.resolve(import.meta.dirname, '..', 'cases');

/** QA_CASES (comma-separated titles, set by the qa CLI) narrows which specs run; empty = all. */
export function selectedCaseTitles() {
  return (process.env.QA_CASES ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export function loadCaseSpecs({ includeTemplates = false, all = false } = {}) {
  if (!fs.existsSync(CASES_DIR)) return [];
  const only = all ? [] : selectedCaseTitles();
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.case.json') && (includeTemplates || !f.startsWith('_')))
    .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')) }))
    .filter((s) => !only.length || only.includes(String(s.title).toLowerCase()));
}

/** A spec applies to an env unless it lists `envs` and the env is not in it. */
export function appliesTo(spec, envKey) {
  return !spec.envs || spec.envs.includes(envKey);
}

/** Resolves an action reference (id or exact name) against GET /cases/:id/actions rows. */
export function resolveAction(ref, catalog) {
  const byId = catalog.find((a) => a.id === ref);
  if (byId) return byId;
  const byName = catalog.filter((a) => a.name?.toLowerCase() === String(ref).toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`Action name "${ref}" is ambiguous (${byName.map((a) => a.id).join(', ')}); use the id.`);
  throw new Error(`Action "${ref}" not in case catalog.`);
}

/** Recursively collects every http(s) URL inside a JSON value (used for view-layout assets). */
export function collectUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectUrls(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectUrls(v, out));
  }
  return out;
}

/** "Sepsis — Adult (v2)" → "sepsis-adult-v2"; the file name for a case's saved spec. */
export function slugify(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The saved spec for a case title (any env), or null. Case-insensitive. */
export function findSpec(title) {
  const t = String(title).toLowerCase();
  return loadCaseSpecs({ all: true }).find((s) => String(s.title).toLowerCase() === t) ?? null;
}

/** Scenarios the runner should execute: everything not explicitly disabled. */
export const activeScenarios = (spec) => (spec?.scenarios ?? []).filter((sc) => sc.status !== 'disabled');

/**
 * Compares vitals against a condition map, e.g. { "spO2": { "lt": 90 }, "heartRate": { "between": [100, 160] } }.
 * Keys are server vital names: heartRate, bpSystolic, bpDiastolic, map, respRate, spO2, temperature, painScore, gcs, urineOutput.
 * Returns a list of human-readable failures (empty = all good).
 */
export function vitalsFailures(vitals, cond = {}) {
  const out = [];
  for (const [key, rule] of Object.entries(cond)) {
    const v = vitals?.[key];
    if (typeof v !== 'number') {
      out.push(`${key} missing (have: ${Object.keys(vitals ?? {}).join(', ')})`);
      continue;
    }
    const r = typeof rule === 'number' ? { eq: rule } : rule;
    if (r.lt !== undefined && !(v < r.lt)) out.push(`${key}=${v}, expected < ${r.lt}`);
    if (r.lte !== undefined && !(v <= r.lte)) out.push(`${key}=${v}, expected ≤ ${r.lte}`);
    if (r.gt !== undefined && !(v > r.gt)) out.push(`${key}=${v}, expected > ${r.gt}`);
    if (r.gte !== undefined && !(v >= r.gte)) out.push(`${key}=${v}, expected ≥ ${r.gte}`);
    if (r.eq !== undefined && v !== r.eq) out.push(`${key}=${v}, expected ${r.eq}`);
    if (r.between && !(v >= r.between[0] && v <= r.between[1])) out.push(`${key}=${v}, expected ${r.between[0]}–${r.between[1]}`);
  }
  return out;
}
