---
name: qa-case-memory
description: Save, change or remove case-specific checks so they run automatically every time that case is tested. Use when the QA engineer says "remember…", "save this check", "from now on, for <case> check that…", "next time also verify…", "add this to the <case> case", "this is a known issue", "stop checking…", or asks what is saved for a case.
---

# Case memory: saved checks per case

The QA engineer is not a programmer. She describes in plain words what a case must do, and
you turn that into something the test runner executes every time the case is tested. She
should never have to edit JSON.

## Where it is stored

| What | File | Shared? |
|---|---|---|
| Saved checks, manual checklist, known issues for a case | `cases/<slug>.case.json` (one file per case) | Yes, once committed to git. Remind her to commit, or tell the team lead the file changed. |
| Last result per case and env | `.qa/case-results.json` (written after every run) | No, this computer only |

These files are the case "database". Treat them as precious: never delete a check or rewrite
a file wholesale; edit the smallest piece.

## The three kinds of memory

| She says | Kind | Goes in |
|---|---|---|
| "If the patient gets no oxygen for 10 minutes, SpO2 must drop below 90" | Automatic check | `scenarios[]` |
| "After needle decompression the chest drain animation must show" / anything you judge by eye or ear | Manual check | `manualChecks[]` (a plain sentence) |
| "The report tab shows the wrong score on test, bug #123" | Known issue | `knownIssues[]`: `{ summary, env, since, bug }` |

If something sounds automatic but depends on pixels, sound or animation, save it as a manual
check. Then say so: "I can't verify that automatically, so I'll put it on the checklist for
every run of this case."

## Saving an automatic check

1. **Pin down the case and environment.**
   - Get the exact title from `npm run qa -- cases --env <env>`.
   - The check applies to every environment unless she says otherwise. If it only holds on
     some, add an `envs` list on the spec only when every check in the file shares it;
     otherwise ask.
2. **Make sure the spec exists.**
   - If it doesn't, run `npm run case:discover -- "<title>"` (add `--live` when writes are
     allowed). That creates the file with the action catalog and arrival state.
   - If login isn't possible, copy `cases/_template.case.json` and fill in only the title,
     `verified: false`, empty `scenarios`, `manualChecks` and `knownIssues`.
3. **Translate her words into steps.** Use real action names from the catalog in the discover
   output (or `GET /cases/:id/actions`); never invent one.
   - If an action, threshold or state name is ambiguous, ask with AskUserQuestion. Offer the
     2–4 closest catalog names as options.

   | Plain words | Step / expectation |
   |---|---|
   | "do X", "give X", "order X" | `{ "action": "X" }`, plus `labPanels` / `examSystems` for labs or exams |
   | "wait N minutes" (sim time), "leave untreated for N min" | `{ "skipTime": N }` (5, 10, 15, 20 or 30; chain steps for other totals) |
   | "wait N seconds" (real time) | `{ "wait": N }` |
   | "get the lab result" | `{ "skipLabWait": true }` after the lab action |
   | "hand off / discharge / send to ICU" | `{ "handoff": null }` or `{ "handoff": "ICU" }` (end-option label) |
   | "should score / be correct" | `"expect": { "classification": "graph_advance" }` (+ `scoreDelta` if she gives points) |
   | "should be penalised / wrong" | `"expect": { "classification": "wrong_state" }` (curated wrong action: `scoreDelta: -20`) |
   | "patient goes to state S" | `"expect": { "toState": "S" }`; "gets worse" → `"enteredBy": "deterioration"` |
   | "should still be in S / not reach S" | `"stateIn": ["S"]` / `"notState": "S"` |
   | "SpO2 below 90", "HR between 100 and 140" | `"vitals": { "spO2": { "lt": 90 } }`, `{ "heartRate": { "between": [100, 140] } }` |
   | "the case should pass / fail / score at least N" | scenario `expect`: `passed`, `scoreMin`, `scoreMax`, `outcomeIn`, `finalState` |

   Vital names: `heartRate, bpSystolic, bpDiastolic, map, respRate, spO2, temperature,
   painScore, gcs, urineOutput`. Comparisons: `lt, lte, gt, gte, eq, between`.
4. **Add the scenario** with metadata:
   ```json
   {
     "name": "untreated: SpO2 falls below 90 within 10 min",
     "request": "<her exact words>",
     "addedBy": "QA",
     "addedOn": "<YYYY-MM-DD>",
     "status": "draft",
     "steps": [{ "skipTime": 10, "expect": { "vitals": { "spO2": { "lt": 90 } } } }]
   }
   ```
   Give the scenario a short, unique, readable name; it becomes the test title in reports.
5. **Validate:** `npm run case:validate -- <file>`. Fix every ✘ before going on.
6. **Prove it once:** `npm run qa -- case "<title>" --env <env> --grep "<scenario name>"`.
   - **Passes:** set `"status": "active"` and
     `"lastConfirmed": { "env": "<env>", "on": "<date>", "build": "<api commit>" }`.
   - **Fails:** don't change the expectation on your own. Read the socket log (see
     `qa-triage`) and decide which applies:
     - **The expectation was wrong.** For example, the drop needs 15 minutes, not 10, or the
       state has a different name. Show her the evidence and ask with AskUserQuestion: "Keep
       as a known bug" / "Change the check to <x>" / "Remove it".
     - **The app or case is wrong.** Keep the check `active` (it should fail until it's
       fixed), add a `knownIssues` entry, and offer `qa-bug-report`.
     - **Login, network or writes not possible.** Leave it `draft` and tell her it will be
       confirmed on the next run.
7. **Confirm in plain words.** Don't paste JSON. For example: "Saved for **Pneumothorax**: if
   the patient is left untreated for 10 minutes, SpO2 must drop below 90. It passed on test
   (api baab7ed) and will run every time you test this case. Commit `cases/pneumothorax.case.json`
   so the team gets it too."

## Saving a manual check or known issue

- Append a plain sentence to `manualChecks`, or an object to `knownIssues`
  (`{ "summary", "env", "since", "bug" }`). Then validate.
- Confirm in one line.

## Changing or removing

- **"Stop checking X":** set `"status": "disabled"` and add `"note": "disabled <date>: <reason>"`.
  Don't delete it; history matters. Confirm first.
- **"Change the threshold to…":** edit just that value, then validate and re-run steps 5–7.
- **"Known issue fixed":** remove the entry from `knownIssues` only after a passing run
  proves it.

## Showing what is saved

When she asks "what do we check for <case>?", answer from the file in plain English:
- **Automatic checks:** one line each with its status.
- **Manual checklist.**
- **Known issues.**
- **Last result:** from `npm run qa -- cases --env <env>`.

## After any run that included a case

The `qa` skill reports results. For each case in the run you must also:
- List its `manualChecks` under "Please look at these yourself". Offer `qa-explore` to walk
  through them in the browser.
- Mark any failure that matches a `knownIssues` entry as **known**, with the bug link, not as
  a new bug.
