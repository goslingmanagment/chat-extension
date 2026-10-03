// Tab and extension pages ↔ background protocol (architecture.md §5.4, §14).
//
// Transport. A ChatSpace tab keeps ONE runtime.Port named `cg-tab` for its
// whole life; requests, responses and events ride it. Extension pages send
// requests with runtime.sendMessage (the response is the reply) and open a
// `cg-page` port when they need events. Every message is the envelope
// below; every `type` has its own schema, checked on both ends.
//
// Sender rules (the background checks before it parses a payload):
// - always: `sender.id === runtime.id` and `sender.frameId === 0`;
// - a tab: its origin is the ChatSpace origin of apps/extension/src/hosts.ts
//   (test builds add the loopback stand), and every request after
//   `tab.register` carries the registered tab session, which the background
//   matches against `sender.tab.id` and the document — a tab cannot claim
//   another tab's session;
// - a page: its URL is `moz-extension://<own uuid>/<page>.html` for one of
//   EXTENSION_PAGES, and a request whose spec lists `pages` comes only from
//   those pages;
// - a request type is accepted only from the sender kinds in its spec
//   (`from`); a tab may ask hub data only for pages of its own binding — the
//   background re-checks that itself.
// Anything else: no answer, a counter, a log record.

import * as z from 'zod/mini';

import { CgErrorWireSchema } from './errors';
import { UuidSchema } from './primitives';

export const TAB_PROTOCOL_VERSION = 1;

/** `runtime.Port` name for the isolated content script ↔ background channel. */
export const TAB_PORT_NAME = 'cg-tab';
/** `runtime.Port` name an extension page opens to receive events. */
export const PAGE_PORT_NAME = 'cg-page';

/** Extension pages allowed to talk to the background: `/<name>.html`. */
export const EXTENSION_PAGES = ['popup', 'options', 'debug-prompt', 'debug-journal'] as const;
export type ExtensionPage = (typeof EXTENSION_PAGES)[number];
export type TabSender = 'tab' | 'page';

// ── Envelope ───────────────────────────────────────────────────────────────

const MessageIdSchema = z.int().check(z.gte(1));
const TypeSchema = z.string().check(z.regex(/^[a-z]+(?:\.[a-zA-Z]+)?$/), z.maxLength(40));

/**
 * `{v: 1, kind, id?, type, payload}`; a response is `ok: true` with a payload
 * or `ok: false` with a CG error. First stage: the envelope with the payload
 * unchecked; the second stage is the payload schema of `type`
 * (`parseTabPayload` in tab-messages.ts). An unknown `type` is rejected there.
 */
export const TabEnvelopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    v: z.literal(TAB_PROTOCOL_VERSION),
    kind: z.literal('req'),
    id: MessageIdSchema,
    type: TypeSchema,
    /** The tab session from `tab.register`; absent on `tab.register` itself and on page requests. */
    tabSessionId: z.optional(UuidSchema),
    payload: z.unknown(),
  }),
  z.discriminatedUnion('ok', [
    z.strictObject({
      v: z.literal(TAB_PROTOCOL_VERSION),
      kind: z.literal('res'),
      id: MessageIdSchema,
      type: TypeSchema,
      ok: z.literal(true),
      payload: z.unknown(),
    }),
    z.strictObject({
      v: z.literal(TAB_PROTOCOL_VERSION),
      kind: z.literal('res'),
      id: MessageIdSchema,
      type: TypeSchema,
      ok: z.literal(false),
      error: CgErrorWireSchema,
    }),
  ]),
  z.strictObject({
    v: z.literal(TAB_PROTOCOL_VERSION),
    kind: z.literal('evt'),
    type: TypeSchema,
    payload: z.unknown(),
  }),
]);
export type TabEnvelope = z.infer<typeof TabEnvelopeSchema>;

