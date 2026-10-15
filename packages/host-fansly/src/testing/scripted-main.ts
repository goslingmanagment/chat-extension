// A scripted MAIN for the isolated side's DOM tests (test-only; nothing that
// ships imports it): its answers by request type — none is `not-ready`, as a
// MAIN before P7b says —, its events checked by Fansly's own schemas
// (validate.ts) the way the bridge client checks them.

import type { FanslyState, FromMainFansly as FanslyBatchEvent } from '@cg/contracts/bridge-messages-fansly';
import { fanslyIdentityWire, probe as PROBE } from '@cg/contracts/fixtures';

import { BridgeCallError, type FanslyBridgeEvent, type FanslyMainBridgeClient } from '../isolated/bridge-client';
import { parseEvent } from '../isolated/validate';

/** The fixtures' snapshot names this document epoch. */
export const EPOCH = 'doc1';

/** MAIN before the page named its creator. */
export const NO_ONE: FanslyState = {
  identity: { ...fanslyIdentityWire, creatorId: null, accountMeSeen: false },
  socket: { epoch: 0, confirmed: false },
  chat: null,
  contract: { anchors: { accountMe: 'notYet', socket: 'notYet', frames: 'notYet', xhr: 'notYet' }, tap: 'ok' },
  lastBatch: 0,
};

export type Answer = (payload: never) => unknown;

/** A MAIN the test scripts: its answers by request type (none — `not-ready`, as a MAIN before P7b says), its events through Fansly's schemas. */
export function scriptedMain(script: Partial<Record<string, Answer>>) {
  const listeners = new Set<(event: FanslyBridgeEvent) => void>();
  const calls: Array<{ readonly t: string; readonly payload: unknown }> = [];
  const client = {
    documentEpoch: EPOCH,
    probe: () => Promise.resolve(PROBE),
    request(t: string, payload: unknown) {
      calls.push({ t, payload });
      const answer = script[t];
      if (answer === undefined) return Promise.reject(new BridgeCallError('not-ready', t));
      try {
        return Promise.resolve(answer(payload as never));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    onEvent(listener: (event: FanslyBridgeEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats: () => ({ rejected: {}, invalidAnswers: 0, invalidEvents: 0, stale: 0, late: 0, timeouts: 0, coalesced: 0 }),
    close: () => listeners.clear(),
  } as unknown as FanslyMainBridgeClient;
  /** Delivers a wire event as the client would after its checks: what Fansly's schemas make of it. */
  const deliver = (t: 'fx.batch' | 'fx.gap' | 'fault', payload: unknown): void => {
    const parsed = parseEvent(t, payload);
    if (parsed === null) throw new Error(`the client would drop this ${t}`);
    for (const listener of [...listeners]) listener({ t, payload: parsed } as FanslyBridgeEvent);
  };
  return {
    client,
    calls,
    /** The requests of a type, their payloads. */
    asked: (t: string): unknown[] => calls.filter((call) => call.t === t).map((call) => call.payload),
    batch: (n: number, ...events: FanslyBatchEvent[]): void => deliver('fx.batch', { n, events }),
    /** A batch the schemas refuse: only its number goes on (validate.ts). */
    refused: (n: number): void => deliver('fx.batch', { n, events: [{ t: 'fx.identity', p: { creatorId: 'not-an-id' } }] }),
    gap: (): void => deliver('fx.gap', { reason: 'overflow' }),
    fault: (source: string, count: number): void => deliver('fault', { source, count }),
  };
}
