// Exercise the actual HTTP handler and AsyncFunction boundary with an in-memory browser and HTTP streams.
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({
  handler: null as ((request: IncomingMessage, response: ServerResponse) => void) | null,
  test: null as (() => Promise<void>) | null,
  listening: () => {},
  see: { site: 'fansly', runs: 0, shot: vi.fn(async () => '/shot.png') },
}));

vi.mock('node:http', () => ({
  createServer: (handler: typeof world.handler) => {
    world.handler = handler;
    return {
      once: vi.fn(),
      listen: (_port: number, _host: string, ready: () => void) => { ready(); world.listening(); },
      close: vi.fn(),
    };
  },
}));
vi.mock('node:fs', () => ({ readFileSync: () => Buffer.from('png'), writeFileSync: vi.fn() }));
vi.mock('@wdio/globals', () => ({ browser: { takeScreenshot: async () => '', getWindowHandle: async () => 'tab' } }));
vi.mock('../e2e/see/kit', () => ({
  lap: vi.fn(), OUT: '/see', useSee: () => ({ see: () => world.see }),
  recordFrames: () => ({ follow: vi.fn(), stop: async () => {} }),
}));
vi.mock('../e2e/see/live', () => ({ LIVE: false, fanslyWrites: [], netRecords: [] }));

const TOKEN = 'ab'.repeat(32);
const HOST = '127.0.0.1:47811';
const AUTH = { host: HOST, 'x-cg-see-token': TOKEN, 'content-type': 'application/javascript; charset=utf-8' };
let session: Promise<void> | undefined;

function request(path: string, method: string, headers: IncomingMessage['headers'], body = '') {
  const stream = Object.assign(new PassThrough(), { url: path, method, headers });
  const on = vi.spyOn(stream, 'on');
  let status = 0;
  let complete!: (value: { status: number; body: string }) => void;
  const result = new Promise<{ status: number; body: string }>((resolve) => { complete = resolve; });
  const response = {
    writeHead: (code: number) => { status = code; return response; },
    end: (value: string | Buffer) => complete({ status, body: value.toString() }),
  };
  if (world.handler === null) throw new Error('no session handler');
  world.handler(stream as unknown as IncomingMessage, response as unknown as ServerResponse);
  const bodyRead = on.mock.calls.some(([event]) => event === 'data');
  stream.end(body);
  return { result, bodyRead };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('CG_SEE_TOKEN', TOKEN);
  vi.stubEnv('CG_SEE_PORT', '47811');
  vi.stubEnv('CG_SEE_IDLE_MIN', '30');
  world.see.runs = 0;
  world.see.shot.mockClear();
  vi.stubGlobal('describe', (_name: string, suite: (this: { timeout: () => void }) => void) => suite.call({ timeout: () => {} }));
  vi.stubGlobal('it', (_name: string, test: () => Promise<void>) => { world.test = test; });
  const listening = new Promise<void>((resolve) => { world.listening = resolve; });
  await import('../e2e/see/session.see');
  if (world.test === null) throw new Error('no session test');
  session = world.test();
  await listening;
});

afterEach(async () => {
  await request('/stop', 'POST', AUTH).result;
  await vi.advanceTimersByTimeAsync(200);
  await session;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('see session command admission', () => {
  it.each([
    ['missing token', { host: HOST, 'content-type': 'application/javascript' }, 401],
    ['wrong token', { ...AUTH, 'x-cg-see-token': 'cd'.repeat(32) }, 401],
    ['short token', { ...AUTH, 'x-cg-see-token': 'ab' }, 401],
    ['duplicate token', { ...AUTH, 'x-cg-see-token': [TOKEN, TOKEN] }, 401],
    ['foreign origin', { ...AUTH, origin: 'https://attacker.example' }, 403],
    ['loopback origin', { ...AUTH, origin: `http://${HOST}` }, 403],
    ['null origin', { ...AUTH, origin: 'null' }, 403],
    ['empty origin', { ...AUTH, origin: '' }, 403],
    ['foreign host', { ...AUTH, host: 'attacker.example:47811' }, 403],
    ['loopback alias', { ...AUTH, host: 'localhost:47811' }, 403],
    ['wrong port', { ...AUTH, host: '127.0.0.1:47812' }, 403],
    ['missing host', { 'x-cg-see-token': TOKEN }, 403],
    ['plain text', { ...AUTH, 'content-type': 'text/plain' }, 415],
  ] satisfies [string, IncomingMessage['headers'], number][])('rejects %s before reading the script', async (_name, headers, status) => {
    const call = request('/run?shot=0', 'POST', headers, 's.runs += 1; return s.runs');
    expect((await call.result).status).toBe(status);
    expect(call.bodyRead).toBe(false);
    expect(world.see.runs).toBe(0);
    expect(world.see.shot).not.toHaveBeenCalled();
  });

  it('authenticates before checking the content type, and does not accept a token in the URL', async () => {
    const call = request(`/run?token=${TOKEN}&shot=0`, 'POST', { host: HOST, 'content-type': 'text/plain' }, 's.runs += 1');
    expect((await call.result).status).toBe(401);
    expect(call.bodyRead).toBe(false);
  });

  it('executes an authenticated script once and returns its result', async () => {
    const call = request('/run?shot=0', 'POST', AUTH, 's.runs += 1; return s.runs');
    expect(call.bodyRead).toBe(true);
    expect(await call.result).toEqual({ status: 200, body: expect.any(String) });
    expect(JSON.parse((await call.result).body)).toMatchObject({ ok: true, result: 1, shot: null });
    expect(world.see.runs).toBe(1);
  });

  it.each([['/ready', 'GET'], ['/shot', 'GET'], ['/stop', 'POST']])('requires the token for %s', async (path, method) => {
    expect((await request(path, method, { host: HOST }).result).status).toBe(401);
    expect((await request(path, method, AUTH).result).status).toBe(200);
    expect(world.see.runs).toBe(0);
  });

  it('never treats GET /stop as a command and keeps the read-only viewer working', async () => {
    expect((await request('/stop', 'GET', AUTH).result).status).toBe(404);
    for (const path of ['/', '/live', '/frame.png', '/status']) {
      expect((await request(path, 'GET', { host: HOST }).result).status).toBe(200);
      expect((await request(path, 'GET', { host: HOST, origin: 'null' }).result).status).toBe(403);
    }
    expect(world.see.runs).toBe(0);
  });
});
