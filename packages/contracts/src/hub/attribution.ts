// Who sent each outgoing message (1.21.0, decision X48; hub
// `clientSendAttributions`, capability `send-attribution-v1`). A person
// pressed the site's own Send, the page's own response to exactly that send
// named the platform's message id, and the background reports it: this page,
// this message, this fan, when, with a price or media or neither. The person
// is the hub's — the user of the token — never a field of ours. No text of a
// message travels.
//
// The request mirrors the hub's strict body exactly (the vendored SDK checks
// it first; a looser mirror would accept what the hub refuses), the answer is
// open like every hub answer: an outcome this build does not know is final
// all the same.

import * as z from 'zod/mini';

import { NativeIdSchema, OpenTokenSchema, boundedText } from '../primitives';
import { PageLabelSchema } from './wire';

/** The clients a report may name, by the page they observe (hub CLIENT_SEND_ATTRIBUTION_SOURCES); open on the wire. */
export const SEND_ATTRIBUTION_SOURCES = ['chatspace-extension'] as const;
export type SendAttributionSource = (typeof SEND_ATTRIBUTION_SOURCES)[number];

/**
 * What the hub did with one fact (hub CLIENT_SEND_ATTRIBUTION_OUTCOMES). Every one is final: `recorded` — the first
 * report of the message; `duplicate` — the same person already reported it for the same fan (a lost answer
 * repeated); `conflict` — someone else, or another fan, came first, and the first report stands; `out_of_range` — the
 * time is more than 5 minutes ahead of the hub's clock or more than 30 days old, nothing is stored.
 */
export const SEND_ATTRIBUTION_OUTCOMES = ['recorded', 'duplicate', 'conflict', 'out_of_range'] as const;
export type SendAttributionOutcome = (typeof SEND_ATTRIBUTION_OUTCOMES)[number];

export const SEND_ATTRIBUTION_LIMITS = {
  /** Facts in one report (hub CLIENT_SEND_ATTRIBUTION_MAX_FACTS). */
  maxFacts: 50,
  /** How old a fact the hub still takes (hub CLIENT_SEND_ATTRIBUTION_MAX_AGE_DAYS); the background keeps less. */
  maxAgeDays: 30,
} as const;

/** The hub's own form of a time in this body (hub CLIENT_SEND_ATTRIBUTION_TIMESTAMP_PATTERN): `toISOString` fits. */
export const SEND_ATTRIBUTION_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export const SendAttributionHubFactSchema = z.strictObject({
  platformMessageId: NativeIdSchema,
  /** The fan the message went to (on OnlyFans the fan id, which is the chat id). */
  fanRef: NativeIdSchema,
  observedAt: z.string().check(z.regex(SEND_ATTRIBUTION_TIMESTAMP_PATTERN)),
  priced: z.boolean(),
  withMedia: z.boolean(),
});
export type SendAttributionHubFact = z.infer<typeof SendAttributionHubFactSchema>;

/** Path `pageLabel`; the body is `source` and `facts`. */
export const SendAttributionsRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  source: boundedText(64),
  facts: z.array(SendAttributionHubFactSchema).check(z.minLength(1), z.maxLength(SEND_ATTRIBUTION_LIMITS.maxFacts)),
});
export type SendAttributionsRequest = z.infer<typeof SendAttributionsRequestSchema>;

export const SendAttributionsResultSchema = z.object({
  pageLabel: z.string(),
  /** One per fact, in the order of the request. */
  results: z.array(z.object({ platformMessageId: z.string(), outcome: OpenTokenSchema })),
  serverNow: z.string(),
});
export type SendAttributionsResult = z.infer<typeof SendAttributionsResultSchema>;
