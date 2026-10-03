// Client gates (architecture.md Appendix A `CG-GATE-*`; AI-021, AI-031,
// AI-036, AI-051, AI-087, AI-122): reasons a feature cannot start in the
// open chat, decided from what the host page already holds — before a token
// is asked for or anything reaches the hub. They only spare a round trip:
// the hub decides the same gates itself (`gate_*` → the same codes), from
// its own archive. A gate fires only on certain facts: a window that may
// have older messages beyond what ChatSpace loaded never fails a
// «too few messages» gate here.

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { type ChatWindow, type LiveTextTail } from '@cg/contracts/host';
import { type Platform } from '@cg/contracts/ids';
import { type PingSegment } from '@cg/contracts/hub';
import { UNAVAILABLE_REASONS, type UnavailableReasonId } from '@cg/contracts/vm';

import { HI_MAX_PERSONAL_MESSAGES, MIN_MESSAGES_FOR_DEEP, policyOf } from './policy';

export type GateReasonId = Extract<UnavailableReasonId, 'chat-loading' | 'needs-draft' | 'no-history' | 'hi-gate' | 'ping-gate' | 'language'>;

export interface Gate {
  readonly reason: GateReasonId;
  readonly code: CgCode;
}

const gate = (reason: GateReasonId): Gate => ({ reason, code: UNAVAILABLE_REASONS[reason].code });

export interface GateFacts {
  readonly platform: Platform;
  /** The open chat's window in the host cache; null — nothing loaded yet. */
  readonly window: ChatWindow | null;
  /** The composer's draft: empty or not; null — unknown (not read). */
  readonly draftEmpty: boolean | null;
  /** The hub's Ping segment when it is known (a feed summary); never computed here. */
  readonly pingSegment?: PingSegment | null;
}

/** The loaded window is the whole conversation (ChatSpace says there is nothing older). */
const wholeHistory = (window: ChatWindow): boolean => window.hasOlder === false;

/**
 * AI-036 (owner's ruling В4): a manual Ping is never blocked on OnlyFans —
 * the hub's segment is a hint; on Fansly an active fan blocks it
 * (CG-GATE-PING), as the Fansly client does.
 */
export function pingGate(platform: Platform, segment: PingSegment | null | undefined): Gate | null {
  return platform === 'fansly' && segment === 'active' ? gate('ping-gate') : null;
}

/** The Ping hint for the person: the hub's segment, or nothing while it is unknown. */
export function pingHint(segment: PingSegment | null | undefined): Exclude<PingSegment, 'unknown'> | null {
  return segment === undefined || segment === null || segment === 'unknown' ? null : segment;
}

/** The reason `feature` cannot start in the open chat right now, or null. */
export function featureGate(feature: FeatureId, facts: GateFacts): Gate | null {
  const window = facts.window;
  // AI-122: nothing starts while the chat's history is not in the host cache yet.
  if (window === null || window.state === 'loading') return gate('chat-loading');
  const rule = policyOf(feature);
  // AI-021: Fix rewrites the person's draft; without one there is nothing to fix.
  if (rule.requiresDraft && facts.draftEmpty === true) return gate('needs-draft');
  switch (feature) {
    case 'reply':
      // A reply answers the fan: a whole conversation without a fan message is Hi's ground.
      return wholeHistory(window) && window.fanMessages === 0 ? gate('no-history') : null;
    case 'hi':
      // AI-031: a fan's message is always personal, so more than ten of them is a dialog whatever else is there.
      return window.fanMessages > HI_MAX_PERSONAL_MESSAGES ? gate('hi-gate') : null;
    case 'ping':
      return pingGate(facts.platform, facts.pingSegment);
    case 'review':
    case 'recap':
      // AI-051: only when the whole conversation is loaded and it is short.
      return wholeHistory(window) && window.loaded < MIN_MESSAGES_FOR_DEEP ? gate('no-history') : null;
    case 'fix':
    case 'recap-short':
    case 'coach':
      return null;
  }
}

// ── AI-087: the language gate ───────────────────────────────────────────────

const CYRILLIC = /\p{Script=Cyrillic}/u;

/** What the fan's own lines say about the fan's script. */
export type FanScript = 'cyrillic' | 'other' | 'unknown';

/**
 * Only the fan's own lines are a language signal — never the chatter's
 * draft or the model's side. A fan who wrote Cyrillic anywhere in the
 * visible tail may be written to in Cyrillic.
 */
export function fanScriptOf(tail: LiveTextTail | null): FanScript {
  if (tail === null) return 'unknown';
  const fanLines = tail.messages.filter((message) => message.direction === 'fan' && message.text.trim().length > 0);
  if (fanLines.length === 0) return 'unknown';
  return fanLines.some((message) => CYRILLIC.test(message.text)) ? 'cyrillic' : 'other';
}

/**
 * AI-087 (CG-GATE-LANGUAGE): a draft in Cyrillic is not inserted unless the
 * fan is known to write Cyrillic. The model sometimes proposes the fan
 * message in the chatter's language; inserting it would send Russian to an
 * English-speaking fan. Copy stays available.
 */
export function languageGate(text: string, fan: FanScript): Gate | null {
  return CYRILLIC.test(text) && fan !== 'cyrillic' ? gate('language') : null;
}
