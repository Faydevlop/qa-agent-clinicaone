---
name: qa
description: Start a ClinicaOne QA run by asking the QA engineer what to test (environment, with or without login, whole app or specific cases, suites, paid AI calls, risky opt-ins), then drive the qa CLI and report. Use for "/qa", "run QA", "test <link>", "check uat", "run the tests", "test the Sepsis case", "smoke test dev without login", or any request to run automated checks where the scope isn't fully stated.
---

# QA run: ask, plan, run, report

The `qa` CLI (`cli/qa.mjs`) is the single entry point for automated runs. A human uses it
interactively (`npm run qa`). You use its non-interactive form, because your shell has no TTY:

```
npm run qa -- plan --json <flags>     # validate + exact command + test count, runs nothing
npm run qa -- run <flags>             # run, then writes reports/summary.md
npm run qa -- case "<title>" [--full] # test specific case(s): generic + saved checks (+ browser)
npm run qa -- cases --env <env>       # published cases, what is saved for each, last result
npm run qa -- summary                 # re-print the last summary
npm run qa -- doctor <env>            # .env / reachability / login check
npm run qa -- suites | presets        # what exists
```

Flags: `--env <dev|test|uat|link>` `--public` | `--login` `--suites a,b|all` `--preset <name>`
`--ai --ai-max N` `--security` `--no-writes` `--slow` `--visual` `--cases "A,B"`
`--grep <text>` `--headed` `--retries N` `--update-snapshots` `--full` (case depth).

## 1. Work out what is already decided

Read the request first. Do not ask what the user already told you.
- "smoke test uat without login" → env=uat, public, suites=smoke. Ask nothing; go to step 3.
- "full regression on test" → env=test, preset full-regression. Ask only about AI.
- "test the Sepsis case on uat" → env=uat, case focus, cases=Sepsis. Ask only depth (and AI).
- "/qa" or "run QA" alone → ask everything below.

Earlier answers in this conversation count as decided, unless the user asks for a different
setup.

## 2. Ask with AskUserQuestion (only the open decisions)

Use the AskUserQuestion tool, at most 4 questions per call. Put the safe choice first and mark
it "(Recommended)". Never ask for passwords.

**Call 1: the essentials**

| header | question | options |
|---|---|---|
| Environment | Which environment should I test? | dev · test · uat (the user can type a link under Other) |
| Login | Run with login or without? | With login (full coverage) (Recommended) · Without login (public checks only: health, headers, login page, anonymous API rules; writes nothing) |
| Scope | What should I test? | Health check after a deploy, ~10 min (Recommended) · A specific case · Full regression, ~35 min · Let me pick suites |
| AI cost | Include the AI patient tests? They make real paid LLM calls. | Off (Recommended) · On, capped at 15 calls · On, capped at 30 calls |

- Drop the AI question when Login is "without". AI needs login.
- With Login "without", map Scope to the `public-quick` preset unless the user picks suites.
- Release sign-off is not offered here; it belongs to `qa-release-check`. If she types it
  under Other, use `--preset release-signoff`. It turns AI on, so don't ask AI separately;
  mention the 15-call cap.
- "A specific case" needs login. If Login is "without", say so and ask again.

**Call 2: only if needed**

- Scope = "A specific case". Run `npm run qa -- cases --env <env>` first. It lists the
  published cases with what is saved for each and the last result. Then ask:
  - **Cases (multiSelect):** up to 4 options. Prefer cases with saved checks or a recent
    failure, and put the saved/last-run info in each description. She can type any other
    title under Other.
  - **Depth:** "Quick: content, assets, engine and saved checks, ~3 min per case
    (Recommended)" · "Full: also plays it in the browser (scene, animation, timer, report),
    ~8 min per case".
  - Ask AI here, not in call 1. AI tests run against the first selected case.

- Scope = "Let me pick suites". Ask two multiSelect questions:
  - "Fast checks": smoke, hardening, api, perf.
  - "Deep checks": engine, e2e, resilience, mobile. Omit mobile without login.
- Login = with. Ask a multiSelect "Extras":
  - Create test data (default on; turn off for a read-only look)
  - Security probes (dev/test only)
  - Slow idle-timeout test (+16 min)
  - Visual screenshot comparison
  If you're running a preset, ask this only when the user hinted at extras.
- The engine, e2e, resilience or perf suite is selected, and `cases/` has more than one spec for the env. Ask a multiSelect "Cases".

## 3. Plan, then confirm only if it costs or writes somewhere sensitive

1. Run `npm run qa -- plan --json <flags>`.
2. If `ok` is false, show the errors and stop.
   - **Missing credentials:** tell the user to add the `LEARNER_EMAIL` / `LEARNER_PASSWORD`
     lines to `qa-agent/.env` themselves, or offer to run without login.
3. Show a 3–5 line plan: env and builds, mode, suites, opt-ins, test count, warnings.
4. Ask for a go/no-go (AskUserQuestion, "Run now (Recommended)" / "Change something") only when:
   - AI is on,
   - security is on,
   - the env is uat/preprod/prod with writes on, or
   - the run is longer than ~15 min.
   Otherwise just run.

## 4. Run and report

For case focus: `npm run qa -- case "<title>" ["<title2>"] --env <env> [--full] [--ai --ai-max N]`.

- Run `npm run qa -- run <same flags>`. Use the background for anything beyond smoke/hardening.
- Read `reports/summary.md`. Report in the `qa-run` format: verdict, env, builds, the
  pass/fail/skip table, failures with evidence paths, and skips with reasons.
- Send every failure through `qa-triage` before calling it a bug. Classify what you know
  immediately. Known findings are in `docs/known-risks.md`; say "known" rather than re-filing.
- When the run included cases, read each case's `cases/<slug>.case.json`:
  - List its `manualChecks` under "Please look at these yourself".
  - Mark failures that match `knownIssues` as known.
  - If a case has no saved checks yet, offer once: "Want me to remember anything specific for
    this case next time?" (`qa-case-memory`).
- Finish with the exact rerun command (`npm run qa -- last` or the full flag line), so the QA
  engineer can repeat it from her own terminal.

## Mapping cheatsheet

| Answer | Flags |
|---|---|
| Without login | `--public` (only `@public` tests; no credentials touched; nothing written) |
| After deploy | `--preset after-deploy` |
| Full regression | `--preset full-regression` |
| Release sign-off | `--preset release-signoff` (AI on, max 15) |
| Public quick | `--preset public-quick` |
| AI on, cap N | `--ai --ai-max N` |
| Read-only look | `--no-writes` |
| Specific case | `case "Pneumothorax"` (quick) or `case "Pneumothorax" --full` |
| Specific case inside a whole-app run | `--suites engine,e2e --cases "Pneumothorax"` |
| One area | `--suites api --grep @assets` |

Flags after `--preset` override it, e.g. `--preset full-regression --ai --ai-max 10`.
