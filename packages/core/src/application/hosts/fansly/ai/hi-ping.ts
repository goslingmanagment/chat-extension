// Hi and Ping on Fansly (docs/project-unite/architecture.md §5.8, §9.2; spec FS-AI-1, FS-AI-2; R20 P8c): what the
// policy says of them from MAIN's snapshot of the start. Pure: no port; the clock is handed in.
//
// - Hi's evidence: the snapshot's proof of the conversation's start (`StartProofV1`, the tab's short certificate and
//   its continuous observation since), its count of personal messages repeated at the top, and the fan's avatar the
//   page loaded (FX-018) — ids and an address, never a text. No proof is not a zero count: the start goes without
//   one and the hub refuses `history_unproven`.
// - Hi's pre-check: the client refuses by itself only when MORE than ten personal messages are proven (the old rule,
//   AI-031; automation and broadcasts do not count, NF-033). Never by the window's count of messages (ChatSpace's
//   rule): ten or fewer, or no proof, is the hub's to decide.
// - Ping's pre-check: a fan who wrote a text within five days is active, and the hub refuses Ping for them
//   (`gate_ping_active`, its `analyzePingSegment`: the newest fan message with a text). The page knows it only from
//   the texts the start may carry (D-14); without them the hub decides alone. The tab's clock is not the hub's: a
//   text in the window's last ten minutes is left to the hub too.

import type { FanslySnapshot } from '@cg/contracts/fansly';
import type { FeatureId } from '@cg/contracts/features';
import type { AiGateReason, AiStartFields } from '@cg/contracts/ops';

/** AI-031: more personal messages than this, proven, and Hi is the wrong feature — the conversation is a dialogue. */
export const HI_PERSONAL_MAX = 10;
/** The hub's PING_ACTIVE_WINDOW_MS: a fan text this recent blocks Ping on Fansly. */
export const PING_ACTIVE_MS = 5 * 24 * 60 * 60 * 1000;
/** How far the tab's clock may stand from the hub's before the pre-check would refuse what the hub serves. */
export const PING_CLOCK_SLACK_MS = 10 * 60 * 1000;

/** Hi's own fields of a start from its snapshot: the start proof with its count, the fan's avatar; none for another feature. */
export function hiFieldsOf(snapshot: FanslySnapshot): Pick<AiStartFields, 'startProof' | 'personalMessageCount' | 'fanAvatarUrl'> {
  if (snapshot.feature !== 'hi') return {};
  const proof = snapshot.startProof;
  return {
    ...(proof === undefined ? {} : { startProof: proof, personalMessageCount: proof.personalCount }),
    ...(snapshot.fanAvatarUrl === undefined ? {} : { fanAvatarUrl: snapshot.fanAvatarUrl }),
  };
}

/** The fan wrote a text within the active window, by the snapshot's own texts; false — not known from the page. */
function fanActive(snapshot: FanslySnapshot, now: number): boolean {
  const since = now - PING_ACTIVE_MS + PING_CLOCK_SLACK_MS;
  return (snapshot.tail ?? []).some((message) => message.direction === 'fan' && message.text.trim() !== '' && Date.parse(message.sentAt) >= since);
}

/** Fansly's pre-check of Hi and Ping (`AiHostPolicy.preflight`): only on what the snapshot proves; null — the hub decides. */
export function hiPingGate(feature: FeatureId, snapshot: FanslySnapshot | null, now: number): AiGateReason | null {
  if (snapshot === null) return null;
  if (feature === 'hi') return (snapshot.startProof?.personalCount ?? 0) > HI_PERSONAL_MAX ? 'hi-gate' : null;
  if (feature === 'ping') return fanActive(snapshot, now) ? 'ping-gate' : null;
  return null;
}
