// Socket.IO driver for a live simulation session. The REST perform-action route is retired,
// so actions, skips and hand-off can only be driven over the socket at /api/v1/websocket.
// Every received event is recorded with a timestamp so tests can assert ordering and timing.
import { io } from 'socket.io-client';
import { resolveEnv } from './env.mjs';

export const SERVER_EVENTS = [
  'session-state', 'vitals-update', 'timer-update', 'action-pending', 'action-result',
  'time-skipped', 'idle-warning', 'idle-cleared', 'session-ended', 'error',
];

export class SimSession {
  constructor({ sessionId, token, env = resolveEnv() }) {
    this.sessionId = sessionId;
    this.token = token;
    this.env = env;
    /** @type {{event:string, at:number, data:any}[]} */
    this.events = [];
    this.waiters = [];
    this.state = null; // latest session-state snapshot
  }

  async connect({ timeoutMs = 20000 } = {}) {
    this.socket = io(this.env.socketUrl, {
      path: this.env.socketPath,
      auth: { token: this.token },
      transports: ['websocket'],
      reconnection: false,
    });
    for (const ev of SERVER_EVENTS) {
      this.socket.on(ev, (data) => this.#record(ev, data));
    }
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Socket connect timeout (${this.env.socketUrl}${this.env.socketPath})`)), timeoutMs);
      this.socket.once('connect', () => { clearTimeout(t); resolve(); });
      this.socket.once('connect_error', (e) => { clearTimeout(t); reject(new Error(`Socket connect_error: ${e.message}`)); });
    });
    this.socket.emit('join-session', { sessionId: this.sessionId });
    await this.waitFor('session-state', null, { timeoutMs });
    return this;
  }

  #record(event, data) {
    const entry = { event, at: Date.now(), data };
    this.events.push(entry);
    if (event === 'session-state') this.state = data;
    this.waiters = this.waiters.filter((w) => {
      if (w.event === event && (!w.pred || w.pred(data)) && entry.at >= w.since) {
        w.resolve(data);
        return false;
      }
      return true;
    });
  }

  /**
   * Resolves with the first matching event at/after `since` (default: now).
   * @param {string} event
   * @param {((d: any) => boolean) | null} [pred]
   * @param {{ timeoutMs?: number, since?: number, includePast?: boolean }} [opts]
   * @returns {Promise<any>}
   */
  waitFor(event, pred = null, { timeoutMs = 30000, since = Date.now() - 1, includePast = true } = {}) {
    if (includePast) {
      const past = this.events.find((e) => e.event === event && e.at >= since && (!pred || pred(e.data)));
      if (past) return Promise.resolve(past.data);
    }
    return new Promise((resolve, reject) => {
      const w = { event, pred, since, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${event}" (session ${this.sessionId}). Last events: ${this.tail(5)}`));
      }, timeoutMs);
    });
  }

  tail(n = 10) {
    return this.events.slice(-n).map((e) => e.event).join(', ');
  }

  eventsOf(name) {
    return this.events.filter((e) => e.event === name);
  }

  /**
   * Performs an action and resolves with { result } (action-result), { pending } (lab queued)
   * or { error } (server refused within 5 s — e.g. missing lab panels).
   * @param {string} actionId
   * @param {{ selectedLabPanels?: string[], selectedExamSystems?: string[], timeoutMs?: number }} [opts]
   * @returns {Promise<{ result?: any, pending?: any, error?: any }>}
   */
  async perform(actionId, { selectedLabPanels, selectedExamSystems, timeoutMs = 30000 } = {}) {
    const since = Date.now();
    this.socket.emit('perform-action', { sessionId: this.sessionId, actionId, selectedLabPanels, selectedExamSystems });
    const mine = (d) => d?.actionId === actionId;
    return Promise.race([
      this.waitFor('action-result', mine, { since, timeoutMs, includePast: false }).then((result) => ({ result })),
      this.waitFor('action-pending', mine, { since, timeoutMs, includePast: false }).then((pending) => ({ pending })),
      this.waitFor('error', null, { since, timeoutMs: 5000, includePast: false })
        .then((error) => ({ error }))
        .catch(() => new Promise(() => {})), // no error within 5 s → let the other branches win
    ]);
  }

  /**
   * @param {number} minutes
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<{ skipped?: any, error?: any }>}
   */
  async skipTime(minutes, { timeoutMs = 30000 } = {}) {
    const since = Date.now();
    this.socket.emit('skip-time', { sessionId: this.sessionId, minutes });
    return Promise.race([
      this.waitFor('time-skipped', null, { since, timeoutMs, includePast: false }).then((skipped) => ({ skipped })),
      this.waitFor('error', null, { since, timeoutMs, includePast: false }).then((error) => ({ error })),
    ]);
  }

  async skipLabWait(reportId, { timeoutMs = 30000 } = {}) {
    const since = Date.now();
    this.socket.emit('skip-lab-wait', { sessionId: this.sessionId, reportId });
    return this.waitFor('time-skipped', (d) => d?.reportId === reportId, { since, timeoutMs, includePast: false });
  }

  async handoff(endOptionId, { timeoutMs = 30000 } = {}) {
    const since = Date.now();
    this.socket.emit('end-session', { sessionId: this.sessionId, ...(endOptionId ? { endOptionId } : {}) });
    return this.waitFor('session-ended', null, { since, timeoutMs, includePast: false });
  }

  activity() {
    this.socket.emit('learner-activity', { sessionId: this.sessionId });
  }

  close() {
    this.socket?.close();
  }
}
