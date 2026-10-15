import type { FanslyApiCall, FanslyApiPort, FanslyApiSignal, FanslyPreparedCall } from '@cg/contracts/fansly-api';
import { admit } from './allowlist';
import { FanslyApiError, readEnvelope, retryAfterMs } from './errors';
import { checkAbort, sleep } from './pacer/async';
import { READ_RETRY_DELAYS_MS } from './pacer/policy';
import type { FanslyPacer } from './pacer/pacer';
import type { ApiSession, ApiSessionPort } from './ports';

declare const __CG_TEST_HOSTS__: boolean;

export interface FanslyClientDeps {
  readonly session: ApiSessionPort;
  readonly pacer: FanslyPacer;
  readonly id: () => string;
  readonly now?: () => number;
  /** Prepared transport; P9c supplies its already-routed relay here. No fallback. */
  readonly send?: (url: string, init: RequestInit) => Promise<Response>;
  /** Removed from release code by the same build switch as the stand permissions. */
  readonly testOrigin?: () => string | undefined;
}

const sameSession = (a: ApiSession, b: ApiSession): boolean => a.legacyId === b.legacyId && a.canonicalId === b.canonicalId &&
  ['authorization', 'fansly-client-id', 'fansly-session-id'].every((key) => a.headers[key] === b.headers[key]);

/** No timers, polling or requests at construction. Only an explicit call dispatches. */
export function createFanslyApi(deps: FanslyClientDeps): FanslyApiPort {
  const now = deps.now ?? Date.now;
  const sessionFor = (call: FanslyApiCall): ApiSession => {
    const session = deps.session.forTab(call.tabId);
    if (session === null || !session.connected || (session.legacyId !== call.accountId && session.canonicalId !== call.accountId) || ['authorization', 'fansly-client-id', 'fansly-session-id'].some((key) => !session.headers[key])) throw new FanslyApiError('CG-FAN-SESSION', 'before-dispatch');
    return session;
  };
  const prepare = async (input: FanslyApiCall, signal: FanslyApiSignal): Promise<FanslyPreparedCall> => {
    // Freeze admission and the JSON before a queue/custody pause. A caller
    // mutating its object during that pause cannot alter the admitted request.
    const call = { ...input, query: { ...input.query } };
    const admitted = admit(call);
    let body: string | undefined;
    try { body = call.method === 'POST' ? JSON.stringify(call.body) : undefined; if (call.method === 'POST' && body === undefined) throw new Error('Invalid body'); }
    catch { throw new FanslyApiError('CG-FAN-REQUEST', 'before-dispatch'); }
    checkAbort(signal);
    await deps.pacer.sync();
    const captured = sessionFor(call);
    const account = captured.canonicalId ?? captured.legacyId;
    const permit = await deps.pacer.acquire(account, call.method, admitted.url.pathname, call.mode, signal);
    let used = false;
    const cancel = (): void => { if (used) return; used = true; permit.release(); };
    return {
      cancel,
      dispatch(guard) {
        if (used) return Promise.reject(new FanslyApiError('CG-FAN-REQUEST', 'before-dispatch'));
        used = true;
        let dispatched = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        const abort = (): void => controller.abort(signal.reason);
        const cleanup = (): void => { clearTimeout(timeout); signal.removeEventListener('abort', abort); permit.release(); };
        try {
          checkAbort(signal);
          const live = sessionFor(call);
          if (!sameSession(captured, live)) throw new FanslyApiError('CG-FAN-SESSION', 'before-dispatch');
          deps.pacer.assertOpen(account);
          const stamp = String(now());
          const headers: Record<string, string> = {
            authorization: live.headers['authorization']!,
            'fansly-client-id': live.headers['fansly-client-id']!,
            'fansly-session-id': live.headers['fansly-session-id']!,
            'fansly-client-ts': stamp,
          };
          const check = live.checks[admitted.family];
          if (check !== undefined) headers['fansly-client-check'] = check;
          if (call.method === 'POST') headers['content-type'] = 'application/json';
          let url = admitted.url.href;
          if (__CG_TEST_HOSTS__) {
            const origin = deps.testOrigin?.();
            if (origin !== undefined) {
              const stand = new URL(origin);
              if (stand.protocol !== 'http:' || stand.hostname !== 'localhost' || stand.username || stand.password || stand.pathname !== '/' || stand.search || stand.hash) throw new FanslyApiError('CG-FAN-REQUEST', 'before-dispatch');
              url = `${stand.origin}${admitted.url.pathname}${admitted.url.search}`;
            }
          }
          const requestId = deps.id();
          if (!deps.session.trackOwnRequest({ requestId, accountId: account, url, stamp, method: call.method })) throw new FanslyApiError('CG-FAN-REQUEST', 'before-dispatch');
          signal.addEventListener('abort', abort, { once: true });
          timeout = setTimeout(() => controller.abort(), 30_000);
          const init: RequestInit = { method: call.method, headers, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body }) };
          guard?.();
          checkAbort(signal);
          // The synchronous guard is adjacent to dispatch. Nothing can wait
          // here after custody (P9d owns the durable intent and the guard).
          dispatched = true;
          const response = deps.send === undefined ? fetch(url, init) : deps.send(url, init);
          return response.then(async (reply): Promise<unknown> => {
            if (reply.status === 429) {
              await deps.session.recordOwnLimit({ requestId, accountId: account, at: now(), source: 'own', method: call.method, pathname: admitted.url.pathname, retryAfterMs: retryAfterMs(reply.headers.get('retry-after'), now()) });
              await deps.pacer.sync();
              throw new FanslyApiError('CG-FAN-RATE-LIMIT', 'after-dispatch', 429, deps.pacer.status(account).cooldownUntil);
            }
            if (reply.status === 401 || reply.status === 403) {
              // Do not disconnect a newly captured session on a stale reply.
              const latest = deps.session.forAccount(account);
              if (latest !== null && sameSession(live, latest)) await deps.session.disconnect(account);
              throw new FanslyApiError('CG-FAN-EXPIRED', 'after-dispatch', reply.status);
            }
            if (!reply.ok) throw new FanslyApiError('CG-FAN-REQUEST', 'after-dispatch', reply.status);
            let json: unknown;
            try { json = await reply.json(); } catch { throw new FanslyApiError('CG-FAN-REQUEST', 'after-dispatch', reply.status); }
            const result = readEnvelope(json, reply.status, admitted.emptyResponse);
            permit.served();
            return result;
          }).catch((error: unknown) => {
            // Even an abort after dispatch is not evidence that a write failed.
            if (error instanceof FanslyApiError && error.phase === 'after-dispatch') throw error;
            throw new FanslyApiError('CG-FAN-REQUEST', 'after-dispatch');
          }).finally(cleanup);
        } catch (error) {
          cleanup();
          return Promise.reject(dispatched ? new FanslyApiError('CG-FAN-REQUEST', 'after-dispatch') : error instanceof Error ? error : new FanslyApiError('CG-FAN-REQUEST', 'before-dispatch'));
        }
      },
    };
  };
  return {
    prepare,
    async request(call, signal) {
      for (let attempt = 0; ; attempt++) {
        try { return await (await prepare(call, signal)).dispatch(); }
        catch (error) {
          const delay = READ_RETRY_DELAYS_MS[attempt];
          if (call.retry !== 'transient' || call.method !== 'GET' || call.mode !== 'queue' || delay === undefined || !(error instanceof FanslyApiError) || error.phase !== 'after-dispatch' || (error.status !== 429 && error.status < 500)) throw error;
          // The failed attempt released its permit. A 429 waits in the same
          // shared lane; a 5xx uses a bounded delay, then reacquires the FIFO.
          await sleep(delay, signal);
        }
      }
    },
  };
}
