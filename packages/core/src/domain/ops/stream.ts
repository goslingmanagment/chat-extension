// Reading one AI stream attempt (architecture.md §7, §8.4; RB-004, RB-005,
// RB-016): frames are checked in order and against the operation they
// belong to. `meta` comes first and names this operation (clientRequestId =
// opId) and the persona definition we asked for — another definition drops
// the result (§7 «Ограда»). `context_v1` of another generation and anything
// after a terminal frame are ignored (delayed frames, foreign frames). An
// `error` frame is terminal and wins over a later abort or EOF; EOF without
// `done` is truncation and the partial text is never a result.

import { narrowToken, type ContextFrame, type HubFrame } from '@cg/contracts/hub';
import { SEND_LIMITS } from '@cg/contracts/limits';
import { CONTEXT_SOURCES, KNOWN_FAN_MESSAGE_STATES, LIVE_TEXT_STATUSES, narrowCoverageCheck, type ServedContext } from '@cg/contracts/ops';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';

/** A cap on what we keep of one stream, far above any hub output limit (Coach 64 000). */
export const STREAM_TEXT_CAP = 256_000;
/** Debug-only reasoning kept per operation. */
export const REASONING_CAP = 64_000;

export interface UsageSnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costMicroUsd: number;
}

export interface QuotaSnapshot {
  readonly remainingRequestsToday: number | null;
  readonly remainingMicroUsdToday: number | null;
}

export type StreamTerminal =
  | { readonly kind: 'done' }
  /** A hub `error` frame: its machine code (never its message) and the provider's retry deadline. */
  | { readonly kind: 'error'; readonly code: string; readonly retryAfterMs: number | null }
  | { readonly kind: 'persona-changed' }
  /** The stream broke its contract (a frame before `meta`, `done` without `meta`). */
  | { readonly kind: 'contract'; readonly detail: string };

export interface StreamState {
  readonly metaSeen: boolean;
  /** `meta.requestId`: the generation's ref. */
  readonly generationRef: string | null;
  readonly text: string;
  /** Any non-empty content arrived (§7: the one retry is only before output). */
  readonly outputSeen: boolean;
  readonly frames: number;
  /** undefined — no context_v1 frame (yet). */
  readonly servedContext: ServedContext | undefined;
  readonly usage: UsageSnapshot | null;
  readonly reasoning: string;
  readonly terminal: StreamTerminal | null;
}

export interface StreamExpectation {
  readonly opId: string;
  readonly personaDefinitionId: string;
  /** Keep reasoning deltas (debug only, DB-014). */
  readonly debug: boolean;
}

export type FrameEffect =
  | { readonly kind: 'ignored'; readonly reason: 'after-terminal' | 'foreign-meta' | 'duplicate-meta' | 'foreign-context' | 'empty-delta' | 'reasoning-off' }
  | { readonly kind: 'meta'; readonly generationRef: string; readonly quota: QuotaSnapshot }
  | { readonly kind: 'context'; readonly served: ServedContext }
  | { readonly kind: 'delta'; readonly text: string; readonly first: boolean }
  | { readonly kind: 'reasoning' }
  | { readonly kind: 'usage'; readonly usage: UsageSnapshot }
  | { readonly kind: 'debug-input' }
  | { readonly kind: 'terminal'; readonly terminal: StreamTerminal };

export const INITIAL_STREAM_STATE: StreamState = {
  metaSeen: false,
  generationRef: null,
  text: '',
  outputSeen: false,
  frames: 0,
  servedContext: undefined,
  usage: null,
  reasoning: '',
  terminal: null,
};

const isNativeId = (value: string): boolean => NATIVE_ID_PATTERN.test(value);

/**
 * `context_v1` as the tab may see it: hub tokens narrowed to the ones this client knows (unknown → null). 1.15.0 (R20
 * HF-8в): the answers to a window check are read by the shared matrix's tables (`narrowCoverageCheck`); a frame
 * without them — every frame of a ChatSpace request — keeps the form it had.
 */
export function narrowContext(frame: ContextFrame): ServedContext {
  const head = frame.servedHead;
  const coverageCheck = narrowCoverageCheck(frame.coverageCheck);
  const served: ServedContext = {
    source: narrowToken(CONTEXT_SOURCES, frame.source),
    servedHead: head !== null && head.occurredAt !== null && isNativeId(head.messageRef) ? { messageRef: head.messageRef, at: head.occurredAt } : null,
    live: { status: narrowToken(LIVE_TEXT_STATUSES, frame.live.status), accepted: frame.live.accepted, rejected: frame.live.rejected },
    ...(coverageCheck === undefined ? {} : { coverageCheck }),
  };
  if (frame.knownFanMessages === undefined) return served;
  return {
    ...served,
    knownFanMessages: frame.knownFanMessages
      .filter((known) => isNativeId(known.id))
      .slice(0, SEND_LIMITS.knownFanMessagesMax)
      .map((known) => ({ id: known.id, state: narrowToken(KNOWN_FAN_MESSAGE_STATES, known.state) })),
  };
}

const terminal = (state: StreamState, end: StreamTerminal): { state: StreamState; effect: FrameEffect } => ({
  state: { ...state, terminal: end },
  effect: { kind: 'terminal', terminal: end },
});

export function readFrame(state: StreamState, frame: HubFrame, expect: StreamExpectation): { readonly state: StreamState; readonly effect: FrameEffect } {
  if (state.terminal !== null) return { state, effect: { kind: 'ignored', reason: 'after-terminal' } };
  const counted: StreamState = { ...state, frames: state.frames + 1 };
  if (frame.type === 'meta') {
    if (frame.clientRequestId !== expect.opId) return { state, effect: { kind: 'ignored', reason: 'foreign-meta' } };
    if (state.metaSeen) return { state, effect: { kind: 'ignored', reason: 'duplicate-meta' } };
    if (frame.personaDefinitionId !== undefined && frame.personaDefinitionId !== expect.personaDefinitionId) {
      return terminal(counted, { kind: 'persona-changed' });
    }
    return {
      state: { ...counted, metaSeen: true, generationRef: frame.requestId },
      effect: {
        kind: 'meta',
        generationRef: frame.requestId,
        quota: { remainingRequestsToday: frame.quota.remainingRequestsToday, remainingMicroUsdToday: frame.quota.remainingMicroUsdToday },
      },
    };
  }
  if (frame.type === 'error') return terminal(counted, { kind: 'error', code: frame.code, retryAfterMs: frame.retryAfterMs });
  if (!state.metaSeen) return terminal(counted, { kind: 'contract', detail: `${frame.type} before meta` });
  switch (frame.type) {
    case 'context_v1': {
      if (frame.generationRef !== state.generationRef) return { state, effect: { kind: 'ignored', reason: 'foreign-context' } };
      const served = narrowContext(frame);
      return { state: { ...counted, servedContext: served }, effect: { kind: 'context', served } };
    }
    case 'content_delta': {
      if (frame.text.length === 0) return { state: counted, effect: { kind: 'ignored', reason: 'empty-delta' } };
      const room = STREAM_TEXT_CAP - state.text.length;
      const text = room > 0 ? frame.text.slice(0, room) : '';
      return {
        state: { ...counted, text: state.text + text, outputSeen: true },
        effect: { kind: 'delta', text, first: !state.outputSeen },
      };
    }
    case 'reasoning_delta': {
      if (!expect.debug) return { state: counted, effect: { kind: 'ignored', reason: 'reasoning-off' } };
      const room = REASONING_CAP - state.reasoning.length;
      return { state: { ...counted, reasoning: state.reasoning + (room > 0 ? frame.text.slice(0, room) : '') }, effect: { kind: 'reasoning' } };
    }
    case 'usage': {
      const usage: UsageSnapshot = {
        inputTokens: frame.usage.inputTokens,
        outputTokens: frame.usage.outputTokens,
        cacheReadTokens: frame.usage.cacheReadTokens,
        cacheWriteTokens: frame.usage.cacheWriteTokens,
        costMicroUsd: frame.usage.costMicroUsd,
      };
      return { state: { ...counted, usage }, effect: { kind: 'usage', usage } };
    }
    case 'debug_input_v1':
      return { state: counted, effect: { kind: 'debug-input' } };
    case 'done':
      return terminal(counted, { kind: 'done' });
  }
}

/** Reads a whole frame sequence (tests and replays). */
export function readFrames(frames: readonly HubFrame[], expect: StreamExpectation, from: StreamState = INITIAL_STREAM_STATE): StreamState {
  let state = from;
  for (const frame of frames) state = readFrame(state, frame, expect).state;
  return state;
}
