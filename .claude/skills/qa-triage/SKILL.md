---
name: qa-triage
description: Diagnose a failing or flaky ClinicaOne QA test — read the Playwright trace, socket-events.json, page-health.json and versions, classify the failure as product bug, test bug, environment issue, or case-data/authoring issue, and decide the next action. Use whenever a test fails, "why did this fail", "is it flaky", "rerun".
---

# Failure triage

Never call a failure a bug until you have classified it with evidence.

## 1. Collect

For each failed test:
- the error message and the failing line
- `test-results/<test>/trace.zip`: `npx playwright show-trace`, or unzip and read the
  `*.trace` network and console entries
- `socket-events.json`: the last server events before the failure
- `page-health.json`: console errors, page errors, failed or slow requests
- `npm run versions -- <env>`: did a deploy happen during the run? A gateway `startedAt`
  newer than the run start means services restarted mid-run.

## 2. Classify

| Class | Typical signals | Next action |
|---|---|---|
| **Product bug** | Server returns a wrong classification, score or state; 5xx; UI shows data that differs from the socket truth; uncaught page error; asset 404 for a URL the API returned | `qa-bug-report` |
| **Case authoring / data** | Golden path step gives `wrong_state`; missing timer edge; asset URL broken in view-layout only; persona incomplete (422); case missing on env | Report to the case author with the step and state ids. Not a code bug. |
| **Environment** | 502/503/504 from nginx; socket connect_error; TLS or ECONNRESET; deploy restart mid-run; AI 503; Pipecat cold start; 429 from a shared NAT | Rerun once after it stabilises; note it in the summary |
| **Test bug** | Selector not found but the element is visible in the screenshot; copy changed; timing assumption (the 12 s loader, the 2.5 s summary delay, a ≤20 s clip); spec expectation never verified (`verified:false`) | Fix the test or selector in `tests/support/ui.ts`, or the spec, openly; explain the change |
| **Unknown** | Can't tell after the above | Rerun with `--repeat-each=3 --trace on`; then escalate with the evidence |

## 3. Flakiness

- `npx playwright test -g "<name>" --repeat-each=5`.
- If it passes 5/5: probably environment. If it fails 1–4 of 5: flaky. Find the race:
  - an event waited on before it was registered
  - a fixed `waitForTimeout`
  - an animation hold still running
  - a tick boundary (5 s)
- Never fix flakiness by adding retries or loosening the assertion. Wait on the right signal:
  a socket event, a response, or a visible state.
- Engine timing (`outcome`, sim time) is inherently tick-dependent. Assert ranges
  (`outcomeIn`), not exact values.

## 4. Output

```
<test> → <class> (<confidence>)
Evidence: <one line + path>
Action: <bug filed / test fixed / rerun ok / escalated>
```
