import { createNetworkSession, type RequestFact } from '@cg/core/services/network-session';
import { createFanslyApi, PACER_KEY, type FanslyCall, type FanslyFetch, type FanslyHttpResponse } from '@cg/fansly-api';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const T0 = Date.UTC(2026, 9, 15, 12);
const A = '300000000000000001';
const B = '300000000000000009';
const OWN = 'moz-extension://test/';
const URL = 'https://apiv3.fansly.com/api/v1/message';
const read: FanslyCall = { account: A, purpose: 'newcomers', route: 'message.history', query: { groupId: '123' } };
const click: FanslyCall = { account: A, purpose: 'registration', route: 'group.detail', path: { group: '123' } };
const response = (status = 200, retryAfter: string | null = null): FanslyHttpResponse => ({ status, headers: { get: () => retryAfter }, text: () => Promise.resolve('{"success":true,"response":{}}') });

function world() {
  const data = new Map<string, unknown>();
  let failures = 0;
  let rejected = false;
  const storage = {
    get: (keys: readonly string[]) => Promise.resolve({ ok: true as const, value: Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))])) }),
    set: (items: Readonly<Record<string, unknown>>) => {
      if (PACER_KEY in items && failures > 0) {
        failures--;
        if (rejected) return Promise.reject(new Error('write failed'));
        return Promise.resolve({ ok: false as const, code: 'CG-STORAGE-WRITE' as const, detail: 'injected failure' });
      }
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
      return Promise.resolve({ ok: true as const, value: undefined });
    },
    remove: (keys: readonly string[]) => { keys.forEach((key) => data.delete(key)); return Promise.resolve({ ok: true as const, value: undefined }); },
    keys: () => Promise.resolve({ ok: true as const, value: [...data.keys()] }),
    onChanged: () => () => undefined,
  };
  const session = () => createNetworkSession({ storage, key: 'session', now: Date.now, ownOrigin: OWN,
    apiRequest: () => true, pageRequest: (fact) => fact.tabId >= 0,
    requiredHeaders: ['authorization'], materialHeaders: ['authorization'], checkHeader: 'fansly-client-check',
    requestIdHeader: 'x-cg-request-id', accountOf: (value) => value || null, familyOf: () => 'message',
  });
  const capture = async (owner: ReturnType<typeof session>, account: string, tabId: number) => {
    await owner.register(tabId);
    const fact: RequestFact = { phase: 'headers', requestId: `page-${tabId}`, url: URL, tabId, frameId: 0, requestHeaders: [{ name: 'authorization', value: account }] };
    await owner.accept(fact);
    await owner.accept({ ...fact, phase: 'completed', statusCode: 200 });
  };
  const warn = vi.fn();
  return { session, capture, storage, data, warn, fail: (count: number, throws = false) => { failures = count; rejected = throws; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

it.each([
  { rejected: false, failures: 1 }, { rejected: true, failures: 1 },
  { rejected: false, failures: Infinity }, { rejected: true, failures: Infinity },
])('[NF-037] [host:fansly] failed Retry-After saves ($failures, rejection=$rejected) cannot restore the listener\'s shorter cooldown', async ({ rejected, failures }) => {
  const w = world();
  const session = w.session();
  await session.setEnabled(true);
  await w.capture(session, A, 1);
  let finish!: (reply: FanslyHttpResponse) => void;
  let clientRequestId = '';
  const fetch = vi.fn<FanslyFetch>((_url, init) => {
    clientRequestId = (init.headers as Record<string, string>)['x-cg-request-id'] ?? '';
    return new Promise((resolve) => { finish = resolve; });
  });
  const api = createFanslyApi({ session, storage: w.storage, fetch, warn: w.warn, random: () => 0 });
  const pass = await api.client.prepare(click);
  const pending = pass.start();
  const limited = expect(pending).rejects.toMatchObject({ kind: 'rate-limited', retryAt: T0 + 120_000 });
  const fact: RequestFact = { phase: 'headers', requestId: 'own-429', url: URL, tabId: -1, frameId: 0, originUrl: OWN,
    requestHeaders: [{ name: 'authorization', value: A }, { name: 'x-cg-request-id', value: clientRequestId }] };
  await session.accept(fact);
  await session.accept({ ...fact, phase: 'completed', statusCode: 429 });
  await api.pacer.sync();
  await api.pacer.flush();
  expect(api.pacer.view({ legacyId: A, canonicalId: null }).cooldownUntil).toBe(T0 + 30_000);
  w.fail(failures, rejected);
  finish(response(429, '120'));
  await limited;
  await api.pacer.flush();
  expect(w.warn).toHaveBeenCalledWith('persist');
  if (failures === 1) expect(w.data.get(PACER_KEY)).toMatchObject({ lanes: [expect.objectContaining({ cooldownUntil: T0 + 120_000 })] });
  vi.setSystemTime(T0 + 31_000);
  await expect(api.client.call(click)).rejects.toMatchObject({ kind: 'cooling', sent: false, retryAt: T0 + 120_000 });
  const restoredSession = w.session();
  await restoredSession.setEnabled(true);
  const restoredFetch = vi.fn<FanslyFetch>(() => Promise.resolve(response()));
  const restored = createFanslyApi({ session: restoredSession, storage: w.storage, fetch: restoredFetch });
  await expect(restored.client.call(click)).rejects.toMatchObject({ kind: 'cooling', sent: false, retryAt: T0 + 120_000 });
  expect(restoredFetch).not.toHaveBeenCalled();
  expect(restored.pacer.view({ legacyId: A, canonicalId: null }).level).toBe(1);
  vi.setSystemTime(T0 + 120_000);
  await expect(restored.client.call(click)).resolves.toMatchObject({ status: 200 });
  // Once storage recovers, a newer primary wins over the old fallback at the next wake.
  w.fail(0);
  const passAfterRecovery = await restored.pacer.enter({ legacyId: A, canonicalId: null }, 'GET /group/:id', 'check');
  passAfterRecovery.start();
  await passAfterRecovery.limited(180_000);
  passAfterRecovery.release();
  await restored.pacer.flush();
  const latest = createFanslyApi({ session: restoredSession, storage: w.storage, fetch: restoredFetch });
  await expect(latest.client.call(click)).rejects.toMatchObject({ kind: 'cooling', retryAt: T0 + 300_000 });
});

it.each([false, true])('[RB-023] [host:fansly] permits prepared under separate ids cannot overlap after resolveIdentity (reverse=%s)', async (reverse) => {
  const w = world();
  const session = w.session();
  await session.setEnabled(true);
  await w.capture(session, B, 2);
  await w.capture(session, A, 1);
  let finish!: (reply: FanslyHttpResponse) => void;
  const fetch = vi.fn<FanslyFetch>(() => new Promise((resolve) => { finish = resolve; }));
  const api = createFanslyApi({ session, storage: w.storage, fetch, random: () => 0 });
  const calls = [read, { ...read, account: B }];
  if (reverse) calls.reverse();
  const [first, second] = await Promise.all(calls.map((call) => api.client.prepare(call)));
  if (first === undefined || second === undefined) throw new Error('missing permits');
  await session.resolveIdentity(A, B, session.forAccount(A) ?? { headers: {} });
  const inFlight = first.start();
  await vi.advanceTimersByTimeAsync(1000);
  // Observe refusal synchronously, without waiting for a mistakenly dispatched read to time out.
  const secondResult = second.start().catch((error: unknown) => error);
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(secondResult).resolves.toMatchObject({ sent: false });
  // Releasing the refused permit must neither unlock the active read nor strand its successors.
  let nextReady = false;
  const next = api.client.prepare({ ...read, account: B }).then((pass) => { nextReady = true; return pass; });
  await vi.advanceTimersByTimeAsync(1000);
  expect(nextReady).toBe(false);
  finish(response());
  await inFlight;
  const nextPass = await next;
  const nextFlight = nextPass.start();
  expect(fetch).toHaveBeenCalledTimes(2);
  finish(response());
  await nextFlight;
});
