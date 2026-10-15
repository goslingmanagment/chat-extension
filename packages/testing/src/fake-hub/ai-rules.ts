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
// window check (HF-8в, context-frame.ts `resolveCoverageCheck`). The rules of
// HF-5 (Hi's start proof), HF-4а and the notes fill are P6c2's and P6c4's.

import { type AiFeatureStreamBody } from '@cg/contracts';

export interface StreamBodyRefusal {
  /** The hub's error code: a gate (`gate_draft_required`) or the plain `bad_request`. */
  readonly error: 'gate_draft_required' | 'bad_request';
  /** The hub's own message, word for word. */
  readonly message: string;
}

/** Hub features whose policy says `requiresDraft` (feature-policies.ts). */
const REQUIRES_DRAFT: readonly string[] = ['improve-draft'];

const blank = (value: string | null | undefined): boolean => value === undefined || value === null || value.trim() === '';

export function streamBodyRefusal(feature: string, body: Partial<AiFeatureStreamBody>): StreamBodyRefusal | null {
  if (REQUIRES_DRAFT.includes(feature) && blank(body.draftText)) return { error: 'gate_draft_required', message: `${feature} requires draftText` };
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
  // Fan-erasure reachability (hub «Blocker 2»): on Fansly the conversation is the group, not the fan, so the writer
  // paths a new client drives — Coach and the short Recap — must name the fan.
  if (body.platform === 'fansly' && blank(body.fanRef) && (feature === 'coach-chat' || body.summaryMode === 'short')) {
    return { error: 'bad_request', message: 'fanRef is required on fansly for coach-chat and short fan-summary' };
  }
  return null;
}

/** A schema as the fake hub needs it: the vendored SDK's zod schema fits. */
export interface BodySchemaLike {
  safeParse(value: unknown): { readonly success: boolean };
}

// ── the narrow token's AI switch (hub client-ai-switch.ts) ─────────────────

/** The AI features behind a flag of their own on every platform. */
const AI_FEATURE_FLAGS: Readonly<Record<string, string>> = { 'coach-chat': 'coach', 'fan-summary': 'recap', 'chat-review': 'review' };
/** The AI features behind a flag of their own only where that flag exists (Fansly, R20 HF-12); elsewhere the master switch and the version. */
const AI_PLATFORM_FEATURE_FLAGS: Readonly<Record<string, string>> = {
  'fast-reply': 'drafts',
  'improve-draft': 'drafts',
  'hi-greeting': 'drafts',
  ping: 'drafts',
  'voice-script': 'voice',
  'fan-notes-fill': 'notesFill',
};
/** The narrow token's AI features with no flag of their own, by the platforms the extension has them on (Help: OnlyFans only, R20 HF-2). */
const AI_UNFLAGGED_FEATURE_PLATFORMS: Readonly<Record<string, readonly string[]>> = { 'help-me': ['onlyfans'] };

/** Whether the extension has this AI feature on this platform at all (`clientAiFeatureExistsOn`): asked first, before any switch. */
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
