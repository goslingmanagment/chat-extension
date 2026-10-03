// The AI stream (architecture.md §7, §8.4; AI-140, AI-141, DB-002…, TL-013).
// - A sensitive action: needs a fresh bootstrap, the page granted, the
//   feature's flag usable, the persona still in the catalog, minVersion met.
// - Frames are checked strictly by the contract (after the SDK's own check):
//   an unknown frame, anything before `meta`, a second `meta`, `context_v1`
//   after output or not asked for, an unasked `debug_input_v1` — all end the
//   stream as a contract failure. Nothing after a terminal frame is used.
// - `meta` with another persona definition than asked: the result is
//   dropped, the catalog refreshed, CG-PERSONA-CHANGED (§7 «Ограда»).
// - Exactly one transparent retry: a structured 503 `service_unavailable`
//   refusal before any frame, after 5 s, announced as a notice. Nothing
//   else is ever repeated (502, EOF, timeouts, error frames).
// - EOF without `done` is CG-STREAM-TRUNCATED; the `error` frame is terminal.
// - Its timeouts (§7 table) belong to the operation: the caller aborts.

import {
  HubFrameSchema,
  HubStreamRequestSchema,
  type AbortSignalLike,
  type AiStreamCapability,
  type HubFailure,
  type HubFrame,
  type HubStreamRequest,
  type MetaFrame,
} from '@cg/contracts';
import { KernelApiError } from '@kernel/sdk';

import { type AiStreamTransport } from './ai-stream-transport';
import { type BootstrapService } from './bootstrap';
import { belowMinVersion, flagState, pageOf } from './bootstrap-rules';
import { type CatalogService } from './catalog';
import { type Connection, type HubContext } from './context';
import { featureOfHub, type PromptEchoStore } from './debug-echo';
import { FacadeCheckError, transportFailure } from './errors';
import { type FetchLike } from './ports';
import { type QuotaTracker } from './quota';
import { callScope, errorFacts, isStructuredHubError } from './wire';

const isAborted = (outcome: AttemptOutcome): boolean => outcome.kind === 'failure' && outcome.failure.kind === 'transport' && outcome.failure.failure === 'aborted';

/** §7: the one transparent retry waits this long. */
export const STREAM_RETRY_DELAY_MS = 5_000;

/** «Сервис недоступен, повтор через 5 с…» with «Отменить»: the operation shows it while the retry waits. */
export interface StreamNotice {
  readonly kind: 'retrying';
  readonly clientRequestId: string;
  /** Epoch ms of the retry. */
  readonly retryAt: number;
}

/** Hub features each owner flag guards on the stream (§4.12; the hub checks them too for the narrow token). */
const FEATURE_FLAGS = { 'chat-review': 'review', 'fan-summary': 'recap', 'coach-chat': 'coach' } as const;

type AttemptOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'failure'; readonly failure: HubFailure; readonly framesSeen: boolean }
  | { readonly kind: 'check'; readonly error: FacadeCheckError }
  | { readonly kind: 'thrown'; readonly error: unknown };

export interface StreamDeps {
  readonly ctx: HubContext;
  readonly bootstrap: BootstrapService;
  readonly catalog: CatalogService;
  readonly quota: QuotaTracker;
  readonly echo: PromptEchoStore;
  readonly transport: AiStreamTransport;
  readonly fetch: FetchLike;
  readonly headers: () => Readonly<Record<string, string>>;
  readonly notify: (notice: StreamNotice) => void;
}

export class StreamService {
  constructor(private readonly deps: StreamDeps) {}

  /** Capabilities a request may ask for now: what the hub declared ∩ what the transport carries (debug-input-v1 needs no declaration). */
  available(): readonly AiStreamCapability[] {
    const declared = this.deps.bootstrap.cached()?.bootstrap.capabilities ?? [];
    return this.deps.transport.capabilities.filter((capability) => capability === 'debug-input-v1' || declared.includes(capability));
  }

  async run(request: HubStreamRequest, sink: (frame: HubFrame) => void, signal: AbortSignalLike): Promise<void> {
    const { ctx } = this.deps;
    const connection = ctx.connection('aiFeatureStream');
    const parsed = HubStreamRequestSchema.safeParse(request);
    if (!parsed.success) throw ctx.failure('aiFeatureStream', transportFailure('contract'), connection);
    const checked = parsed.data;
    const pageId = await this.admit(checked, connection);
    const opId = checked.body.clientRequestId;
    const echo = checked.capabilities.includes('debug-input-v1');
    if (echo) this.deps.echo.requested(opId, featureOfHub(checked.feature, checked.body.summaryMode));
    try {
      for (let attempt = 1; ; attempt += 1) {
        const outcome = await this.attempt(connection, checked, sink, signal, pageId, attempt);
        switch (outcome.kind) {
          case 'done':
            return;
          case 'retry': {
            const retryAt = ctx.clock.now() + STREAM_RETRY_DELAY_MS;
            this.deps.notify({ kind: 'retrying', clientRequestId: opId, retryAt });
            await this.pause(STREAM_RETRY_DELAY_MS, signal, connection);
            continue;
          }
          case 'check':
            throw outcome.error;
          case 'thrown':
            throw outcome.error;
          case 'failure': {
            if (outcome.failure.kind === 'http' && outcome.failure.error === 'quota_denied') this.deps.quota.denied(pageId);
            throw ctx.failure('aiFeatureStream', outcome.failure, connection, {
              pageLabel: checked.body.pageLabel,
              beforeFirstFrame: !outcome.framesSeen,
              retrySpent: attempt > 1,
            });
          }
        }
      }
    } finally {
      if (echo) this.deps.echo.finished(opId);
    }
  }

  /** The sensitive-action gate; the page's id for the quota. */
  private async admit(request: HubStreamRequest, connection: Connection): Promise<number> {
    const { ctx } = this.deps;
    const entry = await this.deps.bootstrap.fresh();
    const { bootstrap } = entry;
    const refuse = (check: ConstructorParameters<typeof FacadeCheckError>[0], reason?: string) =>
      new FacadeCheckError(check, 'aiFeatureStream', connection.epoch, reason);
    if (belowMinVersion(bootstrap, ctx.env.extensionVersion)) throw refuse('belowMinVersion');
    const page = pageOf(bootstrap, request.body.pageLabel);
    if (page === null) throw refuse('pageNotGranted');
    const flag = (FEATURE_FLAGS as Readonly<Record<string, 'review' | 'recap' | 'coach'>>)[request.feature];
    if (flag !== undefined) {
      const state = flagState(bootstrap, flag, page.pageLabel);
      if (!state.usable) throw refuse('featureDisabled', state.reason ?? undefined);
    }
    if (request.body.liveTextContext !== undefined) {
      const state = flagState(bootstrap, 'freshText', page.pageLabel);
      if (!state.usable) throw refuse('featureDisabled', state.reason ?? undefined);
    }
    const unsupported = request.capabilities.filter((capability) => !this.available().includes(capability));
    if (unsupported.length > 0) throw refuse('capabilityMissing', unsupported.join(','));
    const personaKey = request.body.personaKey;
    if (typeof personaKey === 'string') {
      const verdict = this.deps.catalog.verify(personaKey, request.body.expectedPersonaDefinitionId);
      if (!verdict.ok) {
        if (verdict.check === 'personaChangedInMeta') this.deps.catalog.invalidate();
        throw refuse(verdict.check);
      }
    }
    return page.pageId;
  }

  private async attempt(
    connection: Connection,
    request: HubStreamRequest,
    sink: (frame: HubFrame) => void,
    signal: AbortSignalLike,
    pageId: number,
    attempt: number,
  ): Promise<AttemptOutcome> {
    const { ctx } = this.deps;
    const scope = callScope(ctx.clock, [signal, ctx.epochSignalOf(connection)], null);
    let meta: MetaFrame | null = null;
    let framesSeen = false;
    let outputSeen = false;
    let stopped: AttemptOutcome | null = null;
    /** AU-012: the SDK's hook saw the refused handshake; the wipe it starts may abort the stream before the SDK throws. */
    let hookFailure: HubFailure | null = null;
    const stop = (outcome: AttemptOutcome) => {
      if (stopped === null) stopped = outcome;
      scope.dispose();
      // Closes the SDK stream; the transport then resolves quietly.
      scope.abort();
    };
    const contract = () => stop({ kind: 'failure', failure: transportFailure('contract'), framesSeen: true });
    const deliver = (frame: HubFrame) => {
      try {
        sink(frame);
      } catch (error) {
        stop({ kind: 'thrown', error });
      }
    };
    const onFrame = (raw: unknown) => {
      if (stopped !== null) return;
      framesSeen = true;
      const parsed = HubFrameSchema.safeParse(raw);
      if (!parsed.success) return contract();
      const frame = parsed.data;
      if (meta === null && frame.type !== 'meta') return contract();
      switch (frame.type) {
        case 'meta': {
          if (meta !== null || frame.clientRequestId !== request.body.clientRequestId) return contract();
          const expected = request.body.expectedPersonaDefinitionId;
          if (expected !== undefined && frame.personaDefinitionId !== undefined && frame.personaDefinitionId !== expected) {
            this.deps.catalog.invalidate();
            return stop({ kind: 'check', error: new FacadeCheckError('personaChangedInMeta', 'aiFeatureStream', connection.epoch) });
          }
          meta = frame;
          this.deps.quota.fromMeta(pageId, frame);
          return deliver(frame);
        }
        case 'context_v1':
          if (!request.capabilities.includes('context-v1') || outputSeen || frame.generationRef !== meta?.requestId) return contract();
          return deliver(frame);
        case 'debug_input_v1':
          if (!request.capabilities.includes('debug-input-v1')) return contract();
          this.deps.echo.record(request.body.clientRequestId, frame);
          return deliver(frame);
        case 'content_delta':
          outputSeen = true;
          return deliver(frame);
        case 'reasoning_delta':
          return deliver(frame);
        case 'usage':
          ctx.log('debug', 'hub: ai usage', {
            inputTokens: frame.usage.inputTokens,
            outputTokens: frame.usage.outputTokens,
            cacheReadTokens: frame.usage.cacheReadTokens,
            costMicroUsd: frame.usage.costMicroUsd,
          });
          return deliver(frame);
        case 'error':
          return stop({ kind: 'failure', failure: { kind: 'sse-error', code: frame.code, retryAfterMs: frame.retryAfterMs }, framesSeen: true });
        case 'done':
          deliver(frame);
          return stop({ kind: 'done' });
      }
    };
    try {
      await this.deps.transport.open({
        hubOrigin: connection.hubOrigin,
        token: connection.token,
        headers: this.deps.headers(),
        fetch: this.deps.fetch,
        feature: request.feature,
        body: request.body,
        capabilities: request.capabilities,
        signal: scope.signal,
        onFrame,
        onAuthError: (error) => {
          hookFailure = this.onAuthError(error, connection) ?? hookFailure;
        },
      });
    } catch (error) {
      if (stopped === null) stopped = this.classify(error, scope.signal.aborted, framesSeen, attempt);
    } finally {
      scope.dispose();
    }
    if (stopped !== null && !(hookFailure !== null && isAborted(stopped))) return stopped;
    if (hookFailure !== null) return { kind: 'failure', failure: hookFailure, framesSeen };
    // The body ended (or we were cancelled) without a terminal frame.
    if (scope.signal.aborted) return { kind: 'failure', failure: transportFailure('aborted'), framesSeen };
    return { kind: 'failure', failure: transportFailure('truncated'), framesSeen };
  }

  private classify(error: unknown, aborted: boolean, framesSeen: boolean, attempt: number): AttemptOutcome {
    // A hub answer that arrived is read as such even when the 401 hook already ended the epoch (AU-012).
    if (aborted && !(error instanceof KernelApiError && error.status !== null)) return { kind: 'failure', failure: transportFailure('aborted'), framesSeen };
    if (error instanceof KernelApiError && error.status !== null) {
      const { reason } = errorFacts(error.body);
      const failure: HubFailure = { kind: 'http', status: error.status, error: error.code, reason, retryAfterMs: null };
      const retryable = attempt === 1 && !framesSeen && error.status === 503 && error.code === 'service_unavailable' && isStructuredHubError(error.body);
      return retryable ? { kind: 'retry' } : { kind: 'failure', failure, framesSeen };
    }
    if (error instanceof KernelApiError) {
      return { kind: 'failure', failure: transportFailure(error.category === 'contract' ? 'contract' : 'network'), framesSeen };
    }
    if (error instanceof SyntaxError) return { kind: 'failure', failure: transportFailure('contract'), framesSeen };
    // The body broke after the handshake: a cut stream.
    return { kind: 'failure', failure: transportFailure('truncated'), framesSeen };
  }

  /**
   * AU-012: the SDK's hook fires before the stream rejects. The 401 rule is
   * the same as everywhere (only token_revoked/token_expired of this very
   * sign-in wipe it); the hub's answer is kept for the operation's error.
   */
  private onAuthError(error: unknown, connection: Connection): HubFailure | null {
    if (!(error instanceof KernelApiError) || error.status === null) return null;
    const { reason } = errorFacts(error.body);
    if (error.status === 401) this.deps.ctx.custody.reportUnauthorized(connection.epoch, connection.token, reason);
    return { kind: 'http', status: error.status, error: error.code, reason, retryAfterMs: null };
  }

  private pause(ms: number, signal: AbortSignalLike, connection: Connection): Promise<void> {
    const { ctx } = this.deps;
    return new Promise((resolve, reject) => {
      const scope = callScope(ctx.clock, [signal, ctx.epochSignalOf(connection)], ms);
      if (scope.signal.aborted && !scope.timedOut()) {
        scope.dispose();
        reject(ctx.failure('aiFeatureStream', transportFailure('aborted'), connection));
        return;
      }
      scope.signal.addEventListener(
        'abort',
        () => {
          scope.dispose();
          if (scope.timedOut()) resolve();
          else reject(ctx.failure('aiFeatureStream', transportFailure('aborted'), connection));
        },
        { once: true },
      );
    });
  }
}
