// The fake hub in Firefox (architecture.md §12 п. 2, 4): the TEST build's
// own page reaches the loopback fake hub through the build's host
// permission — sign-in, bootstrap, an AI stream read frame by frame with its
// timing, a 503 before the first frame, a reset mid-stream — and its hub
// address can point there. The network trap allows only the stand and the
// fake hub; the fake hub's journal catches a call the client must never make.

import { browser, expect } from '@wdio/globals';

import { wireOf, type WireCall } from '../../src/fake-hub/routing';
import { meta, streamBody, uuid, WORLD } from '../../src/scenarios/hub';
import { installTestBuild } from '../support/extension';
import { fakeHubOrigin, pointTestBuildAtFakeHub, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';

interface PageAnswer {
  readonly status: number;
  readonly body: unknown;
}

interface PageStream {
  readonly status: number;
  readonly frames: string[];
  readonly times: number[];
  readonly end: 'eof' | 'error';
}

/** One hub call from the open extension page (its fetch, its permissions). */
async function pageCall(call: WireCall, token: string | null = null): Promise<PageAnswer> {
  return browser.execute(
    async (origin: string, wire: WireCall, bearer: string | null) => {
      const response = await fetch(`${origin}${wire.path}`, {
        method: wire.method,
        headers: { ...wire.headers, 'x-client-version': 'chat-extension/e2e', ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }) },
        ...(wire.body === undefined ? {} : { body: wire.body }),
      });
      const text = await response.text();
      return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
    },
    fakeHubOrigin(),
    call,
    token,
  );
}

/** One AI stream from the open extension page, read like the SDK: `event: ai` frames, with the time each arrived. */
async function pageStream(call: WireCall, token: string): Promise<PageStream> {
  return browser.execute(
    async (origin: string, wire: WireCall, bearer: string) => {
      const response = await fetch(`${origin}${wire.path}`, { method: wire.method, headers: { ...wire.headers, authorization: `Bearer ${bearer}` }, ...(wire.body === undefined ? {} : { body: wire.body }) });
      const frames: string[] = [];
      const times: number[] = [];
      if (response.body === null) return { status: response.status, frames, times, end: 'eof' as const };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const started = performance.now();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split('\n').find((line) => line.startsWith('data: '));
            if (block.startsWith('event: ai') && data !== undefined) {
              frames.push((JSON.parse(data.slice(6)) as { type: string }).type);
              times.push(performance.now() - started);
            }
          }
        }
      } catch {
        return { status: response.status, frames, times, end: 'error' as const };
      }
      return { status: response.status, frames, times, end: 'eof' as const };
    },
    fakeHubOrigin(),
    call,
    token,
  );
}

const replyCall = (): WireCall => wireOf('aiFeatureStream', { feature: 'fast-reply', body: streamBody({ clientRequestId: uuid(0xe00) }), capabilities: ['context-v1'] });

describe('fake hub — the TEST build reaches it on loopback', () => {
  useNetworkTrap();
  const { hub, accept } = useFakeHub();
  let token = '';

  before(async () => {
    await installTestBuild();
  });

  it('the test build’s hub address points at the fake hub (settings v1)', async () => {
    const settings = await pointTestBuildAtFakeHub();
    expect(settings.hub.baseUrl).toBe(fakeHubOrigin());
    expect(settings.schemaVersion).toBe(1);
  });

  it('its page signs in with a narrow token and reads bootstrap; the journal names the routes, never the token', async () => {
    await browser.url(testBuildPage());
    const mark = await hub().mark();
    const signIn = await pageCall(
      wireOf('authIssueDeviceTokenWithPassword', { username: WORLD.user.username, password: 'synthetic-password', label: 'Firefox · e2e · ChatGoose', mode: 'active', client: 'chat-extension' }),
    );
    expect(signIn).toMatchObject({ status: 200, body: { mode: 'active', client: 'chat-extension' } });
    token = (signIn.body as { token: string }).token;
    const boot = await pageCall(wireOf('clientBootstrap', null), token);
    expect(boot).toMatchObject({ status: 200, body: { protocol: 1, identity: { username: WORLD.user.username, tokenClient: 'chat-extension' } } });
    const entries = (await hub().journal(mark)).entries;
    expect(entries.map((entry) => [entry.route, entry.status, entry.clientVersion, entry.token?.client ?? null])).toEqual([
      ['authIssueDeviceTokenWithPassword', 200, 'chat-extension/e2e', null],
      ['clientBootstrap', 200, 'chat-extension/e2e', 'chat-extension'],
    ]);
    expect(JSON.stringify(entries)).not.toContain(token);
    expect(JSON.stringify(entries)).not.toContain('synthetic-password');
  });

  it('an AI stream arrives frame by frame with its timing', async () => {
    await hub().command({
      op: 'scriptSse',
      responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'frame', frame: { type: 'content_delta', text: 'Hey' }, afterMs: 200 }, { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' }, afterMs: 200 }] }],
    });
    const read = await pageStream(replyCall(), token);
    expect({ status: read.status, frames: read.frames, end: read.end }).toEqual({ status: 200, frames: ['meta', 'content_delta', 'done'], end: 'eof' });
    expect((read.times[1] ?? 0) - (read.times[0] ?? 0)).toBeGreaterThanOrEqual(150);
    expect((read.times[2] ?? 0) - (read.times[1] ?? 0)).toBeGreaterThanOrEqual(150);
  });

  it('the model streams when nothing is scripted; 503 before the first frame and a reset mid-stream reach the page as such', async () => {
    const model = await pageStream(replyCall(), token);
    expect({ status: model.status, first: model.frames[0], last: model.frames.at(-1), end: model.end }).toEqual({ status: 200, first: 'meta', last: 'done', end: 'eof' });
    await hub().command({
      op: 'scriptSse',
      responses: [
        { kind: 'http-error', status: 503, body: { error: 'service_unavailable', message: 'synthetic', statusCode: 503 } },
        { kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'frame', frame: { type: 'content_delta', text: 'Half' } }, { kind: 'reset' }] },
      ],
    });
    expect(await pageStream(replyCall(), token)).toMatchObject({ status: 503, frames: [] });
    expect(await pageStream(replyCall(), token)).toMatchObject({ status: 200, frames: ['meta', 'content_delta'], end: 'error' });
    expect((await hub().journal()).entries.at(-1)?.stream).toEqual({ frames: ['meta', 'content_delta'], outcome: 'reset' });
  });

  it('a call the client must never make is caught by the journal (and only the stand and the fake hub are reachable)', async () => {
    const mark = await hub().mark();
    const ofapi = await pageCall({ method: 'GET', path: '/api/v1/ofapi/read/chats', headers: {} }, token);
    expect(ofapi.status).toBe(403);
    expect((await hub().violations(mark)).map((entry) => [entry.kind, entry.operation])).toEqual([['forbidden', 'ofapi']]);
    await accept();
  });
});
