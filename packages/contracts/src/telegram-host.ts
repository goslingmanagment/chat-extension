// Telegram's side of the host contract (docs/specs/2026-10-27-telegram-site.md §4, §6.5): the port of the Telegram
// adapter as Telegram's own code sees it (`TelegramHostPort`: `telegram` is `TelegramPagePort`, the open chat read as a
// transcript), its anchors and own capability, what its contract report must name (`TELEGRAM_CONTRACT`) and the
// report's strict branch.
//
// A site module, like fansly-host.ts: imported by its own subpath only, never from the root. It may take host.ts at run
// time; host.ts never takes it.

import * as z from 'zod/mini';

import { ANCHOR_STATES, CapabilityStateSchema, HostCapabilitySchema, type FanScript, type HostContractShape, type HostPort } from './host';
import type { HostIdentity } from './ids';
import { EpochMsSchema, boundedText, displayText } from './primitives';

/**
 * Web A's anchors (telegram-tt 6002824b; spec §6 «Anchors on Web A»): the active slides of the list and of the header
 * with the header's peer, the main field and its composer, the message list, and the active account's session entry.
 */
export const TELEGRAM_ANCHOR_IDS = ['layout', 'listSlide', 'headerPeer', 'messageList', 'field', 'composer', 'account'] as const;
export const TelegramAnchorIdSchema = z.enum(TELEGRAM_ANCHOR_IDS);
export type TelegramAnchorId = z.infer<typeof TelegramAnchorIdSchema>;

/** Telegram's own capability: the open chat read from the page as a transcript (§4.3). */
export const TELEGRAM_CAPABILITIES = ['transcript'] as const;
export const TelegramCapabilitySchema = z.enum(TELEGRAM_CAPABILITIES);
export type TelegramCapability = z.infer<typeof TelegramCapabilitySchema>;

/**
 * What a Telegram report must name: every anchor, and what is off by design — no send of ours (X8, its receipt), no
 * chat list, no navigation, no file into the field, no fresh page text (the transcript is the context), no
 * observation of a send, no slot in the chat's header.
 */
export const TELEGRAM_CONTRACT: HostContractShape = {
  anchors: TELEGRAM_ANCHOR_IDS,
  switchedAnchors: [],
  switchedCapabilities: ['previewSend', 'receipt', 'chatList', 'navigate', 'fileAttach', 'freshText', 'sendObserve', 'chatHeader'],
};

export const TelegramContractBlockSchema = z.strictObject({
  anchors: z.record(TelegramAnchorIdSchema, z.enum(ANCHOR_STATES)),
  capabilities: z.record(TelegramCapabilitySchema, CapabilityStateSchema),
});

/** Telegram's report as its producer makes it: the strict branch of the shared `SiteContractReportSchema`. */
export const TelegramContractReportSchema = z.strictObject({
  host: z.literal('telegram-web'),
  build: z.nullable(displayText(80)),
  adapterVersion: boundedText(32),
  checkedAt: EpochMsSchema,
  capabilities: z.record(HostCapabilitySchema, CapabilityStateSchema),
  extensions: z.strictObject({ 'telegram-web': TelegramContractBlockSchema }),
});
export type TelegramContractReport = z.infer<typeof TelegramContractReportSchema>;

/** The open chat read from the page (§4.3): the transcript and what the request says of it. Memory only. */
export interface TelegramChatRead {
  readonly transcript: string;
  readonly messageCount: number;
  /** The header's name of the fan as the page shows it; '' — none. */
  readonly fanDisplayName: string;
  /** The newest messages were rendered (`.list-bottom-marker`). */
  readonly newest: boolean;
  readonly fanScript: FanScript;
}

/** What only Telegram Web A has. */
export interface TelegramPagePort {
  /**
   * The open chat the identity names, as Web A rendered it, with the account read again: null — another chat or
   * account, no chat, an animation of the slides. Never scrolls, never reads another chat.
   */
  read(identity: HostIdentity): TelegramChatRead | null;
}

/** The Telegram adapter's port: the shared HostPort with Telegram's page port typed. */
export interface TelegramHostPort extends HostPort {
  readonly kind: 'telegram-web';
  readonly platform: 'telegram';
  readonly telegram: TelegramPagePort;
}
