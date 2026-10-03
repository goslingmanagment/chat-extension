// The fake hub's AI stream control (architecture.md §12 п. 2 «сценарии SSE:
// кадры, обрывы, error, 409 персоны, 429, 503 до первого чанка»): scripted
// frames with real timing, waits, gates a test releases, a frame cut in half,
// a reset connection, a stalled hub, raw bytes, refusals before the stream,
// and every SSE scenario of @cg/testing/hub replayed byte for byte. The
// journal keeps the frame types and how each stream ended, never the text.

import { type HubFrame } from '@cg/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { SSE_SCENARIOS, meta, sseText, streamBody, uuid } from '../scenarios/hub';
import { createFakeHub, hubErrorBody, type FakeHub } from './hub';
import { hubCall, readSse } from './kit';
import { sseFrameText } from './sse';
import { type FakeSseResponse, type FakeSseStep } from './types';

let hub: FakeHub;
let token: string;

const request = (feature: 'fast-reply' | 'ping' = 'fast-reply', capabilities: string[] = []) => ({ feature, body: streamBody({ clientRequestId: uuid(0x700) }), capabilities });
const post = (init: { signal?: AbortSignal; feature?: 'fast-reply' | 'ping' } = {}): Promise<Response> =>
  hubCall(hub.fetch, hub.origin, 'aiFeatureStream', request(init.feature), { token, ...(init.signal === undefined ? {} : { signal: init.signal }) });
const frame = (f: HubFrame, afterMs?: number): FakeSseStep => (afterMs === undefined ? { kind: 'frame', frame: f } : { kind: 'frame', frame: f, afterMs });
const delta = (text: string, afterMs?: number): FakeSseStep => frame({ type: 'content_delta', text }, afterMs);
const done: FakeSseStep = frame({ type: 'done', stopReason: 'end_turn' });
const script = (...responses: FakeSseResponse[]): void => {
  hub.control({ op: 'scriptSse', responses });
};
const lastStream = () => hub.read().entries.at(-1)?.stream;
const types = (frames: readonly unknown[]): string[] => frames.map((f) => (f as { type: string }).type);

async function until(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`not reached: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(() => {
  hub = createFakeHub();
  token = hub.issueToken();
});

describe('fake hub SSE: timing', () => {
  it('a frame «after N ms» arrives N ms after the previous one was read', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), delta('a', 120), delta('b', 120), done, { kind: 'eof' }] });
    const read = await readSse(await post());
    expect(types(read.frames)).toEqual(['meta', 'content_delta', 'content_delta', 'done']);
    const [first = 0, second = 0, third = 0] = read.times;
    expect(second - first).toBeGreaterThanOrEqual(100);
    expect(third - second).toBeGreaterThanOrEqual(100);
  });

  it('timeScale scales every delay (0 = none); waits pause between frames; heartbeats are comments', async () => {
    const fast = createFakeHub({ timeScale: 0 });
    const fastToken = fast.issueToken();
    fast.control({ op: 'scriptSse', responses: [{ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'wait', ms: 5_000 }, delta('a', 5_000), { kind: 'heartbeat' }, done] }] });
    const started = performance.now();
    const read = await readSse(await hubCall(fast.fetch, fast.origin, 'aiFeatureStream', request(), { token: fastToken }));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect({ frames: types(read.frames), others: read.others, end: read.end }).toEqual({ frames: ['meta', 'content_delta', 'done'], others: [], end: 'eof' });
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'wait', ms: 100 }, done] });
    const waited = await readSse(await post());
    expect((waited.times[1] ?? 0) - (waited.times[0] ?? 0)).toBeGreaterThanOrEqual(80);
  });

  it('a gate holds the stream until the test releases it; the status lists it meanwhile', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'gate', name: 'after-meta' }, delta('rest'), done] });
    const seen: string[] = [];
    const reading = readSse(await post(), (f) => seen.push((f as { type: string }).type));
    await until(() => hub.status().waitingGates.includes('after-meta'), 'the stream waits on the gate');
    expect(seen).toEqual(['meta']);
    expect(hub.status().openStreams).toBe(1);
    hub.control({ op: 'release', gate: 'after-meta' });
    expect(types((await reading).frames)).toEqual(['meta', 'content_delta', 'done']);
    expect(hub.status()).toMatchObject({ waitingGates: [], openStreams: 0 });
    // A released gate stays open until reset.
    script({ kind: 'stream', steps: [{ kind: 'gate', name: 'after-meta' }, done] });
    expect(types((await readSse(await post())).frames)).toEqual(['done']);
  });

  it('the model streams its chunks with aiChunkDelayMs', async () => {
    hub.control({ op: 'config', patch: { aiChunkDelayMs: 40 } });
    const read = await readSse(await post({ feature: 'ping' }));
    const deltas = read.frames.flatMap((f, i) => ((f as { type: string }).type === 'content_delta' ? [read.times[i] ?? 0] : []));
    expect(deltas.length).toBeGreaterThan(1);
    expect((deltas.at(-1) ?? 0) - (deltas[0] ?? 0)).toBeGreaterThanOrEqual(30 * (deltas.length - 1));
  });
});

describe('fake hub SSE: failures of a real connection', () => {
  it('cut: half a frame, then a clean EOF — the client sees a truncated stream', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), delta('Half a'), { kind: 'cut', frame: { type: 'content_delta', text: 'never whole' } }] });
    const read = await readSse(await post());
    expect(types(read.frames)).toEqual(['meta', 'content_delta']);
    expect(read.end).toBe('eof');
    expect(read.rest.length).toBeGreaterThan(0);
    expect(sseFrameText({ type: 'content_delta', text: 'never whole' }).startsWith(read.rest)).toBe(true);
    expect(lastStream()).toEqual({ frames: ['meta', 'content_delta'], outcome: 'cut' });
  });

  it('cut with keepBytes keeps exactly that many bytes', async () => {
    script({ kind: 'stream', steps: [{ kind: 'cut', frame: { type: 'done', stopReason: null }, keepBytes: 7 }] });
    expect((await readSse(await post())).rest).toBe('event: ');
  });

  it('reset: the body read fails (a network error, not an EOF)', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'reset' }] });
    const read = await readSse(await post());
    expect({ frames: types(read.frames), end: read.end }).toEqual({ frames: ['meta'], end: 'error' });
    expect(lastStream()?.outcome).toBe('reset');
  });

  it('stall: nothing more until the client aborts; the stream ends as aborted', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'stall' }] });
    const abort = new AbortController();
    const reading = readSse(await post({ signal: abort.signal }));
    await until(() => (lastStream()?.frames.length ?? 0) === 1, 'meta written');
    expect(hub.status().openStreams).toBe(1);
    abort.abort();
    const read = await reading;
    expect(read.end).toBe('error');
    expect(lastStream()?.outcome).toBe('aborted');
    expect(hub.status().openStreams).toBe(0);
  });

  it('the reader cancelling the body ends the stream as aborted', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'stall' }] });
    const response = await post();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    await until(() => lastStream()?.outcome === 'aborted', 'aborted after cancel');
  });

  it('an aborted request never starts a stream', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(post({ signal: abort.signal })).rejects.toThrow(/abort/i);
  });

  it('closeStreams (and reset) end open streams like a reset connection', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'stall' }] }, { kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'stall' }] });
    const first = readSse(await post());
    await until(() => hub.status().openStreams === 1, 'stream open');
    hub.closeStreams();
    expect((await first).end).toBe('error');
    expect(hub.read().entries.at(-1)?.stream?.outcome).toBe('reset');
  });

  it('raw bytes reach the client as they are: an unknown event, broken JSON', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'raw', text: 'event: other\ndata: {}\n\n' }, { kind: 'raw', text: 'event: ai\ndata: {broken\n\n' }] });
    const read = await readSse(await post());
    expect({ frames: types(read.frames), others: read.others, end: read.end }).toEqual({ frames: ['meta'], others: ['event: other\ndata: {}'], end: 'error' });
    expect(read.error).toBeInstanceOf(SyntaxError);
    await until(() => lastStream()?.outcome === 'eof', 'stream ended');
    expect(lastStream()?.frames).toEqual(['meta', 'raw', 'raw']);
  });

  it('an error frame ends the stream as error-frame; a stream without done ends as eof', async () => {
    script(
      { kind: 'stream', steps: [frame(meta('fast-reply')), frame({ type: 'error', code: 'provider_overloaded', message: 'busy', retryAfterMs: null }), { kind: 'eof' }] },
      { kind: 'stream', steps: [frame(meta('fast-reply')), delta('x')] },
    );
    await readSse(await post());
    expect(lastStream()?.outcome).toBe('error-frame');
    await readSse(await post());
    expect(lastStream()?.outcome).toBe('eof');
  });
});

describe('fake hub SSE: refusals before the stream and script matching', () => {
  it('503 before the first frame, then a stream (the one transparent retry); Retry-After when scripted', async () => {
    script(
      { kind: 'http-error', status: 503, body: hubErrorBody('service_unavailable', 503), retryAfterSec: 5 },
      { kind: 'stream', steps: [frame(meta('fast-reply')), delta('Back online'), done] },
    );
    const refused = await post();
    expect({ status: refused.status, retryAfter: refused.headers.get('retry-after'), body: (await refused.json()) as unknown }).toEqual({
      status: 503,
      retryAfter: '5',
      body: { error: 'service_unavailable', message: 'fake hub: service_unavailable', statusCode: 503 },
    });
    expect(types((await readSse(await post())).frames)).toEqual(['meta', 'content_delta', 'done']);
    expect(hub.read().entries.slice(-2).map((entry) => [entry.status, entry.error, entry.servedBy])).toEqual([
      [503, 'service_unavailable', 'script'],
      [200, null, 'script'],
    ]);
  });

  it('a scripted meta carries the request’s clientRequestId', async () => {
    script({ kind: 'stream', steps: [frame(meta('fast-reply', { clientRequestId: uuid(1) })), done] });
    expect((await readSse(await post())).frames[0]).toMatchObject({ clientRequestId: uuid(0x700) });
  });

  it('a script for one feature leaves the others to the model; spent scripts fall back to the model', async () => {
    hub.control({ op: 'scriptSse', feature: 'ping', responses: [{ kind: 'stream', steps: [frame(meta('ping')), delta('scripted ping'), done] }] });
    await readSse(await post({ feature: 'fast-reply' }));
    expect(hub.read().entries.at(-1)?.servedBy).toBe('model');
    expect(hub.status().script.sseLeft).toBe(1);
    await readSse(await post({ feature: 'ping' }));
    expect(hub.read().entries.at(-1)?.servedBy).toBe('script');
    await readSse(await post({ feature: 'ping' }));
    expect(hub.read().entries.at(-1)?.servedBy).toBe('model');
  });

  it('clearScripts drops what is left; reset aborts streams and clears gates', async () => {
    script({ kind: 'stream', steps: [done] });
    hub.control({ op: 'clearScripts' });
    expect(hub.status().script.sseLeft).toBe(0);
    script({ kind: 'stream', steps: [frame(meta('fast-reply')), { kind: 'gate', name: 'g' }, done] });
    const reading = readSse(await post());
    await until(() => hub.status().waitingGates.includes('g'), 'waiting on g');
    hub.control({ op: 'reset' });
    expect((await reading).end).toBe('error');
    expect(hub.status()).toMatchObject({ waitingGates: [], openStreams: 0, script: { sseLeft: 0 } });
  });
});

describe('fake hub SSE: every scenario of @cg/testing/hub, byte for byte', () => {
  for (const scenario of SSE_SCENARIOS) {
    it(scenario.name, async () => {
      const replay = createFakeHub({ timeScale: 0 });
      const bearer = replay.issueToken();
      replay.control({ op: 'useSseScenario', scenario: scenario.name });
      for (const response of scenario.responses) {
        const answer = await hubCall(replay.fetch, replay.origin, 'aiFeatureStream', scenario.request, { token: bearer });
        if (response.kind === 'http-error') {
          expect({ status: answer.status, body: (await answer.json()) as unknown }).toEqual({ status: response.status, body: response.body });
        } else {
          expect(answer.status).toBe(200);
          expect(await answer.text()).toBe(sseText(response));
        }
      }
      expect(replay.status().script.sseLeft).toBe(0);
      expect(replay.violations()).toEqual([]);
      // The request the scenario sends passes the hub's checks with the user's token.
      expect(replay.read().entries.every((entry) => entry.route === 'aiFeatureStream' && entry.servedBy === 'script' && entry.token?.client === 'chat-extension')).toBe(true);
    });
  }

  it('an unknown scenario name is an error of the test', () => {
    expect(() => hub.control({ op: 'useSseScenario', scenario: 'no-such' })).toThrow(/no SSE scenario/);
  });
});
