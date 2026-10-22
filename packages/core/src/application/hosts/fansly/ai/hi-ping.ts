// Hi and Ping on Fansly (docs/project-unite/architecture.md §5.8, §9.2; spec FS-AI-1, FS-AI-2; R20 P8c): what the
// policy says of them from MAIN's snapshot of the start. Pure: no port; the clock is handed in.
//
// - Hi's fields: the snapshot's proof of the conversation's start when the tab has one (`StartProofV1`, the tab's
//   short certificate and its continuous observation since), its count of personal messages repeated at the top, and
//   the fan's avatar the page loaded (FX-018) — ids and an address, never a text. Hi has no message limit (the owner,
//   2026-10-21): no pre-check of Hi, and no proof is needed — the hub refuses no Hi for its count.
// - Ping has no pre-check here (the owner, 2026-10-22, as D29 lifted it on OnlyFans): a fan who wrote within five days
//   is the chatter's to judge, and the hub no longer refuses Ping for it (`gate_ping_active`). Ping under ten messages
//   is the shared gate's (domain/features/gates.ts).

import type { FanslySnapshot } from '@cg/contracts/fansly';
import type { FeatureId } from '@cg/contracts/features';
import type { AiGateReason, AiStartFields } from '@cg/contracts/ops';

/** Hi's own fields of a start from its snapshot: the start proof with its count, the fan's avatar; none for another feature. */
export function hiFieldsOf(snapshot: FanslySnapshot): Pick<AiStartFields, 'startProof' | 'personalMessageCount' | 'fanAvatarUrl'> {
  if (snapshot.feature !== 'hi') return {};
  const proof = snapshot.startProof;
  return {
    ...(proof === undefined ? {} : { startProof: proof, personalMessageCount: proof.personalCount }),
    ...(snapshot.fanAvatarUrl === undefined ? {} : { fanAvatarUrl: snapshot.fanAvatarUrl }),
  };
}

/** Fansly's pre-check (`AiHostPolicy.preflight`): none — Hi has no message limit, and Ping is the chatter's call (2026-10-22). */
export function hiPingGate(_feature: FeatureId, _snapshot: FanslySnapshot | null, _now: number): AiGateReason | null {
  return null;
}
