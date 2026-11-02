---
name: qa-run
description: Run ClinicaOne automated QA suites (smoke, api, engine, e2e, assets, ai, security, a11y) against an environment, pick the right scope for the request, and summarise results with evidence. Use for "smoke test test env", "run regression on uat", "is dev healthy", "run the asset checks", "rerun failures".
---

# Running the suites

## Choose the scope

Runs go through the qa CLI (`npm run qa -- run <flags>`). If scope, login or AI cost aren't
clear from the request, use the `qa` skill to ask first.

| Request | Command | Time |
|---|---|---|
| "Is it up?" with no credentials | `npm run qa -- run --env <e> --preset public-quick` | ~2 min |
| "Is it up?" / after a deploy | `npm run qa -- run --env <e> --preset after-deploy` | ~10 min |
| Backend change | `--suites api,engine` | ~5–10 min |
| Frontend change | `--suites smoke,e2e,resilience` | ~15–20 min |
| New or changed case content | `--suites api,engine,e2e --cases "<title>" ` (see `qa-case-test`) | varies |
| Full regression | `--preset full-regression` (no AI, no security) | ~35 min |
| AI change | `--suites api --grep @ai --ai --ai-max 15` | ~2 min, costs money |
| Security pass (dev/test) | `--preset security-audit` (set `LEARNER2_*` for IDOR) | ~3 min |
| Performance check | `--suites perf` | ~2 min |
| Mobile/responsive | `--suites mobile` | ~5 min |
| Only failures from last run | `npx playwright test --last-failed` (keeps the last env vars only if you re-export them; prefer `npm run qa -- last --grep "<title>"`) | – |

Raw `npx playwright test` still works. Set `QA_TARGET` and the `QA_*` flags yourself; see
`cli/plan.mjs` for the full list.

For a scoped change, read the commits first:
- `npm run versions`
- `git -C <repo> log --oneline <deployedOld>..<deployedNew>` (repos are in
  `CLINICAONE_REPOS_DIR`)

Then map the changed files to catalog areas (`docs/test-catalog.md`) and run those tags plus
smoke.

## Run

- Run in the background for long suites and keep working.
- Prefer one project at a time so failures are easy to read.
- Never raise `workers` above 1 against a shared env without a reason. The suites share one
  learner account and the auth limiter.

## Read results

- `reports/summary.md`: written after every CLI run (builds, mode, opt-ins, failures, skips,
  measurements). Start here.
- Console: the `list` reporter.
- `reports/results.json`: machine-readable. Use it for the summary.
- `test-results/<test>/`: trace.zip, video, screenshot, `socket-events.json` (every server
  event with timestamps) and `page-health.json` (console errors, failed requests, slow
  requests).
- Annotations in the HTML report show builds, transitions, load times and asset counts.

## Summarise for the QA engineer

```
<✅|⚠️|❌> <env> — FE <commit> / BE <commit> — <passed>/<total> passed, <skipped> skipped

| ID | Check | Result | Evidence |
|----|-------|--------|----------|
| SE-03 | Deterioration on skip | ❌ | test-results/…/socket-events.json (no timer transition after 600s skip) |

Skipped: <why, e.g. "AI suite not enabled", "no case spec for X on uat">
Next: <triage / bug reports / rerun suggestion>
```

Every failure goes through `qa-triage` before it is called a bug. A skip is not a pass: list
skips and their reasons.
