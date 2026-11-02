# Environments and release flow

Source: backend `docs/workflow.md` and `docs/deployment.md`, frontend `docs/deployment.md`,
AI service `scripts/environments.sh` and `.github/workflows/deploy-*.yml`. Checked against
the dev branches on 2026-11-01.

## Environment map

| Env | Frontend | API (gateway) | Branch (FE + BE) | Case Builder branch | AI voice agent |
|---|---|---|---|---|---|
| dev | https://dev.clinicaone.app | https://dev-backend.clinicaone.app/api/v1 | `dev` | `main` (not `dev`) | clinicaone-ai-service-dev (cold start) |
| test | https://test.clinicaone.app | https://test-backend.clinicaone.app/api/v1 | `testing` | `testing` | clinicaone-ai-service-test (cold start) |
| uat | https://uat.clinicaone.app | https://uat-backend.clinicaone.app/api/v1 | `uat` | `uat` | clinicaone-ai-service-uat (warm) |
| preprod | not documented | not documented | `pre-prod` (BE, us-east-1) | – | clinicaone-ai-service-preprod (warm) |
| prod | not documented | not documented | `main` (no deploy workflow yet) | – | – |

- Socket.IO: same host as the API, path `/api/v1/websocket`, `auth: { token }`.
- Case Builder for test: https://test-builder.clinicaone.app.
- UAT hides the AI feedback button, because `EXPO_PUBLIC_SHOW_AI_FEEDBACK` falls back to the
  hostname. Seeing it missing on UAT is expected.
- dev and test voice agents scale to zero. The first voice call can take up to ~85 s.

## How a change reaches each environment

```
feature/* | fix/* | bugfix/<date>   (branched from dev)
        │  PR + review → merge
        ▼
      dev ──push──► deploys dev        (backend: GitHub Actions → SSH to EC2 → git reset → npm ci/build → systemctl restart)
        │                              (frontend: AWS Amplify builds the branch → dist/ + version.json)
        │  whole dev merged
        ▼
    testing ──push──► deploys test     ← QA's main functional pass
        │  whole dev merged
        ▼
      uat ──push──► deploys uat        ← stakeholder / acceptance pass
        ▼
    pre-prod ──push──► deploys preprod (backend + AI only so far)
        ▼
      main  (prod, no automation yet)
```

- Every push to an environment branch deploys automatically. Nothing promotes on its own.
- Backend CI runs lint, build and Jest unit tests before deploying. Amplify (frontend) runs no
  lint or tests, so a broken frontend build is only caught by QA.
- Cases don't travel with code. A case reaches an environment only when someone publishes it
  from that environment's Case Builder, so case ids and versions differ per environment.
  Always look cases up by title.

## Which build is deployed?

| Component | Endpoint | Fields |
|---|---|---|
| Frontend | `GET https://<env>.clinicaone.app/version.json` | version (1.0.<commitCount>), commit, commitFull, branch (Amplify reports `HEAD`), builtAt |
| Gateway | `GET https://<env>-backend.clinicaone.app/version` | version, commit, commitFull, branch, startedAt |
| Content service | `GET https://<env>-backend.clinicaone.app/internal-content/version` | same |
| Health | `GET /health` (gateway), `/internal-content/health` | `{"status":"ok"}` |

`npm run versions` prints all of these. Set `CLINICAONE_REPOS_DIR` and it also compares
against each branch head.

**Rule:** before reopening or filing a bug, confirm the build contains the fix commit.
Put the frontend and backend commits in every bug report.

Snapshot taken 2026-11-01 (it will drift):
- Gateway: dev `dba381c` (dev), test `baab7ed` (testing), uat `84e1af5` (uat).
- Frontend: test `8da1070`, uat `a60ec57`.

## QA gates per environment

| Gate | dev | test | uat | preprod/prod |
|---|---|---|---|---|
| Smoke (`test:smoke`) after every deploy | ✔ | ✔ | ✔ | ✔ (read-only) |
| API + engine | ✔ | ✔ full | ✔ | read-only subset |
| E2E journey | spot | ✔ full | ✔ golden paths | prod: read-only only |
| AI suite (`QA_ENABLE_AI=1`) | on AI changes | ✔ | ✔ | ✗ |
| Security probes | ✔ | ✔ | only with team lead OK | ✗ |
| Exploratory + release checklist | – | ✔ | ✔ sign-off | – |
