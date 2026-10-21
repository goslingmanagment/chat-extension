// What a request of ours to Fansly ends with, and how an answer is read
// (R20 docs/project-unite/architecture.md §8.3; spec FS-NET-3, RB-023, ER-050,
// ER-051; the codes: contracts/src/errors-fansly.ts, docs/architecture.md
// Appendix A «Коды Fansly»).
//
// Fansly answers in an envelope `{success, response}`:
// - 2xx with `success: true` — the answer (`response`; a delete may have none);
// - 2xx with `success: false` — a refusal, not an answer (ER-051): it earns the
//   pacer nothing, its code is kept (a number or a short token, never a text);
// - 401 / 403 — the session expired (ER-050): the template is marked
//   disconnected until the page's next accepted request;
// - 429 — the creator cools down (the pacer, pacer/pacer.ts);
// - another status, a body that is not the envelope, no answer — an error.
//
// `sent` tells whether a request may have left: false — provably none (refused
// before `fetch`: not admitted, no session, the creator cooling down, aborted
// while waiting); true — `fetch` was called, and for a write the outcome is
// the caller's to read (§8.6: a 4xx but 401 refuses, the rest is uncertain).
// Nothing here carries a header, a body or a text of a message.

import type { CgAnyCode, CgAnyErrorWire } from '@cg/contracts/errors-fansly';

export type FanslyFailureKind =
  /** FS-NET-1 does not name the call, or its address does not fit the route. */
  | 'not-admitted'
  /** No session template of this creator (no tab of the model asked Fansly yet, or it expired). */
  | 'session'
  /** Our own refusal: the creator cools down and the call may not wait (check, dispatch, `POST /group`). */
  | 'cooling'
  /** The caller gave up (a pause, a closed window). */
  | 'aborted'
  /**
   * «Fansly через вкладку» (FS-NET-4, R20 P9c): no tab of the session holds a relay frame that came up in time, the
   * route no longer holds (its document, account or tab changed), or the frame refused by its own last check. Never
   * the direct route instead; with `sent: false` — provably no request.
   */
  | 'tab'
  /** Fansly answered 429. */
  | 'rate-limited'
  /** Fansly answered 401 or 403. */
  | 'expired'
  /** HTTP 2xx with `success: false`. */
  | 'refused'
  /** Another status. */
  | 'http'
  /** A 2xx whose body is not Fansly's envelope (an edge page, no `response`). */
  | 'malformed'
  /** No answer: the connection failed. */
  | 'network'
  /** No answer in time. */
  | 'timeout';

const CODES: Readonly<Record<FanslyFailureKind, CgAnyCode>> = {
  'not-admitted': 'CG-FAN-REQUEST',
  session: 'CG-FAN-SESSION',
  cooling: 'CG-FAN-RATE-LIMIT',
  aborted: 'CG-OP-INTERRUPTED',
  tab: 'CG-FAN-TAB',
  'rate-limited': 'CG-FAN-RATE-LIMIT',
  expired: 'CG-FAN-EXPIRED',
  refused: 'CG-FAN-REQUEST',
  http: 'CG-FAN-REQUEST',
  malformed: 'CG-FAN-REQUEST',
  network: 'CG-FAN-REQUEST',
  timeout: 'CG-FAN-REQUEST',
};

export interface FanslyFailureFacts {
  /** Whether `fetch` was called: false — provably no request left. */
  readonly sent: boolean;
  readonly httpStatus?: number;
  /** Fansly's own code of a refusal (`error.code`), as a short token. */
  readonly fanslyCode?: string;
  /** Not before then (a cooldown): epoch ms. */
  readonly retryAt?: number;
  /**
   * The request went from the event page itself, not through a tab's relay frame: its `network` or `timeout` is
   * CG-FAN-NETWORK, which points to «Fansly через вкладку» (2026-10-21 audit №9; the old extension's CG-NET-01).
   */
  readonly direct?: boolean;
}

export class FanslyApiError extends Error {
  override readonly name = 'FanslyApiError';
  readonly kind: FanslyFailureKind;
  readonly code: CgAnyCode;
  readonly sent: boolean;
  readonly httpStatus: number | undefined;
  readonly fanslyCode: string | undefined;
  readonly retryAt: number | undefined;

  constructor(kind: FanslyFailureKind, facts: FanslyFailureFacts) {
    super(`fansly-api: ${kind}${facts.httpStatus === undefined ? '' : ` (HTTP ${facts.httpStatus})`}`);
    this.kind = kind;
    this.code = facts.direct === true && (kind === 'network' || kind === 'timeout') ? 'CG-FAN-NETWORK' : CODES[kind];
    this.sent = facts.sent;
    this.httpStatus = facts.httpStatus;
    this.fanslyCode = facts.fanslyCode;
    this.retryAt = facts.retryAt;
  }

  /** The wire form for a Fansly message's payload (CgAnyErrorWire): the code, its deadline, the status. */
  toWire(): CgAnyErrorWire {
    return {
      code: this.code,
      ...(this.retryAt === undefined ? {} : { retryAt: Math.round(this.retryAt) }),
      ...(this.httpStatus === undefined || this.httpStatus < 100 ? {} : { httpStatus: this.httpStatus }),
    };
  }
}

export const isFanslyApiError = (value: unknown): value is FanslyApiError => value instanceof FanslyApiError;

/** Fansly's code of a refusal: a number or a short token, nothing longer (it is counted, never shown). */
function refusalCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number' && Number.isFinite(code)) return String(code).slice(0, 40);
  if (typeof code === 'string' && /^[\w-]{1,40}$/.test(code)) return code;
  return undefined;
}

export type EnvelopeReading = { readonly ok: true; readonly response: unknown } | { readonly ok: false; readonly error: FanslyApiError };

/**
 * Reads a 2xx body as Fansly's envelope. `emptyAnswer` — the route's answer may carry no `response` (a delete).
 * `success: false` is a refusal whatever the status (ER-051); a body that is not JSON or not the envelope is malformed.
 */
export function readEnvelope(status: number, body: string, emptyAnswer = false): EnvelopeReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return { ok: false, error: new FanslyApiError('malformed', { sent: true, httpStatus: status }) };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: new FanslyApiError('malformed', { sent: true, httpStatus: status }) };
  const envelope = parsed as { success?: unknown; response?: unknown; error?: unknown };
  if (envelope.success !== true) {
    const fanslyCode = refusalCode(envelope.error);
    return { ok: false, error: new FanslyApiError('refused', { sent: true, httpStatus: status, ...(fanslyCode === undefined ? {} : { fanslyCode }) }) };
  }
  if (envelope.response === undefined && !emptyAnswer) return { ok: false, error: new FanslyApiError('malformed', { sent: true, httpStatus: status }) };
  return { ok: true, response: envelope.response };
}

/** A server-requested wait (`Retry-After`, seconds or an HTTP date) in ms; undefined — none or unreadable. */
export function retryAfterMs(value: string | null | undefined, now: number): number | undefined {
  const text = value?.trim();
  if (text === undefined || text === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
