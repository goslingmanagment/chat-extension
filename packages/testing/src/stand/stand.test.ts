// The stand server on its own (no browser): labels, native API shapes,
// scripted sends with their socket echo, socket protocol, control guard,
// egress sink, synthetic dataset, and the fixture build location.

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { FIXTURE_CONTRACTS } from '../../fixture-chatspace/src/metadata';
import { CONTROL_REQUEST_HEADER, NATIVE_REQUEST_HEADER, STAND_API_ORIGIN_META, STAND_TOKEN_PATH, STAND_WS_PATH, type ServerJournalEntry } from '../../fixture-chatspace/src/protocol';
import viteConfig, { FIXTURE_BUILD_DIR as VITE_OUT_DIR } from '../../fixture-chatspace.vite.config';
import { startStandServer, type StandServer } from '../stand-server';
import { createDataset, plainText, STAND_IDS } from './dataset';
import { startEgressSink } from './egress-sink';
import { FIXTURE_BUILD_DIR, FIXTURE_SOURCE_DIR } from './paths';

const fixtureDir = mkdtempSync(join(tmpdir(), 'cg-stand-'));
writeFileSync(join(fixtureDir, 'index.html'), '<!doctype html><title>stand test</title><meta name="stand-api-origin" content="" />');

let stand: StandServer;
let token = '';
let nativeSeq = 0;

/** Headers of a native client call; every call gets its own native id, as the page's client does. */
const native = (extra: Record<string, string> = {}): Record<string, string> => {
  nativeSeq += 1;
  return { [NATIVE_REQUEST_HEADER]: `unit.${nativeSeq}`, authorization: `Bearer ${token}`, ...extra };
};
const control = { [CONTROL_REQUEST_HEADER]: '1', 'content-type': 'application/json' };
const { a: accountA } = STAND_IDS.accounts;
const { a1, a2 } = STAND_IDS.fans;

/** Control and session-token paths go to the page origin, `/api/...` to the API origin. */
const urlOf = (path: string): string => `${path.startsWith('/api/') ? stand.apiOrigin : stand.origin}${path}`;

async function json(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(urlOf(path), init);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

const journalSince = (since: number): readonly ServerJournalEntry[] => stand.journal.read(since).entries;

/** Polls until the condition holds (a confirmed event), instead of sleeping a fixed time. */
async function waitFor(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`${what}: not seen in ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const framesSentTo = (socketId: number, since = 0): readonly ServerJournalEntry[] => journalSince(since).filter((entry) => entry.kind === 'ws-out' && entry.socketId === socketId);

interface Socket {
  readonly ws: WebSocket;
  readonly frames: Array<Record<string, unknown>>;
  send(frame: Record<string, unknown>): void;
  next(event: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
}

async function openSocket(): Promise<Socket> {
  const ws = new WebSocket(`${stand.apiOrigin.replace('http', 'ws')}${STAND_WS_PATH}`);
  const frames: Array<Record<string, unknown>> = [];
  ws.on('message', (data: Buffer) => frames.push(JSON.parse(data.toString('utf8')) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return {
    ws,
    frames,
    send: (frame) => ws.send(JSON.stringify(frame)),
    next: async (event, timeoutMs = 2000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const index = frames.findIndex((frame) => frame['event'] === event);
        if (index !== -1) return frames.splice(index, 1)[0] ?? {};
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`no ${event} frame in ${timeoutMs} ms`);
    },
    close: () => ws.close(),
  };
}

async function nativeSocket(accounts: readonly string[]): Promise<Socket> {
  const socket = await openSocket();
  socket.send({ action: 'auth', token });
  await socket.next('authenticated');
  for (const account of accounts) socket.send({ action: 'subscribe_account', token, account: { account_id: account, platform: 'onlyfans', platform_account_id: 'x' } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return socket;
}

beforeAll(async () => {
  stand = await startStandServer({ fixtureDir, socketGraceMs: 300 });
  token = ((await json(STAND_TOKEN_PATH, { method: 'POST', headers: { [NATIVE_REQUEST_HEADER]: 'unit.auth' } })).body as { token: string }).token;
});

afterAll(async () => {
  await stand.close();
});

afterEach(() => {
  stand.state.reset();
});

describe('stand server: who called', () => {
  it('labels navigations and subresources, native client calls, control calls and foreign calls', async () => {
    const since = stand.journal.read().next;
    await fetch(`${stand.origin}/accounts/${accountA}/chats/${a1}`, { headers: { 'sec-fetch-dest': 'document' } });
    await fetch(`${stand.apiOrigin}/api/v0/accounts`, { headers: native() });
    await fetch(`${stand.origin}/__stand/state`, { headers: control });
    await fetch(`${stand.apiOrigin}/api/v0/accounts`, { headers: { authorization: `Bearer ${token}` } });
    const entries = journalSince(since).filter((entry) => entry.kind === 'http' || entry.kind === 'control');
    expect(entries.map((entry) => [entry.origin, entry.path])).toEqual([
      ['asset', `/accounts/${accountA}/chats/${a1}`],
      ['native', '/api/v0/accounts'],
      ['control', '/__stand/state'],
      ['foreign', '/api/v0/accounts'],
    ]);
  });

  it("a fetch of the page's own index or bundles is foreign: only navigations and subresources are assets", async () => {
    const since = stand.journal.read().next;
    await fetch(`${stand.origin}/`, { headers: { 'sec-fetch-dest': 'empty' } });
    await fetch(`${stand.origin}/assets/index.js`);
    await fetch(`${stand.origin}/assets/index.js`, { headers: { 'sec-fetch-dest': 'script' } });
    expect(journalSince(since).map((entry) => [entry.origin, entry.path])).toEqual([
      ['foreign', '/'],
      ['foreign', '/assets/index.js'],
      ['asset', '/assets/index.js'],
    ]);
  });

  it('a native request id answered once is a replay the second time (foreign)', async () => {
    const since = stand.journal.read().next;
    const headers = native();
    expect((await fetch(`${stand.apiOrigin}/api/v0/accounts`, { headers })).status).toBe(200);
    expect((await fetch(`${stand.apiOrigin}/api/v0/accounts`, { headers })).status).toBe(200);
    const entries = journalSince(since).filter((entry) => entry.kind === 'http');
    expect(entries.map((entry) => entry.origin)).toEqual(['native', 'foreign']);
    expect(entries[1]?.detail).toEqual({ replayOf: headers[NATIVE_REQUEST_HEADER] });
  });

  it('the API origin answers CORS for the page origin: preflights and every response', async () => {
    const since = stand.journal.read().next;
    const preflight = await fetch(`${stand.apiOrigin}/api/v0/accounts/${accountA}/chats/${a1}/messages`, {
      method: 'OPTIONS',
      headers: { origin: stand.origin, 'access-control-request-method': 'POST', 'access-control-request-headers': `authorization,content-type,${NATIVE_REQUEST_HEADER}` },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(stand.origin);
    expect(preflight.headers.get('access-control-allow-headers')).toContain(NATIVE_REQUEST_HEADER);
    const unauthorized = await fetch(`${stand.apiOrigin}/api/v0/accounts`, { headers: { [NATIVE_REQUEST_HEADER]: 'unit.cors', origin: stand.origin } });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('access-control-allow-origin')).toBe(stand.origin);
    expect(journalSince(since).filter((entry) => entry.method === 'OPTIONS').map((entry) => entry.origin)).toEqual(['native']);
  });

  it('the page origin has no API and the API origin has no page', async () => {
    expect((await fetch(`${stand.origin}/api/v0/accounts`, { headers: native() })).status).toBe(404);
    expect((await fetch(`${stand.apiOrigin}/accounts/${accountA}/chats/`, { headers: { 'sec-fetch-dest': 'document' } })).status).toBe(404);
  });

  it('answers 401 without a session token and 403 on control endpoints without the control header', async () => {
    expect((await json('/api/v0/accounts', { headers: { [NATIVE_REQUEST_HEADER]: 'unit.no-token' } })).status).toBe(401);
    expect((await json('/__stand/reset', { method: 'POST' })).status).toBe(403);
  });

  it('serves the SPA index for app routes, told where the API is, and a 503 hint when the fixture is not built', async () => {
    const index = await fetch(`${stand.origin}/accounts/${accountA}/chats/`, { headers: { 'sec-fetch-dest': 'document' } });
    expect(index.status).toBe(200);
    expect(await index.text()).toContain(`<meta name="${STAND_API_ORIGIN_META}" content="${stand.apiOrigin}"`);
    const unbuilt = await startStandServer({ fixtureDir: join(fixtureDir, 'missing') });
    try {
      const response = await fetch(`${unbuilt.origin}/`);
      expect(response.status).toBe(503);
      expect(await response.text()).toContain('build:stand');
    } finally {
      await unbuilt.close();
    }
  });
});

describe('stand server: native API', () => {
  it('lists accounts with numeric ids and string platform ids', async () => {
    const { body } = await json('/api/v0/accounts', { headers: native() });
    expect((body as { items: unknown[] }).items[0]).toMatchObject({ id: Number(accountA), platform_account_id: STAND_IDS.platformAccounts.a, platform: 'onlyfans' });
  });

  it('pages history newest first by cursor, and journals every history load (it reads the chat on the platform)', async () => {
    const since = stand.journal.read().next;
    const first = (await json(`/api/v0/accounts/${accountA}/chats/${a1}/messages?limit=10`, { headers: native() })).body as { items: Array<{ id: string; sent_at: string }>; has_more: boolean };
    expect(first.items).toHaveLength(10);
    expect(first.has_more).toBe(true);
    expect(first.items[0]?.sent_at.localeCompare(first.items[9]?.sent_at ?? '')).toBe(1);
    const cursor = first.items.at(-1)?.id ?? '';
    const second = (await json(`/api/v0/accounts/${accountA}/chats/${a1}/messages?limit=10&cursor=${cursor}`, { headers: native() })).body as { items: Array<{ id: string }> };
    expect(second.items.map((item) => item.id)).not.toContain(cursor);
    const loads = journalSince(since).filter((entry) => entry.kind === 'history-load');
    expect(loads.map((entry) => [entry.origin, entry.chatId])).toEqual([
      ['native', a1],
      ['native', a1],
    ]);
    expect(stand.state.chat(accountA, a1)?.unread).toBe(0);
  });

  it('lists chats by last message and fans in the raw platform shape', async () => {
    const list = (await json(`/api/v0/accounts/${accountA}/chats?limit=5&offset=0`, { headers: native() })).body as { items: Array<{ platform_fan_id: string }>; has_more: boolean; next_offset: number };
    expect(list.items).toHaveLength(5);
    expect(list.next_offset).toBe(5);
    const fans = (await json(`/api/v0/accounts/${accountA}/platforms/onlyfans/fans?fan_ids=${STAND_IDS.fans.a3}`, { headers: native() })).body as { items: Array<Record<string, unknown>> };
    expect(fans.items[0]).toMatchObject({ id: Number(STAND_IDS.fans.a3), isBlocked: true, canReceiveChatMessage: true });
  });
});

describe('stand server: scripted native send and the socket echo', () => {
  const post = (chatId: string, text: string, signal?: AbortSignal) =>
    fetch(`${stand.apiOrigin}/api/v0/accounts/${accountA}/chats/${chatId}/messages`, {
      method: 'POST',
      headers: native({ 'content-type': 'application/json' }),
      body: JSON.stringify({ text, is_copied: false, is_ai_generated: true, internal_template_id: null, reply_time: null, previous_message: null, platformMetadata: {} }),
      ...(signal ? { signal } : {}),
    });

  it('200 with a string id, then the outgoing echo with the same id to subscribed sockets only', async () => {
    const subscribed = await nativeSocket([accountA]);
    const other = await nativeSocket([STAND_IDS.accounts.b]);
    const response = await post(a1, '<p>hi &amp; bye</p>');
    const { id } = (await response.json()) as { id: string };
    expect(typeof id).toBe('string');
    const echo = await subscribed.next('account_new_message');
    expect(echo).toMatchObject({ account: { account_id: accountA }, message: { id, chatId: a1, platform_fan_id: a1, is_from_fan: false, content: '<p>hi &amp; bye</p>' } });
    expect(other.frames.filter((frame) => frame['event'] === 'account_new_message')).toEqual([]);
    const send = stand.journal.read().entries.filter((entry) => entry.kind === 'send').at(-1);
    expect(send?.detail).toMatchObject({ outcome: 'ok', plain: 'hi & bye', isAiGenerated: true });
    subscribed.close();
    other.close();
  });

  it('can echo BEFORE the response, and answers Guard, any status, hang and drop in script order', async () => {
    const socket = await nativeSocket([accountA]);
    stand.state.script(accountA, a1, [
      { kind: 'ok', id: '987654321', echo: 'before', gapMs: 50 },
      { kind: 'guard', topics: ['direct_contact'] },
      { kind: 'status', status: 403 },
      { kind: 'drop' },
    ]);
    const first = post(a1, '<p>1</p>');
    const echo = await socket.next('account_new_message');
    expect((echo['message'] as { id: string }).id).toBe('987654321');
    expect(((await (await first).json()) as { id: string }).id).toBe('987654321');
    const guard = await post(a1, '<p>2</p>');
    expect(guard.status).toBe(422);
    expect(await guard.json()).toMatchObject({ code: 'MESSAGE_GUARD_VIOLATION', topic_matches: ['direct_contact'] });
    const forbidden = await post(a1, '<p>3</p>');
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: 'FORBIDDEN' });
    await expect(post(a1, '<p>4</p>')).rejects.toThrow();
    // Script exhausted: back to plain success.
    expect((await post(a1, '<p>5</p>')).status).toBe(200);
    socket.close();
  });

  it('a hanging send ends only when the client aborts, journalled as send-aborted', async () => {
    stand.state.script(accountA, a2, [{ kind: 'hang' }]);
    const since = stand.journal.read().next;
    const controller = new AbortController();
    const pending = post(a2, '<p>never</p>', controller.signal);
    await waitFor(() => journalSince(since).some((entry) => entry.kind === 'send' && entry.chatId === a2), 'the hanging send reached the server');
    expect(journalSince(since).some((entry) => entry.kind === 'send-aborted')).toBe(false);
    controller.abort();
    await expect(pending).rejects.toThrow();
    await waitFor(() => journalSince(since).some((entry) => entry.kind === 'send-aborted' && entry.chatId === a2), 'send-aborted');
  });
});

describe('stand server: socket protocol', () => {
  it('a frame without a valid token marks the socket foreign; it gets nothing', async () => {
    const since = stand.journal.read().next;
    const socket = await openSocket();
    socket.send({ action: 'auth', token: 'not-a-stand-token' });
    await waitFor(() => journalSince(since).some((entry) => entry.kind === 'ws-in' && entry.origin === 'foreign'), 'the foreign frame handled');
    const [handled] = journalSince(since).filter((entry) => entry.kind === 'ws-in');
    expect(framesSentTo(handled?.socketId ?? -1, since)).toEqual([]);
    expect(stand.hub.summary().find((item) => item.id === handled?.socketId)?.label).toBe('foreign');
    socket.close();
  });

  it('a socket that never sends is foreign: after the grace period, or when it closes silent', async () => {
    const opened = (since: number): number => journalSince(since).find((entry) => entry.kind === 'ws-open')?.socketId ?? -1;
    const eventsOf = (socketId: number): string[][] =>
      journalSince(0)
        .filter((entry) => entry.socketId === socketId && (entry.kind === 'ws-silent' || entry.kind === 'ws-close'))
        .map((entry) => [entry.kind, entry.origin, String(entry.detail?.['reason'] ?? entry.detail?.['code'])]);
    let since = stand.journal.read().next;
    const lingering = await openSocket();
    const lingeringId = opened(since);
    await waitFor(() => eventsOf(lingeringId).length === 1, 'the silent socket relabelled');
    expect(eventsOf(lingeringId)).toEqual([['ws-silent', 'foreign', 'grace']]);
    lingering.close();
    since = stand.journal.read().next;
    const quick = await openSocket();
    const quickId = opened(since);
    quick.ws.close(1000);
    await waitFor(() => eventsOf(quickId).length === 2, 'the quick socket closed');
    expect(eventsOf(quickId)).toEqual([
      ['ws-silent', 'foreign', 'closed'],
      ['ws-close', 'foreign', '1000'],
    ]);
  });

  it('withheld auth: subscribed but never authenticated, so no frames', async () => {
    stand.state.withholdAuth = true;
    const since = stand.journal.read().next;
    const socket = await openSocket();
    socket.send({ action: 'auth', token });
    socket.send({ action: 'subscribe_account', token, account: { account_id: accountA } });
    await waitFor(() => journalSince(since).filter((entry) => entry.kind === 'ws-in').length === 2, 'both actions handled');
    const socketId = journalSince(since).find((entry) => entry.kind === 'ws-in')?.socketId ?? -1;
    expect(stand.hub.summary().find((item) => item.id === socketId)).toMatchObject({ label: 'native', authenticated: false, accounts: [accountA] });
    expect(stand.hub.broadcast({ event: 'probe' }, accountA)).toBe(0);
    expect(framesSentTo(socketId, since)).toEqual([]);
    socket.close();
  });

  it('fan messages from control reach subscribed sockets; closeAll closes every socket', async () => {
    const socket = await nativeSocket([accountA]);
    const { body } = await json('/__stand/fan-message', { method: 'POST', headers: control, body: JSON.stringify({ accountId: accountA, fanId: a2, text: 'synthetic ping' }) });
    const echo = await socket.next('account_new_message');
    expect(echo['message']).toMatchObject({ id: (body as { id: string }).id, is_from_fan: true, chatId: a2 });
    const closed = new Promise<number>((resolve) => socket.ws.once('close', (code: number) => resolve(code)));
    expect(stand.hub.closeAll(4000)).toBeGreaterThanOrEqual(1);
    expect(await closed).toBe(4000);
  });
});

describe('egress sink', () => {
  it('records the request line and drops the connection', async () => {
    const sink = await startEgressSink();
    try {
      await new Promise<void>((resolve) => {
        const socket = connect(sink.port, '127.0.0.1', () => socket.write('CONNECT cg-trap.invalid:443 HTTP/1.1\r\nHost: cg-trap.invalid:443\r\n\r\n'));
        socket.on('close', () => resolve());
        socket.on('error', () => resolve());
      });
      expect(sink.attempts()).toEqual(['CONNECT cg-trap.invalid:443 HTTP/1.1']);
    } finally {
      await sink.close();
    }
  });
});

describe('synthetic data and fixture files', () => {
  it('uses one id form, keeps ids strings and texts synthetic', () => {
    const dataset = createDataset();
    const ids = [...dataset.accounts.flatMap((account) => [account.id, account.platformAccountId]), ...[...dataset.chats.values()].flatMap((chat) => [chat.fan.id, ...chat.messages.map((message) => message.id)])];
    for (const id of ids) expect(id).toMatch(/^[1-9]\d{0,29}$/);
    expect(dataset.chats.get(`${accountA}:${a1}`)?.messages.length).toBe(40);
    expect(plainText('<p>a &amp;lt; b<br>c</p>')).toBe('a &lt; b\nc');
  });

  it('builds the fixture where the server serves it from, outside the sources archive', () => {
    expect(VITE_OUT_DIR).toBe(FIXTURE_BUILD_DIR);
    expect(viteConfig.root).toBe(FIXTURE_SOURCE_DIR);
    expect(FIXTURE_BUILD_DIR).toMatch(/\/\.cache\/fixture-chatspace\/$/);
  });

  it('fixture metadata names only files that exist', () => {
    for (const contract of FIXTURE_CONTRACTS) {
      for (const file of contract.stand) expect(existsSync(join(FIXTURE_SOURCE_DIR, 'src', file)), `${contract.id}: ${file}`).toBe(true);
    }
  });
});
