// The client of Fansly's API: the only code of the extension that requests
// Fansly (R20 docs/project-unite/architecture.md §8.1, §8.3; spec FS-NET-1,
// FS-NET-3). It runs in Fansly's background chunk (`bg/fansly`), over the
// core's session owner (P9a, `BackgroundKit.networkSession`) and the pacer.
//
// A call names its purpose and its route (allowlist.ts): a pair FS-NET-1 does
// not name is refused before anything else. Then, in this order:
// 1. the session: the core restored it (`ready`) and holds a confirmed
//    template of the creator — without one, `session` (no old headers, no
//    fallback, §8.2);
// 2. the pacer, by the call's mode (pacer/pacer.ts): it may wait (a queued
//    read) or refuse (`cooling`) — no request then;
// 3. the request, built synchronously from the template as it is NOW: its
//    `authorization`, `fansly-client-id`, `fansly-session-id`, a fresh
//    `fansly-client-ts` and the accepted `fansly-client-check` of the route's
//    family (never the shared sample, never a stored per-request value
//    replayed: §8.3); the address under the base with `ngsw-bypass=true`;
//    `credentials: 'omit'` (no cookie of the page), no redirect followed;
// 4. the answer, read as Fansly's envelope (errors.ts): `success: false` with
//    200 is an error (ER-051), 401/403 marks the session disconnected
//    (ER-050), 429 cools the creator down (the pass tells the pacer).
//
// A read of a running pass may be asked again (RB-023): after 1, 2 and 4 s on
// a 5xx, after the cooldown on a 429 (its next turn waits it out). A read of a
// click is asked once. A write is asked once, never again on an unclear
// outcome (FS-NET-3).
//
// A write the hub's custody guards (§8.6) is made in two steps: `prepare`
// (everything that may wait: the session, the pacer, a cooldown refuses it
// before the custody) and `start` — synchronous up to `fetch`, so the caller's
// final check and the request have no `await` between them.

import { admit, addressOf, FANSLY_API_BASE, FANSLY_ROUTES, type FanslyAddressParts, type FanslyPurpose, type FanslyRouteName, type FanslyRouteSpec } from './allowlist';
import { FanslyApiError, readEnvelope, retryAfterMs } from './errors';
import { PacerAborted, PacerCooling, type FanslyPacer, type PacerCreator, type PacerPass } from './pacer/pacer';
import { REQUEST_RULES } from './pacer/rules';

/** A session template of a creator as the core holds it (core/services/network-session.ts `SessionTemplate`, structurally). */
export interface FanslySessionTemplate {
  readonly legacyId: string;
  readonly canonicalId: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly checks: Readonly<Record<string, string>>;
  readonly connected: boolean;
}

/** The core's session owner, as the client uses it (`BackgroundKit.networkSession`, structurally). */
export interface FanslySessionPort {
  /** The restoration barrier after the event page wakes. */
  readonly ready: Promise<void>;
  /** The confirmed template of a creator by either of its ids; null — none (or not usable). */
  forAccount(accountId: string): FanslySessionTemplate | null;
  /** Fansly answered 401/403 to this session: unusable until the page's next accepted request. */
  disconnect(accountId: string): Promise<void>;
}

export interface FanslyCall extends FanslyAddressParts {
  readonly purpose: FanslyPurpose;
  readonly route: FanslyRouteName;
  /** The creator whose session the request carries (either of its ids). */
  readonly account: string;
  /** A write's body (JSON). */
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/** The answer of a call: the envelope's `response` (undefined for a route whose answer may carry none). */
export interface FanslyAnswer {
  readonly response: unknown;
  readonly status: number;
}

/** A call admitted and paced, not sent yet. */
export interface PreparedFanslyCall {
  /** Sends it: synchronous up to `fetch` (the template is read now). Once. */
  start(): Promise<FanslyAnswer>;
  /** Not sent after all (the caller's own check refused it): the pacer's turn is given back. */
  cancel(): void;
}

/** The response as the client reads it: a status, the one header it needs and the body as text. */
export interface FanslyHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FanslyFetch = (url: string, init: RequestInit) => Promise<FanslyHttpResponse>;

export interface FanslyClientDeps {
  readonly session: FanslySessionPort;
  readonly pacer: FanslyPacer;
  /** Where the requests go: FANSLY_API_BASE; a test build hands the stand's API (`http://localhost:<port>/api/v1/`). */
  readonly base?: string;
  readonly fetch?: FanslyFetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** The session headers a request carries from the template (the page's own names, lower case). */
const SESSION_HEADERS = ['authorization', 'fansly-client-id', 'fansly-session-id'] as const;

const sleepFor = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(new PacerAborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted === true) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });

const notSent = (kind: 'not-admitted' | 'session' | 'aborted'): FanslyApiError => new FanslyApiError(kind, { sent: false });

export function createFanslyClient(deps: FanslyClientDeps) {
  const base = deps.base ?? FANSLY_API_BASE;
  const doFetch: FanslyFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? sleepFor;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const creatorOf = (template: FanslySessionTemplate): PacerCreator => ({ legacyId: template.legacyId, canonicalId: template.canonicalId });

  /** Admission, the session and the pacer: everything that may wait or refuse before a request. */
  async function prepare(call: FanslyCall): Promise<PreparedFanslyCall> {
    const admission = admit(call.purpose, call.route);
    if (admission === null) throw notSent('not-admitted');
    const spec: FanslyRouteSpec = FANSLY_ROUTES[call.route];
    const url = addressOf(base, call.route, call);
    if (url === null || (call.body !== undefined) !== spec.write) throw notSent('not-admitted');
    let body: string | undefined;
    if (spec.write) {
      body = JSON.stringify(call.body);
      if (body.length > REQUEST_RULES.bodyMaxChars) throw notSent('not-admitted');
    }
    if (call.signal?.aborted === true) throw notSent('aborted');
    await deps.session.ready;
    await deps.pacer.ready;
    const template = deps.session.forAccount(call.account);
    if (template === null || !template.connected) throw notSent('session');
    let pass: PacerPass;
    try {
      pass = await deps.pacer.enter(creatorOf(template), spec.pace, admission.mode, call.signal);
    } catch (error) {
      if (error instanceof PacerCooling) throw new FanslyApiError('cooling', { sent: false, retryAt: error.until });
      if (error instanceof PacerAborted) throw notSent('aborted');
      throw error;
    }
    let used = false;
    return {
      cancel() {
        if (used) return;
        used = true;
        pass.release();
      },
      start() {
        if (used) return Promise.reject(notSent('aborted'));
        used = true;
        // Synchronous up to `fetch`: the template as it is now, a fresh timestamp, the route family's accepted check.
        if (call.signal?.aborted === true) {
          pass.release();
          return Promise.reject(notSent('aborted'));
        }
        const live = deps.session.forAccount(call.account);
        if (live === null || !live.connected || live.legacyId !== template.legacyId) {
          pass.release();
          return Promise.reject(notSent('session'));
        }
        const headers: Record<string, string> = {};
        for (const name of SESSION_HEADERS) {
          const value = live.headers[name];
          if (value !== undefined) headers[name] = value;
        }
        headers['fansly-client-ts'] = String(now());
        const check = spec.checkFamily === null ? undefined : live.checks[spec.checkFamily];
        if (check !== undefined) headers['fansly-client-check'] = check;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        call.signal?.addEventListener('abort', abort, { once: true });
        let timedOut = false;
        const timer = setTimer(() => {
          timedOut = true;
          controller.abort();
        }, REQUEST_RULES.timeoutMs);
        const finish = (): void => {
          clearTimer(timer);
          call.signal?.removeEventListener('abort', abort);
        };
        let request: Promise<FanslyHttpResponse>;
        try {
          request = doFetch(url, {
            method: spec.method,
            headers,
            ...(body === undefined ? {} : { body }),
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          });
        } catch {
          request = Promise.reject(new TypeError('fetch threw'));
        }
        return answerOf(request, () => timedOut, live, pass, spec).finally(() => {
          finish();
          pass.release();
        });
      },
    };
  }

  /** Reads the answer of a request; the pass learns what Fansly said of the pace. */
  async function answerOf(request: Promise<FanslyHttpResponse>, timedOut: () => boolean, template: FanslySessionTemplate, pass: PacerPass, spec: FanslyRouteSpec): Promise<FanslyAnswer> {
    let response: FanslyHttpResponse;
    let text: string;
    try {
      response = await request;
      text = await response.text();
    } catch {
      throw new FanslyApiError(timedOut() ? 'timeout' : 'network', { sent: true });
    }
    const status = response.status;
    if (status === 429) {
      const retryAt = await pass.limited(retryAfterMs(response.headers.get('retry-after'), now()));
      throw new FanslyApiError('rate-limited', { sent: true, httpStatus: 429, retryAt });
    }
    if (status === 401 || status === 403) {
      await deps.session.disconnect(template.legacyId).catch(() => undefined);
      throw new FanslyApiError('expired', { sent: true, httpStatus: status });
    }
    if (status < 200 || status >= 300) throw new FanslyApiError('http', { sent: true, httpStatus: status });
    const reading = readEnvelope(status, text, spec.emptyAnswer === true);
    if (!reading.ok) throw reading.error;
    // Only a validated envelope counts as Fansly answering (E133).
    pass.served();
    return { response: reading.response, status };
  }

  /** A call made through: one attempt, or for a read of a pass up to its admission's attempts (RB-023). */
  async function call(request: FanslyCall): Promise<FanslyAnswer> {
    const admission = admit(request.purpose, request.route);
    if (admission === null) throw notSent('not-admitted');
    const attempts = FANSLY_ROUTES[request.route].write ? 1 : admission.attempts;
    for (let attempt = 0; ; attempt++) {
      try {
        return await (await prepare(request)).start();
      } catch (error) {
        if (!(error instanceof FanslyApiError) || attempt + 1 >= attempts) throw error;
        // A 429: the next turn waits out the cooldown in the queue. A 5xx: a short pause first.
        if (error.kind === 'http' && (error.httpStatus ?? 0) >= 500) {
          try {
            await sleep(REQUEST_RULES.retryDelaysMs[Math.min(attempt, REQUEST_RULES.retryDelaysMs.length - 1)] ?? 0, request.signal);
          } catch {
            // The earlier attempt did leave.
            throw new FanslyApiError('aborted', { sent: true });
          }
          continue;
        }
        if (error.kind !== 'rate-limited') throw error;
      }
    }
  }

  return { prepare, call, base };
}

export type FanslyClient = ReturnType<typeof createFanslyClient>;
