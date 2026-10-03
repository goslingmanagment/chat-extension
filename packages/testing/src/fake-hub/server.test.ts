// The loopback mode of the fake hub (architecture.md §12 п. 4): the same
// pipeline over node:http on 127.0.0.1, for e2e. Frames go out as the stream
// makes them (not buffered), a reset breaks the connection, a client that goes
// away aborts its stream, the control API works from another process (the
// control client) and only with its header, and close() ends everything.

import { request as httpRequest } from 'node:http';

import { createClient } from '@kernel/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { meta, streamBody, uuid, WORLD } from '../scenarios/hub';
import { fakeHubControl, type FakeHubControlClient } from './control-client';
import { FAKE_HUB_CONTROL_HEADER } from './hub';
import { hubCall, readSse } from './kit';
import { startFakeHub, type FakeHubServer } from './server';

let server: FakeHubServer;
let control: FakeHubControlClient;
let token: string;

const stream = (signal?: AbortSignal): Promise<Response> =>
  hubCall(fetch, server.origin, 'aiFeatureStream', { feature: 'fast-reply', body: streamBody({ clientRequestId: uuid(0xa00) }), capabilities: [] }, { token, ...(signal === undefined ? {} : { signal }) });

async function until(predicate: () => Promise<boolean>, what: string): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > 3_000) throw new Error(`not reached: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  server = await startFakeHub();
  control = fakeHubControl(server.origin);
  token = server.hub.issueToken();
});

afterEach(async () => {
  await server.close();
});

describe('fake hub loopback server', () => {
  it('listens on 127.0.0.1 only, on a free port, with the system clock', async () => {
    expect(server.origin).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.hub.origin).toBe(server.origin);
    const status = await control.status();
    expect(status.clock.manual).toBe(false);
    expect(Math.abs(status.clock.now - Date.now())).toBeLessThan(5_000);
  });

  it('serves the vendored SDK over real HTTP: sign-in body, bearer, query', async () => {
    let bearer = '';
    const sdk = createClient({ baseUrl: server.origin, auth: { mode: 'bearer', token: () => bearer } }) as unknown as Record<string, (input?: unknown) => Promise<unknown>>;
    const signIn = (await sdk['authIssueDeviceTokenWithPassword']?.({ body: { username: WORLD.user.username, password: 'synthetic-password', label: 'x', mode: 'active', client: 'chat-extension' } })) as { token: string };
    bearer = signIn.token;
    expect(await sdk['me']?.()).toMatchObject({ user: { username: WORLD.user.username } });
    expect(await sdk['spenders']?.({ query: { scope: 'page', pageLabel: WORLD.pages.one.pageLabel, period: '30d', limit: 2, offset: 0 } })).toMatchObject({ limit: 2, total: 1240 });
    await control.assertClean();
  });

  it('frames leave as the stream makes them: delays survive the wire', async () => {
    await control.command({ op: 'scriptSse', responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'frame', frame: { type: 'content_delta', text: 'a' }, afterMs: 150 }, { kind: 'frame', frame: { type: 'done', stopReason: null }, afterMs: 150 }] }] });
    const read = await readSse(await stream());
    expect(read.frames).toHaveLength(3);
    expect((read.times[1] ?? 0) - (read.times[0] ?? 0)).toBeGreaterThanOrEqual(120);
    expect((read.times[2] ?? 0) - (read.times[1] ?? 0)).toBeGreaterThanOrEqual(120);
  });

  it('a reset step breaks the connection: the body read fails', async () => {
    await control.command({ op: 'scriptSse', responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'reset' }] }] });
    const read = await readSse(await stream());
    expect({ frames: read.frames.length, end: read.end }).toEqual({ frames: 1, end: 'error' });
  });

  it('a client that goes away aborts its stream', async () => {
    await control.command({ op: 'scriptSse', responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] }] });
    const abort = new AbortController();
    const reading = readSse(await stream(abort.signal));
    await until(async () => (await control.status()).openStreams === 1, 'stream open');
    abort.abort();
    expect((await reading).end).toBe('error');
    await until(async () => (await control.journal()).entries.at(-1)?.stream?.outcome === 'aborted', 'aborted in the journal');
    expect((await control.status()).openStreams).toBe(0);
  });

  it('the control client: commands, status, journal, mark, and assertClean naming what went wrong', async () => {
    expect(await control.command({ op: 'clock', mode: 'manual', setMs: Date.parse('2026-10-03T10:00:00.000Z') })).toEqual({ ok: true, now: Date.parse('2026-10-03T10:00:00.000Z') });
    const mark = await control.mark();
    await hubCall(fetch, server.origin, 'me', null, { token });
    expect((await control.journal(mark)).entries.map((entry) => [entry.route, entry.status, entry.at])).toEqual([['me', 200, Date.parse('2026-10-03T10:00:00.000Z')]]);
    await control.assertClean(mark);
    await fetch(`${server.origin}/api/v1/ofapi/read/chats`, { headers: { authorization: `Bearer ${token}` } });
    expect(await control.violations(mark)).toHaveLength(1);
    await expect(control.assertClean(mark, 'in this test')).rejects.toThrow(/1 call\(s\) the client must never make \(in this test\):\n#\d+ GET \/api\/v1\/ofapi\/read\/chats → 403 forbidden \[forbidden:ofapi, check\]/);
    await expect(control.command({ op: 'useHttpScenario', scenario: 'no-such' })).rejects.toThrow(/HTTP 400 .*no HTTP scenario/);
  });

  it('control endpoints need their header: without it the path is an unknown route and a violation', async () => {
    const response = await fetch(`${server.origin}/__fake-hub/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'reset' }) });
    expect(response.status).toBe(404);
    expect((await control.violations()).map((entry) => [entry.kind, entry.path])).toEqual([['unknown', '/__fake-hub/control']]);
    const unknown = await fetch(`${server.origin}/__fake-hub/nothing`, { headers: { [FAKE_HUB_CONTROL_HEADER]: '1' } });
    expect(unknown.status).toBe(404);
    const broken = await fetch(`${server.origin}/__fake-hub/control`, { method: 'POST', headers: { [FAKE_HUB_CONTROL_HEADER]: '1', 'content-type': 'application/json' }, body: '{' });
    expect(broken.status).toBe(400);
  });

  it('a method the route does not take is an unknown path over the wire too (404)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${server.origin}/api/v1/auth/me`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(404);
  });

  it('close() ends open streams and stops listening', async () => {
    await control.command({ op: 'scriptSse', responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] }] });
    const reading = readSse(await stream());
    await until(async () => (await control.status()).openStreams === 1, 'stream open');
    await server.close();
    expect((await reading).end).toBe('error');
    await expect(fetch(`${server.origin}/api/v1/health`)).rejects.toThrow();
    server = await startFakeHub();
  });

  it('a fixed port can be asked for', async () => {
    const other = await startFakeHub({ port: 0, clock: Date.parse('2026-10-03T10:00:00.000Z') });
    try {
      expect((await fakeHubControl(other.origin).status()).clock).toEqual({ now: Date.parse('2026-10-03T10:00:00.000Z'), manual: true });
      await expect(startFakeHub({ port: other.port })).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await other.close();
    }
  });
});
