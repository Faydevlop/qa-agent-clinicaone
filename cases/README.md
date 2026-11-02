# Case specs (the case memory)

Each `*.case.json` file is everything we remember about one case:
- **Saved checks** (`scenarios`): run automatically every time the case is tested.
- **A manual checklist** (`manualChecks`): things only eyes and ears can judge. Claude lists
  them after every run of the case.
- **Known issues** (`knownIssues`): so a known failure is reported as known, not re-filed.

The QA engineer doesn't edit these files by hand. She tells Claude ("for Pneumothorax,
remember that…") and the `qa-case-memory` skill writes, validates and proves the check. Commit
the file so the whole team gets it.

A case with **no** file can still be tested: `npm run qa -- case "<title>"` runs the generic
case checks (`tests/engine/case-generic.spec.ts`).

Each `*.case.json` file describes how one published case should behave. The `engine` suite
(`tests/engine/case-scenarios.spec.ts`) drives every scenario over Socket.IO, and the `e2e`
suite replays the first `golden: true` scenario through the real UI.

Files starting with `_` are templates and are ignored by the runner.

## How to add a case

1. Run `npm run case:discover -- "<Case title>"`. Add `--live` to also start a throwaway
   session and capture the arrival state, wired actions, timer and end options. It writes a
   draft `cases/<slug>.case.json` with `"verified": false`.
2. Open the case in Case Builder and fill in the golden path, wrong actions and expected
   scores from the graph.
3. Run `npx playwright test --project=engine -g "<Case title>"`. Once it passes and the
   expectations match Case Builder, set `"verified": true`.

## Format

```jsonc
{
  "title": "Pneumothorax",            // matched against the Case Library (exact first, then contains)
  "envs": ["dev", "test", "uat"],     // optional; omit to run everywhere
  "verified": false,                  // true once expectations are checked against Case Builder
  "notes": "free text for humans",
  "scenarios": [
    {
      "name": "golden path",
      "golden": true,                 // the e2e suite replays this one in the browser
      "steps": [
        { "action": "High-Flow O2", "expect": { "classification": "graph_advance", "scoreDelta": 15 } },
        { "action": "CBC", "labPanels": ["cbc"], "waitForResult": true },
        { "skipLabWait": true },
        { "skipTime": 10, "expect": { "enteredBy": "deterioration" } },
        { "action": "Needle Decompression", "expect": { "toState": "Stabilised", "timeoutMs": 30000 } },
        { "handoff": null }           // null = default hand-off/discharge; or an end-option label
      ],
      "expect": {
        "passed": true,
        "scoreMin": 30,
        "scoreMax": 290,
        "maxPossibleScore": 290,
        "outcomeIn": ["success", "partial", "slow"],
        "reason": "handoff"
      }
    }
  ]
}
```

### Saved-check metadata (written by Claude)

| Key | Meaning |
|---|---|
| `request` | The QA engineer's own words |
| `addedBy`, `addedOn` | Who and when |
| `status` | `draft` (not yet proven) · `active` · `disabled` (kept for history, not run) |
| `lastConfirmed` | `{ env, on, build }` of the last run that proved it |

Spec level: `manualChecks: ["sentence", …]` and
`knownIssues: [{ "summary", "env", "since", "bug" }]`.

Validate after every edit: `npm run case:validate`.

### Step types

| Step | Meaning |
|---|---|
| `wait` | Real seconds (1–600). Lets ticks or clips run without skipping sim time. |
| `action` | The action's id or exact catalog name. Add `labPanels` / `examSystems` for labs and exams. |
| `skipTime` | Minutes; only 5, 10, 15, 20 or 30, and only while the state has a timer. |
| `skipLabWait` | Jumps to the most recently queued lab result. |
| `handoff` | Ends the session. Pass an end-option label at terminal states, or `null` for the default. |

### Per-step `expect`

`classification` (`graph_advance` \| `wrong_state` \| `general`), `scoreDelta`, `toState`
(state name to wait for), `enteredBy` (`deterioration` \| `improving` \| `stabilizing`),
`isTerminal`, `stateIn: [names]`, `notState`, `vitals` and `refused: true` for steps the
server must reject.

`vitals` uses the server's names (`heartRate, bpSystolic, bpDiastolic, map, respRate, spO2,
temperature, painScore, gcs, urineOutput`) with `lt, lte, gt, gte, eq, between`, e.g.
`{ "spO2": { "lt": 90 }, "heartRate": { "between": [100, 140] } }`. Vitals ramp, so the runner
polls up to `timeoutMs` (default 20 s).

Scenario-level `expect` also accepts `finalState` and `vitals` (checked at the end when there
was no hand-off).

### Engine facts behind the expectations

- A curated wrong action costs −20 points and +600 sim-seconds.
- A mistimed action (wired from another state) costs −20 points plus its own time cost.
- An action not in the case costs 0 points plus its time cost.
- Each `action|fromState` placement scores once; wrong-state penalties count every time.
- `passed = totalScore > 0`.
- `outcome` depends on sim time (success ≤ success threshold, partial ≤ partial threshold,
  otherwise slow). Instant actions jump the clock, so prefer `outcomeIn` over exact values.
- Reaching a terminal state does **not** end the session. The learner must hand off.
