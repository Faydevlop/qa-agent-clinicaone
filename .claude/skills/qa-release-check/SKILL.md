---
name: qa-release-check
description: Produce a QA sign-off for promoting ClinicaOne to the next environment (dev→test, test→uat, uat→preprod/prod) — confirm deployed builds, diff the commits since the last sign-off, run smoke + targeted + full regression, the manual must-checks, and write a go/no-go report. Use for "sign off test", "is uat ready", "release check", "promotion", "regression before release".
---

# Release / promotion check

## 1. Pin the builds

```
npm run versions -- all
```

- Record the frontend `/version.json` and gateway/content `/version` commits for the target
  env.
- If the target hasn't received the merge yet (its commit doesn't match its branch head),
  **stop**. You would be signing off the wrong build.

## 2. What changed

With the repos available (`CLINICAONE_REPOS_DIR`), compare the build being signed off with
the last signed-off build. Previous sign-offs are in `reports/signoff-*.md`.

```
git -C <repos>/clinicaone-simulation-frontend log --oneline <lastSignedFE>..<newFE>
git -C <repos>/clinicaone-simulation-backend  log --oneline <lastSignedBE>..<newBE>
git -C <repos>/clinicaone-simulation-ai-service log --oneline <lastSignedAI>..<newAI>
```

Map the changes to catalog areas:

| Changed path | Areas |
|---|---|
| frontend `src/screens/simulation/**` | UI, SE, EN |
| frontend `src/screens/quiz/**` | QZ |
| frontend `src/api/auth/**` | AU |
| backend `services/simulation-service/**` | SE, EN, QZ |
| backend `services/identity-service/**` | AU |
| backend `services/content-service/**` | CL, AS |
| backend `services/gateway-service/**` | all API; SC |
| AI service | AI |

## 3. Run

1. `npm run test:smoke`. If it fails, the verdict is no-go; stop here.
2. Targeted tags for the changed areas.
3. The full regression: `npm test`, plus `npm run test:ai` if AI changed.
4. Every case spec on the target env: `npx playwright test --project=engine --grep @case`.
5. The manual must-checks below.

## 4. Manual must-checks (every promotion)

- [ ] One full golden-path case in a real browser with sound: scene, animation, timer, vitals
      and report (`qa-case-test` §4, short form).
- [ ] One deterioration-to-death run: the patient visibly worsens, alarms sound, and the end
      behaves as the case defines.
- [ ] Reload and Back inside a simulation (UI-12, UI-13).
- [ ] Mobile landscape on a real phone: rotate prompt and fullscreen (NF-04).
- [ ] Chat with the patient (2–3 questions). On test, also check voice connects.
- [ ] Question bank: start a quiz, answer one question, save and exit.
- [ ] Anything in `docs/known-risks.md` "Recently changed" that touches this release.

## 5. Verdict

Write `reports/signoff-<env>-<YYYY-MM-DD>.md`:

```
# QA sign-off: <env> — <date>
Verdict: GO | GO WITH KNOWN ISSUES | NO-GO
Builds: FE <commit> (<version>) · BE <commit> · AI <commit>
Compared to last sign-off: FE <old>..<new> (<n> commits) · BE … · AI …

## Automated
| Suite | Passed | Failed | Skipped | Notes |

## Manual must-checks
| Check | Result | Evidence |

## Open bugs
| ID/link | Severity | Area | Blocks release? |

## Not tested / risks accepted
```

Rules:
- No-go if there is any Critical or High bug in the golden path, scoring, auth, assets or
  data loss.
- A "go with known issues" verdict must list each accepted issue and who accepted it.
- The QA engineer and team lead make the final call. You recommend.

Give the user the file path and a 3-line summary.
