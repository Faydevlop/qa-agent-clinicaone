#!/usr/bin/env node
// Usage: npm run case:validate [-- <file-or-title>]
// Checks cases/*.case.json for mistakes before they reach the runner: bad JSON, unknown step
// types, misspelled expectation keys or vital names, skip durations the engine refuses.
// Run it after every edit to a case spec (Claude does this automatically when saving a check).
import fs from 'node:fs';
import path from 'node:path';
import { CASES_DIR } from '../lib/cases.mjs';

const STEP_TYPES = ['action', 'skipTime', 'skipLabWait', 'handoff', 'wait'];
const STEP_EXTRAS = ['labPanels', 'examSystems', 'waitForResult', 'expect', 'note'];
const STEP_EXPECT = ['classification', 'scoreDelta', 'toState', 'enteredBy', 'isTerminal', 'refused', 'timeoutMs', 'stateIn', 'notState', 'vitals'];
const SCENARIO_KEYS = ['name', 'golden', 'steps', 'expect', 'status', 'request', 'addedBy', 'addedOn', 'lastConfirmed', 'note'];
const SCENARIO_EXPECT = ['passed', 'scoreMin', 'scoreMax', 'maxPossibleScore', 'outcomeIn', 'reason', 'reachesTerminal', 'finalState', 'vitals', 'timeoutMs'];
const SPEC_KEYS = ['title', 'envs', 'verified', 'notes', 'scenarios', 'manualChecks', 'knownIssues', 'discovered', 'updatedOn'];
const VITALS = ['heartRate', 'bpSystolic', 'bpDiastolic', 'map', 'respRate', 'spO2', 'temperature', 'painScore', 'gcs', 'urineOutput'];
const VITAL_OPS = ['lt', 'lte', 'gt', 'gte', 'eq', 'between'];
const CLASSIFICATIONS = ['graph_advance', 'wrong_state', 'general'];
const TRANSITIONS = ['deterioration', 'improving', 'stabilizing'];
const SKIPS = [5, 10, 15, 20, 30];

const arg = process.argv[2];
const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.case.json')).filter((f) => !arg || f === arg || f.includes(arg.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
if (!files.length) {
  console.error(`No case spec matches "${arg}".`);
  process.exit(1);
}

let bad = 0;
for (const f of files) {
  const problems = [];
  const where = (m) => problems.push(m);
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8'));
  } catch (e) {
    where(`not valid JSON: ${e.message}`);
  }
  if (spec) {
    const unknownKeys = (obj, allowed, at) => Object.keys(obj ?? {}).filter((k) => !allowed.includes(k)).forEach((k) => where(`${at}: unknown key "${k}"`));
    const checkVitals = (v, at) => {
      for (const [k, rule] of Object.entries(v ?? {})) {
        if (!VITALS.includes(k)) where(`${at}: unknown vital "${k}" (use ${VITALS.join(', ')})`);
        if (typeof rule === 'object') unknownKeys(rule, VITAL_OPS, `${at}.${k}`);
        else if (typeof rule !== 'number') where(`${at}.${k}: must be a number or {lt|lte|gt|gte|eq|between}`);
      }
    };
    if (!f.startsWith('_')) unknownKeys(spec, SPEC_KEYS, 'spec');
    if (!spec.title) where('missing "title"');
    if (!Array.isArray(spec.scenarios)) where('"scenarios" must be a list');
    if (spec.manualChecks && !Array.isArray(spec.manualChecks)) where('"manualChecks" must be a list');
    if (spec.knownIssues && !Array.isArray(spec.knownIssues)) where('"knownIssues" must be a list');
    const names = new Set();
    for (const [i, sc] of (spec.scenarios ?? []).entries()) {
      const at = `scenario ${i + 1} "${sc.name ?? '?'}"`;
      if (!f.startsWith('_')) unknownKeys(sc, SCENARIO_KEYS, at);
      if (!sc.name) where(`${at}: missing "name"`);
      if (names.has(sc.name)) where(`${at}: duplicate name (test titles must be unique)`);
      names.add(sc.name);
      if (sc.status && !['active', 'draft', 'disabled'].includes(sc.status)) where(`${at}: status must be active | draft | disabled`);
      if (!Array.isArray(sc.steps) || !sc.steps.length) where(`${at}: needs at least one step`);
      unknownKeys(sc.expect, SCENARIO_EXPECT, `${at} expect`);
      checkVitals(sc.expect?.vitals, `${at} expect.vitals`);
      for (const [j, st] of (sc.steps ?? []).entries()) {
        const sat = `${at} step ${j + 1}`;
        const types = STEP_TYPES.filter((t) => t in st);
        if (types.length !== 1) where(`${sat}: needs exactly one of ${STEP_TYPES.join(', ')} (has ${types.join(', ') || 'none'})`);
        unknownKeys(st, [...STEP_TYPES, ...STEP_EXTRAS], sat);
        if ('skipTime' in st && !SKIPS.includes(st.skipTime)) where(`${sat}: skipTime must be one of ${SKIPS.join(', ')} minutes`);
        if ('wait' in st && !(st.wait > 0 && st.wait <= 600)) where(`${sat}: wait is real seconds, 1-600`);
        unknownKeys(st.expect, STEP_EXPECT, `${sat} expect`);
        if (st.expect?.classification && !CLASSIFICATIONS.includes(st.expect.classification)) where(`${sat}: classification must be ${CLASSIFICATIONS.join(' | ')}`);
        if (st.expect?.enteredBy && !TRANSITIONS.includes(st.expect.enteredBy)) where(`${sat}: enteredBy must be ${TRANSITIONS.join(' | ')}`);
        checkVitals(st.expect?.vitals, `${sat} expect.vitals`);
      }
    }
  }
  if (problems.length) {
    bad++;
    console.log(`✘ ${f}\n${problems.map((p) => `    - ${p}`).join('\n')}`);
  } else {
    const n = spec.scenarios.length;
    console.log(`✔ ${f}: ${n} scenario${n === 1 ? '' : 's'}, ${spec.manualChecks?.length ?? 0} manual checks, ${spec.knownIssues?.length ?? 0} known issues`);
  }
}
process.exit(bad ? 1 : 0);
