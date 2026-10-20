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
//   proof of the conversation's start, its count and the fan's avatar
//   (FX-018); the pre-check, asked again with the start's snapshot before the
//   token, refuses Hi only on MORE than ten proven personal messages and Ping
//   only for a fan the page's own texts show active (five days). Everything
//   else is the hub's to decide (`history_unproven`, `gate_ping_active`).
// - The deep window (R20 P8c; FS-AI-1, §12): the person's Recap depth above
//   3000 from Fansly's `settings.ext`, asked of the background by a start of
//   the deep window only (`windows`); the shared planner caps it by the hub's
//   `limits.deepMax`.

import type { FanslySnapshot, StartProofV1 } from '@cg/contracts/fansly';
import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import type { HostPort } from '@cg/contracts/host';
import type { AiProofAsk, CoverageProof } from '@cg/contracts/ops';
import type { SettingsExt } from '@cg/contracts/settings-ext';

import { type AiPolicy } from '../../../ai/ports';
import { hiFieldsOf, hiPingGate } from './hi-ping';
import { checkWindowOf, startProofOf } from './proof';
import { resultChecks } from './result-checks';
import { fingerprintOf, verdictMark, type ProofFingerprint } from './verdict';

export interface FanslyAiDeps {
  readonly now: () => number;
  /** The person's deep window in Fansly's `settings.ext` (`fansly.settings.windows`); absent — none (the v1 window). */
  readonly windows?: () => Promise<SettingsExt['windows'] | null>;
  /**
   * Hi's start read by the background when the tab saw none (`fansly.hi.start`): the proof, or a dialog; null — not
   * read (a refusal, a timeout). Absent — never asked.
   */
  readonly hiStart?: (chat: FanslySnapshot['identity']) => Promise<HiStartAnswer | null>;
}

/** What the background's read of Hi's start found: its proof (`pass-empty-page`), or more than ten personal messages. */
export interface HiStartAnswer {
  readonly proof: StartProofV1 | null;
  readonly dialog: boolean;
}

/** What a start on Fansly gathered: the snapshot MAIN gave and the start's proof made of it. */
export interface FanslyStartProof {
  readonly snapshot: FanslySnapshot;
  readonly proof: Extract<CoverageProof, { kind: 'tab-snapshot' }>;
  /** Hi: the background's read found more than ten personal messages — a dialog. */
  readonly dialog?: true;
}

/**
 * Hi without the tab's proof of the start (a cold load, a new socket: the page's history came before the socket's
 * `t:1`): the background reads the history to its empty page, as the old extension read a page on every Hi. Its proof
 * goes into the snapshot; a failed read leaves none, and the hub refuses `history_unproven` in its own words.
 */
async function withHiStart(snapshot: FanslySnapshot, deps: FanslyAiDeps): Promise<{ snapshot: FanslySnapshot; dialog: boolean }> {
  if (snapshot.feature !== 'hi' || snapshot.startProof !== undefined || deps.hiStart === undefined) return { snapshot, dialog: false };
  const read = await deps.hiStart(snapshot.identity).catch(() => null);
  if (read === null) return { snapshot, dialog: false };
  const proof = read.proof?.groupId === snapshot.identity.groupId ? read.proof : null;
  return { snapshot: proof === null ? snapshot : { ...snapshot, startProof: proof }, dialog: read.dialog };
}

/** Fansly's port has the freshness of its own snapshot; a port without one (none but Fansly's has it) gives no proof. */
const freshnessOf = (host: HostPort): FanslyHostPort['freshness'] | undefined => (host as Partial<FanslyHostPort>).freshness;

function gather(host: HostPort, ask: AiProofAsk, deps: FanslyAiDeps): Promise<FanslyStartProof | null> | null {
  const freshness = freshnessOf(host);
  const chat = ask.identity.chat;
  const route = host.current().route;
  if (freshness === undefined || chat === null || ask.messageCount === undefined) return null;
  // The chat the start was made in, on the route it was made on: its group is the target's conversation.
  const same = route.epoch === ask.identity.routeEpoch && route.chat !== null && route.chat.hostAccountId === chat.hostAccountId && route.chat.platformFanId === chat.platformFanId;
  if (!same || route.conversationRef === undefined) return null;
  const request = { conversationRef: route.conversationRef, feature: ask.feature, window: checkWindowOf(ask.messageCount), withText: ask.fresh !== null };
  return freshness.snapshot(chat, request).then(async (taken) => {
    if (taken === null) return null;
    const { snapshot, dialog } = await withHiStart(taken, deps);
    return { snapshot, proof: startProofOf(snapshot, ask.fresh, new Date(deps.now()).toISOString()), ...(dialog ? { dialog: true as const } : {}) };
  });
}

export function createFanslyAi(deps: FanslyAiDeps): AiPolicy<FanslyStartProof, ProofFingerprint> {
  const checks = resultChecks(deps.now);
  return {
    watch: (host, changed) => checks.watch(host, changed),
    preflight: (feature, _window, gathered) => (feature === 'hi' && gathered?.dialog === true ? 'hi-gate' : hiPingGate(feature, gathered?.snapshot ?? null, deps.now())),
    proof: (host, ask) => gather(host, ask, deps),
    fields: (gathered) => (gathered === null ? {} : { proof: gathered.proof, ...hiFieldsOf(gathered.snapshot) }),
    fingerprint: (gathered) => (gathered === null ? null : fingerprintOf(gathered.proof)),
    verdict: (view, fingerprint) => verdictMark(view, checks.current(view, fingerprint)),
    unverifiedAnalysisMark: { reason: 'unverified', at: null },
    windows: () => deps.windows?.() ?? Promise.resolve(null),
  };
}
