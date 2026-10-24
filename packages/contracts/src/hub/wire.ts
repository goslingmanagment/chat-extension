// Hub wire building blocks (architecture.md §8, hub-pr-plan.md §4.0–4.1,
// critic item 14). Rules of the hub's client routes, mirrored here:
// - request bodies and queries are strict (we build them; an extra key is our bug);
// - response objects are NOT strict: the hub may add optional keys, which we drop;
// - growing vocabularies (flags, features, capabilities, reasons, sources,
//   coverage, kinds, platform, role) are open tokens: the known values are the
//   constants below, an unknown value means "off" or "unknown", never a failed parse;
// - closed enums only for claim/custody automaton states and operation outcomes.
// Schemas of operations the vendored SDK already has mirror the SDK exactly
// (it validates them first; a looser mirror would accept what it rejects).
// No hub URL paths live in contracts: they are SDK markers, and a content
// script that bundled one would fail the sdk-custody gate. The background's
// hub package and the fake hub own the paths.

import * as z from 'zod/mini';

import { type HostKind } from '../ids';
import { NativeIdSchema, boundedText, type NativeId } from '../primitives';

/** Hub local business date `YYYY-MM-DD` (hub `businessDate`): a real calendar date. */
export const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const BusinessDateSchema = z.string().check(z.refine(isCalendarDate, { message: 'not a YYYY-MM-DD calendar date' }));

/** Hub page label (`pageLabelSchema`, 1–120); the hub's page key in paths and queries. */
export const PageLabelSchema = boundedText(120);

/** Path params of a page route. */
export const PageParamsSchema = z.strictObject({ pageLabel: PageLabelSchema });
/** Path params of a page + fan route; fanRef is the OF fan id (= chat id). */
export const PageFanParamsSchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema });

/** Opaque signed cursor of the hub's client lists (feed, awaiting reply, audience-new). */
export const HubCursorSchema = boundedText(2048);

/** The hub's error body (`errorResponseSchema`): exactly code, message, status, plus the documented `reason`/`statusUrl`. */
export const HubErrorBodySchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.int(),
  /** Machine reason, only where the hub's error canon names one (token_revoked, client_feature_disabled reasons…). */
  reason: z.optional(z.string()),
  statusUrl: z.optional(z.string()),
});
export type HubErrorBody = z.infer<typeof HubErrorBodySchema>;

// ── Known values of the open vocabularies (hub-pr-plan.md §4.1) ────────────

/**
 * Owner kill switches (`chatExtensionFeatures`); on the wire an open record. Where each one exists is the hub's
 * (R20 HF-2): a page of a platform without it reads `platform_unsupported`, whatever the page rows say.
 * HF-15: the global master switch is checked first; off, every feature on every platform reads `disabled`.
 *
 * 1.15.0 (R20 P4b3; docs/project-unite/architecture.md §11.1): Fansly's own six, in the SDK's order — `drafts`
 * (Reply, Fix, Hi and Ping on a Fansly page, HF-12), `voice` (the voice script and the voice-note routes, HF-4б;
 * the bootstrap offers it only where the hub's voice lane serves the page — else `lane_off`), `notesFill`
 * («Заполнить из чата», `fan-notes-fill`), `notes`, `vault`, `registration` (the extension's own panels; the hub
 * has no action behind them). They exist on Fansly only, as `previewSend`, `previewSendMarkAiGenerated`,
 * `navigation`, `wsTap` and `stats` exist on OnlyFans only. A Fansly page is switched on by its own row alone,
 * never by `"*"`: the top-level `flags` say nothing about it.
 */
export const CLIENT_FEATURE_FLAG_NAMES = [
  'insertion',
  'freshText',
  'newcomers',
  'spenders',
  'stats',
  'preview',
  'previewSend',
  'previewSendMarkAiGenerated',
  'fanPanel',
  'navigation',
  'wsTap',
  'sound',
  'coach',
  'recap',
  'review',
  'splitAll',
  'drafts',
  'voice',
  'notesFill',
  'notes',
  'vault',
  'registration',
] as const;
export type ClientFeatureFlag = (typeof CLIENT_FEATURE_FLAG_NAMES)[number];

/** Capabilities the hub declares in bootstrap (critic: + live-text-v1, recap-profile-v1, awaiting-reply-v1, ai-usage-v1). */
export const CLIENT_HUB_CAPABILITY_NAMES = [
  'context-v1',
  'live-text-v1',
  'split-all-v1',
  'shared-recaps-v1',
  'recap-profile-v1',
  'archive-feed-v1',
  'spenders-stats-v1',
  'awaiting-reply-v1',
  'audience-new-v1',
  'preview-send-custody-v1',
  'client-health-perf-v1',
  'ai-usage-v1',
  /**
   * 1.15.0 (R20 F6b, hub HF-10): the recaps read, the dossier save from a generation and the archive feed take
   * `conversationRef` — the conversation apart from the fan. The query strings and bodies are strict: a hub without
   * it answers the field 400, so the hub layer sends it only to a hub that lists this capability (`docs/protocols/
   * hub.md` п. 18).
   */
  'conversation-recaps-v1',
  /** 1.15.0 (R20 HF-8в): the hub answers the body's window check in the context frame. */
  'coverage-check-v1',
  /**
   * 1.15.0 (R20 P4b3; hub HF-3): a greeting with no AI generation behind it — the claim body's manual group
   * `{kind: 'manual', textFingerprint}` and `limits.greetingSendPerMinute`. The hub needs it to offer `newcomers` on
   * a Fansly page (its own table, in the page's feature); a hub without it refuses the manual group (400).
   */
  'manual-greeting-v1',
  /**
   * 1.15.0 (R20 P4b3; hub HF-4б): the voice-note routes (`voiceNoteCreate`, `voiceNoteStatus`, `voiceNoteAudio`) take
   * the narrow token behind the page's `voice`, and the create body takes `fanRef` apart from the chat (HF-4а).
   */
  'voice-notes-v1',
  /** 1.15.0 (R20 HF-5): Fansly Hi accepts the start proof, personal count and avatar at the top level. */
  'hi-start-proof-v1',
  /**
   * 1.21.0 (decision X48): the hub records who sent each outgoing message (`clientSendAttributions`). While the
   * bootstrap lists it the background reports every send the person made in the site's own composer whose message id
   * the page's own response named, and ChatSpace's MAIN follows the receipt of every such send, not only of a draft of
   * ours. A hub without it is never asked and MAIN follows only drafts of ours, as before.
   */
  'send-attribution-v1',
  /**
   * 1.27.0 (decision X54): the AI stream takes `livePpvContext`, the PPV state of the open OnlyFans chat the tab read
   * from OnlyMonster's API. The body is strict: a hub without it answers the field 400, so a draft start reads the
   * state and sends it only to a hub that lists this capability.
   */
  'live-ppv-v1',
  /**
   * 1.29.0 (decision X52): the AI stream takes `liveTextContext` on `chat-review` and `coach-chat` too
   * (`LIVE_TEXT_HUB_NEEDS`); a hub without it refuses the field there (400 `live_text_not_allowed`).
   */
  'live-text-review-coach-v1',
  /**
   * 1.31.0 (decision X52): Recap, full and short, takes `liveTextContext` too, and such a recap stays the fan's shared
   * recap and a dossier's proof; a hub without it refuses the field there (400 `live_text_not_allowed`).
   */
  'live-text-recap-v1',
  /** The voice script and questionnaire fill accept the open chat's latest text. */
  'live-text-fansly-tools-v1',
  /**
   * The AI stream takes `livePpvContext` on a Fansly page too: each paid attachment of the open chat with the fan's
   * purchase as Fansly answers at the click. A hub without it refuses the field there (400), so a Fansly start reads
   * the state and sends it only to a hub that lists this capability.
   */
  'live-ppv-fansly-v1',
  /**
   * The AI stream takes `liveImages`, the fan's newest photos of the open chat as JPEG; listed while the owner's
   * `aiLiveImagesEnabled` is on. A hub without it refuses the field (400), so a start draws the photos only for a hub
   * that lists it.
   */
  'live-images-v1',
  /**
   * 1.48.0: the AI stream takes `recap: 'off'` — the generation reads neither the fan's dossier nor Coach's Recaps, and
   * its meta frame says none went in. A hub without it refuses the field (400), so «с Recap» shows only for a hub that
   * lists it.
   */
  'recap-off-v1',
  /**
   * «Рассылка»: Fix takes `draftPurpose: 'outreach'` — the model's mass message rewritten for one fan. A hub without it
   * refuses the field (400), so «Подстроить под фана» shows only for a hub that lists it.
   */
  'outreach-fix-v1',
  /**
   * Chat Memory week 1: the extension's beat (`clientActivity`) — the pages it has open and how long ago the person
   * was active on each, once a minute, and once more `closed` when the last tab goes or the person signs out. A hub
   * without it is never beaten to.
   */
  'chatter-activity-v1',
  /**
   * Chat Memory week 1: «в разговоре» (`clientInConversation`) — whoever wrote to a fan of the page in the last 15
   * minutes. A hub without it is never asked, and no mark or warning shows.
   */
  'in-conversation-v1',
  /**
   * Chat Memory week 2: the fan's card across pages (`clientFanCard`), «тот же человек» decided by a chatter
   * (`clientFanLinkDecide`), a fact deleted or corrected (`clientFanFactChange`). A hub without it shows no «Память».
   */
  'fan-card-v1',
  /** Chat Memory week 3: «Вернуть» of «Очередь» — a few fans to win back and the owner's approaches, picked in one tap. */
  'win-back-v1',
  /** Chat Memory week 3: «Передача» of «Очередь» — whom the team wrote to, who waits, open promises. */
  'handoff-v1',
] as const;
export type ClientHubCapability = (typeof CLIENT_HUB_CAPABILITY_NAMES)[number];

/**
 * Why a page feature is unavailable (`features.*.reason`, `client_feature_disabled.reason`); critic item 6 adds
 * `client_outdated`. 1.15.0 (R20 P4b3; hub HF-4б): `lane_off` — the bootstrap's alone, checked after everything
 * else: the feature runs on a lane of the hub with switches of its own (`voice`: the voice-notes lane — its live
 * switch, its synthesis provider, its page allowlist, the page's voice profile), and that lane does not serve the
 * page now. A call is answered by the lane's own admission and codes (`voice_disabled`…), never by this reason.
 */
export const CLIENT_FEATURE_UNAVAILABLE_REASONS = [
  'disabled',
  'flag_off',
  'platform_unsupported',
  'binding_missing',
  'hub_not_ready',
  'not_granted',
  'client_outdated',
  'lane_off',
] as const;
export type ClientFeatureUnavailableReason = (typeof CLIENT_FEATURE_UNAVAILABLE_REASONS)[number];

/**
 * Capabilities that travel only in the AI request header `x-kernel-ai-capabilities` (comma list), in the SDK's order.
 * 1.15.0 (R20 HF-8в): `coverage-check-v1` — a request with `coverageCheck` says it (with `context-v1`: the answer rides
 * in the context frame); only a request built from a proof does, so ChatSpace never says it.
 * `hi-start-proof-v1` (HF-5) admits the three Hi fields on Fansly; ChatSpace never says it either.
 */
export const AI_STREAM_CAPABILITIES = ['debug-input-v1', 'context-v1', 'split-all-v1', 'coverage-check-v1', 'hi-start-proof-v1'] as const;
export const AiStreamCapabilitySchema = z.enum(AI_STREAM_CAPABILITIES);
export type AiStreamCapability = z.infer<typeof AiStreamCapabilitySchema>;

/** An unknown flag name, or a known one missing from the record, is off. */
export function isFlagOn(flags: Readonly<Record<string, boolean>>, flag: ClientFeatureFlag): boolean {
  return Object.prototype.hasOwnProperty.call(flags, flag) && flags[flag] === true;
}

export function hasCapability(capabilities: readonly string[], capability: ClientHubCapability | AiStreamCapability): boolean {
  return capabilities.includes(capability);
}

/** Narrows an open token against a known list; unknown → null (the caller treats it as off/unknown). */
export function narrowToken<const T extends string>(known: readonly T[], token: string): T | null {
  return (known as readonly string[]).includes(token) ? (token as T) : null;
}

// ── Host account → page binding keys (bootstrap `bindingsByHost`) ──────────

/** Namespace of each host's accounts in `bindingsByHost` keys; `fansly` is confirmed by R20. */
export const HOST_BINDING_NAMESPACES = { chatspace: 'onlymonster', 'fansly-web': 'fansly' } as const satisfies Record<HostKind, string>;

/** `onlymonster:<accountId>` — the owner's explicit binding key for a host account (§8.3, critic item 3). */
export function hostBindingKey(host: HostKind, hostAccountId: NativeId): string {
  return `${HOST_BINDING_NAMESPACES[host]}:${hostAccountId}`;
}
