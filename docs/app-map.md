# ClinicaOne app map (for testers)

Built from the frontend `dev` (HEAD 46cdedd), backend `dev` (dba381c) and AI service `dev`
(db85043) on 2026-11-01. When the code and this file disagree, the code wins: update this file.

## 1. Learner journey

```
/login ──► /home (Overview) ──► /cases (Case Library) ──► detail panel ──► "Start Now"
                                                                  │ POST /sessions {caseId}
                                                                  ▼
                                   Loading screen (no URL): briefing + asset prefetch, ≥12 s
                                                                  │ full page load
                                                                  ▼
                                   /simulation/:sessionId/:caseId  (Socket.IO, server-driven)
                                   sound gate → actions / labs / exams / chat / monitor / timers
                                                                  │ "Hand-off" → destination
                                                                  ▼
                                   Case report modal: score, tabs, AI feedback, evidence
                                   "Replay case" | "Go to home screen"
/question-bank ──► /question-bank/:quizId   (MCQ quizzes, fullscreen, max 3 in progress)
```

Public routes: `/login`, `/signup`, `/redeem`, `/forgot-password`, `/reset-password?token=`.
Signed-out visits to protected routes fall back to Login, keeping the URL. Only the learner
role exists (`student` in the backend; `admin` exists, but no route checks roles).

## 2. Auth facts that shape testing

- `POST /auth/login {email,password}` returns `data.accessToken` (a 15-minute JWT) and a
  `refreshToken` HttpOnly cookie (30 days, `SameSite=Strict`, `Path=/api/v1/auth`, rotating).
- The web app keeps `sessionStorage["c1.accessToken"]` and `["c1.user"]`, so sessions are
  per tab and a new tab depends on the refresh cookie.
- **Rate limits:** auth routes allow 10 requests / 15 min / IP. 5 wrong passwords lock the
  account (≈30 s on deployed boxes). General limit: 300 requests / min. AI routes: 30 / min.
- On a 401 the client calls `/auth/refresh` once, then logs out.
- The QA harness logs in once per run, caches the token in `.auth/`, and injects it into
  `sessionStorage` for UI tests.

## 3. Selectors (no testIDs exist; aria-labels come from accessibilityLabel)

| Screen | Element | Selector |
|---|---|---|
| Login | email / password | placeholder `revin@gmail.com` / `Password` |
| Login | submit | label `Log In` |
| Login | errors | "Invalid email or password. Please try again.", "Too many failed login attempts. Try again in m:ss." |
| Sidebar | nav | text `Overview`, `Case Library`, `Assessment`; label `Log out` |
| Home | total card | label `Total cases: N. Open the case library`; text `Explore Case Library` |
| Cases | search | placeholder `Search Case`; empty state "No cases match your search." |
| Cases | card / start | label `Open case <title>` / `Start case <title>`; panel label `Start Now` ("Starting...") |
| Loading | progress | "Preparing ER Bay... N%" → "Entering Treatment Room →" |
| Sim | sound gate | text `Start case` (no label) |
| Sim | actions | placeholder `Search an action`; row text + button `Perform`/`Order`/`Reorder`; "Indicated" badge; `Skip the wait for <report>` |
| Sim | lab / exam modals | "Order Labs" → "Order Selected"; "Physical Examination" (system checkboxes) |
| Sim | right panel | `Attach monitor`, vitals "Heart Rate / Blood Pressure / SpO2 / Resp Rate / Temperature" ("---" until attached), label `Observation: skip time`, `Report, N unread`, `Notepad`, `History` |
| Sim | end | text `Hand-off` → "Select Destination" → `Discharge` or the authored end options; after the end, `Show result` |
| Sim | chat | placeholder `Ask the patient a question`; labels `Send`, `Talk to the patient`, `End voice call`, `Mute patient` |
| Sim | idle / exit | "Are you still there?" / "I'm still here"; "Leave simulation?" Stay / Leave |
| Report | modal | "{score} / {max} points"; tabs What to improve, What went well, Summary, Score breakdown, Evidence; `Replay case`, `Go to home screen`; label `Close case report` |
| Quiz | controls | Start, Resume, Submit Answer, Next, Previous, Mark for Review, Save and Exit; option label `Option <id>: <text>`; palette `Question N, <status>` |

## 4. REST API (gateway, base `/api/v1`, Bearer token)

Envelopes:
- Success: `{statusCode, alertMessage, message, data}`.
- List: `{…, tableData}`; paginated lists add `pagination{page,limit,total,totalPages}`.
- Error: `{statusCode, alertMessage, message, details?}`. Only the first validation message
  survives the gateway.

| Area | Endpoints |
|---|---|
| Auth | POST `/auth/login`, `/auth/refresh` (cookie), `/auth/logout`, `/auth/forgot-password` (always 200), `/auth/reset-password`, `/auth/verify-redeem`, `/auth/signup` (onboarding token); GET `/auth/profile` |
| Content | POST `/cases` (list: pagination ≤100, sort createdAt\|title\|category, search.term; published only); GET `/cases/:id`, `/cases/:id/view-history`, `/cases/:id/view-layout`, `/cases/:id/actions`, `/cases/:id/evidence-packs`, `/actions`, `/dashboard`, `/constants` |
| Sessions | POST `/sessions {caseId}` (201: id, patientState, allAssetUrls); GET `/sessions/:id`, `/history`, `/reports`; GET/PUT `/notes` (PUT replaces the list); POST `/sessions/:id/end` (idempotent, reason handoff); GET/POST `/ai-feedback` (409 unless the session ended by handoff or timeout) |
| Quiz | GET `/quiz-categories` (maxInProgress 3); POST `/quizzes {categoryId}` (201 new, 200 resume, 409 limit, 422 empty); GET `/quizzes/:id`; POST `/visit`; PUT `/draft`; POST `/answers` (≥1 option, 409 if already submitted) |
| AI patient | POST `/ai/conversations {caseId}` → conversationToken (2 h); `/ai/conversations/messages {conversationToken,text}` → `{reply}`; `/ai/conversations/end`; `/ai/conversations/voice` → Daily joinUrl/joinToken (85 s client timeout). 503 when AI isn't configured; 404/422 when there is no persona or it is incomplete |
| Ops | GET `/health`, `/version`, `/internal-content/health`, `/internal-content/version`; Swagger `/api/v1/docs` only when enabled |

The REST perform-action route (`POST /sessions/:id/actions`) is retired. Actions go over the
socket only.

## 5. Simulation engine (server-authoritative)

**Client → server**

| Event | Payload |
|---|---|
| `join-session` | `{sessionId}` |
| `perform-action` | `{sessionId, actionId, selectedLabPanels?, selectedExamSystems?}` |
| `skip-time` | `{sessionId, minutes ∈ 5,10,15,20,30}` (only while the state has a timer) |
| `skip-lab-wait` | `{sessionId, reportId}` |
| `end-session` | `{sessionId, endOptionId?}` |
| `observation-answer` | – |
| `learner-activity` | – (the client throttles it to one every 20 s) |

**Server → client**

| Event | When / payload |
|---|---|
| `session-state` | Full snapshot on join and on every transition: currentStateId/Name, isTerminal, endOptions, actions, wrongActionIds, hintActionIds, isConscious, vitals, criticalTimeLimitSeconds, simElapsedSeconds, stateTimer, enteredByTimer{transitionType}, timeSkipOptionsMinutes, performedActionIds, actionResults |
| `vitals-update` | Every tick |
| `timer-update` | `{elapsedSeconds, thresholdSeconds, deteriorated}`, every tick (5 s) |
| `action-result` | classification `graph_advance` \| `wrong_state` \| `general`, scoreDelta, message, professionalImpression, saidBy, patientState, timerTransitions, reportId… |
| `action-pending` | Labs: `{actionId, dueInSeconds, reportId}`; the result arrives later as `action-result` |
| `time-skipped` | – |
| `idle-warning` / `idle-cleared` | – |
| `session-ended` | `{totalScore, maxPossibleScore, scorePercentage, scoreWithCriteria, passed, reason, outcome, simElapsedSeconds, observations…}` |
| `error` | `{message}` |

**Rules worth asserting**
- Ticks happen every 5 s, and only while a socket is joined. Sim time comes from wall clock
  plus clock jumps.
- Timers:
  - Each state has at most one timer edge. When `simElapsed − enteredAt ≥ timerSeconds`, it
    fires (deterioration, improving or stabilizing) and can chain until a terminal state.
  - Skipped time counts: timers fire and the patient can die.
- Ending:
  - A terminal state does **not** end the session. The learner must hand off.
  - Reaching `criticalTimeLimitSeconds` ends the session with reason `timeout`.
  - 15 min idle → `idle-warning`; 2 more minutes → end with reason `idle`.
  - No socket for more than 2 min → swept as `abandoned`.
- Penalties:
  - Curated wrong action: −20 points and +600 sim-seconds.
  - Mistimed action: −20 points plus its time cost.
  - Action not in the case: 0 points plus its time cost.
  - Wrong-state penalties repeat; correct placements score once.
- Action timing:
  - Labs need panels and exams need systems; otherwise the server sends `error`.
  - Labs are background tasks.
  - Respiratory actions ease vitals in over ≤20 s.
  - Other actions jump the clock by their duration.
- Scoring:
  - `passed = totalScore > 0`.
  - `scorePercentage = round(total/max·100)`, clamped to 0–100.
  - `outcome` (success / partial / slow) depends on sim time.
  - `criticalActionsMissed` is always `[]` (a TODO).

**What the client does with it**
- It interpolates the countdown between ticks.
- Nurse alerts fire when SpO2 is ≤90% and falling, or when systolic BP is falling.
- Notifications are held back during transition or hold clips (images 3 s, videos capped at
  20 s).
- The summary modal opens 2.5 s after `session-ended`, once any clip has finished.
- The report list refetches when `reportsRevision` bumps, with retries at 1.5/2/4/8/16 s.

## 6. Scene, animation and assets

- `GET /cases/:id/view-layout` returns `states[stateId]` with environment and patient
  assets, overlays (`zoomFrame`), `holdMediaUrl` and `transitionMediaUrl`.
  `hasViewLayout:false` means nothing was authored for the case.
- `POST /sessions` returns `allAssetUrls`. The loading screen prefetches each with an 8 s
  timeout and one retry, and holds for at least 12 s.
- Media hosts are Cloudinary (`/video/upload/`) and S3. pdf.js comes from cdnjs, and
  evidence PDFs need CORS.
- The face rig (web only) does lip visemes from voice (`voice-visemes`) or from text
  heuristics, plus blinks.
- The HUD is scaled from a 1920×1080 canvas: `scale = clamp(min(h/1080, w/1920), 0.4, 1.6)`.
  Touch devices are forced to landscape.
- Hard-coded special case: id `6a6b96d3c6f7767b8be6ae29` (chest pain, dev only) gets a
  custom loading scene.

## 7. AI patient (gRPC service behind the gateway)

- **Persona rules:**
  - Lay speech; answers only what was asked.
  - Never admits being an AI.
  - Never diagnoses or prescribes ("You're the doctor").
  - Facts come only from the case record; anything missing gets "no".
  - Vitals are not available through the patient.
- **Jailbreaks** get one of two canned lines, never the same one twice in a row:
  - "Sorry, I don't really follow what you mean. Can we get back to why I came in?"
  - "I'm not sure what you're asking me there. I just want to know what's going on with me."
- **Fallback lines:**
  - Tool failure: "my mind's gone blank, ask me again?"
  - Usage budget exhausted: "I don't remember the exact details on that, honestly -- it
    didn't really stick."
  - Voice with no transcript: "Sorry, could you say that again?"
- **Voice watchdogs:**
  - The call ends if nobody joins within 30 s.
  - After 60 s of silence the patient asks "Doctor? Are you still there?", then hangs up
    after 30 s more.
  - 300 s idle timeout; the Daily room ejects everyone at 1800 s.
- **Guardrails fail open.** If a guardrail errors, the turn goes through. AI feedback and
  report wording differ on every run.
- **Session ids** are prefixed with the environment name, which helps when searching
  Langfuse and New Relic.
