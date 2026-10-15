import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FanslyApiCall } from '@cg/contracts/fansly-api';
import { createFanslyApi } from './client';
import { admit } from './allowlist';
import { retryAfterMs } from './errors';
import { FanslyPacer } from './pacer/pacer';
import { apiWorld } from './test-world';

const read: FanslyApiCall = { accountId: '100', tabId: 1, purpose: 'registration', mode: 'cooldown', method: 'GET', path: '/group/55' };
const signal = () => new AbortController().signal;
function world() {
  const w = apiWorld(); const pacer = new FanslyPacer({ ...w, random: () => 0 });
  const send = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true, response: { id: '55' } }))));
  let id = 0;
  const api = createFanslyApi({ session: w.session, pacer, id: () => `r${++id}`, send });
  return { ...w, pacer, send, api };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

describe('Fansly admission and envelope', () => {
  it.each([
    { path: '//evil.test/x' }, { path: '/group/../message' }, { path: '/group/%35' }, { path: '/message/unread' },
    { path: '/account/wallets/earnings/stats/accounts' }, { path: '/group/55?x=1' }, { path: '/subscribers' },
    { path: '/message', query: { ids: '1' } }, { method: 'POST' }, { mode: 'immediate' },
  ])('FS-NET-1 refuses before dispatch: %j', async (patch) => {
    const w = world();
    await expect(w.api.request({ ...read, ...patch } as FanslyApiCall, signal())).rejects.toMatchObject({ code: 'CG-FAN-REQUEST', phase: 'before-dispatch' });
    expect(w.send).not.toHaveBeenCalled();
  });
  it('selects the family check and regenerates the timestamp AFTER a queue wait; no Origin/cookies/redirects', async () => {
    const w = world();
    const call = { ...read, purpose: 'newcomers' as const, mode: 'queue' as const };
    await w.api.request(call, signal());
    const next = w.api.request(call, signal());
    await vi.advanceTimersByTimeAsync(499); expect(w.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await next;
    const [url, init] = (w.send.mock.calls as unknown as [string, RequestInit][])[1]!;
    expect(url).toBe('https://apiv3.fansly.com/api/v1/group/55?ngsw-bypass=true');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { 'fansly-client-ts': '1000500', 'fansly-client-check': 'group-check' } });
    expect(new Headers(init.headers).has('origin')).toBe(false);
    expect(new Headers(init.headers).has('cookie')).toBe(false);
  });
  it.each([false, 'true', undefined])('[ER-051] [RB-023] HTTP 200 with success=%s fails; the envelope earns no successful read', async (success) => {
    const w = world(); w.send.mockResolvedValue(new Response(JSON.stringify({ success, response: {} })));
    await expect(w.api.request(read, signal())).rejects.toMatchObject({ code: 'CG-FAN-REQUEST', phase: 'after-dispatch', status: 200 });
    expect(w.send).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])('HTTP %s disconnects only the same session', async (status) => {
    const w = world(); w.send.mockResolvedValue(new Response('', { status }));
    await expect(w.api.request(read, signal())).rejects.toMatchObject({ code: 'CG-FAN-EXPIRED', phase: 'after-dispatch' });
    expect(w.templates.size).toBe(0);
  });
  it('[RB-023] one POST attempt on network failure, malformed JSON, server error or refused envelope; no retry', async () => {
    for (const result of [new Response('not-json'), new Response('{}', { status: 503 }), new Response('{"success":false}'), new Error('secret response')]) {
      const w = world();
      if (result instanceof Error) w.send.mockRejectedValue(result); else w.send.mockResolvedValue(result);
      await expect(w.api.request({ ...read, method: 'POST', path: '/message', purpose: 'greeting', mode: 'immediate', body: { content: 'private' } }, signal())).rejects.toMatchObject({ code: 'CG-FAN-REQUEST', phase: 'after-dispatch' });
      expect(w.send).toHaveBeenCalledTimes(1);
    }
  });
  it('delete may have an empty success; other successful envelopes must carry a response', async () => {
    const w = world(); w.send.mockResolvedValue(new Response('{"success":true}'));
    await expect(w.api.request({ ...read, method: 'POST', path: '/notes/delete', purpose: 'notes-write', mode: 'immediate', body: {} }, signal())).resolves.toBeUndefined();
    w.send.mockResolvedValue(new Response('{"success":true}'));
    await expect(w.api.request(read, signal())).rejects.toMatchObject({ code: 'CG-FAN-REQUEST' });
  });
  it('no stale check fallback; no session means no request', async () => {
    const w = world(); const template = w.templates.get(1)!;
    w.templates.set(1, { ...template, checks: {} });
    await w.api.request(read, signal());
    expect(new Headers((w.send.mock.calls as unknown as [string, RequestInit][])[0]![1].headers).has('fansly-client-check')).toBe(false);
    w.templates.clear(); await expect(w.api.request(read, signal())).rejects.toMatchObject({ code: 'CG-FAN-SESSION' });
    expect(w.send).toHaveBeenCalledTimes(1);
  });
  it('a prepared write rechecks identity and cooling, then calls the final guard immediately before dispatch, once', async () => {
    const w = world(); const call = { ...read, method: 'POST' as const, path: '/message', purpose: 'greeting' as const, mode: 'immediate' as const, body: {} };
    const prepared = await w.api.prepare(call, signal()); const order: string[] = [];
    w.send.mockImplementation(() => { order.push('send'); return Promise.resolve(new Response('{"success":true,"response":{}}')); });
    const answer = prepared.dispatch(() => { order.push('guard'); });
    expect(order).toEqual(['guard', 'send']); await answer;
    await expect(prepared.dispatch()).rejects.toMatchObject({ phase: 'before-dispatch' });
    const stale = await w.api.prepare(call, signal()); w.templates.clear();
    await expect(stale.dispatch()).rejects.toMatchObject({ code: 'CG-FAN-SESSION' });
    expect(w.send).toHaveBeenCalledTimes(1);
  });
  it('[NF-037] our 429 is durable, closes the next call and preserves Retry-After', async () => {
    const w = world(); w.send.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    await expect(w.api.request(read, signal())).rejects.toMatchObject({ code: 'CG-FAN-RATE-LIMIT', phase: 'after-dispatch', retryAt: 1_120_000 });
    const afterWake = new FanslyPacer({ session: w.session, storage: w.storage });
    await afterWake.sync(); expect(afterWake.status('100')).toMatchObject({ cooldownUntil: 1_120_000, level: 1 });
    await expect(w.api.request(read, signal())).rejects.toMatchObject({ phase: 'before-dispatch' }); expect(w.send).toHaveBeenCalledTimes(1);
  });
  it('a cooldown arriving after prepare refuses an immediate write without waiting', async () => {
    const w = world();
    const prepared = await w.api.prepare({ ...read, method: 'POST', path: '/message', purpose: 'greeting', mode: 'immediate', body: {} }, signal());
    w.facts.push({ requestId: 'foreign', accountId: '100', source: 'page', at: Date.now() });
    await expect(prepared.dispatch()).rejects.toMatchObject({ code: 'CG-FAN-RATE-LIMIT', phase: 'before-dispatch' }); expect(w.send).not.toHaveBeenCalled();
  });
  it('Retry-After parses seconds/date and clamps skew to six hours', () => {
    expect(retryAfterMs('2', Date.now())).toBe(2000);
    expect(retryAfterMs(new Date(Date.now() + 5000).toUTCString(), Date.now())).toBe(5000);
    expect(retryAfterMs('9999999', Date.now())).toBe(21_600_000);
    expect(retryAfterMs('secret', Date.now())).toBe(0);
  });
  it('[RB-023] explicitly opted-in queued reads retry 5xx at most three times; no envelope/4xx or write retries', async () => {
    const w = world(); w.send.mockImplementation(() => Promise.resolve(new Response('', { status: 503 })));
    const work = w.api.request({ ...read, purpose: 'newcomers', mode: 'queue', retry: 'transient' }, signal());
    const rejected = expect(work).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(7000); await rejected; expect(w.send).toHaveBeenCalledTimes(4);
    await expect(w.api.request({ ...read, method: 'POST', path: '/message', purpose: 'greeting', mode: 'immediate', body: {}, retry: 'transient' }, signal())).rejects.toMatchObject({ phase: 'before-dispatch' });
    expect(w.send).toHaveBeenCalledTimes(4);
  });
  it('[RB-023] reusing or canceling a dispatched handle cannot release another request into its occupied FIFO', async () => {
    const w = world(); let answer!: (value: Response) => void;
    w.send.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const call = { ...read, purpose: 'newcomers' as const, mode: 'queue' as const };
    const prepared = await w.api.prepare(call, signal()); const running = prepared.dispatch();
    await expect(prepared.dispatch()).rejects.toMatchObject({ phase: 'before-dispatch' }); prepared.cancel();
    const next = w.api.request(call, signal()); await vi.advanceTimersByTimeAsync(5000);
    expect(w.send).toHaveBeenCalledTimes(1);
    answer(new Response('{"success":true,"response":{}}')); await running; await next;
    expect(w.send).toHaveBeenCalledTimes(2);
  });
  it('the allowlist grants identity, queue reads and clicked writes only in their stated mode', () => {
    expect(admit({ ...read, path: '/account/me', purpose: 'identity' }).family).toBe('account');
    expect(() => admit({ ...read, path: '/account/me', purpose: 'newcomers' })).toThrow();
    expect(() => admit({ ...read, path: '/group/55', purpose: 'notes-read' })).toThrow();
  });
});
