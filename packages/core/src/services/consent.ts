// Firefox's `technicalAndInteraction` data-collection consent, as the
// background services see it (architecture.md §9.6 «Согласие»): telemetry
// (R18) asks `granted()` before anything leaves the browser and listens for
// a revoke to stop at once and drop its pending queue of that class.
//
// Fails closed: until the first check answers, and whenever a check fails,
// consent counts as not granted (`granted()` false, status `unknown`). But a
// failed check is not the person revoking: listeners hear only definite
// answers — a browser event, or a check that succeeded — so a one-off
// browser error never makes telemetry drop its queue (§9.6). A change the
// browser reports (our page, about:addons) wins over a check that was
// already under way.

import { NO_LOG, type ConsentPortLike, type ServiceLog } from './storage/ports';

export type ConsentStatus = 'unknown' | 'granted' | 'denied';

export interface ConsentState {
  /** First check; the readiness barrier runs it. */
  start(): Promise<boolean>;
  /** Asks the browser again (the options page «Статус», after a request). */
  refresh(): Promise<boolean>;
  /** Gate for sending: true only when the browser said yes and nothing since made it unknown. */
  granted(): boolean;
  /** `unknown` before the first answer and after a failed check. */
  status(): ConsentStatus;
  /** Every change of a definite answer; a revoke is `false`. A failed check is not announced. */
  onChange(listener: (granted: boolean) => void): () => void;
  dispose(): void;
}

export interface ConsentDeps {
  readonly port: ConsentPortLike;
  readonly log?: ServiceLog;
}

export function createConsentState(deps: ConsentDeps): ConsentState {
  const log = deps.log ?? NO_LOG;
  const listeners = new Set<(granted: boolean) => void>();
  let status: ConsentStatus = 'unknown';
  /** The last definite answer the listeners heard (they start from "not granted"). */
  let announced = false;
  /** Bumped by every browser event: a check older than an event does not overwrite it. */
  let version = 0;
  let started: Promise<boolean> | null = null;

  const settle = (next: boolean, source: 'check' | 'event'): void => {
    status = next ? 'granted' : 'denied';
    if (next === announced) return;
    announced = next;
    log({ level: 'info', scope: 'bg.consent', msg: next ? 'technical data consent granted' : 'technical data consent revoked', fields: { source } });
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // a listener's bug is not the consent's
      }
    }
  };

  const unsubscribe = deps.port.onChange((next) => {
    version += 1;
    settle(next, 'event');
  });

  async function check(): Promise<boolean> {
    const before = version;
    let answer: boolean | null;
    try {
      answer = await deps.port.check();
    } catch {
      answer = null;
    }
    if (version !== before) return status === 'granted';
    if (answer === null) {
      // Not sending until known — but nothing is announced: a failed check is not a revoke.
      if (status !== 'unknown') log({ level: 'warn', scope: 'bg.consent', msg: 'technical data consent check failed: not sending until known' });
      status = 'unknown';
    } else settle(answer, 'check');
    return status === 'granted';
  }

  return {
    start: () => (started ??= check()),
    refresh: check,
    granted: () => status === 'granted',
    status: () => status,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribe();
      listeners.clear();
    },
  };
}
