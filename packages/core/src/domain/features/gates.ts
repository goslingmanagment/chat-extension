// Client gates (architecture.md Appendix A `CG-GATE-*`; AI-021, AI-031,
// AI-036, AI-051, AI-087, AI-122): reasons a feature cannot start in the
// open chat, decided from what the host page already holds — before a token
// is asked for or anything reaches the hub. They only spare a round trip:
// the hub decides the same gates itself (`gate_*` → the same codes), from
// its own archive. A gate fires only on certain facts: a window that may
// have older messages beyond what the page loaded never fails a
// «too few messages» gate here.
//
// The rules here are the same on every site. What a site decides of its own —
// Hi and Ping, which each site judges from its own facts — is the site's AI
// policy (`AiHostPolicy.preflight`, R20 F10; docs/project-unite/architecture.md
// §1.6), asked after them.

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { type ChatWindow, type FanScript, type LiveTextTail } from '@cg/contracts/host';
import { type PingSegment } from '@cg/contracts/hub';
import { type AiGateReason, type AiHostPolicy } from '@cg/contracts/ops';
import { UNAVAILABLE_REASONS } from '@cg/contracts/vm';

import { MIN_MESSAGES_FOR_DEEP, policyOf } from './policy';

export interface Gate {
  readonly reason: AiGateReason;
  readonly code: CgCode;
}

const gate = (reason: AiGateReason): Gate => ({ reason, code: UNAVAILABLE_REASONS[reason].code });

export interface GateFacts {
  /** The open chat's window in the host cache; null — nothing loaded yet. */
  readonly window: ChatWindow | null;
  /** The composer's draft: empty or not; null — unknown (not read). */
  readonly draftEmpty: boolean | null;
  /** What a start gathered for the site's pre-check (`AiHostPolicy.proof`); absent — nothing yet (a view, a start's first check). */
  readonly proof?: unknown;
}

/** The loaded window is the whole conversation (the page says there is nothing older). */
const wholeHistory = (window: ChatWindow): boolean => window.hasOlder === false;

/** The Ping hint for the person: the hub's segment, or nothing while it is unknown. */
export function pingHint(segment: PingSegment | null | undefined): Exclude<PingSegment, 'unknown'> | null {
  return segment === undefined || segment === null || segment === 'unknown' ? null : segment;
}

/** The reason `feature` cannot start in the open chat right now, or null: the shared rules, then the site's pre-check. */
export function featureGate(feature: FeatureId, facts: GateFacts, site: Pick<AiHostPolicy, 'preflight'>): Gate | null {
  const window = facts.window;
  // AI-122: nothing starts while the chat's history is not in the host cache yet.
  if (window === null || window.state === 'loading') return gate('chat-loading');
  // AI-021: Fix rewrites the person's draft; without one there is nothing to fix.
  if (policyOf(feature).requiresDraft && facts.draftEmpty === true) return gate('needs-draft');
  // AI-051: Review and the full Recap only when the whole conversation is loaded and it is short.
  if ((feature === 'review' || feature === 'recap') && wholeHistory(window) && window.loaded < MIN_MESSAGES_FOR_DEEP) return gate('no-history');
  // Reply has no client gate of its own (neither predecessor had one): whether a chat without a fan message can be
  // answered is the hub's to say. Hi and Ping are each site's own to judge.
  const reason = site.preflight(feature, window, facts.proof ?? null);
  return reason === null ? null : gate(reason);
}

// ── AI-087: the language gate ───────────────────────────────────────────────

const CYRILLIC = /\p{Script=Cyrillic}/u;

/** What the fan's own lines say about the fan's script: the contracts' word (1.15.0, a host's ChatWindow carries it). */
export type { FanScript };

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
