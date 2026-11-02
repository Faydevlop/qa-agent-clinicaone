#!/usr/bin/env node
// Usage: npm run case:discover -- "<case title>" [--live]
// Drafts cases/<slug>.case.json from what the learner API exposes. With --live it also starts a
// throwaway session to capture the arrival state, wired actions, timer and end options, then
// ends it. Golden path and scores still have to be confirmed in Case Builder.
import fs from 'node:fs';
import path from 'node:path';
import { Api } from '../lib/api.mjs';
import { getSession } from '../lib/auth.mjs';
import { SimSession } from '../lib/sim.mjs';
import { CASES_DIR, collectUrls } from '../lib/cases.mjs';

const args = process.argv.slice(2);
const live = args.includes('--live');
const title = args.find((a) => !a.startsWith('--'));
if (!title) {
  console.error('Usage: npm run case:discover -- "<case title>" [--live]');
  process.exit(1);
}

const api = await Api.as('learner');
const c = await api.findCase(title);
const [actions, layout, evidence] = await Promise.all([
  api.get(`/cases/${c.id}/actions`),
  api.get(`/cases/${c.id}/view-layout`),
  api.get(`/cases/${c.id}/evidence-packs`),
]);
const catalog = actions.tableData ?? [];

let arrival = null;
if (live) {
  const s = await api.startSession(c.id);
  const sim = await new SimSession({ sessionId: s.id, token: (await getSession('learner', api.env)).accessToken, env: api.env }).connect();
  const st = sim.state;
  const byId = Object.fromEntries(catalog.map((a) => [a.id, a.name]));
  arrival = {
    state: st.currentStateName,
    criticalTimeLimitSeconds: st.criticalTimeLimitSeconds,
    stateTimer: st.stateTimer,
    timeSkipOptionsMinutes: st.timeSkipOptionsMinutes,
    wiredActions: (st.hintActionIds ?? []).map((id) => byId[id] ?? id),
    curatedWrongActions: (st.wrongActionIds ?? []).map((id) => byId[id] ?? id),
    vitals: st.vitals,
    assetCount: s.allAssetUrls?.length ?? 0,
  };
  sim.close();
  await api.endSession(s.id);
}

const draft = {
  title: c.title,
  envs: [api.env.key],
  verified: false,
  notes: `Drafted by case:discover on ${new Date().toISOString().slice(0, 10)} from ${api.env.key}. Fill golden path + scores from Case Builder.`,
  discovered: {
    caseId: c.id,
    actionCatalog: catalog.map((a) => ({ id: a.id, name: a.name, type: a.actionType, timeCost: a.timeCost })),
    viewLayoutStates: Object.keys(layout.data?.states ?? {}),
    viewLayoutAssetCount: collectUrls(layout.data).size,
    evidencePacks: (evidence.tableData ?? []).map((p) => p.title),
    arrival,
  },
  scenarios: [
    {
      name: 'golden path',
      golden: true,
      steps: [
        ...(arrival?.wiredActions?.slice(0, 1) ?? ['<first golden action>']).map((a) => ({ action: a, expect: { classification: 'graph_advance' } })),
        { handoff: null },
      ],
      expect: { passed: true, outcomeIn: ['success', 'partial', 'slow'], reason: 'handoff' },
    },
    ...(arrival?.curatedWrongActions?.length
      ? [{ name: 'curated wrong action is penalised', steps: [{ action: arrival.curatedWrongActions[0], expect: { classification: 'wrong_state', scoreDelta: -20 } }] }]
      : []),
    ...(arrival?.stateTimer ? [{ name: 'deteriorates when untreated', steps: [{ skipTime: Math.max(...(arrival.timeSkipOptionsMinutes ?? [10])), expect: { enteredBy: 'deterioration' } }] }] : []),
  ],
};

const slug = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let file = path.join(CASES_DIR, `${slug}.case.json`);
if (fs.existsSync(file)) file = path.join(CASES_DIR, `${slug}.${api.env.key}.draft.case.json`);
fs.writeFileSync(file, JSON.stringify(draft, null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), file)} — ${catalog.length} actions${arrival ? `, arrival "${arrival.state}"` : ''}.`);
