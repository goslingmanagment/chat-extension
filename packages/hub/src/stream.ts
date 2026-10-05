// The AI stream (architecture.md §7, §8.4; AI-140, AI-141, DB-002…, TL-013).
// - A sensitive action: needs a bootstrap, the page granted, the feature's
//   flag usable, the persona still in the catalog, minVersion met.
// - It never waits silently for a bootstrap refresh (the first live check:
//   Fix and Hi died after 30 s with no stream request at all). A cached
//   bootstrap that expired no more than 2 × ttlSec ago admits the generation
//   while its refresh runs — the hub checks every AI call again; an older
//   one or none is waited for, but only as long as the operation lives, and
//   the wait is said in the log. Nothing is ever handed to the network for
//   an operation that was cut meanwhile.
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
// - Where an attempt stands is said, never guessed: a notice when the request
//   is handed to the network (`sent`) and when the hub answers the handshake
//   (`answered`), and a log line for each — route, attempt and timings, never
//   a payload. A request that could not be built or sent fails at once with
//   its own code (CG-HUB-REQUEST: our request; CG-NETWORK: the browser
//   refused to send it) and a log line; a request that was sent and got no
//   answer is the caller's deadline (CG-HUB-TIMEOUT), and the log says that
//   the hub had not answered.

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
import { pageSwitchedOff } from '@cg/core/domain/ops';
import { KernelApiError } from '@kernel/sdk';

import { type AiStreamTransport } from './ai-stream-transport';
import { type BootstrapEntry, type BootstrapService } from './bootstrap';
import { belowMinVersion, flagState, pageOf } from './bootstrap-rules';
import { type CatalogService } from './catalog';
import { SLOW_CALL_MS, type Connection, type HubContext } from './context';
import { featureOfHub, type PromptEchoStore } from './debug-echo';
import { FacadeCheckError, flagRefused, transportFailure } from './errors';
import { type FetchLike } from './ports';
import { type QuotaTracker } from './quota';
import { callScope, errorFacts, isStructuredHubError, onAbort } from './wire';

const isAborted = (outcome: AttemptOutcome): boolean => outcome.kind === 'failure' && outcome.failure.kind === 'transport' && outcome.failure.failure === 'aborted';

/** §7: the one transparent retry waits this long. */
export const STREAM_RETRY_DELAY_MS = 5_000;

/**
 * What the operation is told about its stream while it runs:
 * - `retrying` — «Сервис недоступен, повтор через 5 с…» with «Отменить»: the one retry waits;
 * - `sent` — the request of this attempt was handed to the network (the hub may have it from here on);
 * - `answered` — the hub answered the handshake with this status; frames, if any, follow.
 * `at` is epoch ms of this hub layer's clock.
 */
export type StreamNotice =
  | { readonly kind: 'retrying'; readonly clientRequestId: string; /** Epoch ms of the retry. */ readonly retryAt: number }
  | { readonly kind: 'sent'; readonly clientRequestId: string; readonly attempt: number; readonly at: number }
  | { readonly kind: 'answered'; readonly clientRequestId: string; readonly attempt: number; readonly at: number; readonly status: number };

/** Hub features each owner flag guards on the stream (§4.12; the hub checks them too for the narrow token). */
const FEATURE_FLAGS = { 'chat-review': 'review', 'fan-summary': 'recap', 'coach-chat': 'coach' } as const;

/** The operation was cut (its deadline, a cancel) before anything was handed to the network. */
class CutBeforeRequest extends Error {
  override readonly name = 'CutBeforeRequest' as const;
}

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
    const startedMono = ctx.clock.monotonic();
    let pageId: number;
    try {
      pageId = await this.admit(checked, connection, signal);
      // The wait for a bootstrap may have outlived the operation: nothing is handed to the network for it.
      if (signal.aborted) throw new CutBeforeRequest();
    } catch (error) {
      if (error instanceof CutBeforeRequest) {
        ctx.log('warn', 'hub: stream aborted before the request was sent', { route: 'aiFeatureStream', feature: checked.feature, attempt: 1, epoch: connection.epoch, waitedMs: Math.round(ctx.clock.monotonic() - startedMono) });
        throw ctx.failure('aiFeatureStream', transportFailure('aborted'), connection);
      }
      // Refused by the hub layer itself, before any request: said in the log with the check, never silently.
      if (error instanceof FacadeCheckError) {
        ctx.log('warn', 'hub: stream refused before the request', { route: 'aiFeatureStream', feature: checked.feature, kind: error.check, code: error.code, reason: error.reason ?? null, epoch: connection.epoch });
      }
      throw error;
    }
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

  /**
   * The bootstrap a generation is admitted by. Fresh from the cache: at once. Expired no more than 2 × ttlSec
   * ago: at once too, while its refresh runs — said in the log. None, or an older one: the refresh is waited
   * for, raced with the operation's own signal, and the wait is said in the log when it starts and when it ends.
   */
  private async bootstrapFor(request: HubStreamRequest, connection: Connection, signal: AbortSignalLike): Promise<BootstrapEntry> {
    const { ctx, bootstrap } = this.deps;
    const facts = { route: 'aiFeatureStream', feature: request.feature, epoch: connection.epoch } as const;
    const recent = bootstrap.recent();
    if (recent !== null) {
      if (recent.refresh !== null) ctx.log('info', 'hub: stream served from a just-expired bootstrap', { ...facts, expiredMs: recent.expiredMs, refresh: recent.refresh });
      return recent.entry;
    }
    if (signal.aborted) throw new CutBeforeRequest();
    const started = ctx.clock.monotonic();
    const waited = () => Math.round(ctx.clock.monotonic() - started);
    ctx.log('info', 'hub: stream waits for a bootstrap refresh', { ...facts, cached: bootstrap.cached() === null ? 'none' : 'expired' });
    const refresh = bootstrap.refresh();
    let stop: () => void = () => undefined;
    const cut = new Promise<null>((resolve) => {
      stop = onAbort(signal, () => resolve(null));
    });
    try {
      const entry = await Promise.race([refresh, cut]);
      if (entry === null) {
        // The refresh goes on for whoever asks next; its own failure is its own line.
        refresh.catch(() => undefined);
        ctx.log('warn', 'hub: stream waited for a bootstrap refresh', { ...facts, waitMs: waited(), outcome: 'aborted' });
        throw new CutBeforeRequest();
      }
      ctx.log(waited() >= SLOW_CALL_MS ? 'warn' : 'info', 'hub: stream waited for a bootstrap refresh', { ...facts, waitMs: waited(), outcome: 'refreshed' });
      return entry;
    } catch (error) {
      if (!(error instanceof CutBeforeRequest)) ctx.log('warn', 'hub: stream waited for a bootstrap refresh', { ...facts, waitMs: waited(), outcome: 'failed' });
      throw error;
    } finally {
      stop();
    }
  }

  /** The sensitive-action gate; the page's id for the quota. */
  private async admit(request: HubStreamRequest, connection: Connection, signal: AbortSignalLike): Promise<number> {
    const { ctx } = this.deps;
    const entry = await this.bootstrapFor(request, connection, signal);
    const { bootstrap } = entry;
    const refuse = (check: ConstructorParameters<typeof FacadeCheckError>[0], reason?: string) =>
      new FacadeCheckError(check, 'aiFeatureStream', connection.epoch, reason);
    if (belowMinVersion(bootstrap, ctx.env.extensionVersion)) throw refuse('belowMinVersion');
    const page = pageOf(bootstrap, request.body.pageLabel);
    if (page === null) throw refuse('pageNotGranted');
    // The owner's master switch is off for the page: the hub answers 409 to every AI call of this client there.
    if (pageSwitchedOff(page)) throw refuse('featureDisabled', 'disabled');
    const flag = (FEATURE_FLAGS as Readonly<Record<string, 'review' | 'recap' | 'coach'>>)[request.feature];
    if (flag !== undefined) {
      const state = flagState(bootstrap, flag, page.pageLabel);
      if (!state.usable) throw flagRefused(flag, state.reason, 'aiFeatureStream', connection.epoch);
    }
    if (request.body.liveTextContext !== undefined) {
      const state = flagState(bootstrap, 'freshText', page.pageLabel);
      if (!state.usable) throw flagRefused('freshText', state.reason, 'aiFeatureStream', connection.epoch);
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
    /** Where this attempt stands on the wire (monotonic ms): handed to the network, answered by the hub. */
    const startedMono = ctx.clock.monotonic();
    let sentMono: number | null = null;
    let answeredMono: number | null = null;
    const opId = request.body.clientRequestId;
    const facts = { route: 'aiFeatureStream', feature: request.feature, attempt, epoch: connection.epoch } as const;
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
    // Cut already (the operation's deadline or a cancel fell between two steps): nothing is handed to the network.
    if (scope.signal.aborted) {
      scope.dispose();
      ctx.log('warn', 'hub: stream aborted before the request was sent', { ...facts, waitedMs: 0 });
      return { kind: 'failure', failure: transportFailure('aborted'), framesSeen: false };
    }
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
        onRequest: () => {
          sentMono = ctx.clock.monotonic();
          ctx.log('info', 'hub: stream request sent', { ...facts, prepareMs: Math.round(sentMono - startedMono) });
          this.deps.notify({ kind: 'sent', clientRequestId: opId, attempt, at: ctx.clock.now() });
        },
        onAnswer: (status) => {
          answeredMono = ctx.clock.monotonic();
          ctx.log('info', 'hub: stream answered', { ...facts, status, answerMs: Math.round(answeredMono - (sentMono ?? startedMono)) });
          this.deps.notify({ kind: 'answered', clientRequestId: opId, attempt, at: ctx.clock.now(), status });
        },
      });
    } catch (error) {
      if (stopped === null) stopped = this.classify(error, scope.signal.aborted, framesSeen, attempt, sentMono !== null, facts);
    } finally {
      scope.dispose();
    }
    // Cut off (a deadline of the operation, a cancel, the sign-in ending) before the hub said anything: the
    // log says how far the request got — it is the only trace of a request that never reached the hub.
    if (scope.signal.aborted && answeredMono === null && hookFailure === null && (stopped === null || isAborted(stopped))) {
      ctx.log('warn', sentMono === null ? 'hub: stream aborted before the request was sent' : 'hub: stream aborted before the hub answered', {
        ...facts,
        waitedMs: Math.round(ctx.clock.monotonic() - (sentMono ?? startedMono)),
      });
    }
    if (stopped !== null && !(hookFailure !== null && isAborted(stopped))) return stopped;
    if (hookFailure !== null) return { kind: 'failure', failure: hookFailure, framesSeen };
    // The body ended (or we were cancelled) without a terminal frame.
    if (scope.signal.aborted) return { kind: 'failure', failure: transportFailure('aborted'), framesSeen };
    return { kind: 'failure', failure: transportFailure('truncated'), framesSeen };
  }

  private classify(
    error: unknown,
    aborted: boolean,
    framesSeen: boolean,
    attempt: number,
    requested: boolean,
    facts: Readonly<Record<string, string | number>>,
  ): AttemptOutcome {
    // A hub answer that arrived is read as such even when the 401 hook already ended the epoch (AU-012).
    if (aborted && !(error instanceof KernelApiError && error.status !== null)) return { kind: 'failure', failure: transportFailure('aborted'), framesSeen };
    // A frame the SDK's own schema refused (it reports it with the status of the stream, 200): a contract failure.
    if (error instanceof KernelApiError && error.category === 'contract') return { kind: 'failure', failure: transportFailure('contract'), framesSeen: true };
    if (error instanceof KernelApiError && error.status !== null) {
      const { reason } = errorFacts(error.body);
      const failure: HubFailure = { kind: 'http', status: error.status, error: error.code, reason, retryAfterMs: null };
      const retryable = attempt === 1 && !framesSeen && error.status === 503 && error.code === 'service_unavailable' && isStructuredHubError(error.body);
      return retryable ? { kind: 'retry' } : { kind: 'failure', failure, framesSeen };
    }
    // The browser refused or lost the request (offline, DNS, a reset connection): CG-NETWORK — it could not be sent.
    if (error instanceof KernelApiError) return { kind: 'failure', failure: transportFailure('network'), framesSeen };
    if (error instanceof SyntaxError) return { kind: 'failure', failure: transportFailure('contract'), framesSeen };
    if (!requested) {
      // Something threw while the request was being put together: nothing was handed to the network. That is
      // our own request failing (CG-HUB-REQUEST), said at once — never a wait for the operation's deadline.
      this.deps.ctx.log('error', 'hub: stream request not sent', { ...facts, error: error instanceof Error ? error.name : typeof error });
      return { kind: 'failure', failure: transportFailure('contract'), framesSeen };
    }
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
