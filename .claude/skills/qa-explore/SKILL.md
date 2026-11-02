---
name: qa-explore
description: Run a structured exploratory/visual test session of the ClinicaOne learner app in a real browser (Claude in Chrome or Playwright MCP / headed Playwright), watching socket events, network and console alongside the screen — for animation mismatches, scene/asset glitches, timer feel, layout, copy and UX issues automation can't judge. Use for "explore", "look at", "check the animation", "does it feel right", "visual check", "try to break it".
---

# Exploratory session

Exploration finds what scripts can't: wrong animations, janky transitions, confusing copy,
layout breaks, sounds out of sync. Run it as a timeboxed charter, not a wander.

## 1. Charter (agree it with the user in one line)

`Explore <area> on <env> with <case/data> to discover <risk>. Timebox <30–60> min.`

Good charters come from:
- `docs/known-risks.md` → "Recently changed"
- the commits since the last tested build
- areas marked Manual in `docs/test-catalog.md`

## 2. Pick the browser

- **Claude in Chrome** (`mcp__claude-in-chrome__*`): the QA's real Chrome.
  - Load the tools in one ToolSearch call: `tabs_context_mcp`, `tabs_create_mcp`,
    `navigate`, `computer`, `read_page`, `find`, `read_console_messages`,
    `read_network_requests`, `gif_creator`, `javascript_tool`.
  - Open a new tab.
  - Record a GIF (`gif_creator`) for anything you may report.
  - Don't click things that open `alert`/`confirm` dialogs. The simulation's `beforeunload`
    prompt blocks the extension, so leave the simulation with the in-app Leave button, not by
    closing the tab.
- **Headed Playwright** when Chrome isn't connected:
  - `$env:HEADED='1'; npx playwright test -g "<test>" --debug`
  - or write a scratch script that uses the `learnerPage` + `socketLog` fixtures and
    `page.pause()`.

## 3. Watch server truth alongside the screen

Inject this once per page (Chrome `javascript_tool`) to log socket events to the console:

```js
(() => {
  if (window.__qaSock) return 'already';
  const OrigWS = window.WebSocket;
  window.__qaEvents = [];
  window.WebSocket = function (...a) {
    const ws = new OrigWS(...a);
    ws.addEventListener('message', (m) => {
      const s = String(m.data); const i = s.indexOf('[');
      if (s.startsWith('42') && i > 0) { try { const [ev, d] = JSON.parse(s.slice(i)); window.__qaEvents.push({ t: Date.now(), ev, d }); console.log('[qa-socket]', ev, ev === 'session-state' ? d.currentStateName : ev === 'timer-update' ? d.elapsedSeconds : ev === 'action-result' ? `${d.classification} ${d.scoreDelta}` : ''); } catch {} }
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  window.__qaSock = true; return 'hooked';
})();
```

Inject it **before** the simulation page loads. The simulation does a full page load from the
Loading screen, so inject right after it lands and then reload once.

Then read it with `read_console_messages` using pattern `qa-socket`, or
`window.__qaEvents.slice(-20)`.

## 4. Heuristics to apply (pick what fits the charter)

- **State vs scene:** after each action or timer, does the picture match
  `currentStateName`? Does the transition clip match the direction (deterioration vs
  improving)?
- **Timing:**
  - The countdown never jumps backwards.
  - It pauses or hides correctly at the end.
  - Lab countdowns reach 0 and deliver.
  - Skip-time shows only when allowed.
- **Interruptions:**
  - Reload mid-transition.
  - Switch tabs for more than 60 s (the shell reloads on return).
  - Go offline for 10 s and come back (the socket should rejoin).
  - Press Back mid-clip.
  - Double-click Perform.
- **Boundaries:**
  - Order every lab panel.
  - Exam with all 15 systems.
  - 0 panels.
  - Very long notes.
  - Emoji in chat.
  - Rapid actions during a hold clip.
- **Audio:**
  - Mute and volume persist.
  - Beeps follow HR.
  - Alarms stop when the patient stabilises.
  - No sound before the gate.
- **Layout:**
  - 1366×768, 1280×600, a phone in landscape.
  - Zoom to 125%.
  - The HUD panels don't overlap the scene's key area.
- **Copy:** typos, medical terminology consistency, US English, placeholder text left in.
- **Consistency:** the score in the report matches the sum of `action-result.scoreDelta` in
  `__qaEvents`.

## 5. Notes as you go (session sheet)

Keep a running list. For each item record a timestamp, what you did, what you expected, what
happened, and evidence (GIF frame, screenshot, the matching socket event). Classify each as
bug, question or idea.

## 6. Debrief

- Charter outcome.
- Coverage: what was explored, what wasn't.
- Bugs (go through `qa-bug-report`).
- Questions for product or the case author.
- Candidates for automation: add these to `docs/test-catalog.md` as Manual rows, or write
  them with `qa-write-test`.
