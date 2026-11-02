---
name: qa-setup
description: Set up the ClinicaOne QA agent for an environment from just a link (dev/test/uat.clinicaone.app or any URL) — resolve API/socket URLs, create .env for a role (learner today), verify login without exposing secrets, install Playwright. Use when the user gives a new link, says "set up", "log in", "credentials", "switch to uat", or adds a new role.
---

# QA setup from a link

Goal: the user says "test https://uat.clinicaone.app", and two minutes later every suite can
log in there as the right role.

## 0. No copy yet? Use the repo link

If this folder isn't on the computer yet, the agent comes from https://github.com/Faydevlop/qa-agent-clinicaone.git. Clone it, or
use **Code → Download ZIP** when git or command permission isn't available (README section 0).
If a command below is blocked by permissions, give the user the exact command to run in their
terminal and continue from the output they paste back (see CLAUDE.md, "When a command is
blocked").

## 1. Dependencies (first time only)

```
npm run setup        # npm install + Playwright Chromium
```

## 2. Resolve the link

```
npm run env:resolve -- <link>
```

- Known envs map automatically. For any other `<sub>.clinicaone.app` link the API is assumed
  to be `<sub>-backend.clinicaone.app/api/v1`.
- If the env is preprod/prod, or the resolver can't derive a URL, ask the user for the API URL
  (a frontend developer can read it from Amplify's `EXPO_PUBLIC_API_BASE_URL`). Then set
  `QA_WEB_URL` and `QA_API_URL`.
- To discover it yourself: open the site in the browser, read the network tab, and find the
  first request to `/api/v1/…`.

## 3. Create or update `.env`, without touching secrets

You cannot read `.env`, and that is intended.

- If it doesn't exist, copy `.env.example` to `.env`:
  - PowerShell: `Copy-Item .env.example .env`
  - bash: `cp .env.example .env`
- Ask the user to open `.env` and fill in:
  - `QA_TARGET=<env or link>`
  - `LEARNER_EMAIL` and `LEARNER_PASSWORD`, or env-specific values such as
    `UAT_LEARNER_EMAIL` and `UAT_LEARNER_PASSWORD`. Those win for that env, which is how one
    file holds a different account per env.
- Never ask for the password in chat. If they paste one anyway, don't repeat it, and suggest
  they rotate it.
- To switch env for a single run, pass `QA_TARGET` instead of editing:
  - PowerShell: `$env:QA_TARGET='uat'; npm run test:smoke`
  - bash: `QA_TARGET=uat npm run test:smoke`

## 4. Verify

```
npm run env:check -- <link>
```

It checks health and version reachability, that credentials are present (email masked), a
real login, `/auth/profile`, the published case list, and whether a refresh cookie was
issued.

| Symptom | Meaning / fix |
|---|---|
| `Login failed (401)` | Wrong credentials, or the account isn't onboarded (no name/password). Don't retry more than twice: 5 failures lock the account. |
| `429 … retry after Ns` | Auth rate limit (10 per 15 min per IP, shared by the whole office NAT) or lockout. Wait. |
| `unreachable: ECONNRESET / TLS` | VPN, proxy or Windows schannel quirk. Try the link in a browser. Node fetch usually works when curl doesn't. |
| `0 published cases` | Nothing has been published from that env's Case Builder yet. Engine and E2E suites will skip. |
| `no refresh cookie` | Note it: sessions longer than 15 min will drop. This is a finding, not a setup failure. |

## 5. Getting a learner account (if the QA has none on that env)

- **Self-serve:** `/redeem` with the shared redeem code (from the team vault), then `/signup`.
- **Or:** ask the backend developer to seed one.
- Use a dedicated QA account per env. Never use a real learner's account.

## Adding a new role (e.g. admin, instructor)

1. Add the role name to `ROLES` in `lib/env.mjs`.
2. Add `<ROLE>_EMAIL` / `<ROLE>_PASSWORD` lines (and env-prefixed variants) to `.env.example`.
3. Use it in tests with `Api.as('<role>')` / `getSession('<role>')`. For UI tests, add a
   fixture like `learnerPage` in `tests/support/fixtures.ts`.
4. Document the role's routes and permissions in `docs/app-map.md` §2.

Done when `env:check` is all ✔ and `npm run test:smoke` passes.
