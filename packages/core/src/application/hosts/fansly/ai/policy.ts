// Fansly's AI policy (docs/project-unite/architecture.md §1.6, §9.1; spec
// FS-TAIL-1, FS-TAIL-6, FS-TAIL-7, FS-IDN-6; R20 P8b1): what of an AI start is
// Fansly's to say, through the ports of `AiHostPolicy` the shared controller of
// the open chat calls. It rides in Fansly's own lazy chunk `ai-fansly`
// (apps/extension/lazy/fansly/ai-fansly.ts), which Fansly's application half
// loads with the dock; no ChatSpace bundle carries it.
//
// - The proof — MAIN's generation snapshot of the open chat, through the host's
//   `freshness` port (`fx.generationSnapshot`), in place of ChatSpace's visible
//   tail: for EVERY start (FS-TAIL-1: Recap, Review and Coach are checked too),
//   with the texts only where the start may carry them (D-14) and only for the
//   admitted AI features on both hosts (X70, FS-TAIL-10). Its group is the
//   route's conversation of the very chat the start was made in — the target's
//   (FS-IDN-6); its window is min(60, N) of the start's messageCount N
//   (`checkWindowOf`). No snapshot — the bridge did not answer, the port has
//   none, the chat or the start's count is not known, the route moved —
//   is no proof: the generation goes on and is not verified fresh (FS-TAIL-7).
// - The fields — the snapshot as the start's shared `proof` (`CoverageProof`):
//   the background asks the hub about it (`coverageCheck` under
//   `coverage-check-v1`, the fan's known ids, the tail as `liveTextContext`
//   under the page's `freshText`) and never cuts the window by the count.
// - The fingerprint and the verdict (R20 P8b2, ./verdict.ts): the tab keeps
//   the proof's ids and flags with the operation (never a text), and the mark
//   over the finished result is the verdict of spec §3.5's table on what the
//   hub answered — «свежесть не проверена», «ответ мог не учесть последние
//   сообщения», «контекст устарел» — or the background's «фан написал новое».
//   The result keeps its own fingerprint in the background too (P8b3). After
//   a reload its hub answer is checked against that evidence and MAIN's current
//   window; no newer start can lend it a fresh verdict.
// - Hi and Ping (R20 P8c, ./hi-ping.ts): a Hi start carries the snapshot's
//   proof of the conversation's start when the tab has one, its count and the
//   fan's avatar (FX-018); Hi has no message limit (2026-10-21), so nothing
//   is read for a proof the tab lacks. No pre-check refuses Ping for an active
//   fan any more (2026-10-22, as D29 on OnlyFans); Ping under ten messages is
//   the shared gate's (domain/features/gates.ts). Everything else is the hub's
//   to decide (`gate_min_messages`).
// - The deep window (R20 P8c; FS-AI-1, §12): the person's Recap depth above
//   3000 from Fansly's `settings.ext`, asked of the background by a start of
//   the deep window only (`windows`); the shared planner caps it by the hub's
//   `limits.deepMax`.
// - The PPV state (X54 on Fansly, audit 2026-10-20 №3): a start that may carry
//   fresh text, to a hub that lists `live-ppv-fansly-v1`, asks the background
//   beside the snapshot whether the fan bought each paid attachment of the
//   chat's newest messages (`ppv`, core services/hosts/fansly/ppv.ts) — as the
//   old extension read `orderhistory` on every generation — and carries it as
//   `livePpv`. The read is bounded (≤ 2 s, an answer with what is known after
//   1.3 s); none is no state: the hub marks from its own stores.
// - The fan's newest photos (as ChatSpace's): a Reply, Fix or Coach start to a hub that lists `live-images-v1` asks the
//   same read for the photos of the fan's latest turn (their addresses on Fansly's CDN, signed for this browser), the
//   host draws them as JPEG (`loadImages`, at most LIVE_IMAGE_LIMITS.waitMs) and they ride as `liveImages`. None — the
//   start goes without them, and the hub's text notes stay.

import type { FanslySnapshot } from '@cg/contracts/fansly';
import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import type { HostPort, LiveImage, LiveImageRef } from '@cg/contracts/host';
import { LIVE_IMAGE_LIMITS } from '@cg/contracts/limits';
import { LIVE_IMAGE_FEATURES, type AiProofAsk, type CoverageProof, type LivePpvState } from '@cg/contracts/ops';
import type { SettingsExt } from '@cg/contracts/settings-ext';

import { type AiPolicy } from '../../../ai/ports';
import { hiFieldsOf, hiPingGate } from './hi-ping';
import { checkWindowOf, startProofOf } from './proof';
import { resultChecks } from './result-checks';
import { fingerprintOf, shownMark, type ProofFingerprint } from './verdict';

export interface FanslyAiDeps {
  readonly now: () => number;
  /** The person's deep window in Fansly's `settings.ext` (`fansly.settings.windows`); absent — none (the v1 window). */
  readonly windows?: () => Promise<SettingsExt['windows'] | null>;
  /**
   * The open chat read by the background (`fansly.ppv.read`): its PPV state — the paid attachments with the fan's
   * purchase, null when none is known (a refusal, a timeout, nothing paid) — when `ppv` is asked, and the photos of
   * the fan's latest turn when `photos` is. Null — nothing came. Absent — never asked.
   */
  readonly ppv?: (chat: { readonly creatorId: string; readonly fanId: string; readonly groupId: string }, want: { readonly ppv: boolean; readonly photos: boolean }) => Promise<FanslyChatRead | null>;
}

/** What the background read of the open chat for a start. */
export interface FanslyChatRead {
  readonly livePpv: LivePpvState | null;
  readonly photos: readonly LiveImageRef[];
}

/** What a start on Fansly gathered: the snapshot MAIN gave and the start's proof made of it. */
export interface FanslyStartProof {
  readonly snapshot: FanslySnapshot;
  readonly proof: Extract<CoverageProof, { kind: 'tab-snapshot' }>;
  /** The open chat's PPV state, when the start asked for it and the background knew some. */
  readonly livePpv?: LivePpvState;
  /** The fan's newest photos the host drew, when the start asked for them and some came. */
  readonly liveImages?: readonly LiveImage[];
}

/** Fansly's port has the freshness of its own snapshot; a port without one (none but Fansly's has it) gives no proof. */
const freshnessOf = (host: HostPort): FanslyHostPort['freshness'] | undefined => (host as Partial<FanslyHostPort>).freshness;

/** The photos drawn by the host within LIVE_IMAGE_LIMITS.waitMs; none — it could not. */
async function drawPhotos(host: HostPort, refs: readonly LiveImageRef[]): Promise<readonly LiveImage[]> {
  try {
    return (await host.loadImages?.(refs, { waitMs: LIVE_IMAGE_LIMITS.waitMs })) ?? [];
  } catch {
    return [];
  }
}

function gather(host: HostPort, ask: AiProofAsk, deps: FanslyAiDeps): Promise<FanslyStartProof | null> | null {
  const freshness = freshnessOf(host);
  const chat = ask.identity.chat;
  const route = host.current().route;
  if (freshness === undefined || chat === null || ask.messageCount === undefined) return null;
  // The chat the start was made in, on the route it was made on: its group is the target's conversation.
  const same = route.epoch === ask.identity.routeEpoch && route.chat !== null && route.chat.hostAccountId === chat.hostAccountId && route.chat.platformFanId === chat.platformFanId;
  if (!same || route.conversationRef === undefined) return null;
  const request = { conversationRef: route.conversationRef, feature: ask.feature, window: checkWindowOf(ask.messageCount), withText: ask.fresh !== null };
  // The PPV state and the photos beside the snapshot, one read of the chat: the start waits for the slowest, the read
  // at most its bound and the drawing at most LIVE_IMAGE_LIMITS.waitMs after it.
  const wantPpv = ask.livePpv === true && ask.fresh !== null;
  const wantPhotos = ask.liveImages === true && ask.fresh !== null && LIVE_IMAGE_FEATURES.has(ask.feature) && host.loadImages !== undefined;
  const read = (wantPpv || wantPhotos) && deps.ppv !== undefined
    ? deps.ppv({ creatorId: chat.hostAccountId, fanId: chat.platformFanId, groupId: route.conversationRef }, { ppv: wantPpv, photos: wantPhotos }).catch(() => null)
    : Promise.resolve(null);
  const drawn = read.then((answer) => (wantPhotos && answer !== null && answer.photos.length > 0 ? drawPhotos(host, answer.photos) : []));
  return Promise.all([freshness.snapshot(chat, request), read, drawn]).then(([snapshot, answer, liveImages]) => {
    if (snapshot === null) return null;
    const livePpv = wantPpv ? (answer?.livePpv ?? null) : null;
    return {
      snapshot,
      proof: startProofOf(snapshot, ask.fresh, new Date(deps.now()).toISOString()),
      ...(livePpv === null ? {} : { livePpv }),
      ...(liveImages.length > 0 ? { liveImages } : {}),
    };
  });
}

export function createFanslyAi(deps: FanslyAiDeps): AiPolicy<FanslyStartProof, ProofFingerprint> {
  const checks = resultChecks(deps.now);
  return {
    watch: (host, changed) => checks.watch(host, changed),
    preflight: (feature, _window, gathered) => hiPingGate(feature, gathered?.snapshot ?? null, deps.now()),
    proof: (host, ask) => gather(host, ask, deps),
    fields: (gathered) =>
      gathered === null
        ? {}
        : {
            proof: gathered.proof,
            ...hiFieldsOf(gathered.snapshot),
            ...(gathered.livePpv === undefined ? {} : { livePpv: gathered.livePpv }),
            ...(gathered.liveImages === undefined ? {} : { liveImages: [...gathered.liveImages] }),
          },
    fingerprint: (gathered) => (gathered === null ? null : fingerprintOf(gathered.proof)),
    // No «Свежесть не проверена» on a result or an analysis copy (2026-10-22): a real miss stays (`shownMark`).
    verdict: (view, fingerprint) => shownMark(view, checks.current(view, fingerprint)),
    windows: () => deps.windows?.() ?? Promise.resolve(null),
  };
}
