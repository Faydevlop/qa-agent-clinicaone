---
name: qa-case-test
description: Test one ClinicaOne clinical case end-to-end on a deployed environment — assets, golden path, wrong actions, deterioration timers, labs, hand-off options, scoring and the case report — by drafting/updating a cases/*.case.json spec, running it over the socket and in the browser, then doing the manual visual checks. Use for "test the Sepsis case on test", "new case published", "case X scores wrong", "patient doesn't deteriorate".
---

# Testing a case

A case is a graph authored in Case Builder (states, timer edges, actions, end options) and
published to one environment. You verify that the published case behaves the way its author
intended, and that the learner app renders it correctly.

## 1. Discover

```
npm run case:discover -- "<title>" --live
```

This writes `cases/<slug>.case.json` (or `.<env>.draft.case.json` if a spec already exists)
containing:
- the action catalog
- the view-layout states
- the asset count
- the evidence packs
- the arrival state with its wired actions (`hintActionIds`), curated wrong actions, timer,
  skip options and vitals

`--live` starts and ends one throwaway session; skip it on read-only envs.

## 2. Get the intended behaviour

The learner API does not expose the golden path. Get it from the source:
- Ask the user for the Case Builder graph (screenshot or export), or the case author's notes.
- If the case JSON export is available, read it: `graph.nodes`, `graph.edges`,
  `goldenPathOverride`, `scoringCriteria`, `caseConfig` (time limits, success/partial
  thresholds).

Fill in the spec (format in `cases/README.md`):
- **Golden path:** each action with `graph_advance` and its scoreDelta; `toState` where state
  names are known; `isTerminal` on the last step; `handoff` with the expected end option.
- **One curated wrong action:** `wrong_state`, −20.
- **One mistimed action:** an action that is right later but wrong now: −20.
- **Deterioration chain:** skipTime steps with `enteredBy: "deterioration"` and expected
  `toState`s, down to the worst state (e.g. PEA or death) when the timers allow it.
- **Labs:** an order with `labPanels`, then `skipLabWait`, and expect the result.
- **Expected end:** `passed`, `scoreMin`/`scoreMax`, `maxPossibleScore`.

Keep `"verified": false` until the user or author confirms the expectations.

## 3. Run automated checks

```
npm run case:validate -- <slug>                               # spec is well-formed
npm run qa -- case "<title>" --env <env>                      # generic case checks + saved scenarios
npm run qa -- case "<title>" --env <env> --full               # + the browser journey
```

The generic case checks run for any case, even with no spec:
- content complete and every asset/evidence pack loads
- plausible arrival vitals, wired actions, a scene for the arrival state, a running clock
- untreated path: the state changes over time and every state reached has a scene
  (a missing scene is an animation mismatch)
- an unrelated action never scores
- an immediate hand-off doesn't pass and the REST re-score matches

The E2E run (`--full`) covers:
- loading-screen prefetch
- scene media for the current state
- timer ticks
- vitals after attaching the monitor
- the golden path through the real sidebar
- the hand-off modal
- the report score matching `session-ended`

## 4. Manual and visual pass (things only eyes can judge)

Start with the case's own `manualChecks` from its spec. Then use `qa-explore` with this
checklist, recording a GIF of the run. Anything the QA engineer asks to repeat next time goes
into `manualChecks` (`qa-case-memory`).
- [ ] Briefing card matches the case (patient, age, complaint).
- [ ] Arrival scene: correct environment, patient pose and overlays; nothing stretched or
      missing at 1920×1080 and 1366×768.
- [ ] Each golden action: the action overlay or animation matches the action (e.g. O2 mask
      appears for High-Flow O2). The transition clip plays once, doesn't loop or replay in the
      next state, and is ≤20 s.
- [ ] **Animation and state match:** after every transition the scene shows the state named
      in `session-state.currentStateName`. Check `socket-events.json` timestamps against the
      video.
- [ ] Deterioration: vitals move in the right direction, monitor waveform and beeps follow the
      HR, alarms sound for the most urgent monitor, a nurse notification appears, and the
      scene changes to the deteriorated look.
- [ ] Timer: the HUD countdown matches `criticalTimeLimitSeconds − simElapsedSeconds` (±5 s);
      skip-time options appear only while a state timer runs.
- [ ] Labs and imaging: the pending countdown, the Skip button, the result content and
      reference-range colouring (`/constants`).
- [ ] Wrong action feedback: toast, shake and red row.
- [ ] Hand-off options at terminal state match the authored end options.
- [ ] Report: score, the outcome label, every tab filled, evidence PDFs open, the AI feedback
      flow (not on UAT).
- [ ] Patient chat: answers are consistent with `GET /cases/:id/view-history` (see
      `qa-ai-patient`).

## 5. Report

One row per check, plus a verdict for the case:
- **Ready:** every check passes.
- **Content issues:** route these to the case author.
- **App bugs:** route these to a developer.

Wrong scores, missing timers or a wrong golden path are usually **case authoring**, not code.
Say so, and point to the step in the socket log. Set `"verified": true` only when the user
confirms.
