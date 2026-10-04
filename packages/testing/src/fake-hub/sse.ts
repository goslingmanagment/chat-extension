// SSE bodies of the fake hub's AI stream (architecture.md §8.4, §12 п. 2):
// frames framed like the hub (`event: ai`, `data: <json>`, blank line), with
// controllable timing (per-frame delays, waits, gates a test releases) and the
// failure shapes of a real connection: a clean EOF before `done`, a frame cut
// in half, a reset connection, a hub that stalls. Each written chunk waits
// until the client has read it, so a frame «after 200 ms» really arrives
// 200 ms after the previous one was read.

import { type HubFrame } from '@cg/contracts';

import { type FakeSseStep, type StreamOutcome } from './types';

/** Waiting points of scripted streams, released by the test (`release`). A released gate stays open until reset. */
export class Gates {
  private readonly released = new Set<string>();
  private readonly waiters = new Map<string, Set<() => void>>();

  wait(name: string, signal: AbortSignal): Promise<void> {
    if (this.released.has(name) || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const set = this.waiters.get(name) ?? new Set<() => void>();
      this.waiters.set(name, set);
      const done = (): void => {
        set.delete(done);
        if (set.size === 0) this.waiters.delete(name);
        resolve();
      };
      set.add(done);
      signal.addEventListener('abort', done, { once: true });
    });
  }

  release(name: string): void {
    this.released.add(name);
    for (const done of [...(this.waiters.get(name) ?? [])]) done();
  }

  /** Gates a stream waits on right now. */
  waiting(): string[] {
    return [...this.waiters.keys()].sort();
  }

  reset(): void {
    this.released.clear();
  }
}

/** One frame as the hub writes it. */
export const sseFrameText = (frame: HubFrame): string => `event: ai\ndata: ${JSON.stringify(frame)}\n\n`;
export const SSE_HEARTBEAT = ': keep-alive\n\n';

export interface SsePlayContext {
  /** The request's signal: the client went away. */
  readonly signal: AbortSignal | null;
  /** The hub's own signal: reset or close ends every open stream like a reset connection. */
  readonly hubSignal: AbortSignal;
  /** Multiplies every delay (0 = none). */
  readonly timeScale: number;
  readonly gates: Gates;
  /** A frame before it is written (the model echoes the request's clientRequestId into `meta`). */
  readonly rewrite?: (frame: HubFrame) => HubFrame;
  readonly onFrame: (frame: HubFrame | null) => void;
  readonly onEnd: (outcome: StreamOutcome) => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

const abortError = (): Error => new DOMException('The client aborted the stream.', 'AbortError');

/** The 200 SSE body of one stream script. */
export function sseBody(steps: readonly FakeSseStep[], ctx: SsePlayContext): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const stop = new AbortController();
  let ended = false;
  /** The terminal frame already written (`done` / `error`): what the stream was, whoever hangs up after it. */
  let terminal: StreamOutcome | null = null;
  const end = (outcome: StreamOutcome): void => {
    if (ended) return;
    ended = true;
    ctx.onEnd(outcome);
  };
  const onClientAbort = (): void => {
    stop.abort();
    // A client that read the terminal frame closes the connection at once: the generation is over, not aborted.
    end(terminal ?? 'aborted');
    writer.abort(abortError()).catch(() => undefined);
  };
  const onHubClose = (): void => {
    stop.abort();
    end('reset');
    writer.abort(new TypeError('fake hub: connection reset (hub closed)')).catch(() => undefined);
  };
  if (ctx.signal?.aborted === true) onClientAbort();
  else if (ctx.hubSignal.aborted) onHubClose();
  ctx.signal?.addEventListener('abort', onClientAbort, { once: true });
  ctx.hubSignal.addEventListener('abort', onHubClose, { once: true });
  // The reader cancelled the body (reader.cancel()): the writable side errors.
  writer.closed.catch(() => {
    stop.abort();
    end(terminal ?? 'aborted');
  });
  const scaled = (ms: number | undefined): number => Math.max(0, Math.round((ms ?? 0) * ctx.timeScale));
  const write = (text: string | Uint8Array): Promise<void> => writer.write(typeof text === 'string' ? encoder.encode(text) : text);

  void (async () => {
    try {
      for (const step of steps) {
        if (stop.signal.aborted) return;
        switch (step.kind) {
          case 'frame': {
            await sleep(scaled(step.afterMs), stop.signal);
            if (stop.signal.aborted) return;
            const frame = ctx.rewrite?.(step.frame) ?? step.frame;
            // Known before the write resolves: the reader may hang up in the very step it reads the frame.
            if (frame.type === 'done') terminal = 'done';
            if (frame.type === 'error') terminal = 'error-frame';
            await write(sseFrameText(frame));
            ctx.onFrame(frame);
            break;
          }
          case 'heartbeat':
            await write(SSE_HEARTBEAT);
            break;
          case 'wait':
            await sleep(scaled(step.ms), stop.signal);
            break;
          case 'gate':
            await ctx.gates.wait(step.name, stop.signal);
            break;
          case 'raw':
            await write(step.text);
            ctx.onFrame(null);
            break;
          case 'cut': {
            const bytes = encoder.encode(sseFrameText(ctx.rewrite?.(step.frame) ?? step.frame));
            await write(bytes.slice(0, step.keepBytes ?? Math.floor(bytes.length / 2)));
            end('cut');
            await writer.close();
            return;
          }
          case 'reset':
            end('reset');
            await writer.abort(new TypeError('fake hub: connection reset'));
            return;
          case 'stall':
            await new Promise<void>((resolve) => {
              if (stop.signal.aborted) resolve();
              else stop.signal.addEventListener('abort', () => resolve(), { once: true });
            });
            return;
          case 'eof':
            end(terminal ?? 'eof');
            await writer.close();
            return;
        }
      }
      end(terminal ?? 'eof');
      await writer.close();
    } catch {
      // A write failed: the client is gone (abort and cancel already ended the stream).
      stop.abort();
      end(terminal ?? 'aborted');
    } finally {
      ctx.signal?.removeEventListener('abort', onClientAbort);
      ctx.hubSignal.removeEventListener('abort', onHubClose);
    }
  })();
  return readable;
}
