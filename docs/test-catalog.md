# Test catalog

Run any area through the CLI: `npm run qa -- run --env <e> --suites <suite> [--grep <tag>]`.
Tags: `@public` (no login), `@writes`, `@ai` (paid), `@security`, `@slow`, `@visual`, plus
area tags (`@assets`, `@case`, `@a11y`, `@responsive`, `@perf`, `@hardening`, `@resilience`).

Each row is a check ID. **Auto** names the spec that covers it. **Manual** rows are for
exploratory sessions driven by Claude through the Chrome extension or Playwright MCP, or by
hand. Tags (`@smoke`, `@api`, `@engine`, `@e2e`, `@ai`, `@security`, `@a11y`, `@responsive`,
`@visual`, `@writes`) work with `--grep`.

## SM: Smoke (every deploy, every env)
| ID | Check | Auto |
|---|---|---|
| SM-01 | Gateway `/health` ok, `/version` branch matches env | smoke.spec |
| SM-02 | Content `/internal-content/health` | smoke.spec |
| SM-03 | Frontend `/version.json` served | smoke.spec |
| SM-04 | Deep links return 200 with no redirect (SPA rewrite) | smoke.spec |
| SM-05 | CORS allows the frontend origin with credentials | smoke.spec |
| SM-06 | Learner login and profile work | smoke.spec |
| SM-07 | Login page renders | smoke.spec |

## AU: Auth
| ID | Check | Auto |
|---|---|---|
| AU-01 | Client validation fires without a network call | e2e/auth |
| AU-02 | UI login lands on /home | e2e/auth |
| AU-03 | Protected route while signed out shows Login | e2e/auth |
| AU-04 | Logout clears sessionStorage | e2e/auth |
| AU-05 | 401 for missing or tampered token; refresh without cookie gives 401 | api/auth |
| AU-06 | Wrong password gives a generic 401 | api/auth |
| AU-07 | Refresh cookie issued (HttpOnly/Strict) | api/auth |
| AU-08 | Session survives >15 min (silent refresh) | Manual: leave a tab on /cases for 16 min, then navigate |
| AU-09 | New tab or cold reload keeps you signed in (needs the refresh cookie) | Manual |
| AU-10 | Lockout countdown after 5 bad passwords shows m:ss and recovers | Manual, **dedicated throwaway account only** |
| AU-11 | Forgot password → email → reset link → new password works | Manual (needs a mailbox) |
| AU-12 | Redeem code → signup → onboarding | Manual (needs a redeem code) |

## CL: Home and Case Library
| ID | Check | Auto |
|---|---|---|
| CL-01 | Dashboard total equals the API total (detects the mock-data fallback) | api/content, e2e/case-library |
| CL-02 | Search, detail panel, close | e2e/case-library |
| CL-03 | Empty search state | e2e/case-library |
| CL-04 | Sidebar navigation | e2e/case-library |
| CL-05 | Pagination, "Load more", sort by title/category/date | api/content (+ manual UI) |
| CL-06 | Only published cases are listed | api/content |
| CL-07 | Card shows patient name, age, gender and image | Manual |

## AS: Assets and loading
| ID | Check | Auto |
|---|---|---|
| AS-01 | Every view-layout asset of every case returns 200 within 8 s | api/content `@assets` |
| AS-02 | Evidence PDFs reachable and CORS-enabled | api/content `@assets` |
| AS-03 | Loading screen prefetches all `allAssetUrls` with no failures | e2e/simulation |
| AS-04 | Loading holds ≥12 s, finishes <60 s, shows % progress | e2e/simulation |
| AS-05 | No images that fail to decode or videos in error | e2e/simulation |
| AS-06 | Slow network (Fast 3G): retry once, then continue without hanging | Manual: DevTools throttling |
| AS-07 | Brief/briefing card content matches the case | Manual |

## SE: Simulation engine (socket, server truth)
| ID | Check | Auto |
|---|---|---|
| SE-01 | Join sends a full session-state | engine-invariants |
| SE-02 | Timer ticks about every 5 s, monotonic; vitals-update arrives | engine-invariants |
| SE-03 | Deterioration: skipping past the state timer moves state via a timer, and vitals change | engine-invariants, case specs |
| SE-04 | Unsupported skip duration refused | engine-invariants |
| SE-05 | Unwired action classified `wrong_state` with ≤0 score | engine-invariants |
| SE-06 | Hand-off score payload is consistent; REST re-score matches | engine-invariants |
| SE-07 | Lab without panels refused | engine-invariants |
| SE-08 | Golden path per case reaches terminal and passes | case-scenarios |
| SE-09 | Repeat placement doesn't score twice | case-scenarios |
| SE-10 | Timeout at `criticalTimeLimitSeconds` ends with reason timeout | Manual or a long case spec using skipTime |
| SE-11 | Idle 15 min → warning → "I'm still here" clears it; 2 more min → ends with reason idle | SE-20 (`--slow`) + Manual UI |
| SE-12 | Closing the tab mid-case → session abandoned after about 2–3 min | Manual + `GET /sessions/:id` |
| SE-13 | Lab result arrives after its due time; Skip delivers it now | case spec with `skipLabWait` |
| SE-14 | Socket without a token is refused | engine-socket `@public` |
| SE-15 | Joining someone else's (or a non-existent) session id gives "Session not found", no state | engine-socket |
| SE-16 | Two tabs on one session: same state, same timer (±5 s), actions broadcast to both | engine-socket |
| SE-17 | Reconnect resumes the same state; elapsed never resets | engine-socket |
| SE-18 | Skip-time arithmetic: `skippedSeconds = minutes×60`, elapsed advances by that; every offered option accepted | engine-socket |
| SE-19 | After hand-off, actions, skips and ticks stop | engine-socket |
| SE-20 | Idle warning at 15 min (secondsLeft ≤120); activity clears it (automates SE-11 first half) | engine-socket `@slow` |

## UI: Simulation UI, timers and animation
| ID | Check | Auto |
|---|---|---|
| UI-01 | Sound gate shows for audio cases and enters fullscreen | e2e/simulation (passGates) |
| UI-02 | Countdown in the HUD moves smoothly and matches `timer-update` (±5 s) | e2e/simulation (ticks) + Manual visual |
| UI-03 | Vitals show "---" until the monitor is attached, then live numbers; beeps follow HR | e2e/simulation + Manual audio |
| UI-04 | Scene media for `currentStateId` matches view-layout (**animation/scene mismatch**) | e2e/simulation |
| UI-05 | Transition clip plays on state change, freezes the outgoing state, caps at 20 s, and doesn't replay in the next state (pending-lab bug scar) | Manual |
| UI-06 | Notifications are held during clips, then appear in the right tab | Manual |
| UI-07 | Wrong action: amber toast, row shakes and turns red, server logs `wrong_state` | Manual + socket log |
| UI-08 | Guide/hints shows only actions wired at the current state | Manual vs `hintActionIds` |
| UI-09 | Lab modal panels, exam modal systems, history modal content | Manual |
| UI-10 | Reports hub: unread badge, pending countdown, results, lab reference ranges | Manual |
| UI-11 | Notepad add/edit persists across reload | api/sessions + Manual |
| UI-12 | Back gives "Leave simulation?"; Stay keeps you in; Leave goes to /cases | e2e/simulation |
| UI-13 | Reload rejoins the same session and state | e2e/simulation |
| UI-14 | Face rig blinks; lips move on patient speech (voice and text) | Manual |
| UI-15 | Tap-to-zoom on overlays with a zoomFrame; taps don't fall through | Manual |
| UI-16 | Case without alarm sounds doesn't blank the page (regression 684029b) | Manual |
| UI-17 | Nurse alert when SpO2 ≤90% and falling | Manual (deteriorate a respiratory case) |

## EN: End of case and report
| ID | Check | Auto |
|---|---|---|
| EN-01 | Hand-off destinations: only Discharge before terminal; authored options at terminal | Manual + case spec `handoff` |
| EN-02 | Report opens after any clip plus 2.5 s; never before the terminal animation | e2e/simulation + Manual |
| EN-03 | UI score equals `session-ended` score; tabs present | e2e/simulation |
| EN-04 | Score breakdown equals `/sessions/:id/history` | Manual |
| EN-05 | AI feedback: offered only for handoff/timeout, polls, shows a result; **hidden on UAT** | Manual |
| EN-06 | Evidence tab PDFs render | Manual (+ AS-02) |
| EN-07 | Replay case starts a fresh session; Go to home works | Manual |

## QZ: Question bank
| ID | Check | Auto |
|---|---|---|
| QZ-01 | Categories, counts and status match the API | api/quiz, e2e/quiz |
| QZ-02 | Start, resume, visit, draft, answer; one submit per question | api/quiz |
| QZ-03 | Limit of 3 in progress shows the LimitDialog | Manual |
| QZ-04 | Leaving fullscreen pauses the quiz; copy and context menu blocked | Manual |
| QZ-05 | Result screen and review answers; partial-credit math | Manual |

## AI: AI patient
| ID | Check | Auto |
|---|---|---|
| AI-01 | In-character answer, no emotion tags in text | api/ai-patient `@ai` |
| AI-02 | Jailbreak gives a canned deflection, never repeated back to back | api/ai-patient |
| AI-03 | Never says it's an AI | api/ai-patient |
| AI-04 | Role reversal and off-topic stay in character | api/ai-patient |
| AI-05 | Text reply latency under 10 s | api/ai-patient |
| AI-06 | Clinical fidelity: answers match the case file (view-history), no invented meds or allergies | Manual: compare with `GET /cases/:id/view-history` |
| AI-07 | Chat disabled while the patient is unconscious | Manual |
| AI-08 | Voice: connect (≤85 s on dev/test), talk, lip-sync, mute, end; watchdog prompts | Manual (mic) |

## SC: Security (opt-in)
| ID | Check | Auto |
|---|---|---|
| SC-01 | Anonymous calls get 401 on all protected routes | api/security |
| SC-02 | Foreign Origin gets 403 | api/security |
| SC-03 | Session IDOR (another learner reads or ends my session) | api/security (needs LEARNER2) |
| SC-04 | `/internal-content` case create reachable with a learner JWT | api/security |
| SC-05 | Swagger exposure per env | api/security |

## CS: Case checks (any case you pick: `npm run qa -- case "<title>"`)
| ID | Check | Auto |
|---|---|---|
| CS-01 | Case detail, action catalog (no duplicate names), scenes, every asset and evidence pack loads | case-generic |
| CS-02 | Arrival: not terminal, time limit set, actions wired, plausible vitals, scene exists | case-generic |
| CS-03 | Untreated: state changes over time; every reached state has a scene (animation mismatch); vitals plausible | case-generic |
| CS-04 | Unrelated action never scores | case-generic |
| CS-05 | Immediate hand-off doesn't pass; REST re-score matches | case-generic |
| CS-06 | Saved checks from `cases/<slug>.case.json` | case-scenarios |
| CS-07 | Browser journey for each picked case (`--full`) | e2e/simulation |
| CS-08 | The case's `manualChecks` | Manual, listed after every case run |

## HD: Hardening (public, read-only)
| ID | Check | Auto |
|---|---|---|
| HD-01 | TLS certs for web and API valid for more than 14 days | hardening |
| HD-02 | http redirects to https (or port 80 closed) | hardening |
| HD-03 | API: no `x-powered-by`, `nosniff`, HSTS | hardening |
| HD-04 | Web: HSTS, `nosniff` | hardening |
| HD-05 | Unknown route gives a JSON 404, no stack trace | hardening |
| HD-06 | Malformed JSON / 5 MB body gives 4xx, never 5xx | hardening |
| HD-07 | index.html revalidated; bundle cache policy recorded | hardening |
| HD-08 | No public source maps outside dev/test | hardening |

## PF: Performance budgets (soft)
| ID | Check | Auto |
|---|---|---|
| PF-01 | `/health` p95 < 500 ms | perf `@public` |
| PF-02 | Login page TTFB < 1.5 s, DCL < 5 s, LCP < 4 s, JS < 6 MB | perf `@public` |
| PF-03 | `/auth/profile` p95 < 800 ms, `POST /cases` p95 < 1.5 s | perf |
| PF-04 | Home LCP < 4 s signed in | perf |
| PF-05 | Case media: images ≤ 2 MB, videos ≤ 30 MB; total recorded | perf |

## RS: Resilience
| ID | Check | Auto |
|---|---|---|
| RS-01 | Garbage token in sessionStorage → Login, no stuck spinner | resilience `@public` |
| RS-02 | `POST /cases` 500 → shell still usable, no uncaught exception | resilience |
| RS-03 | 3 s API latency → Home still renders | resilience |
| RS-04 | Double-click Start Now → exactly one session | resilience `@writes` |
| RS-05 | 10 s offline mid-case → client re-joins and the timer continues | resilience `@writes` |

## NF: Non-functional
| ID | Check | Auto |
|---|---|---|
| NF-01 | Serious or critical axe violations on shell screens | e2e/a11y-responsive |
| NF-02 | No horizontal overflow at 1366×768, 1280×600, 915×412 | e2e/a11y-responsive |
| NF-03 | Login visual baseline | e2e/a11y-responsive `@visual` |
| NF-04 | Mobile landscape: rotate prompt, fullscreen, iOS "Add to Home Screen" hint | Manual on a real device |
| NF-05 | Browser matrix: Chrome, Edge, Safari (face rig and video), Firefox | Manual |
