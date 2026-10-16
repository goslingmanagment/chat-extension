// The relay frame's lease in a Fansly tab (R20 P9c; docs/project-unite/
// architecture.md §8.5; spec FS-NET-4, FX-001): the background asks the tab to
// raise its frame (`fansly.relay.open`) when it routes a request through it and
// again when it sends one; the tab mounts it (the HostPort's `fansly.relay`)
// and keeps it until 60 s after the last ask — a batch of work and 60 s, not a
// frame for the whole shift as the old extension kept. Early, before any
// application chunk: the background's work (the «Новые» pass, Spenders) may
// route through a tab that shows no chat.

import type { FanslyPagePort } from '@cg/contracts/fansly';

import type { HostDiagnostic, StartedHost } from '../../adapter';

/** How long the frame stays after the background's last ask. */
export const RELAY_HOLD_MS = 60_000;

type Background = NonNullable<StartedHost['background']>;

export interface RelayLeaseOptions {
  readonly holdMs?: number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

const isEmptyObject = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

export function relayTransport(host: Promise<{ readonly fansly: Pick<FanslyPagePort, 'relay'> }>, diagnostic: (event: HostDiagnostic) => void, options: RelayLeaseOptions = {}): Background {
  const holdMs = options.holdMs ?? RELAY_HOLD_MS;
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  return {
    validate(kind, type, payload) {
      if (kind !== 'evt' || type !== 'fansly.relay.open') return null;
      return isEmptyObject(payload) ? { ok: true, payload } : { ok: false };
    },
    connect(rpc, life) {
      void host.then((port) => {
        if (life.aborted) return;
        const relay = port.fansly.relay;
        let lease: unknown = null;
        const release = (): void => {
          if (lease !== null) clearTimer(lease);
          lease = null;
        };
        // The shared client is typed by the shared registry; this event is Fansly's (checked by `validate` above).
        const onEvent = rpc.onEvent.bind(rpc) as unknown as (type: 'fansly.relay.open', listener: () => void) => () => void;
        const off = onEvent('fansly.relay.open', () => {
          release();
          lease = setTimer(() => {
            lease = null;
            relay.close();
          }, holdMs);
          void relay.open().then((state) => {
            if (state === 'failed') diagnostic({ event: 'relay-open', detail: { state } });
          });
        });
        life.addEventListener(
          'abort',
          () => {
            off();
            release();
            relay.close();
          },
          { once: true },
        );
      });
    },
  };
}

/** Two site transports over the one tab RPC: the first that knows a payload checks it. */
export function bothTransports(first: Background, second: Background): Background {
  return {
    validate: (kind, type, payload) => first.validate(kind, type, payload) ?? second.validate(kind, type, payload),
    connect(rpc, life) {
      first.connect(rpc, life);
      second.connect(rpc, life);
    },
  };
}
