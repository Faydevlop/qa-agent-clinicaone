# Known risks and open findings

From the code analysis on 2026-11-01. Re-verify each one on the target environment before
filing it. Close entries here when they are fixed.

## Security (report privately to the team lead)
1. **Session endpoints don't check ownership.** `GET /sessions/:id`, `/history`, `/reports`,
   `GET`/`PUT /notes` and `POST /sessions/:id/end` only validate the JWT
   (backend `services/simulation-service/src/grpc/handlers/simulation.handlers.ts`). Any
   learner holding a session id could read or end another learner's session. The socket
   handlers, quizzes and AI feedback do check ownership. Check: SC-03.
2. **content-service is publicly proxied at `/internal-content/`.** Its
   `POST /api/v1/cases/create` requires a JWT but no role, so a learner token may reach it.
   Check: SC-04.

## Product and behaviour
- **Malformed JSON gives 500, not 400** (confirmed on test, api baab7ed, 2026-11-01):
  `POST /api/v1/sessions` (and `/auth/refresh`) with body `{"caseId":` returns
  `{"statusCode":500,"message":"Internal server error"}`. The body-parser `SyntaxError` isn't
  mapped to 400 in the gateway error handler. No stack leaks. HD-06.
- **Missing security headers** (test, 2026-11-01): the gateway sends no `X-Content-Type-Options`
  or HSTS (helmet is commented out in `gateway-service/src/app.ts`), and the Amplify frontend
  sends no HSTS. HD-03/HD-04.
- Login page: axe reports one serious `color-contrast` violation (test, web 8da1070,
  2026-11-01; seen once, then blocked by local ECONNRESET). Re-run NF-01 to get the node.
- Hashed JS bundles are served `max-age=0, s-maxage=31536000`: CDN-cached, but browsers
  revalidate on every load. HD-07, perf note.
- The dashboard falls back to the length of the mock case list if `GET /dashboard` fails,
  so a wrong total can hide an API failure (CL-01).
- `criticalActionsMissed` is always empty, and the scoring rubric is a TODO in the frontend.
- `passed = totalScore > 0`, so a learner who scores +1 after many penalties still "passes".
  Confirm this is intended.
- The report list isn't polled. If the socket drops, lab results can look stale until the
  next revision bump.
- Reaching a terminal state doesn't end the case. The learner must hand off. Check that the UI
  makes this obvious.
- The voice room says `transport: daily` while the gateway type allows `livekit|daily`. A
  Pipecat start failure surfaces as a 500, not 412 as the docs say.
- AI guardrails fail open: if the classifier is down, jailbreaks go straight to the model.
- `outcome` depends on sim time, and instant actions jump the clock, so "slow" is common even
  on a perfect run. Confirm with product.

## Environment and tooling
- No preprod or prod frontend/API hostnames are documented, and there is no prod deploy
  workflow.
- Amplify runs no tests: a frontend build that compiles but is broken ships to the
  environment.
- `docs/auth.md` in the frontend describes a refresh-token file and SecureStore that don't
  exist. Native refresh persistence is likely missing.
- The frontend sends `/ai/conversations {caseId}`; its docs say `{sessionId, caseId}`.
- The auth rate limit is per IP. A whole office behind one NAT shares 10 logins per 15 min.
  Testers locking each other out is expected, not a bug.
- From some Windows machines, curl/schannel TLS handshakes to the Amplify frontends fail
  intermittently. Node `fetch` and browsers are fine. Use `curl --ssl-no-revoke` or Node.

## Recently changed (regression focus)
- Fullscreen on "Start case": 4b318e1, f0bb179.
- Responsive fixes on short and landscape screens (auth, quiz, loading, exam report, summary
  gauge).
- Hand-off at terminal states and end-option labels.
- MCQ question bank.
- AI feedback button.
- Scene tap-through and tap-to-zoom.
- Audio volume, and the crash on cases without alarm sounds.
- Missing action listing (769975c).
- Evidence-pack PDFs.
- DKA loader glitch.
- AI service: new voice watchdog and turn metrics; mapper and report prompt versions reset
  to v1 (db85043).
