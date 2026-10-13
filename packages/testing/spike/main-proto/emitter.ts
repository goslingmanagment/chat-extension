// fx.batch with credits (architecture §6): the events of one listener call go out in one `post`; states
// (fx.identity, fx.chat, fx.contract) coalesce by type; at most 8 unacknowledged batches and 256 KiB in flight;
// the waiting queue is part of the memory account; overflow → one fx.gap and nothing more until fx.state.

type Plain = Record<string, unknown>;

export interface Emitter {
  event(t: string, payload: Plain, bytes: number): void;
  state(t: string, payload: Plain): void;
  /** End of a listener call: send what it produced (≤ 1 post). */
  flush(): void;
  ack(n: number): void;
  resync(): void;
  bytesHeld(): number;
  stats(): { batches: number; events: number; gaps: number; held: number; inFlight: number };
}

const MAX_UNACKED = 8;
const MAX_IN_FLIGHT_BYTES = 256 * 1024;
const MAX_QUEUE_BYTES = 512 * 1024;
const STATES = ['fx.identity', 'fx.chat', 'fx.contract'];

export function createEmitter(post: (t: string, payload: Plain) => void, connected: () => boolean): Emitter {
  let pending: Array<[string, Plain, number]> = [];
  let queue: Array<[string, Plain, number]> = [];
  let queueBytes = 0;
  const states: Record<string, Plain> = {};
  const unacked = new Map<number, number>();
  let inFlightBytes = 0;
  let n = 0;
  let gapped = false;
  let batches = 0;
  let events = 0;
  let gaps = 0;

  const pump = (): void => {
    if (!connected() || gapped) return;
    const stateKeys = Object.keys(states);
    while ((queue.length || stateKeys.length) && unacked.size < MAX_UNACKED && inFlightBytes < MAX_IN_FLIGHT_BYTES) {
      const out: Array<[string, Plain]> = [];
      let bytes = 0;
      for (const key of stateKeys.splice(0)) {
        out.push([key, states[key] as Plain]);
        delete states[key];
        bytes += 64;
      }
      while (queue.length && bytes < 64 * 1024) {
        const [t, p, b] = queue.shift() as [string, Plain, number];
        queueBytes -= b;
        bytes += b;
        out.push([t, p]);
      }
      const id = (n += 1);
      unacked.set(id, bytes);
      inFlightBytes += bytes;
      batches += 1;
      events += out.length;
      post('fx.batch', { n: id, events: out.map(([t, p]) => ({ t, p })) });
    }
  };

  return {
    event(t, payload, bytes) {
      if (gapped) return;
      pending.push([t, payload, bytes]);
    },
    state(t, payload) {
      if (STATES.includes(t)) states[t] = payload;
    },
    flush() {
      if (pending.length) {
        for (const item of pending) {
          queue.push(item);
          queueBytes += item[2];
        }
        pending = [];
      }
      if (queueBytes > MAX_QUEUE_BYTES && !gapped) {
        queue = [];
        queueBytes = 0;
        gapped = true;
        gaps += 1;
        if (connected()) post('fx.gap', { reason: 'overflow' });
        return;
      }
      pump();
    },
    ack(id) {
      const bytes = unacked.get(id);
      if (bytes === undefined) return;
      unacked.delete(id);
      inFlightBytes -= bytes;
      pump();
    },
    resync() {
      gapped = false;
      pump();
    },
    bytesHeld: () => queueBytes + inFlightBytes,
    stats: () => ({ batches, events, gaps, held: queueBytes + inFlightBytes, inFlight: unacked.size }),
  };
}
