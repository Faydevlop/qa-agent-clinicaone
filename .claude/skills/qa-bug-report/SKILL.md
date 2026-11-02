---
name: qa-bug-report
description: Write a reproducible ClinicaOne bug report with environment, build commits, exact steps, expected vs actual, severity, owner (frontend/backend/AI/case author) and evidence (trace, GIF, socket events, network). Use when a confirmed product or case issue needs filing, or the user says "write up this bug", "log a bug".
---

# Bug report

Only file after `qa-triage` classifies the issue as a product bug or a case authoring issue.
Save each report as `reports/bugs/<YYYY-MM-DD>-<short-slug>.md` and give the user the path.
They paste it into the tracker. Don't post anywhere yourself.

## Template

```markdown
# <Area>: <what is wrong, in user terms>

**Env:** <test> (https://test.clinicaone.app) · **FE:** <commit> (<version>) · **BE:** <commit> · **AI:** <commit if relevant>
**Account/role:** learner (QA account) · **Browser/device:** Chrome 1xx, 1920×1080 · **Case:** <title> (id <id> on this env)
**Severity:** Critical | High | Medium | Low · **Owner:** frontend | backend | AI | case author
**Catalog ID:** <SE-03> · **Frequency:** 3/3 | intermittent (2/5)

## Steps
1. Log in, open Case Library, start "<title>"
2. …

## Expected
<what should happen, citing the rule: docs/app-map.md §5, case spec, Case Builder graph>

## Actual
<what happened, quoting the server payload or the UI text>

## Evidence
- Trace: test-results/<…>/trace.zip
- Video/GIF: <path>
- Socket events (excerpt):
  ```json
  {"event":"action-result","data":{"classification":"wrong_state","actionId":"…","scoreDelta":-20}}
  ```
- Network: <METHOD path → status, x-correlation-id if present>
- Console: <error line>

## Notes
<regression? first seen in build X; workaround; related bugs>
```

## Severity guide (ClinicaOne-specific)

| Severity | Examples |
|---|---|
| **Critical** | Can't log in; can't start any case; simulation crashes or blanks; scores saved wrong for everyone; security exposure of other learners' data |
| **High** | Golden path broken for one case; deterioration or timer doesn't fire; wrong score or outcome; report doesn't open; AI patient states clinically wrong facts or reveals it's an AI; assets missing in a key state |
| **Medium** | Animation shows the wrong state briefly; notification in the wrong tab; layout overlap at a common resolution; lab result late beyond its due time |
| **Low** | Copy or typo; minor visual misalignment; tone of AI replies |

## Owner hints

- Wrong classification, score, timer or state in socket payloads: **backend**, or the **case
  author** if the graph itself is wrong. Compare against Case Builder.
- Payload correct but the screen differs: **frontend**.
- Reply content, guardrails, voice pipeline, feedback narrative: **AI**.
- 502/504 or deploy issues: **backend/devops**. Note the time window.

Security findings: mark them **Confidential**, and send them only to the team lead.
