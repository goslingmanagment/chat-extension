// ChatSpace's AI policy (docs/project-unite/architecture.md §1.6, §9.1; R20
// F10): what of an AI start and of its result is ChatSpace's to say, through
// the ports of `AiHostPolicy` the shared controller of the open chat calls.
// It is exactly what that controller did by itself before the second site:
//
// - the proof — the open chat's visible tail from page memory, read only when
//   the start may carry fresh page text (D-14: a draft feature in the dock,
//   admitted on the page); the shared plan trims it and it goes to the hub as
//   `fresh`. Beside it, when the hub takes it (X54, `live-ppv-v1`), the PPV
//   state of the chat's newest messages from OnlyMonster's API: the model's
//   paid messages, their price and whether the fan bought them — what page
//   memory holds stale, a purchase updating no loaded message. The click
//   waits for that read at most LIVE_PPV_LIMITS.waitMs and starts without it
//   after; a failed read is no state, and the hub keeps its own marks;
// - the pre-check — Hi is not offered in a conversation that is certainly a
//   dialogue (AI-031); Ping is never blocked (AI-036);
// - no fingerprint — a result keeps nothing of its start's proof (F8: after
//   the start no tail is kept anywhere in the tab);
// - the verdict — the background's «фан написал новое» (§6.7.5) as the mark.
//
// It rides with ChatSpace's application half of the adapter
// (apps/extension/src/composition/tab/hosts/chatspace/app.ts) in ChatSpace's
// `tab-app` chunk: the shared `ai` layer carries only the calls. It imports
// nothing of the shared feature table on purpose — a module goes to the first
// lazy layer that needs it, and the table would follow it into `tab-app`.

import type { ChatRef } from '@cg/contracts/ids';
import type { HostPort, LiveTextTail, OpenChatPage } from '@cg/contracts/host';
import { LIVE_PPV_LIMITS } from '@cg/contracts/limits';
import type { AiHostPolicy, LivePpvState } from '@cg/contracts/ops';

/** AI-031: Hi is for a conversation with at most this many messages — of either side, as the hub counts them (`gate_hi_greeting_limit`). */
export const HI_MAX_MESSAGES = 10;

/** What a ChatSpace start gathers of the open chat: the visible tail (D-14) and the PPV state (X54); each may be absent. */
export interface ChatSpaceProof {
  readonly tail: LiveTextTail | null;
  readonly livePpv: LivePpvState | null;
}

/**
 * X54: the model's paid messages of a page as OnlyFans gives them — a listed price above zero, not free, and a known
 * `isOpened` (on the model's paid message, the purchase). One whose state OnlyFans did not give is left out: the hub's
 * own mark stands for it. A message the API names twice counts once (the first): one id with two answers would fail
 * the start's schema, and the click with it. null — none.
 */
export function livePpvOf(page: OpenChatPage): LivePpvState | null {
  const seen = new Set<string>();
  const items = page.items
    .filter((item) => item.direction === 'model' && item.price !== null && item.isFree !== true && item.isOpened !== null && !seen.has(item.platformMessageId) && seen.add(item.platformMessageId) !== undefined)
    .slice(0, LIVE_PPV_LIMITS.maxItems)
    .map((item) => ({ platformMessageId: item.platformMessageId, priceUsd: item.price as number, purchased: item.isOpened === true }));
  return items.length > 0 ? { capturedAt: page.capturedAt, items } : null;
}

/** X54: the open chat's PPV state, waited for at most `waitMs`; the read itself goes on and fills the port's cache. */
export async function readLivePpv(host: HostPort, chat: ChatRef, waitMs: number = LIVE_PPV_LIMITS.waitMs): Promise<LivePpvState | null> {
  if (host.openChatMessages === undefined) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)));
  try {
    const read = await Promise.race([host.openChatMessages(chat, { limit: LIVE_PPV_LIMITS.readMessages }), late]);
    return read !== null && read.ok ? livePpvOf(read.page) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const CHATSPACE_AI: AiHostPolicy<ChatSpaceProof, null> = {
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
  preflight: (feature, window) => (feature === 'hi' && window.loaded > HI_MAX_MESSAGES ? 'hi-gate' : null),
  proof: (host, ask) => {
    if (ask.fresh === null) return null;
    const chat = ask.identity.chat;
    // Both reads at once: the tail from page memory, the PPV state from the host's API (the slower of the two).
    const tail = host.readVisibleTail(ask.identity, ask.fresh.maxItems).catch(() => null);
    const livePpv = ask.livePpv === true && chat !== null ? readLivePpv(host, chat) : Promise.resolve(null);
    return Promise.all([tail, livePpv]).then(([read, state]) => ({ tail: read, livePpv: state }));
  },
  fields: (proof) => ({ fresh: proof?.tail ?? null, ...(proof?.livePpv ? { livePpv: proof.livePpv } : {}) }),
  fingerprint: () => null,
  verdict: (view) => view.stale ?? null,
};
