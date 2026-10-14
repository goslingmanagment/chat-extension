// ChatSpace's AI policy (docs/project-unite/architecture.md §1.6, §9.1; R20
// F10): what of an AI start and of its result is ChatSpace's to say, through
// the ports of `AiHostPolicy` the shared controller of the open chat calls.
// It is exactly what that controller did by itself before the second site:
//
// - the proof — the open chat's visible tail from page memory, read only when
//   the start may carry fresh page text (D-14: a draft feature in the dock,
//   admitted on the page); the shared plan trims it and it goes to the hub as
//   `fresh`;
// - the pre-check — Hi is not offered in a conversation that is certainly a
//   dialogue (AI-031); Ping is never blocked (AI-036);
// - no fingerprint — a result keeps nothing of its start's proof (F8: after
//   the start no tail is kept anywhere in the tab);
// - the verdict — the background's «фан написал новое» (§6.7.5) as the mark.
//
// It rides with ChatSpace's application half of the adapter
// (apps/extension/src/composition/tab/hosts/chatspace/app.ts) in ChatSpace's
// `tab-app` chunk: the shared `ai` layer carries only the calls.

import type { LiveTextTail } from '@cg/contracts/host';
import type { AiHostPolicy } from '@cg/contracts/ops';

import { HI_MAX_PERSONAL_MESSAGES } from '../../../domain/features';

export const CHATSPACE_AI: AiHostPolicy<LiveTextTail, null> = {
  /**
   * AI-031, NF-015: the hub's own Hi gate, as far as the page can know it. The hub refuses a greeting when the
   * conversation has more than ten stored messages — EVERY message, the fan's and the model's alike (on the lane this
   * client uses the hub has no word for «personal»: it counts its whole transcript, `gate_hi_greeting_limit`). The
   * dock does not see the hub's archive; it sees ChatSpace's window of the open chat. More than ten confirmed
   * messages of either side in that window is a certain fact — the conversation is a dialogue, and Reply is the
   * feature for it — so Hi is not offered and no request is spent on a refusal. Ten or fewer says nothing certain
   * (older history may lie beyond the window, the archive may hold what ChatSpace has not loaded): Hi stays on, and
   * the hub's own refusal, when it comes, is shown in the gate's words (CG-GATE-HI). The tail of a start changes
   * nothing of it.
   *
   * AI-036 (the owner's ruling В4): a manual Ping is never blocked on OnlyFans — the hub's segment is a hint.
   */
  preflight: (feature, window) => (feature === 'hi' && window.loaded > HI_MAX_PERSONAL_MESSAGES ? 'hi-gate' : null),
  proof: (host, ask) => (ask.fresh === null ? null : host.readVisibleTail(ask.identity, ask.fresh.maxItems)),
  fields: (fresh) => ({ fresh }),
  fingerprint: () => null,
  verdict: (view) => view.stale ?? null,
};
