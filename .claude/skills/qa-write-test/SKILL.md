---
name: qa-write-test
description: Add or fix an automated ClinicaOne QA test following this repo's conventions — choose the right layer (api / engine socket / e2e browser / case spec), reuse fixtures and selectors, assert on server truth, keep auth budget and env safety. Use for "automate this", "add a test for", "turn this bug into a regression test", "selector broke".
---

# Writing tests here

## Pick the lowest layer that proves it

| Behaviour | Layer | Where |
|---|---|---|
| A case's graph, scores, timers | **Case spec** (JSON, no code) | `cases/*.case.json` |
| Engine rule for all cases | Socket | `tests/engine/*.spec.ts` with `SimSession` |
| REST contract, validation, envelopes | API | `tests/api/*.spec.ts` with the `api` fixture |
| Rendering, navigation, copy, layout, animation | Browser | `tests/e2e/*.spec.ts` with the `learnerPage` + `socketLog` + `health` fixtures |

## Conventions

- Import `test`/`expect` from `../support/fixtures`, never from `@playwright/test` directly.
- **Tags in titles:**
  - always one layer tag: `@smoke`, `@api`, `@engine` or `@e2e`
  - add the area tags: `@assets`, `@ai`, `@security`, `@a11y`, `@responsive`, `@visual`
  - add `@writes` if the test changes server state
- **Writes:** guard with `test.skip(!env.writesAllowed, …)`. Prod is read-only.
- **Sessions:** start with `api.startSession(caseId)` and always end them in
  `afterEach`/`finally` with `api.endSession(id)`.
- **Cases:** use `api.findCase(title)`, never ids. The default comes from
  `flags.defaultCase`.
- **Auth:** use the fixtures (one cached login per run). Never call `/auth/login` in a loop.
  The only UI login lives in `e2e/auth.spec.ts`.
- **Selectors:**
  - add them to `sel` in `tests/support/ui.ts`
  - order of preference: label/role, then placeholder, then exact text
  - no CSS classes or XPath into RN Web's generated divs, except the row helper that already
    exists
- **Waiting:**
  - wait for signals: `socketLog.waitFor('session-state', pred)`, `page.waitForResponse`, or
    `expect(locator).toBeVisible()`
  - `waitForTimeout` only for a documented product delay (≤20 s clip, 2.5 s summary), with a
    comment
- **Assertions:**
  - server truth first (socket payload, API response), then the UI's reflection of it
  - use `expect.soft` for lists of independent checks so one run reports them all
  - put context in assertion messages
- **Evidence:** attach anything useful with `testInfo.attach` (the `health` fixture already
  attaches page health).
- Map the new test to a catalog ID in `docs/test-catalog.md` and update the row's Auto column.

## Regression test from a bug

1. Reproduce at the lowest layer.
2. Write the test so it fails on the buggy build.
3. Name it after the behaviour, not the ticket. Put the ticket in an annotation:
   `test.info().annotations.push({ type: 'bug', description: '<link>' })`.
4. Confirm it fails now and passes once the fix is deployed. Check the build with
   `npm run versions`.

## Before you finish

- `npx tsc -p . --noEmit` (type check)
- `npx playwright test <file> --list` (it collects)
- Run it once against dev
