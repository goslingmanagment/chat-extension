// The board «Отчёт» (hub package R, 2026-11-15; 8-docs/2026-11-13-products/parts/R-protocol.md): what the extension and
// Hub's board page in its frame say to each other, and what the extension's tab and background say of it.
//
// - Hub's Workboard draws the board at `<team origin>/workboard/frame/report`; the extension puts that page in an
//   iframe of its closed root over the site (host-kit isolated/report-board.ts). No credential enters the frame: every
//   API request of the board crosses a `MessagePort` to the content script and on to the background, which runs it with
//   the device token, only for the allow-list below (core domain/report-board.ts checks it).
// - The pulse (`clientActivity`) answers `report`: null for a person without the right `submits_shift` (then the
//   launcher's fifth row is not drawn at all).

import * as z from 'zod/mini';

import { CountSchema, HubIntIdSchema, NativeIdSchema, boundedText, displayText } from './primitives';
import { PageLabelSchema } from './hub/wire';

/**
 * The protocol's version (R-protocol «Handshake (version 2)», after the arena's round 3: a page script of the site could
 * answer a broadcast of the frame first). The extension makes a random key, puts it into the frame's address fragment
 * (`#k=<key>&v=2`, unreadable to the site: a closed root, another origin) and posts the port with the key on the
 * frame's `load`, again with a fresh channel every 500 ms until the frame says `ready` on the port. The frame sends
 * nothing to its parent; a window message that claims to be a frame's hello is ignored.
 */
export const REPORT_BOARD_PROTOCOL = 2;
/** The extension's port, transferred with the key, to the team origin only. */
export const REPORT_FRAME_PORT = 'report-board/port';

/**
 * Workboard's screens the extension shows in its frame over the site (the coordinator, 2026-11-15: one host, one
 * handshake, one fetch relay; the background's allow-list is a table per screen). ONE row ships: `report`, the board
 * «Отчёт», at exactly `/workboard/frame/report` (Hub lifts its no-framing headers for that one path only). Another
 * screen («Записать кастом», «Мои деньги») is added here explicitly, with its own Hub path, never by a wildcard.
 */
export const WORKBOARD_FRAME_SCREENS = ['report'] as const;
export type WorkboardFrameScreen = (typeof WORKBOARD_FRAME_SCREENS)[number];
/**
 * The team origin of the production hub (R-protocol «Addresses»): Workboard lives there, the API at the hub's origin.
 * Another hub (a dev hub, the stand's fake hub) serves Workboard's frame pages at its own origin.
 */
export const PRODUCTION_HUB_ORIGIN = 'https://gosling-agency.ru';
export const PRODUCTION_TEAM_ORIGIN = 'https://chatgoose.gosling-agency.ru';
export const teamOriginOf = (hubOrigin: string): string => (hubOrigin === PRODUCTION_HUB_ORIGIN ? PRODUCTION_TEAM_ORIGIN : hubOrigin);
/** Test builds only: a storage.local key that points the frames at another team origin (Hub's demo board on the stand). */
export const TEST_FRAME_ORIGIN_KEY = 'see.frameOrigin';

/** Where Workboard draws a screen for the frame on the team origin: `/workboard/frame/<screen>`. */
export const WORKBOARD_FRAME_PREFIX = '/workboard/frame/';
export const workboardFramePath = (screen: WorkboardFrameScreen): string => `${WORKBOARD_FRAME_PREFIX}${screen}`;

/** The board's phases (hub `shift_handins.phase`); `none` — no shift to report. */
export const REPORT_PHASES = ['draft', 'checking', 'confirm', 'counted', 'fixing', 'none'] as const;
export type ReportPhase = (typeof REPORT_PHASES)[number];

/** The pulse's `report`: the shift that needs the person most and whether it waits for them (the launcher's dot). */
export const ReportPulseSchema = z.object({
  shiftId: z.nullable(HubIntIdSchema),
  /** An open token: a phase this build does not know is read as `none`. */
  phase: z.string().check(z.maxLength(32)),
  needsMe: z.boolean(),
});
export type ReportPulse = z.infer<typeof ReportPulseSchema>;

/** A sale «show on the site» asks for (`find`), as the board holds it. */
export const ReportSaleSchema = z.object({
  transactionId: HubIntIdSchema,
  pageLabel: PageLabelSchema,
  /** `fansly` or `onlyfans`. */
  platform: z.string().check(z.maxLength(16)),
  /** The platform's own transaction id (Fansly's `transactionId`, OnlyFans' statement id); null — Hub holds none. */
  platformRef: z.nullable(NativeIdSchema),
  /** The board's kind of the sale (`media`, `subscription`, `tip`, `message`…): an open token. */
  kind: z.string().check(z.maxLength(32)),
  occurredAt: z.string().check(z.maxLength(40)),
  netMills: z.int(),
  grossMills: z.nullable(z.int()),
  fanName: z.nullable(displayText(256)),
  fanHandle: z.nullable(displayText(64)),
});
export type ReportSale = z.infer<typeof ReportSaleSchema>;

/** Methods the board's requests may carry. */
export const REPORT_FETCH_METHODS = ['GET', 'PUT', 'POST', 'DELETE'] as const;
export type ReportFetchMethod = (typeof REPORT_FETCH_METHODS)[number];
/** The longest body of a board request the background relays (a comment of a sale is ≤ 1000 characters). */
export const REPORT_FETCH_BODY_MAX = 32_768;
/** The longest answer the background hands back to the frame. */
export const REPORT_FETCH_ANSWER_MAX = 2_000_000;

export const ReportFetchRequestSchema = z.strictObject({
  /** The frame's screen: its own allow-list decides. */
  screen: z.enum(WORKBOARD_FRAME_SCREENS),
  method: z.enum(REPORT_FETCH_METHODS),
  path: boundedText(512),
  body: z.nullable(z.string().check(z.maxLength(REPORT_FETCH_BODY_MAX))),
});
export const ReportFetchAnswerSchema = z.union([
  z.strictObject({ status: z.int().check(z.gte(100), z.lte(599)), body: z.string().check(z.maxLength(REPORT_FETCH_ANSWER_MAX)) }),
  z.strictObject({ error: z.enum(['refused', 'network', 'signed_out']) }),
]);
export type ReportFetchAnswer = z.infer<typeof ReportFetchAnswerSchema>;

/** «Show on the site» as the background routed it: here, in another tab it brought forward, or nowhere yet. */
export const ReportFindRouteSchema = z.strictObject({
  where: z.enum(['here', 'tab', 'none']),
});

/** One row of Fansly's wallet list the site itself loaded (a sighting, R-board §5). */
export const SaleSightingRowSchema = z.strictObject({
  platformRef: NativeIdSchema,
  /** Fansly's own transaction type code as a string (`7101`, `15001`…); Hub maps it as its sync does. */
  kind: boundedText(32),
  occurredAt: z.string().check(z.maxLength(40)),
  /** What the site printed: after its fee. */
  netMills: z.int(),
  /** Not printed by Fansly's wallet: null. */
  grossMills: z.nullable(z.int()),
  fanRef: z.nullable(NativeIdSchema),
  fanName: z.nullable(displayText(256)),
});
export type SaleSightingRow = z.infer<typeof SaleSightingRowSchema>;
/** Rows one sighting report carries (the site's own page is 30 rows). */
export const SALE_SIGHTINGS_MAX = 100;

export const SaleSightingsRequestSchema = z.strictObject({
  /** The site's account the rows belong to (`fansly:<creator id>`); the background names its page. */
  hostAccountId: NativeIdSchema,
  rows: z.array(SaleSightingRowSchema).check(z.minLength(1), z.maxLength(SALE_SIGHTINGS_MAX)),
});

/** `report.statement`: the OnlyFans pages whose statement the board wants read again now. */
export const ReportStatementRequestSchema = z.strictObject({ pages: z.array(PageLabelSchema).check(z.maxLength(20)) });

/** The board's count line as the bar shows it, from the frame's last `state`. */
export const ReportStateSchema = z.object({
  shiftId: z.nullable(HubIntIdSchema),
  phase: z.string().check(z.maxLength(32)),
  chip: displayText(64),
  count: CountSchema,
  totalMills: z.int(),
  needsMe: z.boolean(),
});
export type ReportState = z.infer<typeof ReportStateSchema>;
