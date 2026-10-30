// The client of Fansly's API: the only code of the extension that requests
// Fansly (R20 docs/project-unite/architecture.md §8.1, §8.3; spec FS-NET-1,
// FS-NET-3). It runs in Fansly's background chunk (`bg/fansly`), over the
// core's session owner (P9a, `BackgroundKit.networkSession`) and the pacer.
//
// A call names its purpose and its route (allowlist.ts): a pair FS-NET-1 does
// not name is refused before anything else. Then, in this order:
// 1. the session: the core restored it (`ready`) and holds a confirmed
//    template of the creator — none by its id, each session not yet tied to
//    a creator asks `/account/me` first (X62, AU-032); still none, `session`
//    (no old headers, no fallback, §8.2);
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
// before the custody, the route) and `start` — synchronous up to `fetch`, so
// the caller's final check and the request have no `await` between them.
//
// R20 P9c: the route (transport.ts) is chosen in `prepare`, after the pacer's
// turn: the event page's own `fetch`, or with «Fansly через вкладку» the relay
// frame of the model's tab, up and answering before anything goes to the hub's
// custody — no frame in time is `tab`, provably unsent, and never the direct
// route instead. `start` asks the route whether it still holds (the same frame,
// tab, document and session) right before it sends; the route dispatches before
// it yields. A direct request with no answer is told to the transport, which
// then tries the tab until the browser restarts (transport.ts).

import { admit, addressOf, FANSLY_API_BASE, FANSLY_ROUTES, type FanslyAddressParts, type FanslyPurpose, type FanslyRouteName, type FanslyRouteSpec } from './allowlist';
import { FanslyApiError, readEnvelope, retryAfterMs } from './errors';
import { PacerAborted, PacerCooling, type FanslyPacer, type PacerCreator, type PacerPass } from './pacer/pacer';
import { REQUEST_RULES } from './pacer/rules';
import { FanslyRouteRefused, FanslyRouteUnavailable, directTransport, type FanslyFetch, type FanslyHttpResponse, type FanslyRoute, type FanslyTransport, type FanslyTransportLabel } from './transport';

/** A session template of a creator as the core holds it (core/services/network-session.ts `SessionTemplate`, structurally). */
export interface FanslySessionTemplate {
  readonly legacyId: string;
  readonly canonicalId: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly checks: Readonly<Record<string, string>>;
  readonly connected: boolean;
  readonly observedAt: number;
}

/** The core's session owner, as the client uses it (`BackgroundKit.networkSession`, structurally). */
export interface FanslySessionPort {
  /** The restoration barrier after the event page wakes. */
  readonly ready: Promise<void>;
  /** The confirmed template of a creator by either of its ids; null — none (or not usable). */
  forAccount(accountId: string): FanslySessionTemplate | null;
  /** Fansly answered 401/403 to this session: unusable until the page's next accepted request. */
  disconnect(accountId: string, expected: FanslySessionTemplate): Promise<void>;
  /** AU-032: the connected sessions no `/account/me` has tied to their creator yet. */
  unidentified?(): readonly FanslySessionTemplate[];
  /** AU-032: `/account/me` asked with `expected` named `canonicalId` (bound while its material headers are unchanged). */
  resolveIdentity?(legacyId: string, canonicalId: string, expected: FanslySessionTemplate): Promise<void>;
}

export interface FanslyCall extends FanslyAddressParts {
  readonly purpose: FanslyPurpose;
  readonly route: FanslyRouteName;
  /** The creator whose session the request carries (either of its ids). */
  readonly account: string;
  /** A write's body (JSON). */
  readonly body?: unknown;
  /**
   * `tab` — through the relay frame of the session's tab even while «Fansly через вкладку» is off (transport.ts
   * `FanslyRouteRequest.tab`): an answer whose CDN addresses the tab itself must load (they are signed for the line
   * that read them, and the tab rides its container's proxy). Absent — the person's switch decides.
   */
  readonly via?: 'tab';
  readonly signal?: AbortSignal;
}

/** The answer of a call: the envelope's `response` (undefined for a route whose answer may carry none). */
export interface FanslyAnswer {
  readonly response: unknown;
  readonly status: number;
}

/** A call admitted, paced and routed, not sent yet. */
export interface PreparedFanslyCall {
  /** One client fetch, even if the browser resends it internally (X41). */
  readonly requestId: string;
  /** Where it goes (§8.5): `direct`, or `tab:<tabSessionId>` of the relay frame — a part of P9d's tuple. */
  readonly transport: FanslyTransportLabel;
  /** The route's part of the last check, synchronous (transport.ts `FanslyRoute.holds`); `start` asks it too. */
  holds(): boolean;
  /** Sends it: synchronous up to `fetch` (the template is read now). Once. */
  start(): Promise<FanslyAnswer>;
  /** Not sent after all (the caller's own check refused it): the pacer's turn is given back. */
  cancel(): void;
}

export interface FanslyClientDeps {
  readonly session: FanslySessionPort;
  readonly pacer: FanslyPacer;
  /** Where the requests go: FANSLY_API_BASE; a test build hands the stand's API (`http://localhost:<port>/api/v1/`). */
  readonly base?: string;
  readonly fetch?: FanslyFetch;
  /** Where a ready request leaves (R20 P9c, transport.ts): the event page's own `fetch` by default. */
  readonly transport?: FanslyTransport;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** The session headers a request carries from the template (the page's own names, lower case). */
export const REQUEST_ID_HEADER = 'x-cg-request-id';

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

const notSent = (kind: 'not-admitted' | 'session' | 'aborted' | 'tab'): FanslyApiError => new FanslyApiError(kind, { sent: false });

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/** How long a session whose `/account/me` failed waits before it is asked again. */
const IDENTIFY_RETRY_MS = 60_000;

/** `account.id` of an `/account/me` answer. */
const creatorIdOf = (response: unknown): string | null => {
  const account = typeof response === 'object' && response !== null ? (response as { account?: unknown }).account : undefined;
  const id = typeof account === 'object' && account !== null ? (account as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : null;
};

export function createFanslyClient(deps: FanslyClientDeps) {
  const base = deps.base ?? FANSLY_API_BASE;
  const doFetch: FanslyFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const transport = deps.transport ?? directTransport(doFetch);
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? sleepFor;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const creatorOf = (template: FanslySessionTemplate): PacerCreator => ({ legacyId: template.legacyId, canonicalId: template.canonicalId });
  /** When each session's `/account/me` was asked, by its legacy id. */
  const asked = new Map<string, number>();

  /**
   * AU-032: no session names this creator by its id, yet a page's token may name another id than the creator its
   * `/account/me` shows. Each session no answer has tied yet asks `/account/me` itself (at most once a minute), and the
   * answer binds the creator to exactly that session — the old extension's identity lookup.
   */
  async function identify(account: string, signal?: AbortSignal): Promise<FanslySessionTemplate | null> {
    for (const template of deps.session.unidentified?.() ?? []) {
      if ((asked.get(template.legacyId) ?? -Infinity) > now() - IDENTIFY_RETRY_MS) continue;
      asked.set(template.legacyId, now());
      try {
        const answer = await call({ purpose: 'identity', route: 'account.me', account: template.legacyId, ...(signal === undefined ? {} : { signal }) });
        const creator = creatorIdOf(answer.response);
        if (creator !== null) await deps.session.resolveIdentity?.(template.legacyId, creator, template);
      } catch {
        // This session stays unidentified; it is asked again after IDENTIFY_RETRY_MS.
      }
      const found = deps.session.forAccount(account);
      if (found !== null) return found;
    }
    return null;
  }

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
    await deps.session.ready.catch(() => { throw notSent('session'); });
    await deps.pacer.ready;
    const template = deps.session.forAccount(call.account) ?? (call.purpose === 'identity' ? null : await identify(call.account, call.signal));
    // The identity's own questions may have outlived the caller.
    if (template === null && isAborted(call.signal)) throw notSent('aborted');
    if (template === null || !template.connected) throw notSent('session');
    let pass: PacerPass;
    try {
      pass = await deps.pacer.enter(creatorOf(template), spec.pace, admission.mode, call.signal);
    } catch (error) {
      if (error instanceof PacerCooling) throw new FanslyApiError('cooling', { sent: false, retryAt: error.until });
      if (error instanceof PacerAborted) throw notSent('aborted');
      throw error;
    }
    // The route after the pacer's turn, before anything is handed to the custody: a frame raised now serves the request at once.
    let route: FanslyRoute;
    try {
      route = await transport.route({ legacyId: template.legacyId, canonicalId: template.canonicalId, ...(call.via === 'tab' ? { tab: true } : {}), ...(call.signal === undefined ? {} : { signal: call.signal }) });
    } catch (error) {
      pass.release();
      throw notSent(error instanceof FanslyRouteUnavailable && error.reason === 'aborted' ? 'aborted' : 'tab');
    }
    const requestId = crypto.randomUUID();
    let used = false;
    return {
      requestId,
      transport: route.transport,
      holds: () => route.holds(),
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
        // The route's part of the last check: the same frame, tab, document and session (or the switch still off).
        if (!route.holds()) {
          pass.release();
          return Promise.reject(notSent('tab'));
        }
        const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };
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
        // No await between this final admission and fetch (P9d custody).
        try {
          const until = deps.pacer.coolingUntil(creatorOf(live));
          if (until > now()) throw new PacerCooling(until);
          pass.start(requestId);
        } catch (error) {
          finish();
          pass.release();
          return Promise.reject(error instanceof PacerCooling ? new FanslyApiError('cooling', { sent: false, retryAt: error.until }) : notSent('aborted'));
        }
        let request: Promise<FanslyHttpResponse>;
        try {
          // `credentials: 'omit'`, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'` — the route's (the relay frame's too).
          request = route.send({ url, path: url.slice(base.length), method: spec.method, headers, ...(body === undefined ? {} : { body }), signal: controller.signal });
        } catch {
          request = Promise.reject(new TypeError('send threw'));
        }
        return answerOf(request, () => timedOut, live, pass, spec, route.transport === 'direct', call.signal).finally(() => {
          finish();
          pass.release();
        });
      },
    };
  }

  /** Reads the answer of a request; the pass learns what Fansly said of the pace. */
  async function answerOf(request: Promise<FanslyHttpResponse>, timedOut: () => boolean, template: FanslySessionTemplate, pass: PacerPass, spec: FanslyRouteSpec, direct: boolean, signal?: AbortSignal): Promise<FanslyAnswer> {
    let response: FanslyHttpResponse;
    let text: string;
    /** No answer: the direct route tells its transport (the next requests try the tab), unless the caller gave up. */
    const unanswered = (): FanslyApiError => {
      if (direct && !isAborted(signal)) transport.unanswered?.();
      return new FanslyApiError(timedOut() ? 'timeout' : 'network', { sent: true, direct });
    };
    try {
      response = await request;
    } catch (error) {
      // The route took nothing (no frame took the post, or the frame's own check refused): provably no request.
      if (error instanceof FanslyRouteRefused) throw notSent('tab');
      throw unanswered();
    }
    const status = response.status;
    if (status === 429) {
      const retryAt = await pass.limited(retryAfterMs(response.headers.get('retry-after'), now()));
      throw new FanslyApiError('rate-limited', { sent: true, httpStatus: 429, retryAt });
    }
    if (status === 401 || status === 403) {
      await deps.session.disconnect(template.legacyId, template).catch(() => undefined);
      throw new FanslyApiError('expired', { sent: true, httpStatus: status });
    }
    if (status < 200 || status >= 300) throw new FanslyApiError('http', { sent: true, httpStatus: status });
    try {
      text = await response.text();
    } catch {
      throw unanswered();
    }
    const reading = readEnvelope(status, text, spec.emptyAnswer === true);
    if (!reading.ok) throw reading.error;
    // Only a validated envelope counts as Fansly answering (E133).
    if (!spec.write) pass.served();
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

  return { prepare, call, identify, base, transport };
}

export type FanslyClient = ReturnType<typeof createFanslyClient>;
