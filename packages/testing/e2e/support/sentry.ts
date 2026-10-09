// What the page's Sentry sent to the stand's collector (?stand-sentry=1,
// fixture-chatspace/src/sentry.ts; decision X22), read as the Sentry server
// would: envelopes of newline-separated JSON — a header, then each item's
// header (`type`, maybe `length`) and payload.

import type { SentryEnvelope } from '../../src/stand/sentry-inbox';
import { standServer } from './stand';

export interface SentryItem {
  readonly type: string;
  readonly payload: unknown;
}

export interface SentryFrame {
  readonly filename?: string;
  readonly function?: string;
  readonly abs_path?: string;
}

/** The parts of an error event this check reads (Sentry's event payload). */
export interface SentryEvent {
  readonly message?: string;
  readonly exception?: { readonly values?: ReadonlyArray<{ readonly type?: string; readonly value?: string; readonly mechanism?: { readonly type?: string; readonly data?: Record<string, unknown> }; readonly stacktrace?: { readonly frames?: readonly SentryFrame[] } }> };
  readonly breadcrumbs?: ReadonlyArray<{ readonly category?: string; readonly message?: string; readonly type?: string; readonly data?: Record<string, unknown> }>;
  readonly request?: { readonly url?: string };
  readonly extra?: Record<string, unknown>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The items of one envelope; a payload that is not JSON stays a string. */
export function envelopeItems(raw: string): SentryItem[] {
  const bytes = encoder.encode(raw);
  let at = 0;
  const line = (): string | null => {
    if (at >= bytes.length) return null;
    let end = bytes.indexOf(0x0a, at);
    if (end === -1) end = bytes.length;
    const text = decoder.decode(bytes.subarray(at, end));
    at = end + 1;
    return text;
  };
  const json = (text: string): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };
  line(); // the envelope's own header
  const items: SentryItem[] = [];
  for (let header = line(); header !== null; header = line()) {
    if (header.trim() === '') continue;
    const head = json(header) as { type?: unknown; length?: unknown };
    let payload: string | null;
    if (typeof head.length === 'number') {
      payload = decoder.decode(bytes.subarray(at, at + head.length));
      at += head.length + 1;
    } else payload = line();
    items.push({ type: typeof head.type === 'string' ? head.type : 'unknown', payload: payload === null ? null : json(payload) });
  }
  return items;
}

/** Every envelope the page's Sentry sent since `since`. */
export async function sentryEnvelopes(since = 0): Promise<readonly SentryEnvelope[]> {
  return (await standServer.sentry(since)).envelopes;
}

/** The error events among them. */
export function sentryEvents(envelopes: readonly SentryEnvelope[]): SentryEvent[] {
  return envelopes.flatMap((envelope) => envelopeItems(envelope.raw).filter((item) => item.type === 'event').map((item) => item.payload as SentryEvent));
}

/** An event's own words: its message and its exceptions' type and value. */
export const eventText = (event: SentryEvent): string => [event.message ?? '', ...(event.exception?.values ?? []).map((value) => `${value.type ?? ''}: ${value.value ?? ''}`)].join(' | ');
