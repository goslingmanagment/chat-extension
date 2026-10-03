// A scripted hub facade for the R10 service tests: it plays the fake hub's
// stream scenarios (@cg/testing/hub SseResponse values, typed here
// structurally) frame by frame on the test clock, and answers claim calls
// from a queue. Failures reject the way the real facade does: a
// HubCallError with the route, the facts and the sign-in epoch.

import {
  type ClaimOp,
  type ClaimState,
  type HubCallError,
  type HubFacade,
  type HubFailure,
  type HubFrame,
  type HubRouteKey,
  type HubStreamRequest,
  type ProfileFromGenerationRequest,
  type ProfileSaveOutcome,
} from '@cg/contracts';
import { type AbortSignalLike } from '@cg/contracts/hub';

import { type FakeClock } from './clock';

export type ScriptStep =
  | { readonly kind: 'frame'; readonly frame: HubFrame; readonly afterMs?: number }
  | { readonly kind: 'heartbeat' }
  | { readonly kind: 'eof' }
  /** The connection stays open and silent until aborted. */
  | { readonly kind: 'stall' };

export type ScriptResponse =
  | { readonly kind: 'http-error'; readonly status: number; readonly body: { readonly error: string; readonly reason?: string | undefined } }
  | { readonly kind: 'stream'; readonly steps: readonly ScriptStep[] }
  /** The connection never answers until aborted. */
  | { readonly kind: 'hang' }
  /** The request fails in transport. */
  | { readonly kind: 'network' };

export type ClaimAnswer =
  | { readonly kind: 'ok'; readonly state: ClaimState }
  | { readonly kind: 'http'; readonly status: number; readonly error: string; readonly reason?: string }
  | { readonly kind: 'transport'; readonly failure: 'network' | 'timeout' }
  /** Never answers (the background unloads meanwhile). */
  | { readonly kind: 'hang' };

/** What the real facade rejects with: an Error carrying the HubCallError facts. */
export class FakeHubCallError extends Error implements HubCallError {
  override readonly name = 'HubCallError' as const;

  constructor(
    readonly route: HubRouteKey,
    readonly failure: HubFailure,
    readonly epoch: number,
  ) {
    super(`hub call ${route} failed`);
  }
}

export function hubError(route: HubRouteKey, failure: HubFailure, epoch: number): FakeHubCallError {
  return new FakeHubCallError(route, failure, epoch);
}

type FacadePart = Pick<HubFacade, 'stream' | 'claim' | 'claimStatus' | 'profileFromGeneration'>;

export class FakeHub implements FacadePart {
  readonly streams: HubStreamRequest[] = [];
  readonly claims: ClaimOp[] = [];
  readonly statusReads: { pageLabel: string; fanRef: string }[] = [];
  readonly profiles: ProfileFromGenerationRequest[] = [];
  readonly streamScript: ScriptResponse[] = [];
  readonly claimScript: ClaimAnswer[] = [];
  readonly statusScript: ClaimAnswer[] = [];
  readonly profileScript: (ProfileSaveOutcome | 'error')[] = [];
  epoch = 3;

  constructor(private readonly clock: FakeClock) {}

  stream(request: HubStreamRequest, sink: (frame: HubFrame) => void, signal: AbortSignalLike): Promise<void> {
    this.streams.push(request);
    const response = this.streamScript.shift();
    if (response === undefined) return Promise.reject(new Error('no scripted stream response'));
    const epoch = this.epoch;
    const fail = (failure: HubFailure): FakeHubCallError => hubError('aiFeatureStream', failure, epoch);
    return new Promise<void>((resolve, reject) => {
      let over = false;
      const end = (error?: FakeHubCallError): void => {
        if (over) return;
        over = true;
        if (error === undefined) resolve();
        else reject(error);
      };
      signal.addEventListener('abort', () => end(fail({ kind: 'transport', failure: 'aborted' })), { once: true });
      switch (response.kind) {
        case 'http-error':
          queueMicrotask(() => end(fail({ kind: 'http', status: response.status, error: response.body.error, reason: response.body.reason ?? null, retryAfterMs: null })));
          return;
        case 'network':
          queueMicrotask(() => end(fail({ kind: 'transport', failure: 'network' })));
          return;
        case 'hang':
          return;
        case 'stream':
          void (async () => {
            for (const step of response.steps) {
              if (over) return;
              if (step.kind === 'heartbeat') continue;
              if (step.kind === 'stall') return;
              if (step.kind === 'eof') return end(fail({ kind: 'transport', failure: 'truncated' }));
              if ((step.afterMs ?? 0) > 0) await new Promise<void>((wake) => this.clock.setTimer(step.afterMs ?? 0, wake));
              else await Promise.resolve();
              if (over) return;
              sink(step.frame);
              if (step.frame.type === 'error') return end(fail({ kind: 'sse-error', code: step.frame.code, retryAfterMs: step.frame.retryAfterMs }));
              if (step.frame.type === 'done') return end();
            }
            end(fail({ kind: 'transport', failure: 'truncated' }));
          })();
      }
    });
  }

  claim(op: ClaimOp): Promise<ClaimState> {
    this.claims.push(op);
    return this.answer('clientFanClaim', this.claimScript.shift());
  }

  claimStatus(pageLabel: string, fanRef: string): Promise<ClaimState> {
    this.statusReads.push({ pageLabel, fanRef });
    return this.answer('clientFanClaimStatus', this.statusScript.shift());
  }

  profileFromGeneration(request: ProfileFromGenerationRequest): Promise<ProfileSaveOutcome> {
    this.profiles.push(request);
    const next = this.profileScript.shift();
    if (next === undefined || next === 'error') return Promise.reject(hubError('clientFanProfileFromGeneration', { kind: 'transport', failure: 'network' }, this.epoch));
    return Promise.resolve(next);
  }

  private answer(route: HubRouteKey, answer: ClaimAnswer | undefined): Promise<ClaimState> {
    if (answer === undefined) return Promise.reject(new Error(`no scripted ${route} answer`));
    switch (answer.kind) {
      case 'ok':
        return Promise.resolve(answer.state);
      case 'http':
        return Promise.reject(hubError(route, { kind: 'http', status: answer.status, error: answer.error, reason: answer.reason ?? null, retryAfterMs: null }, this.epoch));
      case 'transport':
        return Promise.reject(hubError(route, { kind: 'transport', failure: answer.failure }, this.epoch));
      case 'hang':
        return new Promise<ClaimState>(() => undefined);
    }
  }
}
