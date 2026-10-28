// What the hub's own handler refuses in an AI body AFTER its schema accepted
// it — the rules of `prepareAiFeatureStream` (hub
// apps/runtime/src/modules/ai/features/index.ts; first read at e7e1037b, the
// same at c8514c5c; re-read at bd3eec06, the commit production runs and the
// SDK is vendored from since R20 P2v),
// in the hub's order and with the hub's own messages. Between c8514c5c and
// bd3eec06 the R20 hub PRs added refusals only of fields and features a
// ChatSpace body never carries — `noteFields` / `noteValues` off
// `fan-notes-fill` (right after `summaryMode`), `fanRef` of `fan-notes-fill` on
// Fansly, `startProof` / `personalMessageCount` / `fanAvatarUrl` off the Hi
// start-proof lane (HF-5) — and dropped one that never met ChatSpace (fresh
// text on a Fansly page, HF-8б): every rule below is unchanged, and the new
// ones come with the Fansly fake hub (R20 P6c1, P6c2, P6c4). They are code on the hub, not schema, so the body schema of
// the vendored SDK cannot show them: the first live check met one of them
// (the Coach preset sent with our own question → 400 in 10 ms) only on the
// real hub. Modelled here so that a body the hub would refuse fails on the
// fake hub too, in unit tests and in e2e.
//
// The body schema itself is the hub's: `FakeHubOptions.streamBodySchema`
// takes the vendored SDK's `routeSchemas.aiFeatureStream.body` (the e2e
// harness and the wiring tests pass it; this package's shipped-side code
// never imports the SDK).
//
// R20 P6c1 adds the hub's Fansly rules of the same handler and its AI switch,
// each from bd3eec06: the `fanRef` a Fansly writer path needs (Coach and the
// short Recap), the narrow token's switch by platform (client-ai-switch.ts:
// on Fansly Reply, Fix, Hi and Ping behind `drafts`, Help not at all), the
// pair `groupId ↔ fanRef` (HF-9, chat-access.ts) and the answer to the
// window check (HF-8в, context-frame.ts `resolveCoverageCheck`).
// HF-5 (Hi's start proof) follows below (P6c2). P6c4 adds voice identity, notes fill
// isolation and the transcript reader's depth (HF-4а/б, HF-6), from bd3eec065;
// the voice script on OnlyFans pages too is hub #757 (10fe275d6).
//
// Telegram (hub #909, 52e09102; docs/specs/2026-10-27-telegram-site.md §5.6): a
// Telegram page runs Reply, Fix and Coach only (`ai-platform-features.ts`, 409
// `client_feature_disabled` / `platform_unsupported` before anything else), each
// with the open chat in `clientContext` and the fan in `fanRef`, without media
// notes, draft media, a mass message or the selling tone
// (`assertTelegramRequestShape`, 400). And on any page the hub takes none of the
// open chat's live fields beside `clientContext` (live-text.ts, live-ppv.ts,
// live-images.ts off Fansly, draft-media.ts: 400 `live_text_not_allowed`); a
// window check there it ignores (no context frame on that lane), which the fake
// refuses outright so a client that sends one is caught.

import { type AiFeatureStreamBody, type HubStreamRequest } from '@cg/contracts';

export interface StreamBodyRefusal {
  /** The hub's error code: a gate (`gate_draft_required`), the plain `bad_request`, or a feature the page's platform does not run. */
  readonly error: 'gate_draft_required' | 'bad_request' | 'client_feature_disabled';
  /** The hub's own message, word for word. */
  readonly message: string;
  readonly reason?: string;
}

/** Hub features whose policy says `requiresDraft` (feature-policies.ts). */
const REQUIRES_DRAFT: readonly string[] = ['improve-draft', 'voice-script'];

const blank = (value: string | null | undefined): boolean => value === undefined || value === null || value.trim() === '';

type StreamRuleBody = Partial<AiFeatureStreamBody> & { readonly clientContext?: unknown; readonly noteValues?: readonly string[] | undefined };

export function streamBodyRefusal(feature: string, body: StreamRuleBody, capabilities: readonly string[] = []): StreamBodyRefusal | null {
  // The hub's first checks: the platform's own features, then Telegram's request shape (hub #909).
  if (body.platform !== undefined && !aiFeatureRunsOnPlatform(feature, body.platform)) return { error: 'client_feature_disabled', message: `Chat-extension feature "${feature}" is unavailable (platform_unsupported)`, reason: 'platform_unsupported' };
  if (body.platform === 'telegram') {
    const telegram = telegramShapeRefusal(feature, body);
    if (telegram !== null) return telegram;
  }
  if (REQUIRES_DRAFT.includes(feature) && blank(body.draftText)) return { error: 'gate_draft_required', message: `${feature} requires draftText` };
  // «Рассылка» (`outreach-fix-v1`): Fix alone rewrites a mass message (hub assertDraftPurposeRequestShape).
  if (body.draftPurpose !== undefined && feature !== 'improve-draft') return { error: 'bad_request', message: `${feature} does not accept draftPurpose` };
  // Coach feature isolation: coach-chat needs a question — its own, or the preset's, which lives on the hub.
  if (feature === 'coach-chat') {
    if (body.preset !== undefined) {
      if (!blank(body.chatterQuestion)) return { error: 'bad_request', message: 'coach-chat preset forbids chatterQuestion' };
    } else if (blank(body.chatterQuestion)) {
      return { error: 'bad_request', message: 'coach-chat requires chatterQuestion' };
    }
  } else if (body.chatterQuestion !== undefined || body.coachHistory !== undefined || body.preset !== undefined) {
    return { error: 'bad_request', message: `${feature} does not accept coach fields` };
  }
  if (body.summaryMode !== undefined && feature !== 'fan-summary') return { error: 'bad_request', message: `${feature} does not accept summaryMode` };
  // assertNoteFieldsRequestShape (bd3eec065): the SDK allows these fields on any feature;
  // the handler isolates them. Our client sends noteValues with the labels (merge mode; the values since X43).
  if (feature === 'fan-notes-fill') {
    if (body.noteFields === undefined || body.noteFields.length === 0) return { error: 'bad_request', message: 'fan-notes-fill requires noteFields' };
    if (body.noteValues !== undefined && body.noteValues.length !== body.noteFields.length) return { error: 'bad_request', message: 'noteValues must hold exactly one value per noteFields label' };
  } else {
    if (body.noteFields !== undefined) return { error: 'bad_request', message: `${feature} does not accept noteFields` };
    if (body.noteValues !== undefined) return { error: 'bad_request', message: `${feature} does not accept noteValues` };
  }
  // Fan-erasure reachability (hub «Blocker 2»): on Fansly the conversation is the group, not the fan, so the writer
  // paths a new client drives — Coach and the short Recap — must name the fan.
  if (body.platform === 'fansly' && blank(body.fanRef) && (feature === 'coach-chat' || body.summaryMode === 'short')) {
    return { error: 'bad_request', message: 'fanRef is required on fansly for coach-chat and short fan-summary' };
  }
  if (body.platform === 'fansly' && blank(body.fanRef) && feature === 'fan-notes-fill') return { error: 'bad_request', message: 'fanRef is required on fansly for fan-notes-fill' };
  return clientContextBesideRefusal(feature, body) ?? hiStartProofShapeRefusal(feature, body, capabilities) ?? hiFanAccountRefusal(feature, body, capabilities);
}

// ── Telegram (hub #909: ai-platform-features.ts, features/index.ts `assertTelegramRequestShape`) ──

/** The AI features a platform's pages run, where the platform limits them; a platform without an entry runs every one. */
const AI_PLATFORM_FEATURES: Readonly<Record<string, readonly string[]>> = { telegram: ['fast-reply', 'improve-draft', 'coach-chat'] };

/** `aiFeatureRunsOnPlatform`: whether pages of this platform run this AI feature. */
export function aiFeatureRunsOnPlatform(feature: string, platform: string): boolean {
  return Object.hasOwn(AI_PLATFORM_FEATURES, platform) ? (AI_PLATFORM_FEATURES[platform]?.includes(feature) ?? false) : true;
}

type TelegramRuleBody = StreamRuleBody & { readonly clientContext?: { readonly media?: unknown } | undefined };

/**
 * `assertTelegramRequestShape`, in the hub's order and with its messages: the chat and the fan named
 * (`telegram_context_required`), no media notes, no draft media, no mass message, no selling tone (`telegram_not_allowed`).
 */
export function telegramShapeRefusal(feature: string, body: TelegramRuleBody): StreamBodyRefusal | null {
  const bad = (message: string, reason: string): StreamBodyRefusal => ({ error: 'bad_request', message, reason });
  if (body.clientContext === undefined) return bad(`${feature} on a telegram page requires clientContext`, 'telegram_context_required');
  if (blank(body.fanRef)) return bad(`${feature} on a telegram page requires fanRef`, 'telegram_context_required');
  if (body.clientContext.media !== undefined) return bad('clientContext.media is not accepted on a telegram page', 'telegram_not_allowed');
  if (body.draftMedia !== undefined) return bad('draftMedia is not accepted on a telegram page', 'telegram_not_allowed');
  if (body.draftPurpose === 'outreach') return bad('draftPurpose "outreach" is not accepted on a telegram page', 'telegram_not_allowed');
  if (body.replyTone === 'upsell') return bad('the upsell tone is not accepted on a telegram page', 'telegram_not_allowed');
  return null;
}

/**
 * The open chat's live fields beside `clientContext` (the hub's live-text.ts, live-ppv.ts, live-images.ts — taken
 * beside it on a Fansly page alone, the released Fansly extension's lane —, draft-media.ts): 400
 * `live_text_not_allowed`. A window check beside it the hub ignores (its lane has no context frame); the fake refuses
 * it, so a client that sends one fails here and not silently.
 */
export function clientContextBesideRefusal(feature: string, body: StreamRuleBody & { readonly coverageCheck?: unknown }): StreamBodyRefusal | null {
  if (body.clientContext === undefined) return null;
  const bad = (field: string): StreamBodyRefusal => ({ error: 'bad_request', message: `${field} cannot be combined with clientContext`, reason: 'live_text_not_allowed' });
  if (body.liveTextContext !== undefined) return bad('liveTextContext');
  if (body.livePpvContext !== undefined) return bad('livePpvContext');
  if (body.liveImages !== undefined && body.platform !== 'fansly') return bad('liveImages');
  if (body.draftMedia !== undefined) return bad('draftMedia');
  if (body.coverageCheck !== undefined) return { error: 'bad_request', message: `${feature}: coverageCheck beside clientContext is never answered (the fake hub refuses it)` };
  return null;
}

// ── The open chat's PPV state (hub context/live-ppv.ts `assertLivePpvRequestShape`) ──

/** The hub's `AI_LIVE_PPV_FEATURES`. */
const LIVE_PPV_FEATURES: readonly string[] = ['fast-reply', 'improve-draft', 'hi-greeting', 'ping', 'chat-review', 'coach-chat', 'fan-summary'];

/**
 * Why the hub refuses `livePpvContext` before any context loads (400, reason `live_text_not_allowed`): another feature,
 * beside `clientContext`, or items of the other platform's shape — a Fansly page takes paid attachments
 * (`contentKind`, `contentRef`; `live-ppv-fansly-v1`), an OnlyFans page paid messages. Null — taken.
 */
export function livePpvRefusal(feature: string, body: StreamRuleBody): string | null {
  const state = body.livePpvContext;
  if (state === undefined) return null;
  if (!LIVE_PPV_FEATURES.includes(feature)) return `${feature} does not accept livePpvContext`;
  if (body.clientContext !== undefined) return 'livePpvContext cannot be combined with clientContext';
  const attachments = state.items.filter((item) => 'contentRef' in item).length;
  if (body.platform === 'fansly' && attachments !== state.items.length) return 'livePpvContext on a Fansly page names paid attachments';
  if (body.platform !== 'fansly' && attachments > 0) return 'livePpvContext on an OnlyFans page names paid messages';
  return null;
}

// ── The fan's newest photos (hub context/live-images.ts `assertLiveImagesRequestShape`) ──

/** The hub's `AI_LIVE_IMAGES_FEATURES`. */
const LIVE_IMAGES_FEATURES: readonly string[] = ['fast-reply', 'improve-draft', 'coach-chat'];

/** Why the hub refuses `liveImages` before any context loads (400, reason `live_text_not_allowed`). Null — taken. */
export function liveImagesRefusal(feature: string, body: StreamRuleBody): string | null {
  if (body.liveImages === undefined) return null;
  if (!LIVE_IMAGES_FEATURES.includes(feature)) return `${feature} does not accept liveImages`;
  if (body.clientContext !== undefined) return 'liveImages cannot be combined with clientContext';
  return null;
}

// ── The media attached to the message being written (hub context/draft-media.ts `assertDraftMediaRequestShape`) ──

/** The hub's `AI_DRAFT_MEDIA_FEATURES`. */
const DRAFT_MEDIA_FEATURES: readonly string[] = ['fast-reply', 'improve-draft', 'hi-greeting', 'ping', 'coach-chat', 'voice-script'];

/** Why the hub refuses `draftMedia` before any context loads (400, reason `live_text_not_allowed`). Null — taken. */
export function draftMediaRefusal(feature: string, body: StreamRuleBody): string | null {
  if (body.draftMedia === undefined) return null;
  if (!DRAFT_MEDIA_FEATURES.includes(feature)) return `${feature} does not accept draftMedia`;
  if (body.clientContext !== undefined) return 'draftMedia cannot be combined with clientContext';
  return null;
}

// ── Hi by the start proof (hub context/hi-start-proof.ts, HF-5, bd3eec065) ──
// Since 2026-10-21 Hi has no message limit: the hub refuses no Hi for its count or for a start nobody proved
// (`gate_hi_greeting_limit` is gone); only the shape of the lane's fields is still checked.

export function hiStartProofDecides(feature: string, body: StreamRuleBody, capabilities: readonly string[]): boolean {
  return feature === 'hi-greeting' && body.platform === 'fansly' && body.clientContext === undefined && capabilities.includes('hi-start-proof-v1');
}

/** assertHiStartProofRequestShape, in the hub's order, before the client's stricter body mirror. */
function hiStartProofShapeRefusal(feature: string, body: StreamRuleBody, capabilities: readonly string[]): StreamBodyRefusal | null {
  const fields = ['startProof', 'personalMessageCount', 'fanAvatarUrl'].filter((name) => body[name as keyof StreamRuleBody] !== undefined).join(', ');
  if (fields === '') return null;
  const bad = (message: string, reason: string): StreamBodyRefusal => ({ error: 'bad_request', message, reason });
  if (feature !== 'hi-greeting') return bad(`${feature} does not accept ${fields}`, 'start_proof_not_allowed');
  if (body.clientContext !== undefined) return bad(`${fields} cannot be combined with clientContext`, 'start_proof_not_allowed');
  if (body.platform !== 'fansly') {
    // The hub since the 2026-10-20 audit (row 6): on an OnlyFans page the client's count of personal messages, alone.
    if (fields === 'personalMessageCount') return null;
    return bad(`${fields} are only accepted for fansly pages`, 'start_proof_not_allowed');
  }
  if (!capabilities.includes('hi-start-proof-v1')) return bad(`${fields} require the hi-start-proof-v1 capability`, 'capability_required');
  // The SDK schema runs first. Without it, malformed bodies still reach the client's schema below, never throw here.
  if (body.startProof !== undefined && body.startProof !== null) {
    if (body.startProof.groupId !== body.conversationRef) return bad("startProof.groupId must be the request's conversationRef", 'start_proof_mismatch');
    if (body.personalMessageCount !== undefined && body.personalMessageCount !== body.startProof.personalCount) return bad('personalMessageCount must equal startProof.personalCount', 'start_proof_mismatch');
  }
  return null;
}

// ── Hi's fan account (hub context/fansly-fan-identity.ts `assertHiFanAccountRequestShape`, 2026-10-26) ──

/** Why the hub refuses `fanAccount`: only Fansly Hi without clientContext, from a caller that says hi-fan-account-v1. */
function hiFanAccountRefusal(feature: string, body: StreamRuleBody, capabilities: readonly string[]): StreamBodyRefusal | null {
  if (body.fanAccount === undefined) return null;
  const bad = (message: string, reason: string): StreamBodyRefusal => ({ error: 'bad_request', message, reason });
  if (feature !== 'hi-greeting') return bad(`${feature} does not accept fanAccount`, 'fan_account_not_allowed');
  if (body.clientContext !== undefined) return bad('fanAccount cannot be combined with clientContext', 'fan_account_not_allowed');
  if (body.platform !== 'fansly') return bad('fanAccount is only accepted for fansly pages', 'fan_account_not_allowed');
  if (!capabilities.includes('hi-fan-account-v1')) return bad('fanAccount requires the hi-fan-account-v1 capability', 'capability_required');
  return null;
}

// ── Ping from ten messages (hub feature-policies.ts, the owner 2026-10-21) ──

/** The hub's Ping minimum: fewer messages in the transcript it reads and Ping is `gate_min_messages`. */
export const PING_MIN_MESSAGES = 10;

/**
 * The hub's Ping minimum on the lane this client rides (no `clientContext`): the messages of the transcript it reads —
 * the archive the reader serves and, merged by id, the page's fresh texts. Both platforms.
 */
export function pingFewRefusal(count: number): 'gate_min_messages' | null {
  return count < PING_MIN_MESSAGES ? 'gate_min_messages' : null;
}

/** The platforms the voice-notes lane renders for (hub voice-lane.ts `isVoiceLanePlatform`; OnlyFans since hub #757). */
const VOICE_LANE_PLATFORMS: readonly string[] = ['fansly', 'onlyfans'];

/**
 * The voice script's gate (HF-4а; hub #757), after access and HF-9's pair check, before any spend: a page of the
 * lane's platforms; the fan always named, and the chat itself wherever no pair was checked — on OnlyFans, where the
 * chat is the fan, and on the client-context lane (the released Fansly extension's fan/fan); then the lane's switch.
 */
export function voiceScriptRefusal(body: Partial<AiFeatureStreamBody> & { readonly clientContext?: unknown }, laneOff: boolean): string | null {
  if (body.platform === undefined || !VOICE_LANE_PLATFORMS.includes(body.platform)) return 'gate_voice_unsupported_platform';
  const pairChecked = body.platform === 'fansly' && body.clientContext === undefined;
  if (blank(body.fanRef) || (body.conversationRef !== body.fanRef && !pairChecked)) return 'gate_voice_identity_required';
  return laneOff ? 'gate_voice_disabled' : null;
}

/** HF-6 (ai-transcript-depth.ts + features/index.ts at bd3eec065). The wire accepts 5000;
 * the reader clamps, it does NOT reject above deepMax. Both platforms use the same cap. */
export function transcriptWindow(request: HubStreamRequest, ownerDepth: number): { requested: number; limit: number } {
  const { feature, body, capabilities } = request;
  const short = feature === 'fan-summary' && body.summaryMode === 'short';
  const deep = ['fan-summary', 'chat-review', 'fan-notes-fill'].includes(feature);
  const fallback = short ? 300 : deep ? 1500 : feature === 'improve-draft' ? 25 : 100;
  const requested = short ? Math.min(300, body.messageCount ?? fallback) : body.messageCount ?? fallback;
  // 2026-10-27 (hub `coach-depth-v1`): Coach reads the owner's depth too, from a caller that says it.
  const mayReadDeep = capabilities.includes('context-v1') && ((feature === 'fan-summary' && !short) || feature === 'fan-notes-fill' || (feature === 'coach-chat' && capabilities.includes('coach-depth-v1')));
  const cap = mayReadDeep ? (feature === 'fan-notes-fill' ? Math.max(3000, ownerDepth) : ownerDepth) : 1500;
  return { requested, limit: Math.min(requested, cap) };
}

/** A schema as the fake hub needs it: the vendored SDK's zod schema fits. */
export interface BodySchemaLike {
  safeParse(value: unknown): { readonly success: boolean };
}

// ── the narrow token's AI switch (hub client-ai-switch.ts) ─────────────────

/** The AI features behind a flag of their own on every platform. */
const AI_FEATURE_FLAGS: Readonly<Record<string, string>> = { 'coach-chat': 'coach', 'fan-summary': 'recap', 'chat-review': 'review', 'fan-notes-fill': 'notesFill' };
/** The AI features behind a flag of their own only where that flag exists (Fansly, R20 HF-12); elsewhere the master switch and the version. */
const AI_PLATFORM_FEATURE_FLAGS: Readonly<Record<string, string>> = {
  'fast-reply': 'drafts',
  'improve-draft': 'drafts',
  'hi-greeting': 'drafts',
  ping: 'drafts',
  'voice-script': 'voice',
};
/** The narrow token's AI features with no flag of their own, by the platforms the extension has them on (Help: OnlyFans only, R20 HF-2). */
const AI_UNFLAGGED_FEATURE_PLATFORMS: Readonly<Record<string, readonly string[]>> = { 'help-me': ['onlyfans'] };

/** Whether the extension has this AI feature on this platform at all (`clientAiFeatureExistsOn`): after the master switch (HF-15). */
export function aiFeatureExistsOn(feature: string, platform: string): boolean {
  return AI_UNFLAGGED_FEATURE_PLATFORMS[feature]?.includes(platform) ?? true;
}

/**
 * The flag that decides a narrow token's generation of this feature on this platform (`clientAiFeatureFlag`); null
 * when only the master switch and the version do. `flagExists` says whether a flag exists on the platform (the hub's
 * table, `clientFeatureExistsOn`).
 */
export function aiFeatureFlag(feature: string, platform: string, flagExists: (flag: string, platform: string) => boolean): string | null {
  const flag = AI_FEATURE_FLAGS[feature];
  if (flag !== undefined) return flag;
  const platformFlag = AI_PLATFORM_FEATURE_FLAGS[feature];
  return platformFlag !== undefined && flagExists(platformFlag, platform) ? platformFlag : null;
}

// ── the pair `groupId ↔ fanRef` (hub chat-access.ts, R20 HF-9) ─────────────

/** What the hub can vouch for about a pair, or `mismatch` (409 `conversation_fan_mismatch`). */
export type PairState = 'verified' | 'unverified' | 'mismatch';

/**
 * `classifyAiConversationPair`: the page's thread of the group names its fan. `verified` — this fan; `mismatch` —
 * another; `unverified` — no thread yet, or one whose fan the hub does not know. Ids compare as exact strings (HF-8а):
 * two fans one double apart are two fans.
 */
export function classifyPair(threadFan: string | null | undefined, fanRef: string): PairState {
  if (threadFan === null || threadFan === undefined || threadFan === '') return 'unverified';
  return threadFan === fanRef ? 'verified' : 'mismatch';
}

// ── the window check (hub context-frame.ts `resolveCoverageCheck`, R20 HF-8в) ─

/** One message of the window the model read: the ref its store keeps (the exact id) and its side. */
export interface ServedRef {
  readonly messageRef: string;
  readonly isFromFan: boolean;
}

/** What the hub's stores hold for THIS conversation about an id the served window does not hold; an id not listed is absent. */
export type StoreState = 'present' | 'deleted';

/** The body's `coverageCheck`. */
export interface CoverageCheckAsked {
  readonly window: readonly { readonly id: string; readonly dir: 'fan' | 'model' }[];
  readonly deletedIds: readonly string[];
}

/** The frame's `coverageCheck`: one answer per id of each list, in the body's order. */
export interface CoverageCheckAnswer {
  readonly window: readonly { readonly id: string; readonly state: 'included' | 'direction_mismatch' | 'outside_window' | 'deleted' | 'absent' | 'unknown' }[];
  readonly deleted: readonly { readonly id: string; readonly state: 'deleted' | 'still_served' | 'absent' | 'unknown' }[];
}

/**
 * One answer per id the body named, each list in the body's order, judged against the window that served the
 * generation; an id matches a window ref only as the same string. A window id: `included` (read, from the side the
 * tab says), `direction_mismatch` (read, from the other side), `outside_window` (held for this conversation, not
 * read), `deleted` (tombstoned for it), `absent` (not held), `unknown` (the stores could not be read). A deleted id:
 * `still_served` (the model read it), `deleted` (tombstoned), `absent` (no tombstone, whatever else is held),
 * `unknown`. `stores` is null when their lookup failed. The hub's function, line for line.
 */
export function resolveCoverageCheck(input: { readonly check: CoverageCheckAsked; readonly window: readonly ServedRef[]; readonly stores: ReadonlyMap<string, StoreState> | null }): CoverageCheckAnswer {
  const served = new Map(input.window.map((message) => [message.messageRef, message]));
  const stored = (id: string): StoreState | 'absent' => input.stores?.get(id) ?? 'absent';
  return {
    window: input.check.window.map(({ id, dir }) => {
      const inWindow = served.get(id);
      if (inWindow !== undefined) return { id, state: inWindow.isFromFan === (dir === 'fan') ? 'included' : 'direction_mismatch' };
      if (input.stores === null) return { id, state: 'unknown' };
      const state = stored(id);
      return { id, state: state === 'present' ? 'outside_window' : state };
    }),
    deleted: input.check.deletedIds.map((id) => {
      if (served.has(id)) return { id, state: 'still_served' };
      if (input.stores === null) return { id, state: 'unknown' };
      return { id, state: stored(id) === 'deleted' ? 'deleted' : 'absent' };
    }),
  };
}
