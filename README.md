# ClinicaOne QA Agent: user guide

This folder turns Claude Code into a QA partner for ClinicaOne. You tell Claude what to test
in plain English ("check the Pneumothorax case on test"). It asks a few questions, runs the
automated tests against the live website, explains the results, and remembers what you teach
it about each case.

You don't need to write code. You need two things: opening a terminal, and talking to Claude
Code.

---

## Contents

0. [Get the QA agent from the GitHub link](#0-get-the-qa-agent-from-the-github-link)
1. [One-time setup](#1-one-time-setup)
2. [Every day: two ways to run tests](#2-every-day-two-ways-to-run-tests)
3. [Recipes: "I want to…"](#3-recipes-i-want-to)
4. [Testing a specific case](#4-testing-a-specific-case)
5. [Teaching Claude about a case (saved checks)](#5-teaching-claude-about-a-case-saved-checks)
6. [Reading the results](#6-reading-the-results)
7. [Costs, limits and safety rules](#7-costs-limits-and-safety-rules)
8. [Troubleshooting](#8-troubleshooting)
9. [Reference (for technical readers)](#9-reference-for-technical-readers)

---

## 0. Get the QA agent from the GitHub link

The QA agent lives here: **https://github.com/Faydevlop/qa-agent-clinicaone**

You only do this once per computer. Pick whichever works for you.

### Option A: Let Claude do it

Open Command Prompt in the folder where you keep your work (for example `Documents`), type
`claude`, and paste this message:

```
Set up the ClinicaOne QA agent from https://github.com/Faydevlop/qa-agent-clinicaone.git
Clone it, open the qa-agent folder, follow its README and CLAUDE.md, and walk me through the rest.
```

Claude may ask "Allow this command?" for `git clone` and `npm run setup`. Choose **Yes**.

### Option B: Do it yourself (when Claude isn't allowed to run commands)

Sometimes Claude can't run commands on your computer. It says "permission denied", or it keeps
asking you to run things yourself, or your Claude account has no Claude Code access. That's fine:
the link still works without Claude.

1. Get the files, either way:
   - **With git:** in Command Prompt, run
     ```
     git clone https://github.com/Faydevlop/qa-agent-clinicaone.git qa-agent
     ```
   - **Without git:** open https://github.com/Faydevlop/qa-agent-clinicaone in your browser, click the green **Code** button →
     **Download ZIP**, and extract it. Rename the extracted folder to `qa-agent` if you like.
2. Continue with [One-time setup](#1-one-time-setup) below, from **Step 2**.
3. If Claude still can't run commands later, use
   [Way B: the menu yourself](#way-b-use-the-menu-yourself-no-claude-needed). It does the same
   tests without Claude.

> **"Repository not found" or a GitHub sign-in prompt?** The repository is private. Ask the team
> lead to add your GitHub account as a collaborator, accept the invite email, then try again.

### Getting updates later

- Cloned with git: run `git pull` inside the `qa-agent` folder.
- Downloaded the ZIP: download it again and copy your `.env` file and your `cases` folder into
  the new folder, so your login and saved checks come with you.

---

## 1. One-time setup

Do this once per computer. It takes about 10 minutes.

### Step 1: Check the tools are installed

Open **Command Prompt** (press Windows key, type `cmd`, press Enter) and type:

```
node -v
claude --version
```

You should see two version numbers. If `node` is missing, install Node.js LTS from
https://nodejs.org. If `claude` is missing, ask the team lead.

### Step 2: Open a terminal in this folder

1. In File Explorer, open the `qa-agent` folder.
2. Click the address bar at the top.
3. Type `cmd` and press Enter.

A Command Prompt opens already inside the folder. **Every command in this guide is typed
here.**

### Step 3: Install

```
npm run setup
```

Wait until it finishes (2–5 minutes the first time).

### Step 4: Add your login details

```
copy .env.example .env
notepad .env
```

Notepad opens. Fill in these two lines with the **learner test account** for the
environments you test, then save and close:

```
LEARNER_EMAIL=your-test-learner@example.com
LEARNER_PASSWORD=the-password
```

> 🔒 **Only ever type passwords into this file, never into the Claude chat.** Claude is
> blocked from reading `.env`, so the password never leaves your computer.
>
> If dev, test and uat use different accounts, fill `DEV_LEARNER_EMAIL`,
> `TEST_LEARNER_EMAIL` and so on instead. The file explains each line.

### Step 5: Check everything works

```
npm run qa -- doctor test
```

Every line should start with ✔. If you see ✘, read the message or go to
[Troubleshooting](#8-troubleshooting).

### Step 6: Start Claude

```
claude
```

Setup is done. From now on you start with Step 2 (open the terminal here), then `claude`.

---

## 2. Every day: two ways to run tests

### Way A: Ask Claude (recommended)

Type `/qa`, or just say what you want. Claude asks only what it doesn't already know, using
clickable options:

```
You:    /qa

Claude: Which environment should I test?          ○ dev  ● test  ○ uat  ○ Other (paste a link)
        Run with login or without?                ● With login (full coverage)
                                                  ○ Without login (public checks only)
        What should I test?                       ○ Health check after a deploy (~10 min)
                                                  ● A specific case
                                                  ○ Full regression (~35 min)
                                                  ○ Let me pick suites
Claude: Which cases?                              ☑ Pneumothorax  (3 saved checks, passed 2026-11-01)
                                                  ☐ Sepsis        (nothing saved yet)
        How deep?                                 ● Quick  ○ Full (also plays it in the browser)
        Include the AI patient tests? (paid)      ● Off  ○ On, capped at 15 calls

Claude: Running… ✅ Pneumothorax on test: 9 passed, 0 failed.
        Please look at these yourself: 1) O2 mask appears after High-Flow O2 …
```

If you already said it all ("quick test of Pneumothorax on test, no AI"), Claude skips the
questions and runs straight away.

### Way B: Use the menu yourself (no Claude needed)

```
npm run qa
```

Use the arrow keys and Space to choose, Enter to confirm:

```
? Which environment?          dev / test / uat / Paste a link…
? Run with login?             With login / Without login (public checks only)
? What do you want to test?   The whole app / Specific case(s)
? Which cases?                [x] Pneumothorax   3 saved checks · last on test: all passed
? How deep?                   Quick / Full (browser)
? Opt-ins (cost / risk)       [ ] AI patient conversations   PAID: real LLM calls
? Go?                         Run now / Save as preset, then run / Just print the command / Cancel
```

At the end you get a summary on screen and in `reports/summary.md`. To run exactly the same
thing again: `npm run qa -- last`.

---

## 3. Recipes: "I want to…"

| I want to… | Say to Claude | Or type yourself |
|---|---|---|
| Check an environment right after a deploy | "Check test after the deploy" | `npm run qa -- run --env test --preset after-deploy` |
| Check quickly **without** a password | "Smoke test uat without login" | `npm run qa -- run --env uat --preset public-quick` |
| Test **one case** quickly | "Test the Pneumothorax case on test" | `npm run qa -- case "Pneumothorax" --env test` |
| Test a case fully, including animations and the report | "Fully test Pneumothorax on test, in the browser" | `npm run qa -- case "Pneumothorax" --env test --full` |
| Test several cases | "Test Pneumothorax and Sepsis on uat" | `npm run qa -- case "Pneumothorax" "Sepsis" --env uat` |
| See which cases exist and what's saved for them | "Which cases are on test?" | `npm run qa -- cases --env test` |
| Make Claude **remember** a check for a case | "For Pneumothorax, remember: if untreated for 10 min, SpO2 must drop below 90" | (Claude only, see section 5) |
| Run everything before a release | "Is uat ready to sign off?" | `npm run qa -- run --env uat --preset release-signoff` |
| Test the AI patient (costs money) | "Check the AI patient on test, max 10 calls" | `npm run qa -- run --env test --suites api --grep @ai --ai --ai-max 10` |
| Repeat the last run | "Run the same again" | `npm run qa -- last` |
| Understand a failure | "Why did the deterioration test fail?" | |
| Write up a bug | "Write up that bug" | |
| Explore by hand with Claude watching | "Explore the Sepsis simulation with me in Chrome" | |
| See the full report with screenshots and videos | | `npm run report` |

---

## 4. Testing a specific case

You can test **any** published case, even one nobody has written tests for. Pick it in the
menu, or name it to Claude.

### What "Quick" checks (about 2–4 minutes per case)

- The case's details, actions, scenes and evidence PDFs exist, and **every image, video and
  sound loads**.
- On arrival:
  - vitals are realistic
  - there are actions to take
  - a scene exists for the starting state
  - the clock runs
- **Left untreated, the patient changes** (usually deteriorates), and every state the patient
  reaches has a scene. A missing scene means an animation mismatch.
- A wrong or unrelated action **never earns points**.
- Ending the case immediately does **not** pass, and the score is stored consistently.
- Plus every **saved check** for that case (see section 5).

### What "Full" adds (about 6–10 minutes per case)

The case is played in a real browser:
- the loading screen loads every asset
- the scene shown matches the patient's current state
- the timer and vitals move
- the right actions are clicked one by one (if a correct sequence of actions, the "golden
  path", is saved for the case)
- the end-of-case report shows the same score as the server
- going Back and reloading keep you in the case

### After a case run, Claude also shows

- **"Please look at these yourself":** the case's manual checklist (things only eyes and ears
  can judge).
- **Known issues:** failures that are already reported, marked "known" rather than counted as
  new bugs.

---

## 5. Teaching Claude about a case (saved checks)

When you notice something important about a case, tell Claude to **remember** it. It saves
the check in the case's file, proves it works once, and from then on it runs **every time
that case is tested**, by you or anyone on the team.

### How to ask

Start with the case name, then describe what should happen in normal words:

| Kind | Example of what to say | What Claude does |
|---|---|---|
| **Automatic check** | "For Pneumothorax, remember: if the patient gets nothing for 10 minutes, SpO2 must drop below 90." | Saves a check, runs it once, and tells you if it passed |
| | "For Sepsis, giving fluids before antibiotics should still score." | Same |
| | "For DKA, insulin before potassium must be penalised." | Same |
| **Manual check** (eyes/ears) | "For Pneumothorax, always remind me to check the chest drain animation after the tube thoracostomy." | Adds it to the case's checklist |
| **Known issue** | "Pneumothorax on test: the report shows the wrong outcome. That's bug 123. Remember it." | Records it, so the failure is reported as known |
| **Look it up** | "What do we check for Pneumothorax?" | Lists all saved checks, the checklist, known issues and the last result |
| **Change** | "Change the Pneumothorax SpO2 check to below 88." | Edits that one value and re-proves it |
| **Stop** | "Stop checking the Sepsis fluids rule." | Switches it off (kept for history, not deleted) |

### What happens when you ask

1. If something is unclear (which action exactly? which threshold?), Claude asks you, with
   options taken from the real case.
2. Claude saves the check in `cases/<case-name>.case.json`. You never need to open this file.
3. Claude runs **only that new check** once against the environment.
   - **It passes:** the check is now active.
   - **It fails:** Claude shows you why. You choose whether the expectation was wrong (change
     it), the app is wrong (keep it as a known bug), or to remove it.
4. Claude confirms in one sentence what it saved.

### Tips for good saved checks

- **Say the case name every time.** Checks belong to one case.
- **Use numbers when you have them:** "below 90", "within 10 minutes", "−20 points".
- **Say which environment** if a rule only holds on one.
- Anything about **looks, motion or sound** becomes a manual-checklist item. Claude can't hear
  or judge animation automatically.

### Sharing with the team

The saved checks live in the `cases` folder. After saving, tell the team lead "I updated
`cases/pneumothorax.case.json`" (or commit it if you use git), so everyone's Claude knows the
same things.

---

## 6. Reading the results

Claude starts every report with a verdict:

- ✅ **Ready:** everything passed.
- ⚠️ **Issues:** some checks failed; details follow.
- ❌ **Blocked:** the environment is down or login is broken.

| Word | Meaning |
|---|---|
| **passed** | Worked as expected |
| **failed** | Didn't work as expected. Claude says whether it looks like an app bug, a case-content problem, a test problem or an environment problem |
| **skipped** | Deliberately not run, with a reason (for example "AI not enabled" or "read-only environment"). Skipped is **not** the same as passed |
| **flaky** | Failed once, passed on retry. Worth watching |
| **known** | Failed, but it's already in the case's known issues |

Where to look for more:
- `reports/summary.md`: the short written summary of the last run.
- `npm run report`: opens the full report in your browser, with screenshots, videos and a
  step-by-step trace of every failed test.
- The build numbers (web and api) at the top of every summary say exactly which version was
  tested. Always include them in bug reports; Claude does this for you.

---

## 7. Costs, limits and safety rules

| Rule | Why |
|---|---|
| **AI patient tests are off unless you turn them on**, and always have a cap (default 15 calls) | Each patient message is a paid call to an AI service |
| **Don't log in more than about 10 times in 15 minutes** | The server blocks the whole office's internet address for 15 minutes. The tests log in once and reuse it |
| **5 wrong passwords lock the account** | Use `npm run qa -- doctor` to check the password once, not repeated runs |
| **"Create test data" adds practice sessions** to the environment under the test learner | Normal on dev/test. Ask the team lead before heavy runs on uat |
| **Security probes run on dev and test only** | They poke at access rules; findings go privately to the team lead |
| **Production is read-only** | The tests refuse to change anything on prod |
| **Never paste a password into Claude** | Passwords belong only in `.env` |

---

## 8. Troubleshooting

| You see | Do this |
|---|---|
| `No learner credentials for "test"` | Open `.env` (`notepad .env`) and fill `LEARNER_EMAIL` / `LEARNER_PASSWORD` (or `TEST_LEARNER_…`) |
| `401` / "Invalid email or password" | Wrong password in `.env`. Fix it, **then wait**; don't retry many times (5 wrong = locked) |
| `429` / "Too many requests" | The login limit is hit. Wait 15 minutes |
| `ECONNRESET`, `fetch failed`, `ERR_CONNECTION_RESET` | A network problem between your computer and the site. Try again, switch network/VPN, or tell the team lead. It's not an app bug |
| `Could not load the case list` | Login or network problem. Run `npm run qa -- doctor test` |
| `No published case matching "X"` | The case title is different on this environment, or it isn't published there. Run `npm run qa -- cases --env test` to see exact titles |
| Many browser tests fail at once after an app redesign | Buttons or labels probably changed. Tell Claude "the UI changed, fix the selectors" |
| `Not an interactive terminal` | Run `npm run qa` in a normal Command Prompt window, not inside another tool |
| Something else | Copy the message to Claude and ask "what does this mean?" |

---

## 9. Reference (for technical readers)

### What's in the folder

```
qa-agent/
├─ README.md                 # this guide
├─ CLAUDE.md                 # Claude's instructions: rules, workflow, skill index
├─ .claude/
│  ├─ settings.json          # permissions (.env is unreadable by Claude)
│  └─ skills/                # qa (entry: asks, then runs), qa-case-memory (saved checks),
│                            # qa-setup, qa-run, qa-case-test, qa-explore, qa-ai-patient,
│                            # qa-release-check, qa-triage, qa-bug-report, qa-write-test
├─ cli/                      # the qa command: wizard, flags → plan, run, summary
├─ presets/                  # saved run selections
├─ cases/                    # case memory: one file per case (saved checks, checklist, known issues)
├─ docs/                     # app-map, environments-and-release, test-catalog, known-risks
├─ lib/                      # env resolver, cached login, REST client, Socket.IO simulation driver
├─ scripts/                  # env:check, env:resolve, versions, case:discover, case:validate
├─ tests/
│  ├─ smoke/ hardening/ api/ engine/ e2e/ resilience/ perf/
│  └─ support/               # fixtures, selectors, socket recorder, page health
├─ reports/                  # summary.md, HTML/JSON results, bug reports (git-ignored)
└─ .qa/                      # last run + last result per case (this computer only)
```

### The qa command

```
npm run qa                                   # interactive menu
npm run qa -- run  [flags]                   # run without questions
npm run qa -- plan [flags] [--json]          # show what would run + test count; runs nothing
npm run qa -- case "<title>" [...] [flags]   # case focus
npm run qa -- cases [--env e]                # published cases + saved info + last result
npm run qa -- last | summary | doctor <env> | suites | presets
```

| Flag | Meaning |
|---|---|
| `--env dev\|test\|uat\|<link>` | Target environment |
| `--public` / `--login` | Without login (only `@public` tests) / with login |
| `--suites a,b` or `all` | smoke, hardening, api, engine, e2e, resilience, perf, mobile |
| `--preset <name>` | public-quick, after-deploy, full-regression, release-signoff, security-audit |
| `--cases "A,B"` | Without `--suites`: case focus. With `--suites`: whole-app run limited to these case specs |
| `--full` | Case focus: add the browser journey |
| `--ai --ai-max N` | Enable paid AI patient tests, stop at N calls |
| `--no-writes` | Read-only: skip tests that create sessions or quiz attempts |
| `--security`, `--slow`, `--visual` | Security probes (dev/test), 16-min idle test, screenshot comparison |
| `--grep <text>` | Only tests whose name contains the text |
| `--headed`, `--retries N`, `--update-snapshots` | Show the browser, retry failures, refresh visual baselines |

### Other commands

```
npm run env:check -- <link|env>      # .env + login sanity (never prints secrets)
npm run versions -- all              # deployed commits per environment
npm run case:discover -- "<title>" [--live]   # draft a case file from the live API
npm run case:validate [-- <file>]    # check case files for mistakes
npm run report                       # open the HTML report
npx playwright test ...              # raw Playwright (set QA_TARGET and QA_* yourself; see cli/plan.mjs)
```

### Good to know

- **Login budget:** the backend allows 10 login attempts per 15 minutes per IP, and 5 wrong
  passwords lock the account. The suites log in once and reuse the token
  (`.auth/`, git-ignored).
- **Cases differ per environment.** Each environment's Case Builder publishes its own copy, so
  case files reference cases by title, never by id.
- **Every result includes the build commits** (`/version.json`, `/version`). Check them before
  reopening a bug.
- Test IDs and coverage: [docs/test-catalog.md](docs/test-catalog.md). Open findings:
  [docs/known-risks.md](docs/known-risks.md). Case file format: [cases/README.md](cases/README.md).

### Optional third-party skills

These public skills can sit alongside ours. Review a skill's `SKILL.md` before installing it,
because it gives instructions to your agent.

```
npx @qaskills/cli add playwright-e2e        # generic Playwright POM/fixtures guidance
npx @qaskills/cli add playwright-api        # API testing patterns
npx @qaskills/cli add flaky-test-doctor     # flaky-failure classification
npx @qaskills/cli add axe-accessibility     # deeper a11y testing
```

- Catalogue: https://qaskills.sh
- Curated tool list: https://github.com/tugkanboz/awesome-ai-testing (Playwright MCP, Chrome
  DevTools MCP, k6 and Promptfoo are the most relevant)
- `skillfish` (npm) is a skill manager. The `alexbaum-ai/neurm` deep-thinker skill could not
  be found publicly (as of 2026-11-01), so it is not included.

Our own skills take precedence. They encode ClinicaOne-specific facts the generic ones don't
know.
