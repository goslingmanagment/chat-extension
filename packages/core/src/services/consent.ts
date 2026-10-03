// Firefox's `technicalAndInteraction` data-collection consent, as the
// background services see it (architecture.md §9.6 «Согласие»): telemetry
// (R18) asks `granted()` before anything leaves the browser and listens for
// a revoke to stop at once and drop its pending queue of that class.
//
// Fails closed: until the first check answers, and whenever a check fails,
// consent counts as not granted. A change the browser reports (our page,
// about:addons) wins over a check that was already under way.

import { NO_LOG, type ConsentPortLike, type ServiceLog } from './storage/ports';

export interface ConsentState {
  /** First check; the readiness barrier runs it. */
  start(): Promise<boolean>;
  /** Asks the browser again (the options page «Статус», after a request). */
  refresh(): Promise<boolean>;
  granted(): boolean;
  /** Every change of the answer; a revoke is `false`. */
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
  let granted = false;
  /** Bumped by every browser event: a check older than an event does not overwrite it. */
  let version = 0;
  let started: Promise<boolean> | null = null;

  const set = (next: boolean, source: 'check' | 'event'): void => {
    if (next === granted) return;
    granted = next;
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
    set(next, 'event');
  });

  async function check(): Promise<boolean> {
    const before = version;
    let answer: boolean;
    try {
      answer = (await deps.port.granted()) === true;
    } catch {
      answer = false;
    }
    if (version === before) set(answer, 'check');
    return granted;
  }

  return {
    start: () => (started ??= check()),
    refresh: check,
    granted: () => granted,
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
