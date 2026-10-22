// ChatSpace's AI policy (docs/project-unite/architecture.md §1.6, §9.1; R20
// F10): what of an AI start and of its result is ChatSpace's to say, through
// the ports of `AiHostPolicy` the shared controller of the open chat calls.
// It is exactly what that controller did by itself before the second site:
//
// - the proof — read only when the start may carry fresh page text (D-14: a
//   draft feature in the dock, Review in the dock and Coach on its panel since
//   X52, admitted on the page): the open chat's newest messages from
//   OnlyMonster's API — on a hub that takes the PPV state (`live-ppv-v1`), the
//   one switch of a start's own reads — and its visible tail from page memory,
//   both at once. The
//   tail is the API's messages typed in the chat, with what page memory holds
//   that the page does not (a message that came in during the read); without
//   the API's page it is page memory's, as before. The shared plan trims it
//   and it goes to the hub as `fresh`. From the same page, when the hub takes
//   it (X54, `live-ppv-v1`) and for the draft features, the PPV state: the
//   model's paid messages, their price and whether the fan bought them. The
//   click waits for the API at most LIVE_PPV_LIMITS.waitMs; late or failed, it
//   takes the chat as ChatSpace has it loaded (`startPage`) — the PPV state as
//   the page holds it, which ChatSpace keeps current from its socket's
//   purchases; with neither, the hub keeps its own marks;
// - the pre-check — none of its own: Hi has no message limit (the owner,
//   2026-10-21), Ping is never blocked for an active fan (AI-036); Ping under
//   ten messages is the shared gate's (domain/features/gates.ts);
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
import type { HostPort, LiveImage, LiveImageRef, LiveTextTail, OpenChatPage } from '@cg/contracts/host';
import { LIVE_IMAGE_LIMITS, LIVE_PPV_LIMITS, OPEN_CHAT_LIMITS } from '@cg/contracts/limits';
import type { AiHostPolicy, LivePpvState } from '@cg/contracts/ops';

/**
 * X54: the starts that carry the PPV state — the draft features, as the start's schema admits it (`StartOp.livePpv`).
 * Its own list, not the fresh text's: a later start that may carry fresh text (Review, Coach) does not carry the state
 * until it is admitted on its own.
 */
const LIVE_PPV_FEATURES: ReadonlySet<string> = new Set(['reply', 'fix', 'hi', 'ping']);

/** The starts that carry the fan's newest photos as images (`StartOp.liveImages`, contracts LIVE_IMAGE_FEATURES). */
const LIVE_IMAGE_FEATURES: ReadonlySet<string> = new Set(['reply', 'fix', 'coach']);

/** What a ChatSpace start gathers of the open chat: the visible tail (D-14), the PPV state (X54) and the fan's newest photos; each may be absent. */
export interface ChatSpaceProof {
  readonly tail: LiveTextTail | null;
  readonly livePpv: LivePpvState | null;
  readonly liveImages?: readonly LiveImage[];
}

/**
 * The photos of the fan's latest turn — their messages after the model's last personal one (a queued mass or scheduled
 * message does not end it) — among the page's newest LIVE_IMAGE_LIMITS.windowMessages, newest first, each media once,
 * at most `maxImages`. Empty — the fan sent none since the model last answered.
 */
export function liveImageRefsOf(page: OpenChatPage): LiveImageRef[] {
  const refs: LiveImageRef[] = [];
  for (const item of page.items.slice(0, LIVE_IMAGE_LIMITS.windowMessages)) {
    if (item.direction === 'model') {
      if (item.automatic) continue;
      break;
    }
    for (const photo of item.photos ?? []) {
      if (refs.length >= LIVE_IMAGE_LIMITS.maxImages) return refs;
      if (!refs.some((ref) => ref.mediaId === photo.mediaId)) refs.push({ platformMessageId: item.platformMessageId, sentAt: item.sentAt, mediaId: photo.mediaId, url: photo.url });
    }
  }
  return refs;
}

/** The latest turn's photos drawn by the host, waited for at most LIVE_IMAGE_LIMITS.waitMs; none — no photo, or the host cannot. */
async function liveImagesOf(host: HostPort, page: OpenChatPage | null): Promise<readonly LiveImage[]> {
  const refs = page === null ? [] : liveImageRefsOf(page);
  if (refs.length === 0 || host.loadImages === undefined) return [];
  try {
    return await host.loadImages(refs, { waitMs: LIVE_IMAGE_LIMITS.waitMs });
  } catch {
    return [];
  }
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

/**
 * X52, X54: the open chat's newest page from the host's API, waited for at most `waitMs`; the read itself goes on and
 * fills the port's cache. null — no API, not the open chat, a failure, or late.
 */
export async function readOpenPage(host: HostPort, chat: ChatRef, limit: number, waitMs: number = LIVE_PPV_LIMITS.waitMs): Promise<OpenChatPage | null> {
  if (host.openChatMessages === undefined) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)));
  try {
    const read = await Promise.race([host.openChatMessages(chat, { limit: Math.min(Math.max(1, limit), OPEN_CHAT_LIMITS.pageMax) }), late]);
    return read !== null && read.ok ? read.page : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The open chat's newest page for a start: our API read, waited for at most `waitMs`; when it is late or fails, the
 * page as ChatSpace has it loaded (no request) — the PPV state as the page holds it, the photos and the text. Our API
 * read takes seconds on a chat with much media (live, 2026-10-22: 7-25 s), so without the page's copy a start mostly
 * carried no PPV state and no photo at all.
 */
export async function startPage(host: HostPort, chat: ChatRef, limit: number, waitMs: number = LIVE_PPV_LIMITS.waitMs): Promise<OpenChatPage | null> {
  const read = await readOpenPage(host, chat, limit, waitMs);
  if (read !== null || host.cachedChatMessages === undefined) return read;
  try {
    return await host.cachedChatMessages(chat, Math.min(Math.max(1, limit), OPEN_CHAT_LIMITS.pageMax));
  } catch {
    return null;
  }
}

/** X54: the open chat's PPV state, waited for at most `waitMs`. */
export async function readLivePpv(host: HostPort, chat: ChatRef, waitMs: number = LIVE_PPV_LIMITS.waitMs): Promise<LivePpvState | null> {
  const page = await readOpenPage(host, chat, LIVE_PPV_LIMITS.readMessages, waitMs);
  return page === null ? null : livePpvOf(page);
}

type LiveTextMessage = LiveTextTail['messages'][number];

/** Oldest first: by the time, then by the id as a number (a longer id is a later one). */
const older = (a: LiveTextMessage, b: LiveTextMessage): number =>
  a.sentAt !== b.sentAt ? (a.sentAt < b.sentAt ? -1 : 1) : a.platformMessageId.length - b.platformMessageId.length || (a.platformMessageId < b.platformMessageId ? -1 : a.platformMessageId > b.platformMessageId ? 1 : 0);

/**
 * X52: the tail a start carries. With the API's page: its messages typed in the chat — not from OnlyFans' queue (a mass
 * or scheduled message), not media alone, each id once — and the messages of page memory the page does not name at
 * all (one that came in during the read), oldest first, the newest `max`. Without the page, or with nothing usable on
 * it: page memory's, as it was.
 */
export function tailOf(page: OpenChatPage | null, memory: LiveTextTail | null, max: number): LiveTextTail | null {
  if (page === null) return memory;
  const named = new Set(page.items.map((item) => item.platformMessageId));
  const seen = new Set<string>();
  const messages: LiveTextMessage[] = [];
  for (const item of page.items) {
    if (item.automatic || item.text.trim() === '' || seen.has(item.platformMessageId)) continue;
    seen.add(item.platformMessageId);
    messages.push({ platformMessageId: item.platformMessageId, direction: item.direction, sentAt: item.sentAt, text: item.text });
  }
  // Nothing usable on the page: page memory's tail as it was.
  if (messages.length === 0) return memory;
  for (const message of memory?.messages ?? []) if (!named.has(message.platformMessageId)) messages.push(message);
  const capturedAt = memory !== null && memory.capturedAt > page.capturedAt ? memory.capturedAt : page.capturedAt;
  return { capturedAt, messages: messages.sort(older).slice(-Math.max(1, max)) };
}

export const CHATSPACE_AI: AiHostPolicy<ChatSpaceProof, null> = {
  /**
   * Nothing of ChatSpace's own: Hi has no message limit (the owner, 2026-10-21), and a manual Ping is never blocked
   * for an active fan on OnlyFans (AI-036, the owner's ruling В4) — the hub's segment is a hint.
   */
  preflight: () => null,
  proof: (host, ask) => {
    const fresh = ask.fresh;
    const chat = ask.identity.chat;
    if (fresh === null) return null;
    const ppv = ask.livePpv === true && LIVE_PPV_FEATURES.has(ask.feature);
    const images = ask.liveImages === true && LIVE_IMAGE_FEATURES.has(ask.feature) && host.loadImages !== undefined;
    // Both reads at once: page memory's tail and the open chat's page — the host's API, or ChatSpace's own copy when the
    // API is late —, one page for the tail, the PPV state and the photos of the fan's latest turn, drawn as soon as the
    // page names them. Only where the hub takes the state or the photos: a hub without them is asked of nothing of ours.
    const memory = host.readVisibleTail(ask.identity, fresh.maxItems).catch(() => null);
    const page = (ask.livePpv !== true && !images) || chat === null ? Promise.resolve(null) : startPage(host, chat, Math.max(fresh.maxItems, ppv ? LIVE_PPV_LIMITS.readMessages : 0));
    const photos = images ? page.then((read) => liveImagesOf(host, read)) : Promise.resolve([]);
    return Promise.all([memory, page, photos]).then(([tail, read, liveImages]) => ({
      tail: tailOf(read, tail, fresh.maxItems),
      livePpv: ppv && read !== null ? livePpvOf(read) : null,
      ...(liveImages.length > 0 ? { liveImages } : {}),
    }));
  },
  fields: (proof) => ({
    fresh: proof?.tail ?? null,
    ...(proof?.livePpv ? { livePpv: proof.livePpv } : {}),
    ...(proof?.liveImages !== undefined && proof.liveImages.length > 0 ? { liveImages: [...proof.liveImages] } : {}),
  }),
  fingerprint: () => null,
  verdict: (view) => view.stale ?? null,
};
