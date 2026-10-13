// Tab and extension pages ↔ background protocol (architecture.md §5.4, §14;
// R20: docs/project-unite/architecture.md §1.6, §8.5, §12).
//
// Transport. A site's tab (ChatSpace, fansly.com) keeps ONE runtime.Port named
// `cg-tab` for its whole life; requests, responses and events ride it.
// Extension pages send requests with runtime.sendMessage (the response is the
// reply) and open a `cg-page` port when they need events. A site's relay frame
// (1.15.0: «Fansly через вкладку», an extension page framed inside that site's
// tab) opens a `cg-relay` port for as long as it has work. Every message is
// the envelope below; every `type` has its own schema, checked on both ends.
//
// Two registries. The shared one (tab-messages.ts) is every site's and the
// pages'. A site may have its own (1.15.0: tab-messages-fansly.ts): its types
// share one prefix (`fansly.`), the background core checks sender, session,
// site and envelope and hands the body to the site's background chunk, which
// parses it with the site's schemas. A ChatSpace bundle never carries a site
// registry. A type is a word, then up to two dotted words (`op.start`,
// `fansly.notes.read`).
//
// Sender rules (the background checks before it parses a payload):
// - always: `sender.id === runtime.id`;
// - a tab: the top frame (`sender.frameId === 0`); its origin is a site origin
//   of the runtime host table (apps/extension/src/hosts/runtime; test builds
//   add the loopback stand), it registers only as that site, and every request
//   after `tab.register` carries the registered tab session, which the
//   background matches against `sender.tab.id` and the document — a tab cannot
//   claim another tab's session;
// - a page: its URL is `moz-extension://<own uuid>/<page>.html` for one of
//   EXTENSION_PAGES, and a request whose spec lists `pages` comes only from
//   those pages;
// - a relay (1.15.0): its URL is the site's relay page of this extension, in a
//   subframe (`sender.frameId !== 0`) of a tab that holds a registered tab
//   session of that site; it speaks for that tab session and nothing else. The
//   `frameId === 0` rule of `cg-tab` is not relaxed for it;
// - a request type is accepted only from the sender kinds in its spec
//   (`from`); one whose spec lists `hosts` (1.15.0) only from a tab or a relay
//   of those sites (pages are not affected); a tab may ask hub data only for
//   pages of its own binding — the background re-checks that itself.
// Anything else: no answer, a counter, a log record.

import * as z from 'zod/mini';

import { CgErrorWireSchema } from './errors';
import { HOST_KINDS, type HostKind } from './hosts';
import { UuidSchema } from './primitives';

export const TAB_PROTOCOL_VERSION = 1;

/** `runtime.Port` name for the isolated content script ↔ background channel. */
export const TAB_PORT_NAME = 'cg-tab';
/** `runtime.Port` name an extension page opens to receive events. */
export const PAGE_PORT_NAME = 'cg-page';
/** `runtime.Port` name a site's relay frame opens (1.15.0; R20 architecture §8.5). */
export const RELAY_PORT_NAME = 'cg-relay';

/** Extension pages allowed to talk to the background: `/<name>.html`. */
export const EXTENSION_PAGES = ['popup', 'options', 'debug-prompt', 'debug-journal'] as const;
export type ExtensionPage = (typeof EXTENSION_PAGES)[number];
/** `relay` — 1.15.0: a site's relay frame (`cg-relay`), speaking for the tab session it is framed in. */
export type TabSender = 'tab' | 'page' | 'relay';

/** One request type of a registry: its schemas and who may send it. */
export interface TabRequestSpec {
  readonly req: z.ZodMiniType;
  readonly res: z.ZodMiniType;
  readonly from: readonly TabSender[];
  /** Only these pages may send it (when the sender is a page). */
  readonly pages?: readonly ExtensionPage[];
  /** 1.15.0: only a tab or a relay of these sites may send it; absent — of any site. Pages are not affected. */
  readonly hosts?: readonly HostKind[];
}

/** One event type of a registry: its schema and who receives it. */
export interface TabEventSpec {
  readonly payload: z.ZodMiniType;
  readonly to: readonly TabSender[];
}

/**
 * The sender rules of one request spec (1.15.0, shared by every registry): the sender kind is in `from`; a page is
 * one of `pages` when the spec names them; a tab or a relay is of one of `hosts` when the spec names them (`host` —
 * the site of the tab, or of the tab the relay is framed in; null for a page).
 */
export function senderAllowed(spec: TabRequestSpec, sender: TabSender, page: ExtensionPage | null, host: HostKind | null): boolean {
  if (!spec.from.includes(sender)) return false;
  if (sender === 'page') return spec.pages === undefined || (page !== null && spec.pages.includes(page));
  return spec.hosts === undefined || (host !== null && spec.hosts.includes(host));
}

// ── Envelope ───────────────────────────────────────────────────────────────

const MessageIdSchema = z.int().check(z.gte(1));
/** A word, then up to two dotted words (1.15.0: two, for a site's own types such as `fansly.notes.read`). */
const TypeSchema = z.string().check(z.regex(/^[a-z]+(?:\.[a-zA-Z]+){0,2}$/), z.maxLength(40));

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


// ── tab.register (light) ───────────────────────────────────────────────────
// The first request of a tab document, sent from the early isolated bundle;
// its schemas live here so that bundle does not load the request registry
// (tab-messages.ts uses these same objects).

const ContractsVersionSchema = z.string().check(z.minLength(1), z.maxLength(32));

export const TabRegisterRequestSchema = z.strictObject({
  host: z.enum(HOST_KINDS),
  /** The script arrived after document_start: the tab predates this extension instance (UP-009). */
  lateInjection: z.boolean(),
  contractsVersion: ContractsVersionSchema,
});
export type TabRegisterRequest = z.infer<typeof TabRegisterRequestSchema>;

/** The background mints the tab session (§5.1). */
export const TabRegisterResponseSchema = z.strictObject({ tabSessionId: UuidSchema, contractsVersion: ContractsVersionSchema, testBuild: z.boolean() });
export type TabRegisterResponse = z.infer<typeof TabRegisterResponseSchema>;
