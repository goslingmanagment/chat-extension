import { generationDebug } from '../domain/debug/op-debug';
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
// went away interrupts it. A hub that refuses the page's persona as edited
// since (`persona_definition_changed`, before any frame: nothing was made)
// is asked once more at once, with the persona the catalog has now. After an unload a running operation is
// `interrupted` and never POSTed again. Results live 30 minutes. A tab that
// re-attaches to a running operation (reload, palette «Перейти», a mirror's
// gap) gets the text so far in the view and the batches start again at seq 1
// for it (mirrorFromView). Usage goes to the log always (no text), to the
// screen only in debug mode (§8.4).
//
// A Coach turn with auto-recap is one composite slot (§7, AI-096): one start
// (`StartOp.coach.autoRecap`), one token, one admission. The recap runs as an
// operation of its own; the moment it ends — and the question still goes —
// the answer step takes the chat's slot in the same synchronous step, so no
// other start can be admitted in between, and the recap's terminal view
// names it (`OpView.continuedBy`).

import { type CgCode } from '@cg/contracts/errors';
import { FEATURE_IDS, type FeatureId, type SiteOpId } from '@cg/contracts/features';
import type { HostKind } from '@cg/contracts/hosts';
import { TargetSchema } from '@cg/contracts/ids';
import type { ScheduledStart, SiteOperations } from './site-ops';
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
import { COVERAGE_CHECK_LIMITS, OP_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { OpViewSchema, type Admission, type OpDebugView, type OpState, type OpView, type AnyOpView, type SiteOpView, type SiteStartOp, type AnyStartOp, type AnyOpResult, type Phase, type StartOp } from '@cg/contracts/ops';
import { FreshnessCheckpointSchema, type FreshnessCheckpoint } from '@cg/contracts/send';
import { coverageFingerprintOf } from '../domain/ops/proof';
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
  nextDeadlineFor,
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
import { coachTurnSteps, recapStepVerdict } from '../domain/coach';
import { freshTextAdmitted } from '../domain/features/admission';
import { conversationOf } from '../domain/ops/conversation';
import { type ActionTokens } from './tokens';
import { type TabPresence } from './presence';
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
  /** Once per operation that reached the hub, before its start proof leaves memory. Local numbers only downstream. */
  settled?(view: OpView, start: StartOp, ownerTab: string | null): void;
  /** The resolver asked for a catalog refresh (persona changed). */
  refreshCatalog?(): void;
  /** The resolver asked for a bootstrap refresh (flags, version). */
  refreshBootstrap?(): void;
  /** A full recap finished (H-5 dossier save, §7 «Recap: общий и досье»); `ownerTab` null — its tab closed. */
  recapDone?(view: OpView, ownerTab: string | null): void;
  /** The echo ticket can exist even when the hub returned no prompt blocks. */
  promptToken?(opId: string): string | null;
  /** debug_input_v1 arrived: the debug store keeps it and answers an opaque token (DB-004). */
  debugInput?(opId: string, frame: Extract<HubFrame, { type: 'debug_input_v1' }>): string | null;
  /** A `usage` frame arrived (numbers only): the local spend journal of debug mode counts it (DB-022). */
  usage?(feature: string, usage: Extract<HubFrame, { type: 'usage' }>['usage']): void;
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
  /** Where a tab is now (toasts «AI готово · {фан}»): the chat it shows and whether it is visible. */
  readonly presence: (tabSessionId: string) => Pick<TabPresence, 'chat' | 'visible'> | null;
  readonly log?: LogSink;
  readonly drivers?: Partial<Record<FeatureId, Partial<OpDriver>>>;
  readonly hooks?: OpSchedulerHooks;
  /**
   * What the browser says about the connection (`navigator.onLine`); absent — not asked. A deadline that fires
   * before the hub answered while the browser says «offline» is «нет связи» (CG-NETWORK): the request could not
   * be delivered — not a hub that was slow to answer (CG-HUB-TIMEOUT).
   */
  readonly online?: () => boolean;
  /** Loads only the owning site module, including when its journal is restored. */
  readonly siteOps?: (host: HostKind) => Promise<SiteOperations | null>;
  /**
   * The page's persona as the hub has it now — the catalog read again, the page's choice following it (an owner's
   * edit gives a persona another definition under the same key); null — none. Asked when the hub refused the
   * definition a request named; absent — such a refusal is shown as it is.
   */
  readonly personaNow?: (pageId: number) => Promise<PersonaChoice | null>;
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
  view: AnyOpView;
  readonly site: SiteOperations | null;
  readonly startedBy: string | null;
  ownerTab: string | null;
  readonly requestKey: string;
  /** Its persona definition follows the hub once (`followPersona`); everything else stays as admitted. */
  tag: OpEnvTag;
  readonly fanLabel: string | null;
  readonly chatKey: ChatKey;
  readonly knownIds: string[];
  readonly checkpoint: FreshnessCheckpoint | null;
  readonly split: boolean;
  /** Kept only while running: the request may hold draft or fresh text. */
  start: ScheduledStart | null;
  /** The answer step of a composite Coach turn whose recap step this run is; kept only while running (it holds the question). */
  then: StartOp | null;
  request: HubStreamRequest | null;
  stopReason: string | null;
  stream: StreamState;
  attempt: number;
  /** The request was asked again with the persona's current definition (once per operation). */
  personaFollowed: boolean;
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
  /**
   * Where the request of the current attempt stands, as the hub layer said (`noteWire`): nothing yet, handed to
   * the network, or answered by the hub. A deadline that fires says which — «the request was sent and the hub
   * did not answer» is not «the hub answered and then fell silent».
   */
  wire: WireStage;
}

/** `idle` — not handed to the network (yet); `sent`; `answered` — the hub answered the handshake with this status. */
export type WireStage = { readonly at: 'idle' } | { readonly at: 'sent'; readonly since: number } | { readonly at: 'answered'; readonly since: number; readonly status: number };

const WIRE_IDLE: WireStage = { at: 'idle' };

interface Settled {
  readonly state: Exclude<OpState, 'admitted' | 'requesting' | 'streaming'>;
  readonly code?: CgCode;
  readonly retryAt?: number | null;
  readonly httpStatus?: number | null;
  /** The technical line of the error (machine words only: which deadline, how far the request got). */
  readonly detail?: string;
  readonly result?: AnyOpResult;
  /** Show a toast to the owning tab when it is elsewhere. */
  readonly toast: boolean;
}

/**
 * How far the request had got when a deadline fired: `not-sent` — nothing was handed to the network (the hub
 * layer was still preparing); `no-answer` — the request was sent and the hub had not answered the handshake;
 * `no-frames` — the hub answered and sent no frame; `silent` — frames came, then nothing.
 */
export function deadlineStage(wire: WireStage, frames: number): 'not-sent' | 'no-answer' | 'no-frames' | 'silent' {
  if (frames > 0) return 'silent';
  return wire.at === 'idle' ? 'not-sent' : wire.at === 'sent' ? 'no-answer' : 'no-frames';
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
    const records = await readStore(await this.deps.store.get(OPS_STORE_KEY), this.deps.siteOps);
    let interrupted = 0;
    let dropped = records.dropped;
    for (const { view, meta, site } of records.items) {
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
      const run = this.restoredRun(next, meta, site);
      this.runs.set(next.opId, run);
      if (next.state === 'done' && next.endedAt !== undefined) this.cache.remember({ requestKey: meta.requestKey, opId: next.opId, startedAt: next.startedAt, endedAt: next.endedAt });
    }
    if (interrupted > 0 || dropped > 0) {
      this.log.write({ level: 'info', scope: 'bg.ops', msg: 'operations restored', fields: { interrupted, dropped, kept: this.runs.size } });
      await this.persist().catch(() => undefined);
    }
    return { restored: this.runs.size, interrupted, dropped };
  }

  private restoredRun(view: AnyOpView, meta: PersistedMeta, site: SiteOperations | null): Run {
    return {
      view,
      site,
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
      then: null,
      request: null,
      stopReason: null,
      stream: INITIAL_STREAM_STATE,
      attempt: 0,
      personaFollowed: false,
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
      wire: WIRE_IDLE,
    };
  }

  // ── start ────────────────────────────────────────────────────────────────

  async start(tabSessionId: string, input: AnyStartOp, options: StartOptions = {}): Promise<StartOutcome> {
    const { clock, tokens } = this.deps;
    const site = isSharedFeature(input.feature) ? null : await this.deps.siteOps?.(input.target.binding.host) ?? null;
    const siteDriver = site?.drivers[input.feature as SiteOpId];
    if (!isSharedFeature(input.feature) && (site === null || site.host !== input.target.binding.host || siteDriver === undefined)) return { kind: 'refused', code: 'CG-FEATURE-DISABLED' };
    const asked: ScheduledStart = isSharedFeature(input.feature) ? input as StartOp : siteDriver!.prepare(input as SiteStartOp);
    // BG-001, AI-120: only a trusted click of our own UI starts a generation.
    if (!tokens.redeem({ tabSessionId, kind: 'generate', surface: asked.surface, actionToken: asked.cause.actionToken })) {
      this.log.write({ level: 'warn', scope: 'bg.ops', msg: 'start without a valid action token', code: 'CG-UI-FAILED', ctx: { tabSessionId } });
      return { kind: 'refused', code: 'CG-UI-FAILED' };
    }
    const env = this.deps.environment();
    const precondition = startPrecondition(env, asked, siteDriver?.feature);
    if (precondition !== null) return { kind: 'refused', code: precondition };
    const session = env.session;
    const persona = env.persona(asked.target.binding.pageId);
    if (session === null || persona === null) return { kind: 'refused', code: 'CG-AUTH-REQUIRED' };

    // §7 «ход Coach с авто-рекапом — один составной слот»: this one start and its one token admit the recap
    // step now and the answer step after it. A recap that may not run here at all (its owner switch is off)
    // is not a reason to lose the question: the Coach is asked right away.
    const steps = isSharedFeature(asked.feature) ? coachTurnSteps(asked as StartOp) : null;
    const composite = steps !== null && startPrecondition(env, steps.recap) === null;
    const start = steps === null ? asked : composite ? steps.recap : steps.answer;
    const then = steps !== null && composite ? steps.answer : null;

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
      if (this.runs.get(decision.opId)?.ownerTab === null) this.attachRun(decision.opId, tabSessionId);
      return { kind: 'admission', admission: { ok: true, opId: decision.opId }, reopened: true };
    }
    if (decision.kind === 'refuse') return { kind: 'admission', admission: decision.refusal, reopened: false };

    const opId = this.deps.ids.uuid();
    const run = this.newRun(opId, tabSessionId, start, requestKey, chatKey, persona, session, options.fanLabel ?? null, now, site);
    run.then = then;
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
    this.log.write({
      level: 'info',
      scope: 'bg.ops',
      msg: 'operation admitted',
      fields: { feature: start.feature, surface: start.surface, ...(then === null ? {} : { composite: true }) },
      ctx: { opId, chatKey, tabSessionId, session: session.epoch },
    });
    this.launch(run);
    return { kind: 'admission', admission: { ok: true, opId }, reopened: false };
  }

  /**
   * The recap step of a composite Coach turn ended (§7): when the question
   * still goes — the recap is done, or could not be made for reasons of the
   * conversation itself — the answer step takes the chat's slot here, in the
   * same synchronous step that ends the recap. No admission can come in
   * between, no second token is spent, and nothing is queued. A canceled or
   * stopped recap ends the turn; so does a tab that went away (the dialog
   * lives in its memory: an answer nobody can read is not paid for) and an
   * environment that is no longer the one the turn was admitted in.
   */
  private continuation(run: Run, answer: StartOp, settled: Settled, now: number): Run | null {
    const proceeds = settled.state === 'done' || (settled.state === 'failed' && settled.code !== undefined && recapStepVerdict(settled.code) === 'proceed');
    const owner = run.ownerTab;
    if (!proceeds || owner === null || this.tagLost(run.tag)) return null;
    const env = this.deps.environment();
    const session = env.session;
    const persona = env.persona(run.tag.pageId);
    if (session === null || persona === null || startPrecondition(env, answer) !== null) return null;
    const opId = this.deps.ids.uuid();
    const requestKey = requestKeyOf(requestIdentityOf({ session, start: answer, persona, archiveHead: null }));
    const next = this.newRun(opId, owner, answer, requestKey, run.chatKey, persona, session, run.fanLabel, now);
    this.runs.set(opId, next);
    this.log.write({
      level: 'info',
      scope: 'bg.ops',
      msg: 'operation admitted',
      fields: { feature: answer.feature, surface: answer.surface, continues: true },
      ctx: { opId, chatKey: run.chatKey, tabSessionId: owner, session: session.epoch },
    });
    return next;
  }

  private newRun(
    opId: string,
    tabSessionId: string,
    start: ScheduledStart,
    requestKey: string,
    chatKey: ChatKey,
    persona: PersonaChoice,
    session: NonNullable<OpsEnvironment['session']>,
    fanLabel: string | null,
    now: number,
    site: SiteOperations | null = null,
  ): Run {
    const knownIds = new Set<string>();
    for (const message of start.fresh?.messages ?? []) knownIds.add(message.platformMessageId);
    for (const id of start.checkpoint?.knownFanMessageIds ?? []) knownIds.add(id);
    // A proof's window (R20 P8b1): what the tab saw before the click is never «новое после генерации».
    for (const entry of start.proof?.window ?? []) knownIds.add(entry.id);
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
        ...(start.proof === undefined ? {} : { freshnessProof: { windowSize: Math.min(COVERAGE_CHECK_LIMITS.windowMax, Math.max(start.window, start.proof.window.length)), fingerprint: coverageFingerprintOf(start.proof) } }),
      },
      site,
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
      then: null,
      request: null,
      stopReason: null,
      stream: INITIAL_STREAM_STATE,
      attempt: 0,
      personaFollowed: false,
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
      wire: WIRE_IDLE,
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

  private timeouts(run: Run) {
    return run.site?.drivers[run.view.feature as SiteOpId]?.timeouts ?? timeoutsOf(run.view.feature as FeatureId);
  }

  private build(run: Run, start: ScheduledStart, ctx: StreamRequestContext): BuildResult {
    if (run.site !== null) return run.site.drivers[start.feature as SiteOpId]!.build(start, ctx);
    return this.driver(start.feature as FeatureId).build(start as StartOp, ctx);
  }

  private parse(run: Run, text: string, ctx: ParseContext) {
    if (run.site !== null) return run.site.drivers[run.view.feature as SiteOpId]!.parse(text, { ...ctx, start: run.start!, stopReason: run.stopReason });
    return this.driver(run.view.feature as FeatureId).parse(text, { ...ctx, feature: run.view.feature as FeatureId });
  }

  private emitDone(run: Run): void {
    if (run.site !== null) run.site.done(this.publicView(run) as SiteOpView);
    else this.deps.events.emit(null, 'op.done', { view: this.publicView(run) as OpView });
  }

  /** The site's panel reads its own views; shared op.list and send paths remain closed. */
  siteView(opId: string, host: HostKind): SiteOpView | null {
    const run = this.runs.get(opId);
    return run?.site?.host === host && !resultExpired(run.view, this.deps.clock.now()) ? this.publicView(run) as SiteOpView : null;
  }

  siteList(tab: string, host: HostKind, chatKey?: ChatKey): { readonly ops: SiteOpView[]; readonly truncated: boolean } {
    const mine = [...this.runs.values()].filter((run) => run.site?.host === host && !resultExpired(run.view, this.deps.clock.now()) &&
      (chatKey === undefined ? run.startedBy === tab || run.ownerTab === tab : run.chatKey === chatKey));
    mine.sort((a, b) => b.view.startedAt - a.view.startedAt);
    return { ops: mine.slice(0, STORAGE_LIMITS.resultsPerTab).map((run) => this.publicView(run) as SiteOpView), truncated: mine.length > STORAGE_LIMITS.resultsPerTab };
  }

  /**
   * Runs an admitted operation to its end. Whatever throws on the way — while the request is built, before any
   * hub call, or in our own handling of an answer — ends the operation at once, with a code and a log line: an
   * admitted operation is never left to wait for a deadline (or for ever) because of a failure nobody reported.
   */
  private launch(run: Run): void {
    void this.drive(run).catch((error: unknown) => {
      if (run.ended) return;
      // Nothing was handed to the hub layer yet: the request itself could not be made (our bug, CG-HUB-REQUEST).
      const beforeRequest = run.attempt === 0;
      const code: CgCode = beforeRequest ? 'CG-HUB-REQUEST' : 'CG-UNKNOWN';
      this.log.write({
        level: 'error',
        scope: 'bg.ops',
        msg: beforeRequest ? 'operation failed before the hub request' : 'operation failed outside the stream',
        code,
        fields: { feature: run.view.feature, error: error instanceof Error ? error.name : typeof error },
        ctx: { opId: run.view.opId },
      });
      run.abort?.abort();
      this.settle(run, { state: 'failed', code, toast: true });
    });
  }

  private async drive(run: Run): Promise<void> {
    if (!this.buildRequest(run)) return;
    this.move(run, 'requesting', { name: 'connecting', since: this.deps.clock.now() });

    for (;;) {
      const retryIn = await this.attempt(run);
      if (retryIn === null || run.ended) return;
      if (retryIn === 'again') continue;
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

  /** The hub request of a start, for the run's persona; false — the operation ended with the reason. */
  private buildRequest(run: Run): boolean {
    const env = this.deps.environment();
    const start = run.start;
    if (start === null || env.bootstrap === null) {
      this.settle(run, { state: 'failed', code: 'CG-HUB-UNAVAILABLE', toast: true });
      return false;
    }
    const built = this.build(run, start, {
      opId: run.view.opId,
      persona: { key: run.tag.personaKey, definitionId: run.tag.personaDefinitionId },
      bootstrap: env.bootstrap,
      debug: env.debug,
      freshText: freshTextAdmitted(env.features(start.target.binding.host), env.bootstrap, start.target.binding.pageId),
    });
    if (!built.ok) {
      this.log.write({ level: 'error', scope: 'bg.ops', msg: 'request refused before the hub', code: 'CG-HUB-REQUEST', fields: { issues: built.issues }, ctx: { opId: run.view.opId } });
      this.settle(run, { state: 'failed', code: 'CG-HUB-REQUEST', toast: true });
      return false;
    }
    run.request = built.request;
    return true;
  }

  /**
   * The hub refused the persona definition the request named, before any frame: the owner edited the persona
   * since. Nothing was made or spent (the hub checks the persona before it takes the request), so this is no
   * repeat of anything indeterminate: the request is asked once more, at once, with the definition the hub has
   * now for the same persona. Another persona, none, or the same definition again — the refusal stands.
   */
  private async followPersona(run: Run): Promise<boolean> {
    if (run.personaFollowed || run.stream.frames > 0 || this.deps.personaNow === undefined) return false;
    run.personaFollowed = true;
    const now = await this.deps.personaNow(run.tag.pageId).catch(() => null);
    if (run.ended || this.environmentLost(run) || now === null || now.key !== run.tag.personaKey || now.definitionId === run.tag.personaDefinitionId) return false;
    run.tag = { ...run.tag, personaDefinitionId: now.definitionId };
    this.log.write({ level: 'info', scope: 'bg.ops', msg: 'persona definition followed', fields: { feature: run.view.feature, attempt: run.attempt }, ctx: { opId: run.view.opId } });
    void this.persist().catch(() => undefined);
    return this.buildRequest(run);
  }

  /**
   * One POST of the stream. Resolves with the pause before the single transparent retry, `again` — at once (the
   * persona followed), or null when it ended.
   */
  private async attempt(run: Run): Promise<number | 'again' | null> {
    const { clock, hub } = this.deps;
    const request = run.request;
    if (request === null) return null;
    run.attempt += 1;
    run.wire = WIRE_IDLE;
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
      // Not a failure of the hub call at all (the hub layer itself threw, or our own handling of a frame): never
      // «нет связи». Before anything was handed to the network it is our request that failed (CG-HUB-REQUEST);
      // after that it is an answer we could not use — the same code, said at once, with a log line.
      const failure: HubFailure = isHubCallError(error) ? error.failure : { kind: 'transport', failure: 'contract' };
      if (!isHubCallError(error)) {
        this.log.write({
          level: 'error',
          scope: 'bg.ops',
          msg: 'stream failed outside the facade contract',
          code: 'CG-HUB-REQUEST',
          fields: { feature: run.view.feature, stage: run.wire.at, error: error instanceof Error ? error.name : typeof error },
          ctx: { opId: run.view.opId },
        });
      }
      // §7 «Отмена»: the hub layer cuts the streams of a sign-in that ended before it announces the change
      // (its epoch signal goes first, the event follows the storage writes). That abort is the automatic
      // cancel itself, not a failure of the hub: the operation ends as the session change would end it.
      if (failure.kind === 'transport' && failure.failure === 'aborted' && this.environmentLost(run)) {
        this.settle(run, { state: 'canceled', code: 'CG-CONTEXT-CHANGED', toast: true });
        return null;
      }
      const resolution = this.resolve(run, failure, isHubCallError(error) ? error.epoch : null);
      if (resolution.code === 'CG-PERSONA-CHANGED' && (await this.followPersona(run))) return run.ended ? null : 'again';
      if (run.ended) return null;
      const retry = retryDecision({
        disposition: resolution.disposition,
        // The persona's own re-ask is not the 503 retry: it leaves that one as it was.
        attempt: run.attempt - (run.personaFollowed ? 1 : 0),
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
    this.armDeadline(run, { at: run.times.opRequestAt + this.timeouts(run).maxMs, kind: 'max' });
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
    if (frame.type === 'done' && run.stream.terminal === null) run.stopReason = frame.stopReason;
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
        if (frame.type === 'usage') this.deps.hooks?.usage?.(run.view.feature, frame.usage);
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
    const parsed = this.parse(run, text, {
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
      // The cache never crosses users or sign-ins (AI-128): results of the old sign-in go — and its quota with them.
      const keep = (run: Run): boolean =>
        !run.ended || (change.kind === 'session' && change.next !== null && change.next.hubOrigin === run.tag.hubOrigin && change.next.userId === run.tag.userId && change.next.epoch === run.tag.signInEpoch);
      let kept = true;
      for (const [opId, run] of this.runs) {
        if (keep(run)) continue;
        kept = false;
        this.runs.delete(opId);
        this.cache.forgetOp(opId);
      }
      if (!kept || change.kind === 'hub') this.quotas.clear();
      void this.persist().catch(() => undefined);
    }
    return canceled;
  }

  /**
   * «Очистить локальные данные» (ST-110): finished results leave memory and
   * storage; what is running stays and ends as usual. Answers how many went.
   */
  clearFinished(): number {
    let dropped = 0;
    for (const [opId, run] of this.runs) {
      if (!run.ended) continue;
      this.runs.delete(opId);
      this.cache.forgetOp(opId);
      dropped += 1;
    }
    if (dropped > 0) void this.persist().catch(() => undefined);
    return dropped;
  }

  /**
   * The hub layer waits before its one transparent retry of this operation's
   * stream (§7 «Сервис недоступен, повтор через 5 с…»): the phase says so
   * until the next frame. The retry itself is the hub layer's; nothing is
   * POSTed from here.
   */
  noteRetry(opId: string, retryAt: number): void {
    const run = this.runs.get(opId);
    if (run === undefined || run.ended || run.stream.frames > 0) return;
    this.setPhase(run, { name: 'retry-wait', since: this.deps.clock.now(), retryAt });
  }

  /**
   * The hub layer says where the request of an operation stands: handed to the network (`sent`), answered by
   * the hub (`answered`, with the status of the handshake). Nothing changes for the tab; a deadline that fires
   * later names the stage in its log line and in the technical line of the error.
   */
  noteWire(opId: string, stage: { readonly kind: 'sent' } | { readonly kind: 'answered'; readonly status: number }): void {
    const run = this.runs.get(opId);
    if (run === undefined || run.ended) return;
    const since = this.deps.clock.now();
    run.wire = stage.kind === 'sent' ? { at: 'sent', since } : { at: 'answered', since, status: stage.status };
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
    return run === undefined || run.site !== null ? null : this.attachRun(opId, tabSessionId) as OpView;
  }

  private attachRun(opId: string, tabSessionId: string): AnyOpView | null {
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
      if (run.ended) this.emitDone(run);
    }
    if (marked.length > 0) void this.persist().catch(() => undefined);
    return marked;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  view(opId: string): OpView | null {
    const run = this.runs.get(opId);
    return run === undefined || run.site !== null ? null : this.publicView(run) as OpView;
  }

  /** `op.list`: this tab's results (or the chat's), or the newest across tabs. */
  list(tabSessionId: string, scope: 'tab' | 'all', chatKey?: ChatKey): { readonly ops: OpView[]; readonly truncated: boolean } {
    const now = this.deps.clock.now();
    const visible = [...this.runs.values()].filter((run) => run.site === null && !resultExpired(run.view, now));
    const mine = visible.filter((run) => (chatKey === undefined || run.chatKey === chatKey) && (scope === 'all' || run.startedBy === tabSessionId || run.ownerTab === tabSessionId || chatKey !== undefined));
    mine.sort((a, b) => b.view.startedAt - a.view.startedAt);
    const cap = scope === 'tab' ? STORAGE_LIMITS.resultsPerTab : STORAGE_LIMITS.opListMax;
    return { ops: mine.slice(0, cap).map((run) => this.publicView(run) as OpView), truncated: mine.length > cap };
  }

  /**
   * 1.20.0 (decision X47): the fans' names the tabs gave with their starts (`StartOp.fanLabel`), newest first, one per
   * chat — for the pages' «Идут сейчас». Display only, from memory and the operations' own journal.
   */
  fanLabels(limit: number): { readonly chatKey: ChatKey; readonly label: string }[] {
    const out = new Map<ChatKey, string>();
    for (const run of [...this.runs.values()].sort((a, b) => b.view.startedAt - a.view.startedAt)) {
      if (out.size >= limit) break;
      if (run.fanLabel !== null && run.fanLabel.trim() !== '' && !out.has(run.chatKey)) out.set(run.chatKey, run.fanLabel);
    }
    return [...out].map(([chatKey, label]) => ({ chatKey, label }));
  }

  /** Running operations (palette, diagnostics). */
  active(): readonly OpView[] {
    return this.activeAll().filter((view): view is OpView => isSharedFeature(view.feature));
  }

  activeAll(): readonly AnyOpView[] {
    return [...this.runs.values()].filter((run) => !run.ended).map((run) => this.publicView(run));
  }

  /** `quota.get`: the page's quota as the last `meta` reported it; null — unknown. */
  quota(pageId: number): AiQuotaSnapshot | null {
    return this.quotas.get(pageId) ?? null;
  }

  /** What the send coordinator needs about the operation a send comes from. */
  forSend(opId: string): { readonly view: OpView; readonly checkpoint: FreshnessCheckpoint | null; readonly tag: OpEnvTag } | null {
    const run = this.runs.get(opId);
    if (run === undefined || run.site !== null) return null;
    return { view: run.view as OpView, checkpoint: run.checkpoint, tag: run.tag };
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
        site: run.site !== null,
        summary: { opId: run.view.opId, feature: run.view.feature, surface: run.view.surface, chat: run.view.target.chat, fanLabel: run.fanLabel, state: run.view.state, startedAt: run.view.startedAt },
      });
    }
    return entries;
  }

  private environmentLost(run: Run): boolean {
    return run.ended || this.tagLost(run.tag);
  }

  /** The sign-in or the page's persona (its key) is no longer the one an operation was admitted under. */
  private tagLost(tag: OpEnvTag): boolean {
    const env = this.deps.environment();
    const session = env.session;
    if (session === null || session.hubOrigin !== tag.hubOrigin || session.userId !== tag.userId || session.epoch !== tag.signInEpoch) return true;
    const persona = env.persona(tag.pageId);
    // Another definition of the same persona (the owner edited it) is no other persona.
    return persona === null || persona.key !== tag.personaKey;
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
    const deadline = at ?? nextDeadlineFor(this.timeouts(run), run.times);
    const delay = Math.max(0, deadline.at - this.deps.clock.now());
    run.deadline = this.deps.clock.setTimer(delay, () => {
      run.deadline = null;
      if (run.ended) return;
      // RB-002/RB-003: a timeout is never retried. The log and the technical line say how far the request got:
      // not handed to the network, sent without an answer, or answered and then silent. The code tells the two
      // apart where the browser can: nothing came back AND the browser says it has no connection — «нет связи»
      // (CG-NETWORK, the request could not be delivered); otherwise the hub did not answer in time (CG-HUB-TIMEOUT).
      const stage = deadlineStage(run.wire, run.stream.frames);
      const waitedMs = this.deps.clock.now() - (run.wire.at === 'idle' ? run.times.attemptAt : run.wire.since);
      const undelivered = (stage === 'not-sent' || stage === 'no-answer') && this.deps.online?.() === false;
      const code: CgCode = undelivered ? 'CG-NETWORK' : TIMEOUT_CODE;
      this.log.write({
        level: 'warn',
        scope: 'bg.ops',
        msg: 'stream deadline passed',
        code,
        fields: { kind: deadline.kind, stage, waitedMs, ...(run.wire.at === 'answered' ? { status: run.wire.status } : {}), ...(this.deps.online === undefined ? {} : { online: this.deps.online() }) },
        ctx: { opId: run.view.opId },
      });
      this.settle(run, { state: 'failed', code, detail: `${deadline.kind}: ${stage}`, toast: true });
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
            ...(settled.detail === undefined ? {} : { detail: settled.detail }),
            ...(settled.retryAt === undefined || settled.retryAt === null ? {} : { retryAt: settled.retryAt }),
            ...(settled.httpStatus === undefined || settled.httpStatus === null ? {} : { httpStatus: settled.httpStatus }),
          };
    const view = {
      ...run.view,
      state: settled.state,
      phase: { name: 'settled', since: now },
      endedAt: now,
      ...(settled.result === undefined ? {} : { result: settled.result }),
      ...(error === undefined ? {} : { error }),
    } as AnyOpView;
    if (settled.state !== 'done') delete (view as { text?: string }).text;
    run.view = view;
    this.stage(run, 'settled', now);
    const debug = this.deps.environment().debug ? this.debugView(run) : undefined;
    if (debug !== undefined) run.view = { ...run.view, debug };
    if (run.site === null && run.start !== null && run.attempt > 0) this.deps.hooks?.settled?.(run.view as OpView, run.start as StartOp, run.ownerTab);
    // Texts the request carried (draft, fresh tail, Coach question) leave memory with the run.
    const then = run.then;
    run.start = null;
    run.request = null;
    run.then = null;
    // A composite Coach turn: the answer step holds the chat's slot from this very moment.
    const next = then === null ? null : this.continuation(run, then, settled, now);
    if (next !== null) run.view = { ...run.view, continuedBy: next.view.opId };
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
    this.emitDone(run);
    // The turn is not over while its answer step runs: that one says «AI готово» or «не получилось».
    if (settled.toast && next === null) this.toast(run, settled);
    const written = this.persist();
    if (next === null) {
      void written.catch(() => {
        this.log.write({ level: 'error', scope: 'bg.ops', msg: 'result journal write failed', code: 'CG-STORAGE-WRITE', ctx: { opId: run.view.opId } });
      });
      return;
    }
    // As for any admission: the answer step and its identity reach storage.session before its hub request.
    void written.then(
      () => {
        if (!next.ended) this.launch(next);
      },
      () => {
        this.log.write({ level: 'error', scope: 'bg.ops', msg: 'admission journal write failed', code: 'CG-STORAGE-WRITE', ctx: { opId: next.view.opId } });
        this.settle(next, { state: 'failed', code: 'CG-STORAGE-WRITE', toast: true });
      },
    );
  }

  /** «AI готово · {фан}» / «AI: не получилось · {фан}» when the owning tab shows another chat (§7). */
  private toast(run: Run, settled: Settled): void {
    const owner = run.ownerTab;
    if (owner === null) return;
    const presence = this.deps.presence(owner);
    if (presence === null) return;
    const here = presence.chat !== null && chatKeyOf(presence.chat) === run.chatKey && presence.visible;
    if (here || (settled.state !== 'done' && settled.state !== 'failed')) return;
    const target = run.view.target;
    const toast: BackgroundToast = {
      toastId: this.deps.ids.uuid(),
      kind: settled.state === 'done' ? 'success' : 'error',
      scope: settled.state === 'done' ? 'op.ready' : 'op.failed',
      opId: run.view.opId,
      ...(isSharedFeature(run.view.feature) ? { feature: run.view.feature } : {}),
      chat: target.chat,
      // «Открыть чат» opens the operation's own conversation (on Fansly the group); on ChatSpace it is the fan, and absent.
      ...conversationOf(target.fanRef, target.conversationRef),
      fanLabel: run.fanLabel,
      ...(run.view.error === undefined ? {} : { error: run.view.error, code: run.view.error.code }),
    };
    this.deps.events.emit(owner, 'toast', { toast });
  }

  /** The prompt page can read the proof while the result and its echo are alive. No disk copy of its tail. */
  generationDebug(token: string): OpDebugView['generation'] {
    if (!this.deps.environment().debug) return undefined;
    for (const run of this.runs.values()) if (!resultExpired(run.view, this.deps.clock.now()) && run.view.debug?.promptToken === token) return run.view.debug.generation;
    return undefined;
  }

  clearDebug(): void {
    for (const run of this.runs.values()) {
      const { debug: _debug, ...view } = run.view;
      run.view = view;
    }
    void this.persist().catch(() => undefined);
  }

  private debugView(run: Run): OpDebugView {
    const usage = run.stream.usage;
    const frame = run.context;
    const generation = generationDebug(run.start?.proof, run.view.servedContext);
    return {
      ...(generation === undefined ? {} : { generation }),
      stages: run.stages.slice(0, DEBUG_STAGES_MAX).map((stage) => ({ name: stage.name.slice(0, 48), at: stage.at })),
      usage:
        usage === null
          ? null
          : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, costMicroUsd: usage.costMicroUsd },
      reasoning: run.stream.reasoning.length > 0 ? run.stream.reasoning : null,
      promptToken: run.promptToken ?? this.deps.hooks?.promptToken?.(run.view.opId) ?? null,
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
  private publicView(run: Run): AnyOpView {
    if (run.ended || !(run.site !== null || showsStream(run.view.feature as FeatureId))) return run.view;
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
        view: withoutGenerationTail(run.ended ? run.view : withoutText(run.view)),
        meta: { startedBy: run.startedBy, requestKey: run.requestKey, tag: run.tag, fanLabel: run.fanLabel, knownIds: run.knownIds, checkpoint: run.checkpoint, split: run.split } satisfies PersistedMeta,
      })),
    };
    await this.writes.run(() => this.deps.store.set(OPS_STORE_KEY, value));
  }
}

// ── persistence helpers ──────────────────────────────────────────────────

function withoutText(view: AnyOpView): AnyOpView {
  if (view.text === undefined) return view;
  const copy: AnyOpView = { ...view };
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

async function readStore(raw: unknown, load?: OpSchedulerDeps['siteOps']): Promise<{ readonly items: { readonly view: AnyOpView; readonly meta: PersistedMeta; readonly site: SiteOperations | null }[]; readonly dropped: number }> {
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1 || !Array.isArray((raw as { ops?: unknown }).ops)) {
    return { items: [], dropped: raw === undefined || raw === null ? 0 : 1 };
  }
  const items: { view: AnyOpView; meta: PersistedMeta; site: SiteOperations | null }[] = [];
  let dropped = 0;
  for (const item of (raw as { ops: unknown[] }).ops) {
    const rawView = (item as { view?: unknown } | null)?.view;
    const common = OpViewSchema.safeParse(rawView);
    let site: SiteOperations | null = null;
    let view: AnyOpView | null = common.success ? common.data : null;
    if (view === null && load !== undefined) {
      const target = TargetSchema.safeParse((rawView as { target?: unknown } | null)?.target);
      if (target.success) {
        site = await load(target.data.binding.host);
        view = site?.readView(rawView) ?? null;
      }
    }
    const meta = readMeta((item as { meta?: unknown } | null)?.meta);
    if (view === null || meta === null) dropped += 1;
    else items.push({ view, meta, site });
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

function withoutGenerationTail(view: AnyOpView): AnyOpView {
  if (view.debug?.generation === undefined) return view;
  const { generation: _generation, ...debug } = view.debug;
  return { ...view, debug };
}

function isSharedFeature(feature: string): feature is FeatureId {
  return (FEATURE_IDS as readonly string[]).includes(feature);
}
