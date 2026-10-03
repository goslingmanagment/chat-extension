// The operation scheduler of the background (architecture.md §7, §5.5,
// §8.4): the single writer that admits, runs, cancels and remembers AI
// operations. A start spends its one-time `generate` token, passes the
// preconditions, reopens a cached result of the same request, and is then
// admitted atomically (one per chat across the extension, three per tab, no
// queue); its admission and identity are journaled in storage.session BEFORE
// the hub request. The stream runs in the background whatever the tab does:
// a chat switch or a closed tab never cancels it; only an explicit cancel or
// a change of the page's persona, the sign-in or the hub address does.
// Stream text reaches the owning tab in 50 ms batches. The only automatic
// repeat is the one 503-before-first-frame retry, and an environment that
// went away interrupts it. After an unload a running operation is
// `interrupted` and never POSTed again. Results live 30 minutes. A tab that
// re-attaches to a running operation (reload, palette «Перейти», a mirror's
// gap) gets the text so far in the view and the batches start again at seq 1
// for it (mirrorFromView). Usage goes to the log always (no text), to the
// screen only in debug mode (§8.4).

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { type IncomingFact } from '@cg/contracts/host';
import {
  type ContextFrame,
  type HubCallError,
  type HubErrorResolution,
  type HubFacade,
  type HubFailure,
  type HubFrame,
  type HubStreamRequest,
  type ResolveHubError,
} from '@cg/contracts/hub';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { OP_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { OpViewSchema, type Admission, type OpDebugView, type OpResult, type OpState, type OpView, type Phase, type StartOp } from '@cg/contracts/ops';
import { FreshnessCheckpointSchema, type FreshnessCheckpoint } from '@cg/contracts/send';
import { type AiQuotaSnapshot, type BackgroundToast } from '@cg/contracts/tab-messages';

import {
  INITIAL_STREAM_STATE,
  ResultCache,
  TIMEOUT_CODE,
  basicParseResult,
  buildStreamRequest,
  canceledByChange,
  chatKeyOfStart,
  decideAdmission,
  isTerminalOpState,
  nextDeadline,
  readFrame,
  requestIdentityOf,
  requestKeyOf,
  resultExpired,
  retryDecision,
  showsStream,
  staleMarkFor,
  startPrecondition,
  timeoutsOf,
  type ActiveOpEntry,
  type BuildResult,
  type Deadline,
  type EnvironmentChange,
  type OpEnvTag,
  type OpsEnvironment,
  type ParseContext,
  type ParseOutcome,
  type PersonaChoice,
  type StreamRequestContext,
  type StreamState,
  type StreamTimes,
} from '../domain/ops';
import { type ActionTokens } from './tokens';
import { type TabPresence } from './tabs';
import { AbortSwitch, NO_LOG, WriteQueue, type Clock, type IdSource, type KeyValueStore, type LogSink, type TabEventSink, type TimerHandle } from './ports';

/** storage.session key of the operation journal and results. */
export const OPS_STORE_KEY = 'ops.v1';

const DAY_MS = 86_400_000;
const UPDATE_APPEND_MAX = 64_000;
const DEBUG_STAGES_MAX = 32;
/** OpView.text (contracts `displayText(64_000)`): a longer stream travels only in batches and the result. */
const VIEW_TEXT_MAX = 64_000;

/** A feature's request builder and result parser; R11 plugs its own, the defaults are the domain's. */
export interface OpDriver {
  build(start: StartOp, ctx: StreamRequestContext): BuildResult;
  parse(text: string, ctx: ParseContext & { readonly feature: FeatureId }): ParseOutcome;
}

export interface OpSchedulerHooks {
  /** The resolver asked for a catalog refresh (persona changed). */
  refreshCatalog?(): void;
  /** The resolver asked for a bootstrap refresh (flags, version). */
  refreshBootstrap?(): void;
  /** A full recap finished (H-5 dossier save, §7 «Recap: общий и досье»); `ownerTab` null — its tab closed. */
  recapDone?(view: OpView, ownerTab: string | null): void;
  /** debug_input_v1 arrived: the debug store keeps it and answers an opaque token (DB-004). */
  debugInput?(opId: string, frame: Extract<HubFrame, { type: 'debug_input_v1' }>): string | null;
}

export interface OpSchedulerDeps {
  readonly clock: Clock;
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly hub: Pick<HubFacade, 'stream'>;
  readonly resolve: ResolveHubError;
  /** The background's state now (sign-in, bootstrap, personas, debug, settings). */
  readonly environment: () => OpsEnvironment;
  readonly tokens: Pick<ActionTokens, 'redeem'>;
  readonly events: TabEventSink;
  /** storage.session. */
  readonly store: KeyValueStore;
  /** Where a tab is now (toasts «AI готово · {фан}»). */
  readonly presence: (tabSessionId: string) => TabPresence | null;
  readonly log?: LogSink;
  readonly drivers?: Partial<Record<FeatureId, Partial<OpDriver>>>;
  readonly hooks?: OpSchedulerHooks;
}

export interface StartOptions {
  /** Fan name for the refusal list and toasts; display only. */
  readonly fanLabel?: string | null;
  /** The hub archive head the caller knew (part of the request identity). */
  readonly archiveHead?: string | null;
}

export type StartOutcome =
  | { readonly kind: 'admission'; readonly admission: Admission; readonly reopened: boolean }
  /** Nothing was admitted or spent on the hub; the tab keeps the person's input. */
  | { readonly kind: 'refused'; readonly code: CgCode };

export type CancelReason = 'explicit' | 'persona' | 'session' | 'hub';

interface PersistedMeta {
  readonly startedBy: string | null;
  readonly requestKey: string;
  readonly tag: OpEnvTag;
  readonly fanLabel: string | null;
  readonly knownIds: readonly string[];
  /** The preview's freshness checkpoint of the Generate click, kept with the opId (X8); null — none. */
  readonly checkpoint: FreshnessCheckpoint | null;
  /** Split was asked for (Б7), for «Получилась одна часть». */
  readonly split: boolean;
}

interface Run {
  view: OpView;
  readonly startedBy: string | null;
  ownerTab: string | null;
  readonly requestKey: string;
  readonly tag: OpEnvTag;
  readonly fanLabel: string | null;
  readonly chatKey: ChatKey;
  readonly knownIds: string[];
  readonly checkpoint: FreshnessCheckpoint | null;
  readonly split: boolean;
  /** Kept only while running: the request may hold draft or fresh text. */
  start: StartOp | null;
  request: HubStreamRequest | null;
  stream: StreamState;
  attempt: number;
  times: StreamTimes;
  abort: AbortSwitch | null;
  deadline: TimerHandle | null;
  flushTimer: TimerHandle | null;
  wait: { readonly timer: TimerHandle; readonly resume: (go: boolean) => void } | null;
  seq: number;
  pending: string;
  ended: boolean;
  context: ContextFrame | null;
  stages: { name: string; at: number }[];
  promptToken: string | null;
}

interface Settled {
  readonly state: Exclude<OpState, 'admitted' | 'requesting' | 'streaming'>;
  readonly code?: CgCode;
  readonly retryAt?: number | null;
  readonly httpStatus?: number | null;
  readonly result?: OpResult;
  /** Show a toast to the owning tab when it is elsewhere. */
  readonly toast: boolean;
}

function isHubCallError(error: unknown): error is HubCallError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; failure?: unknown };
  return candidate.name === 'HubCallError' && typeof candidate.failure === 'object' && candidate.failure !== null;
}

const nextUtcMidnight = (now: number): number => Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;

export class OpScheduler {
  private readonly runs = new Map<string, Run>();
  private readonly cache = new ResultCache();
  private readonly quotas = new Map<number, AiQuotaSnapshot>();
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly deps: OpSchedulerDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  // ── restore ──────────────────────────────────────────────────────────────

  /**
   * After an unload (§7 «Фон и выгрузка»): results come back, an operation
   * that was running becomes `interrupted` with an honest reason and is
   * never POSTed again; damaged and expired records are dropped.
   */
  async restore(): Promise<{ readonly restored: number; readonly interrupted: number; readonly dropped: number }> {
    const now = this.deps.clock.now();
    const records = readStore(await this.deps.store.get(OPS_STORE_KEY));
    let interrupted = 0;
    let dropped = records.dropped;
    for (const { view, meta } of records.items) {
      if (this.runs.has(view.opId)) continue;
      let next = view;
      if (!isTerminalOpState(view.state)) {
        interrupted += 1;
        next = { ...view, state: 'interrupted', phase: { name: 'settled', since: now }, endedAt: now, error: { code: 'CG-OP-INTERRUPTED' } };
        delete (next as { text?: string }).text;
      } else if (resultExpired(view, now)) {
        dropped += 1;
        continue;
      }
      const run = this.restoredRun(next, meta);
      this.runs.set(next.opId, run);
      if (next.state === 'done' && next.endedAt !== undefined) this.cache.remember({ requestKey: meta.requestKey, opId: next.opId, startedAt: next.startedAt, endedAt: next.endedAt });
    }
    if (interrupted > 0 || dropped > 0) {
      this.log.write({ level: 'info', scope: 'bg.ops', msg: 'operations restored', fields: { interrupted, dropped, kept: this.runs.size } });
      await this.persist().catch(() => undefined);
    }
    return { restored: this.runs.size, interrupted, dropped };
  }

  private restoredRun(view: OpView, meta: PersistedMeta): Run {
    return {
      view,
      startedBy: meta.startedBy,
      ownerTab: null,
      requestKey: meta.requestKey,
      tag: meta.tag,
      fanLabel: meta.fanLabel,
      chatKey: chatKeyOf(view.target.chat),
      knownIds: [...meta.knownIds],
      checkpoint: meta.checkpoint,
      split: meta.split,
      start: null,
      request: null,
      stream: INITIAL_STREAM_STATE,
      attempt: 0,
      times: { opRequestAt: view.startedAt, attemptAt: view.startedAt, metaAt: null, firstChunkAt: null, lastFrameAt: null },
      abort: null,
      deadline: null,
      flushTimer: null,
      wait: null,
      seq: 0,
      pending: '',
      ended: isTerminalOpState(view.state),
      context: null,
      stages: [],
      promptToken: null,
    };
  }

  // ── start ────────────────────────────────────────────────────────────────

  async start(tabSessionId: string, start: StartOp, options: StartOptions = {}): Promise<StartOutcome> {
    const { clock, tokens } = this.deps;
    // BG-001, AI-120: only a trusted click of our own UI starts a generation.
    if (!tokens.redeem({ tabSessionId, kind: 'generate', surface: start.surface, actionToken: start.cause.actionToken })) {
      this.log.write({ level: 'warn', scope: 'bg.ops', msg: 'start without a valid action token', code: 'CG-UI-FAILED', ctx: { tabSessionId } });
      return { kind: 'refused', code: 'CG-UI-FAILED' };
    }
    const env = this.deps.environment();
    const precondition = startPrecondition(env, start);
    if (precondition !== null) return { kind: 'refused', code: precondition };
    const session = env.session;
    const persona = env.persona(start.target.binding.pageId);
    if (session === null || persona === null) return { kind: 'refused', code: 'CG-AUTH-REQUIRED' };

    const identity = requestIdentityOf({ session, start, persona, archiveHead: options.archiveHead ?? null });
    const requestKey = requestKeyOf(identity);
    const chatKey = chatKeyOfStart(start);
    const now = clock.now();

    // AI-128: the same request reopens its result; Regenerate and Refresh bypass it.
    if (start.force !== true && start.regenerateOf === undefined) {
      const cached = this.cache.lookup(requestKey, now);
      const run = cached === null ? undefined : this.runs.get(cached.opId);
      if (run !== undefined && run.view.state === 'done') return { kind: 'admission', admission: { ok: true, opId: run.view.opId }, reopened: true };
    }

    // Atomic: decide and take the slot in one synchronous step (the single writer).
    const decision = decideAdmission(this.activeEntries(), { tabSessionId, chatKey, requestKey });
    if (decision.kind === 'reopen') {
      // A run whose tab went away (reload, closed tab) follows the tab that asked for it again.
      if (this.runs.get(decision.opId)?.ownerTab === null) this.attachTab(decision.opId, tabSessionId);
      return { kind: 'admission', admission: { ok: true, opId: decision.opId }, reopened: true };
    }
    if (decision.kind === 'refuse') return { kind: 'admission', admission: decision.refusal, reopened: false };

    const opId = this.deps.ids.uuid();
    const run = this.newRun(opId, tabSessionId, start, requestKey, chatKey, persona, session, options.fanLabel ?? null, now);
    this.runs.set(opId, run);

    // The admission and its identity reach storage.session before the hub request.
    try {
      await this.persist();
    } catch {
      this.runs.delete(opId);
      this.log.write({ level: 'error', scope: 'bg.ops', msg: 'admission journal write failed', code: 'CG-STORAGE-WRITE', ctx: { opId } });
      return { kind: 'refused', code: 'CG-STORAGE-WRITE' };
    }
    if (run.ended) return { kind: 'admission', admission: { ok: true, opId }, reopened: false };
    this.log.write({ level: 'info', scope: 'bg.ops', msg: 'operation admitted', fields: { feature: start.feature, surface: start.surface }, ctx: { opId, chatKey, tabSessionId, session: session.epoch } });
    void this.drive(run);
    return { kind: 'admission', admission: { ok: true, opId }, reopened: false };
  }

  private newRun(
    opId: string,
    tabSessionId: string,
    start: StartOp,
    requestKey: string,
    chatKey: ChatKey,
    persona: PersonaChoice,
    session: NonNullable<OpsEnvironment['session']>,
    fanLabel: string | null,
    now: number,
  ): Run {
    const knownIds = new Set<string>();
    for (const message of start.fresh?.messages ?? []) knownIds.add(message.platformMessageId);
    for (const id of start.checkpoint?.knownFanMessageIds ?? []) knownIds.add(id);
    return {
      view: {
        opId,
        feature: start.feature,
        surface: start.surface,
        target: start.target,
        state: 'admitted',
        phase: { name: 'admitted', since: now },
        startedAt: now,
        toneUsed: start.tone,
      },
      startedBy: tabSessionId,
      ownerTab: tabSessionId,
      requestKey,
      tag: {
        hubOrigin: session.hubOrigin,
        userId: session.userId,
        signInEpoch: session.epoch,
        pageId: start.target.binding.pageId,
        personaKey: persona.key,
        personaDefinitionId: persona.definitionId,
      },
      fanLabel,
      chatKey,
      knownIds: [...knownIds],
      checkpoint: start.checkpoint ?? null,
      split: start.split,
      start,
      request: null,
      stream: INITIAL_STREAM_STATE,
      attempt: 0,
      times: { opRequestAt: now, attemptAt: now, metaAt: null, firstChunkAt: null, lastFrameAt: null },
      abort: null,
      deadline: null,
      flushTimer: null,
      wait: null,
      seq: 0,
      pending: '',
      ended: false,
      context: null,
      stages: [{ name: 'admitted', at: now }],
      promptToken: null,
    };
  }

  // ── the run ──────────────────────────────────────────────────────────────

  private driver(feature: FeatureId): OpDriver {
    const custom = this.deps.drivers?.[feature];
    return {
      build: custom?.build ?? buildStreamRequest,
      parse: custom?.parse ?? ((text, ctx) => basicParseResult(ctx.feature, text, ctx)),
    };
  }

  private async drive(run: Run): Promise<void> {
    const env = this.deps.environment();
    const start = run.start;
    if (start === null || env.bootstrap === null) return this.settle(run, { state: 'failed', code: 'CG-HUB-UNAVAILABLE', toast: true });
    const built = this.driver(start.feature).build(start, {
      opId: run.view.opId,
      persona: { key: run.tag.personaKey, definitionId: run.tag.personaDefinitionId },
      bootstrap: env.bootstrap,
      debug: env.debug,
    });
    if (!built.ok) {
      this.log.write({ level: 'error', scope: 'bg.ops', msg: 'request refused before the hub', code: 'CG-HUB-REQUEST', fields: { issues: built.issues }, ctx: { opId: run.view.opId } });
      return this.settle(run, { state: 'failed', code: 'CG-HUB-REQUEST', toast: true });
    }
    run.request = built.request;
    this.move(run, 'requesting', { name: 'connecting', since: this.deps.clock.now() });

    for (;;) {
      const retryIn = await this.attempt(run);
      if (retryIn === null || run.ended) return;
      const go = await this.waitForRetry(run, retryIn);
      if (run.ended) return;
      if (!go) {
        // RB-001: the environment went away during the wait (no change event reached us): never POSTed later.
        this.log.write({ level: 'warn', scope: 'bg.ops', msg: 'retry interrupted', code: 'CG-OP-INTERRUPTED', ctx: { opId: run.view.opId } });
        this.settle(run, { state: 'interrupted', code: 'CG-OP-INTERRUPTED', toast: false });
        return;
      }
    }
  }

  /** One POST of the stream. Resolves with the pause before the single transparent retry, or null when it ended. */
  private async attempt(run: Run): Promise<number | null> {
    const { clock, hub } = this.deps;
    const request = run.request;
    if (request === null) return null;
    run.attempt += 1;
    run.stream = INITIAL_STREAM_STATE;
    run.times = { ...run.times, attemptAt: clock.now(), metaAt: null, firstChunkAt: run.times.firstChunkAt, lastFrameAt: null };
    if (run.attempt > 1) this.setPhase(run, { name: 'connecting', since: clock.now() });
    const abort = new AbortSwitch();
    run.abort = abort;
    this.armDeadline(run);
    try {
      await hub.stream(request, (frame) => this.onFrame(run, frame), abort.signal);
      if (run.ended) return null;
      const terminal = run.stream.terminal;
      if (terminal?.kind === 'done') {
        this.finishDone(run);
        return null;
      }
      // Resolved without `done`: EOF by another name.
      this.failWith(run, { kind: 'transport', failure: 'truncated' });
      return null;
    } catch (error) {
      if (run.ended) return null;
      const terminal = run.stream.terminal;
      // RB-005: an error frame is terminal and wins over the abort or EOF that follows it.
      if (terminal?.kind === 'error') {
        this.failWith(run, { kind: 'sse-error', code: terminal.code, retryAfterMs: terminal.retryAfterMs });
        return null;
      }
      if (terminal?.kind === 'done') {
        this.finishDone(run);
        return null;
      }
      const failure: HubFailure = isHubCallError(error) ? error.failure : { kind: 'transport', failure: 'network' };
      if (!isHubCallError(error)) this.log.write({ level: 'error', scope: 'bg.ops', msg: 'stream failed outside the facade contract', ctx: { opId: run.view.opId } });
      const resolution = this.resolve(run, failure, isHubCallError(error) ? error.epoch : null);
      const retry = retryDecision({
        disposition: resolution.disposition,
        attempt: run.attempt,
        frameSeen: run.stream.frames > 0,
        outputSeen: run.stream.outputSeen || run.times.firstChunkAt !== null,
        environmentLost: this.environmentLost(run),
      });
      if (retry.retry) return retry.delayMs;
      this.failResolved(run, resolution);
      return null;
    } finally {
      this.clearDeadline(run);
      run.abort = null;
    }
  }

  /**
   * «Сервис недоступен, повтор через 5 с…»: resolves true to retry, false
   * when canceled or interrupted meanwhile. The operation's whole-time
   * maximum keeps running across the wait.
   */
  private waitForRetry(run: Run, delayMs: number): Promise<boolean> {
    const now = this.deps.clock.now();
    this.setPhase(run, { name: 'retry-wait', since: now, retryAt: now + delayMs });
    this.armDeadline(run, { at: run.times.opRequestAt + timeoutsOf(run.view.feature).maxMs, kind: 'max' });
    return new Promise<boolean>((resolve) => {
      const timer = this.deps.clock.setTimer(delayMs, () => {
        run.wait = null;
        this.clearDeadline(run);
        resolve(!run.ended && !this.environmentLost(run));
      });
      run.wait = { timer, resume: resolve };
    });
  }

  private onFrame(run: Run, frame: HubFrame): void {
    if (run.ended) return;
    const now = this.deps.clock.now();
    const { state, effect } = readFrame(run.stream, frame, { opId: run.view.opId, personaDefinitionId: run.tag.personaDefinitionId, debug: this.deps.environment().debug });
    run.stream = state;
    if (effect.kind !== 'ignored') run.times = { ...run.times, lastFrameAt: now };
    switch (effect.kind) {
      case 'ignored':
        return;
      case 'meta':
        run.times = { ...run.times, metaAt: now };
        run.view = { ...run.view, generationRef: effect.generationRef };
        this.stage(run, 'meta', now);
        this.noteQuota(run, effect.quota, now);
        this.move(run, 'streaming', { name: 'awaiting-first-chunk', since: now });
        break;
      case 'context':
        if (frame.type === 'context_v1') run.context = frame;
        run.view = { ...run.view, servedContext: effect.served };
        for (const id of contextIds(effect.served)) if (!run.knownIds.includes(id)) run.knownIds.push(id);
        this.stage(run, 'context', now);
        break;
      case 'delta':
        run.pending += effect.text;
        if (effect.first) {
          // The first chunk goes out at once (first paint); later ones in 50 ms batches.
          run.times = { ...run.times, firstChunkAt: now };
          run.view = { ...run.view, firstChunkAt: now };
          this.stage(run, 'first-chunk', now);
          this.setPhase(run, { name: 'streaming', since: now });
        } else this.scheduleFlush(run);
        break;
      case 'usage': {
        this.stage(run, 'usage', now);
        // §8.4, DB-018, DB-022: the spend goes to the log always (numbers only), to the screen only in debug mode.
        const usage = effect.usage;
        this.log.write({
          level: 'info',
          scope: 'bg.ops.usage',
          msg: 'ai usage',
          fields: {
            feature: run.view.feature,
            surface: run.view.surface,
            pageId: run.tag.pageId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            costMicroUsd: usage.costMicroUsd,
          },
          ctx: { opId: run.view.opId },
        });
        break;
      }
      case 'reasoning':
        break;
      case 'debug-input':
        if (frame.type === 'debug_input_v1') run.promptToken = this.deps.hooks?.debugInput?.(run.view.opId, frame) ?? null;
        break;
      case 'terminal': {
        const terminal = effect.terminal;
        if (terminal.kind === 'persona-changed') {
          // §7 «Ограда»: drop the result, refresh the catalog, CG-PERSONA-CHANGED (AI-140, AI-141).
          this.deps.hooks?.refreshCatalog?.();
          this.settle(run, { state: 'failed', code: 'CG-PERSONA-CHANGED', toast: true });
          run.abort?.abort();
        } else if (terminal.kind === 'contract') {
          this.log.write({ level: 'error', scope: 'bg.ops', msg: 'stream broke its contract', code: 'CG-HUB-REQUEST', fields: { detail: terminal.detail }, ctx: { opId: run.view.opId } });
          this.settle(run, { state: 'failed', code: 'CG-HUB-REQUEST', toast: true });
          run.abort?.abort();
        } else this.stage(run, terminal.kind, now);
        return;
      }
    }
    this.armDeadline(run);
  }

  private finishDone(run: Run): void {
    if (run.ended) return;
    const now = this.deps.clock.now();
    this.setPhase(run, { name: 'parsing', since: now }, false);
    const text = run.stream.text;
    const parsed = this.driver(run.view.feature).parse(text, {
      feature: run.view.feature,
      splitRequested: run.split,
      generationRef: run.stream.generationRef,
    });
    if (!parsed.ok) {
      this.settle(run, { state: 'failed', code: parsed.code, toast: true });
      return;
    }
    run.view = text.length <= VIEW_TEXT_MAX ? { ...run.view, text } : withoutText(run.view);
    this.settle(run, { state: 'done', result: parsed.result, toast: true });
  }

  // ── failures ────────────────────────────────────────────────────────────

  private resolve(run: Run, failure: HubFailure, epoch: number | null): HubErrorResolution {
    const env = this.deps.environment();
    return this.deps.resolve(failure, {
      route: 'aiFeatureStream',
      currentSignIn: epoch === null || (env.session !== null && env.session.epoch === epoch && env.session.epoch === run.tag.signInEpoch),
      pageGranted: env.bootstrap === null ? null : env.bootstrap.pages.some((page) => page.pageId === run.tag.pageId),
      beforeFirstFrame: run.stream.frames === 0 && !run.stream.outputSeen,
      claimAction: null,
      fanLookup: false,
      now: this.deps.clock.now(),
    });
  }

  private failWith(run: Run, failure: HubFailure): void {
    this.failResolved(run, this.resolve(run, failure, null));
  }

  private failResolved(run: Run, resolution: HubErrorResolution): void {
    switch (resolution.disposition) {
      case 'ignore':
        // An answer to an older sign-in (AU-014): the session change cancels the operation; nothing to show.
        this.settle(run, { state: 'canceled', toast: false });
        return;
      case 'refresh-catalog':
        this.deps.hooks?.refreshCatalog?.();
        break;
      case 'refresh-bootstrap':
        this.deps.hooks?.refreshBootstrap?.();
        break;
      case 'show':
      case 'clear-sign-in':
      case 'retry-once':
      case 'restart-cursor':
      case 'not-ready':
      case 'empty':
      case 'read-status':
        break;
    }
    this.settle(run, {
      state: 'failed',
      code: resolution.code ?? 'CG-HUB-UNKNOWN',
      retryAt: resolution.retryAt,
      httpStatus: resolution.httpStatus,
      toast: true,
    });
  }

  // ── cancel, environment, tabs, incoming ─────────────────────────────────

  /** Explicit cancel (button, ⌘. / Ctrl+., Esc in the loading overlay); returns the state after it. */
  cancel(opId: string, reason: CancelReason = 'explicit'): OpState | null {
    const run = this.runs.get(opId);
    if (run === undefined) return null;
    if (run.ended) return run.view.state;
    const code: CgCode | undefined = reason === 'persona' ? 'CG-PERSONA-CHANGED' : reason === 'explicit' ? undefined : 'CG-CONTEXT-CHANGED';
    this.settle(run, code === undefined ? { state: 'canceled', toast: false } : { state: 'canceled', code, toast: true });
    run.abort?.abort();
    return run.view.state;
  }

  /** A sign-in, hub address or persona change: the operations bound to the old one are canceled (AI-126). */
  environmentChanged(change: EnvironmentChange): readonly string[] {
    const canceled: string[] = [];
    for (const run of this.runs.values()) {
      if (run.ended || !canceledByChange(run.tag, change)) continue;
      this.cancel(run.view.opId, change.kind === 'persona' ? 'persona' : change.kind === 'hub' ? 'hub' : 'session');
      canceled.push(run.view.opId);
    }
    if (change.kind !== 'persona') {
      // The cache never crosses users or sign-ins (AI-128): results of the old sign-in go.
      const keep = (run: Run): boolean =>
        !run.ended || (change.kind === 'session' && change.next !== null && change.next.hubOrigin === run.tag.hubOrigin && change.next.userId === run.tag.userId && change.next.epoch === run.tag.signInEpoch);
      for (const [opId, run] of this.runs) {
        if (keep(run)) continue;
        this.runs.delete(opId);
        this.cache.forgetOp(opId);
      }
      void this.persist().catch(() => undefined);
    }
    return canceled;
  }

  /** The owning tab closed: the surface detaches, the generation goes on (BG-006, AI-124). */
  detachTab(tabSessionId: string): readonly string[] {
    const detached: string[] = [];
    for (const run of this.runs.values()) {
      if (run.ownerTab !== tabSessionId) continue;
      run.ownerTab = null;
      if (run.flushTimer !== null) {
        this.deps.clock.clearTimer(run.flushTimer);
        run.flushTimer = null;
      }
      run.pending = '';
      if (!run.ended) detached.push(run.view.opId);
    }
    return detached;
  }

  /**
   * A tab (re-)attaches to an operation it shows: after a reload, from the
   * palette «Перейти», or to resync its mirror after a gap. The view carries
   * the text so far (Fix excepted); the batches start again at seq 1 for
   * this tab, so a mirror seeded from the view (mirrorFromView) continues
   * without a gap. What was pending for the old owner is in that text.
   */
  attachTab(opId: string, tabSessionId: string): OpView | null {
    const run = this.runs.get(opId);
    if (run === undefined) return null;
    if (!run.ended) {
      if (run.flushTimer !== null) {
        this.deps.clock.clearTimer(run.flushTimer);
        run.flushTimer = null;
      }
      run.pending = '';
      run.seq = 0;
      run.ownerTab = tabSessionId;
    }
    return this.publicView(run);
  }

  /** A fan's message (sound.event facts): results of that chat become stale (§7 «Кэш», §6.7.5). */
  incoming(fact: IncomingFact, receivedAt: number = this.deps.clock.now()): readonly string[] {
    const marked: string[] = [];
    for (const run of this.runs.values()) {
      if (run.view.stale !== undefined || run.view.state === 'failed' || run.view.state === 'canceled' || run.view.state === 'interrupted') continue;
      const mark = staleMarkFor({ chatKey: run.chatKey, startedAt: run.view.startedAt, ids: run.knownIds }, fact, receivedAt);
      if (mark === null) continue;
      run.view = { ...run.view, stale: mark };
      marked.push(run.view.opId);
      if (run.ended) this.deps.events.emit(null, 'op.done', { view: this.publicView(run) });
    }
    if (marked.length > 0) void this.persist().catch(() => undefined);
    return marked;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  view(opId: string): OpView | null {
    const run = this.runs.get(opId);
    return run === undefined ? null : this.publicView(run);
  }

  /** `op.list`: this tab's results (or the chat's), or the newest across tabs. */
  list(tabSessionId: string, scope: 'tab' | 'all', chatKey?: ChatKey): { readonly ops: OpView[]; readonly truncated: boolean } {
    const now = this.deps.clock.now();
    const visible = [...this.runs.values()].filter((run) => !resultExpired(run.view, now));
    const mine = visible.filter((run) => (chatKey === undefined || run.chatKey === chatKey) && (scope === 'all' || run.startedBy === tabSessionId || run.ownerTab === tabSessionId || chatKey !== undefined));
    mine.sort((a, b) => b.view.startedAt - a.view.startedAt);
    const cap = scope === 'tab' ? STORAGE_LIMITS.resultsPerTab : STORAGE_LIMITS.opListMax;
    return { ops: mine.slice(0, cap).map((run) => this.publicView(run)), truncated: mine.length > cap };
  }

  /** Running operations (palette, diagnostics). */
  active(): readonly OpView[] {
    return [...this.runs.values()].filter((run) => !run.ended).map((run) => this.publicView(run));
  }

  /** `quota.get`: the page's quota as the last `meta` reported it; null — unknown. */
  quota(pageId: number): AiQuotaSnapshot | null {
    return this.quotas.get(pageId) ?? null;
  }

  /** What the send coordinator needs about the operation a send comes from. */
  forSend(opId: string): { readonly view: OpView; readonly checkpoint: FreshnessCheckpoint | null; readonly tag: OpEnvTag } | null {
    const run = this.runs.get(opId);
    if (run === undefined) return null;
    return { view: run.view, checkpoint: run.checkpoint, tag: run.tag };
  }

  /** Resolves when every journal write so far settled (tests, shutdown). */
  idle(): Promise<void> {
    return this.writes.idle();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private activeEntries(): ActiveOpEntry[] {
    const entries: ActiveOpEntry[] = [];
    for (const run of this.runs.values()) {
      if (run.ended) continue;
      entries.push({
        opId: run.view.opId,
        chatKey: run.chatKey,
        ownerTab: run.ownerTab,
        requestKey: run.requestKey,
        summary: { opId: run.view.opId, feature: run.view.feature, surface: run.view.surface, chat: run.view.target.chat, fanLabel: run.fanLabel, state: run.view.state, startedAt: run.view.startedAt },
      });
    }
    return entries;
  }

  private environmentLost(run: Run): boolean {
    if (run.ended) return true;
    const env = this.deps.environment();
    const session = env.session;
    if (session === null || session.hubOrigin !== run.tag.hubOrigin || session.userId !== run.tag.userId || session.epoch !== run.tag.signInEpoch) return true;
    const persona = env.persona(run.tag.pageId);
    return persona === null || persona.definitionId !== run.tag.personaDefinitionId || persona.key !== run.tag.personaKey;
  }

  private move(run: Run, state: OpState, phase: Phase): void {
    if (run.ended || run.view.state === state) {
      this.setPhase(run, phase);
      return;
    }
    run.view = { ...run.view, state, phase };
    this.stage(run, state, phase.since);
    this.flush(run);
  }

  private setPhase(run: Run, phase: Phase, flushNow = true): void {
    if (run.ended) return;
    run.view = { ...run.view, phase };
    this.stage(run, phase.name, phase.since);
    if (flushNow) this.flush(run);
    else this.scheduleFlush(run);
  }

  private stage(run: Run, name: string, at: number): void {
    if (run.stages.length < DEBUG_STAGES_MAX) run.stages.push({ name, at });
  }

  private scheduleFlush(run: Run): void {
    if (run.flushTimer !== null || run.ownerTab === null) return;
    run.flushTimer = this.deps.clock.setTimer(OP_LIMITS.updateBatchMs, () => {
      run.flushTimer = null;
      this.flush(run);
    });
  }

  /** Sends what accumulated as `op.update` batches to the owning tab (AI-137). */
  private flush(run: Run): void {
    if (run.flushTimer !== null) {
      this.deps.clock.clearTimer(run.flushTimer);
      run.flushTimer = null;
    }
    const to = run.ownerTab;
    if (to === null) {
      run.pending = '';
      return;
    }
    let pending = run.pending;
    run.pending = '';
    do {
      const append = pending.slice(0, UPDATE_APPEND_MAX);
      pending = pending.slice(UPDATE_APPEND_MAX);
      run.seq += 1;
      this.deps.events.emit(to, 'op.update', {
        opId: run.view.opId,
        seq: run.seq,
        append,
        state: run.view.state,
        phase: run.view.phase,
        ...(run.view.firstChunkAt === undefined ? {} : { firstChunkAt: run.view.firstChunkAt }),
      });
    } while (pending.length > 0);
  }

  private armDeadline(run: Run, at?: Deadline): void {
    this.clearDeadline(run);
    if (run.ended) return;
    const deadline = at ?? nextDeadline(run.view.feature, run.times);
    const delay = Math.max(0, deadline.at - this.deps.clock.now());
    run.deadline = this.deps.clock.setTimer(delay, () => {
      run.deadline = null;
      if (run.ended) return;
      // RB-002/RB-003: a timeout is CG-HUB-TIMEOUT, never retried.
      this.log.write({ level: 'warn', scope: 'bg.ops', msg: 'stream deadline passed', code: TIMEOUT_CODE, fields: { kind: deadline.kind }, ctx: { opId: run.view.opId } });
      this.settle(run, { state: 'failed', code: TIMEOUT_CODE, toast: true });
      run.abort?.abort();
    });
  }

  private clearDeadline(run: Run): void {
    if (run.deadline !== null) {
      this.deps.clock.clearTimer(run.deadline);
      run.deadline = null;
    }
  }

  private noteQuota(run: Run, quota: { readonly remainingRequestsToday: number | null; readonly remainingMicroUsdToday: number | null }, now: number): void {
    const snapshot: AiQuotaSnapshot = {
      pageId: run.tag.pageId,
      remainingRequestsToday: quota.remainingRequestsToday,
      remainingMicroUsdToday: quota.remainingMicroUsdToday,
      resetsAt: new Date(nextUtcMidnight(now)).toISOString(),
      observedAt: new Date(now).toISOString(),
    };
    this.quotas.set(run.tag.pageId, snapshot);
    this.deps.events.emit(null, 'quota.changed', { quota: snapshot });
  }

  /** The one place an operation ends. */
  private settle(run: Run, settled: Settled): void {
    if (run.ended) return;
    const now = this.deps.clock.now();
    this.flush(run);
    run.ended = true;
    this.clearDeadline(run);
    if (run.wait !== null) {
      this.deps.clock.clearTimer(run.wait.timer);
      const resume = run.wait.resume;
      run.wait = null;
      resume(false);
    }
    const error =
      settled.code === undefined
        ? undefined
        : {
            code: settled.code,
            ...(settled.retryAt === undefined || settled.retryAt === null ? {} : { retryAt: settled.retryAt }),
            ...(settled.httpStatus === undefined || settled.httpStatus === null ? {} : { httpStatus: settled.httpStatus }),
          };
    const view: OpView = {
      ...run.view,
      state: settled.state,
      phase: { name: 'settled', since: now },
      endedAt: now,
      ...(settled.result === undefined ? {} : { result: settled.result }),
      ...(error === undefined ? {} : { error }),
    };
    if (settled.state !== 'done') delete (view as { text?: string }).text;
    run.view = view;
    this.stage(run, 'settled', now);
    const debug = this.deps.environment().debug ? this.debugView(run) : undefined;
    if (debug !== undefined) run.view = { ...run.view, debug };
    // Texts the request carried (draft, fresh tail, Coach question) leave memory with the run.
    run.start = null;
    run.request = null;
    if (settled.state === 'done') {
      this.cache.remember({ requestKey: run.requestKey, opId: run.view.opId, startedAt: run.view.startedAt, endedAt: now });
      if (run.view.feature === 'recap') this.deps.hooks?.recapDone?.(run.view, run.ownerTab);
    }
    this.log.write({
      level: settled.state === 'failed' ? 'warn' : 'info',
      scope: 'bg.ops',
      msg: 'operation ended',
      ...(settled.code === undefined ? {} : { code: settled.code }),
      fields: { state: settled.state, feature: run.view.feature, attempts: run.attempt, ms: now - run.view.startedAt },
      ctx: { opId: run.view.opId, chatKey: run.chatKey },
    });
    this.deps.events.emit(null, 'op.done', { view: this.publicView(run) });
    if (settled.toast) this.toast(run, settled);
    void this.persist().catch(() => {
      this.log.write({ level: 'error', scope: 'bg.ops', msg: 'result journal write failed', code: 'CG-STORAGE-WRITE', ctx: { opId: run.view.opId } });
    });
  }

  /** «AI готово · {фан}» / «AI: не получилось · {фан}» when the owning tab shows another chat (§7). */
  private toast(run: Run, settled: Settled): void {
    const owner = run.ownerTab;
    if (owner === null) return;
    const presence = this.deps.presence(owner);
    if (presence === null) return;
    const here = presence.chat !== null && chatKeyOf(presence.chat) === run.chatKey && presence.visible;
    if (here || (settled.state !== 'done' && settled.state !== 'failed')) return;
    const toast: BackgroundToast = {
      toastId: this.deps.ids.uuid(),
      kind: settled.state === 'done' ? 'success' : 'error',
      scope: settled.state === 'done' ? 'op.ready' : 'op.failed',
      opId: run.view.opId,
      feature: run.view.feature,
      chat: run.view.target.chat,
      fanLabel: run.fanLabel,
      ...(run.view.error === undefined ? {} : { error: run.view.error, code: run.view.error.code }),
    };
    this.deps.events.emit(owner, 'toast', { toast });
  }

  private debugView(run: Run): OpDebugView {
    const usage = run.stream.usage;
    const frame = run.context;
    return {
      stages: run.stages.slice(0, DEBUG_STAGES_MAX).map((stage) => ({ name: stage.name.slice(0, 48), at: stage.at })),
      usage:
        usage === null
          ? null
          : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, costMicroUsd: usage.costMicroUsd },
      reasoning: run.stream.reasoning.length > 0 ? run.stream.reasoning : null,
      promptToken: run.promptToken,
      context:
        frame === null
          ? null
          : {
              source: frame.source.slice(0, 64),
              coverage: frame.coverage.slice(0, 64),
              windowRequested: frame.window.requested,
              windowServed: frame.window.served,
              liveAccepted: frame.live.accepted,
              liveRejected: frame.live.rejected,
            },
    };
  }

  /** The view a tab sees: while running, with the text so far (never Fix's: its stream is not shown, AI-138). */
  private publicView(run: Run): OpView {
    if (run.ended || !showsStream(run.view.feature)) return run.view;
    const text = run.stream.text;
    if (text.length === 0 || text.length > VIEW_TEXT_MAX) return run.view;
    return { ...run.view, text };
  }

  private async persist(): Promise<void> {
    const now = this.deps.clock.now();
    const items = pruned([...this.runs.values()], now);
    const kept = new Set(items.map((run) => run.view.opId));
    for (const [opId, run] of this.runs) {
      if (kept.has(opId) || !run.ended) continue;
      this.runs.delete(opId);
      this.cache.forgetOp(opId);
    }
    const value = {
      v: 1,
      ops: items.map((run) => ({
        view: run.ended ? run.view : withoutText(run.view),
        meta: { startedBy: run.startedBy, requestKey: run.requestKey, tag: run.tag, fanLabel: run.fanLabel, knownIds: run.knownIds, checkpoint: run.checkpoint, split: run.split } satisfies PersistedMeta,
      })),
    };
    await this.writes.run(() => this.deps.store.set(OPS_STORE_KEY, value));
  }
}

// ── persistence helpers ──────────────────────────────────────────────────

function withoutText(view: OpView): OpView {
  if (view.text === undefined) return view;
  const copy: OpView = { ...view };
  delete (copy as { text?: string }).text;
  return copy;
}

function contextIds(served: NonNullable<OpView['servedContext']>): string[] {
  const ids: string[] = [];
  if (served.servedHead !== null) ids.push(served.servedHead.messageRef);
  for (const known of served.knownFanMessages ?? []) if (known.state === 'included') ids.push(known.id);
  return ids;
}

/** Retention (§9.4): every running operation; per starting tab the newest results; the total within its bytes. */
function pruned(runs: readonly Run[], now: number): Run[] {
  const live = runs.filter((run) => !run.ended || !resultExpired(run.view, now));
  live.sort((a, b) => b.view.startedAt - a.view.startedAt);
  const perTab = new Map<string, number>();
  const kept: Run[] = [];
  let bytes = 0;
  for (const run of live) {
    if (!run.ended) {
      kept.push(run);
      continue;
    }
    const tab = run.startedBy ?? '';
    const count = perTab.get(tab) ?? 0;
    if (count >= STORAGE_LIMITS.resultsPerTab) continue;
    const size = JSON.stringify(run.view).length;
    if (bytes + size > STORAGE_LIMITS.resultsTotalBytes) continue;
    bytes += size;
    perTab.set(tab, count + 1);
    kept.push(run);
  }
  return kept;
}

function readStore(raw: unknown): { readonly items: { readonly view: OpView; readonly meta: PersistedMeta }[]; readonly dropped: number } {
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1 || !Array.isArray((raw as { ops?: unknown }).ops)) {
    return { items: [], dropped: raw === undefined || raw === null ? 0 : 1 };
  }
  const items: { view: OpView; meta: PersistedMeta }[] = [];
  let dropped = 0;
  for (const item of (raw as { ops: unknown[] }).ops) {
    const view = OpViewSchema.safeParse((item as { view?: unknown } | null)?.view);
    const meta = readMeta((item as { meta?: unknown } | null)?.meta);
    if (!view.success || meta === null) dropped += 1;
    else items.push({ view: view.data, meta });
  }
  return { items, dropped };
}

function readMeta(raw: unknown): PersistedMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['split'] !== 'boolean') return null;
  if (m['checkpoint'] !== null && !FreshnessCheckpointSchema.safeParse(m['checkpoint']).success) return null;
  const tag = m['tag'] as Record<string, unknown> | undefined;
  const ok =
    (m['startedBy'] === null || typeof m['startedBy'] === 'string') &&
    typeof m['requestKey'] === 'string' &&
    (m['fanLabel'] === null || typeof m['fanLabel'] === 'string') &&
    Array.isArray(m['knownIds']) &&
    (m['knownIds'] as unknown[]).every((id) => typeof id === 'string') &&
    typeof tag === 'object' &&
    tag !== null &&
    typeof tag['hubOrigin'] === 'string' &&
    typeof tag['userId'] === 'number' &&
    typeof tag['signInEpoch'] === 'number' &&
    typeof tag['pageId'] === 'number' &&
    typeof tag['personaKey'] === 'string' &&
    typeof tag['personaDefinitionId'] === 'string';
  return ok ? (raw as PersistedMeta) : null;
}
