// A fan's preview without opening the chat (architecture.md §6.5, §6.7, §7
// «Превью и «Новые»», §10.2 PreviewVM; SP-050…SP-056, AI-038, NEW-10,
// CS-030, DB-026). The feed is the hub archive only — opening a chat marks it
// read on OnlyFans, so nothing is read from ChatSpace and the chat stays
// unread. Generation runs on the hub's context (surface `preview` or
// `newcomers`, no fresh page text) with the freshness checkpoint taken at the
// Generate click. A result leaves the preview in two ways, each on a human
// click of one part: «Отправить» through the R10 send coordinator, and
// «Открыть и вставить» — one navigation with one deferred insert that has a
// deadline and can be canceled. Nothing is sent, inserted or repeated by
// itself; an unknown outcome offers only «Открыть чат для проверки».

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { TONES, type FeatureId, type Surface, type Tone } from '@cg/contracts/features';
import { type HostEvent, type HostPort, type NavigationReceipt } from '@cg/contracts/host';
import { type SpenderDetail } from '@cg/contracts/hub';
import { chatKeyOf, type PartRef, type Target } from '@cg/contracts/ids';
import { OP_LIMITS, SEND_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { type OpView, type StartOp } from '@cg/contracts/ops';
import { type FreshnessCheckpoint, type PreviewSendPreflight, type PreviewSendRequest, type SendAttemptView, type SendGroup } from '@cg/contracts/send';
import { type TabEventPayload } from '@cg/contracts/tab-messages';
import {
  type ActionReceipt,
  type DockActionVM,
  type FeedItemVM,
  type I18n,
  type PartialGap,
  type PreviewActionId,
  type PreviewSource,
  type PreviewVM,
  type ReasonVM,
  type RunningOpVM,
  type TargetHandle,
  type UiAction,
  type UiActionType,
  type UserOptions,
  type VmView,
} from '@cg/contracts/vm';

import { DeferredInsertSlot, type DeferredOutcome } from '../../domain/insert/deferred';
import { buildDeferredInsert, buildOpenAndInsert } from '../../domain/insert/intent';
import { EMPTY_DRAFTS, draftKey, findDraft, keepOnlyUser, putDraft, readDraftStore, removeDraft, type DraftStore } from '../../domain/newcomers/drafts';
import { greetingOutputProblem } from '../../domain/newcomers/greeting';
import { personalMessages, tooManyForHi } from '../../domain/newcomers/rows';
import { digestHex } from '../../domain/ops/digest';
import { applyOpDone, applyOpUpdate, mirrorFromView, newMirror, type OpMirror } from '../../domain/ops/mirror';
import { messageWindowFor } from '../../domain/ops/request';
import { isTerminalOpState } from '../../domain/ops/states';
import { attemptReachable } from '../../domain/send/attempt';
import { servedContextHold } from '../../domain/send/freshness';
import { archiveLag, feedRows, firstFeedPage, keepFeed, olderFeedPage, type FeedState, type KeptFeed } from '../../domain/spenders/feed';
import { targetPage } from '../../domain/fanpanel/model';
import { type PageContextPort, type PageContextState, flagReason, pageFlag } from '../boards/context';
import { fanHandle, parseFanHandle, parsePartHandle } from '../boards/handles';
import { issueCause, type ChatNavigator } from '../boards/navigate';
import { type BoardsClock, type BoardsNotifier, type ClipboardWriter, type DraftStorePort, type IdSource, type PreviewSendClick, type PreviewSender, type TabRpc } from '../boards/ports';
import { type GreetingDesk, type PreviewDirectory, type PreviewTargetInfo, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { button, dataView, errorOf, failureClass, failureView, loadingView, localError, msg, reason, stamp, type BoardReasonId } from '../boards/views';
import { partsOfResult, previewResult, type PartRows } from './result';
import { clickable, fanAttempts, inFlight, openInsertRow, partKey, partOrder, progressOf, refusal, sendRow, type PartAttempt } from './send-rows';

/** Rows of one feed page (the hub's default; never above `limits.feedMax`). */
export const FEED_PAGE_SIZE = 50;
/** How long «✓» stays on a copy button. */
export const COPY_MARK_MS = 2000;
/** Results the tab keeps track of (the background keeps their texts, §9.4). */
const TRACKS_MAX = STORAGE_LIMITS.resultsPerTab;
/** A syntactically valid stand-in for the cause of a display-only preflight: MAIN never receives a token (§14). */
const DISPLAY_CAUSE = { kind: 'click', actionToken: 'preflight-display-only' } as const;
/** Past the insert's own deadline, for the host's answer to arrive first. */
const DEFERRED_GRACE_MS = 1500;
/**
 * How long a part stays off after the hub's `preview_send_rate_limited`. The
 * hub counts sends per minute (`limits.previewSendPerMinute`) and an attempt
 * view carries no deadline of its own, so the hold is one such minute.
 */
export const RATE_LIMIT_HOLD_MS = 60_000;

const SOURCES = ['spenders', 'newcomers', 'palette'] as const satisfies readonly PreviewSource[];
const DRAFT_FEATURES = ['reply', 'fix', 'hi', 'ping'] as const satisfies readonly PreviewActionId[];
const CLOSE_PREVIEW: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } };

interface OpTrack {
  readonly opId: string;
  readonly handle: TargetHandle;
  readonly source: PreviewSource;
  readonly pageId: number;
  readonly fanRef: string;
  readonly feature: FeatureId;
  readonly surface: Surface;
  target: Target;
  mirror: OpMirror;
  /** The highest batch number seen, for resyncing a mirror after a gap. */
  lastSeq: number;
  readonly startedAt: number;
  /** The freshness checkpoint of the Generate click; null — MAIN gave none: the result can be inserted, never sent. */
  readonly checkpoint: FreshnessCheckpoint | null;
  /** Revision of the local draft at Generate; a Fix result is void once the draft moves on. */
  readonly previewRevision: number;
  readonly fixSource: string | null;
  toneUsed: Tone | null;
  splitRequested: boolean;
  readonly personaDefinitionId: string | null;
  hidden: boolean;
  expanded: boolean;
  cachedAt: number | null;
  readonly attempts: Map<string, PartAttempt>;
  /** Parts whose click is with the coordinator and has no attempt id yet. */
  readonly clicked: Set<string>;
  readonly copy: Map<string, 'done' | 'failed'>;
  /** MAIN's side-effect-free answer for the button; null — not asked yet. */
  preflight: PreviewSendPreflight | null;
  preflightRun: number;
  /** This tab saw a fan message after the checkpoint. */
  fanWrote: boolean;
  fanWroteAt: string | null;
  /** «Открыть и вставить» in flight: the part and its deadline. */
  openInsert: { readonly key: string; readonly until: number } | null;
  /** Timers that lift a hub rate-limit hold, by part. */
  readonly holdTimers: Map<string, number>;
}

interface TargetState {
  readonly handle: TargetHandle;
  readonly source: PreviewSource;
  readonly pageId: number;
  readonly fanRef: string;
  info: PreviewTargetInfo;
  feed: FeedState | null;
  feedLoading: boolean;
  feedError: CgErrorWire | null;
  feedRun: number;
  feedSince: number | null;
  feedLoadedAt: number | null;
  olderLoading: boolean;
  olderError: CgErrorWire | null;
  /** `fan.card` over 30 days: the header's money and the page subscription (X8 condition 9). */
  card: SpenderDetail | null;
  cardRun: number;
  tone: Tone | null;
  /** Polling the archive while a held send waits for the fan's new message to reach it (§6.7.5). */
  poll: { timer: number; readonly until: number; readonly head: string | null } | null;
  rows: { readonly feed: FeedState; readonly language: string; readonly items: FeedItemVM[] } | null;
}

interface PendingInsert {
  readonly navigationId: string;
  readonly track: OpTrack;
  readonly key: string;
  readonly abort: AbortFlag;
  timer: number | null;
}

/** The part of AbortSignal HostPort.navigate uses (contracts carry no DOM types). */
class AbortFlag {
  aborted = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'abort', listener: () => void): void {
    if (this.aborted) listener();
    else this.listeners.add(listener);
  }

  removeEventListener(_type: 'abort', listener: () => void): void {
    this.listeners.delete(listener);
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}

export interface PreviewControllerDeps {
  readonly rpc: TabRpc;
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly ids: IdSource;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly navigator: ChatNavigator;
  /** Who a handle is, per list. */
  readonly directories: Readonly<Record<PreviewSource, PreviewDirectory | null>>;
  /** «Новые»: the greeting lease and status of the fan on the card. */
  readonly greeting: GreetingDesk | null;
  /** The tab side of the R10 send coordinator; null — no send in this build. */
  readonly sender: PreviewSender | null;
  readonly drafts: DraftStorePort | null;
  readonly clipboard: ClipboardWriter | null;
  readonly notifier: BoardsNotifier | null;
}

export interface PreviewController extends SurfaceController<'preview'> {
  /** The local drafts are read; resolves once (tests, a first paint that wants the draft). */
  ready(): Promise<void>;
  /** Whether a saved draft exists for a fan of a list, and the thread it was written on (the «Новые» rows). */
  draftOf(source: PreviewSource, pageId: number, fanRef: string): { readonly text: string; readonly threadRevision: string | null } | null;
  /** A draft was written, cleared or read from storage: the lists that show «есть черновик» follow. */
  onDrafts(listener: () => void): () => void;
}

export function createPreviewController(deps: PreviewControllerDeps): PreviewController {
  const { rpc, host, i18n, clock, ids, context, surfaces, navigator } = deps;

  const targets = new Map<TargetHandle, TargetState>();
  let kept: KeptFeed[] = [];
  const tracks = new Map<string, OpTrack>();
  const currentOp = new Map<TargetHandle, string>();
  const attemptOwner = new Map<string, { readonly opId: string; readonly key: string }>();
  /** Views of attempts whose id the click has not learned yet. */
  const unclaimed = new Map<string, SendAttemptView>();
  let drafts: DraftStore = EMPTY_DRAFTS;
  const draftListeners = new Set<() => void>();
  const draftsChanged = (): void => {
    for (const listener of [...draftListeners]) listener();
  };
  const revisions = new Map<string, number>();
  const slot = new DeferredInsertSlot();
  let pendingInsert: PendingInsert | null = null;
  /** The boards are closing because a chat is being opened by us: not the person closing the preview. */
  let closingForNavigation = false;
  let epoch = context.current().epoch;
  let disposed = false;
  let saveChain: Promise<void> = Promise.resolve();

  const cells: Record<PreviewSource, ViewCell<PreviewVM>> = {
    spenders: new ViewCell(() => build('spenders')),
    newcomers: new ViewCell(() => build('newcomers')),
    palette: new ViewCell(() => build('palette')),
  };
  const changed = (source?: PreviewSource): void => {
    if (disposed) return;
    if (source === undefined) for (const s of SOURCES) cells[s].invalidate();
    else cells[source].invalidate();
  };
  const changedFor = (handle: TargetHandle): void => {
    for (const s of SOURCES) if (surfaces.current().preview[s] === handle) cells[s].invalidate();
  };

  const nowIso = (): string => new Date(clock.now()).toISOString();
  const surfaceOf = (source: PreviewSource): Surface => (source === 'newcomers' ? 'newcomers' : 'preview');
  const purposeOf = (source: PreviewSource): 'greeting' | 'preview-reply' => (source === 'newcomers' ? 'greeting' : 'preview-reply');
  const featuresOf = (source: PreviewSource): readonly PreviewActionId[] => (source === 'newcomers' ? ['hi'] : DRAFT_FEATURES);

  // ── drafts ──

  const ownerKey = (source: PreviewSource, pageId: number, fanRef: string): string | null => {
    const session = context.current().session;
    return session === null ? null : draftKey({ hubOrigin: session.hubOrigin, userId: session.userId, pageId, list: source, fanRef });
  };
  const draftText = (state: TargetState): string => {
    const key = ownerKey(state.source, state.pageId, state.fanRef);
    return key === null ? '' : (findDraft(drafts, key, clock.now())?.text ?? '');
  };
  const draftRevision = (state: Pick<TargetState, 'source' | 'pageId' | 'fanRef'>): number => {
    const key = ownerKey(state.source, state.pageId, state.fanRef);
    return key === null ? 0 : (revisions.get(key) ?? findDraft(drafts, key, clock.now())?.revision ?? 0);
  };
  const saveDrafts = (): void => {
    const port = deps.drafts;
    if (port === null) return;
    const snapshot = drafts;
    saveChain = saveChain.then(() => port.save(snapshot)).catch(() => undefined);
  };
  const readyPromise: Promise<void> =
    deps.drafts === null
      ? Promise.resolve()
      : deps.drafts
          .load()
          .then((raw) => {
            const stored = readDraftStore(raw, clock.now());
            const session = context.current().session;
            // Drafts typed before the store answered win over what was stored for the same fan.
            const typedKeys = new Set(drafts.drafts.map((draft) => draft.key));
            const merged = { v: stored.v, drafts: [...drafts.drafts, ...stored.drafts.filter((draft) => !typedKeys.has(draft.key))] };
            drafts = session === null ? merged : keepOnlyUser(merged, session.hubOrigin, session.userId);
            changed();
            draftsChanged();
          })
          .catch(() => undefined);

  // ── targets and the feed ──

  const feedLimit = (): number => Math.max(1, Math.min(FEED_PAGE_SIZE, context.current().bootstrap?.limits.feedMax ?? FEED_PAGE_SIZE));

  async function loadFeed(state: TargetState): Promise<void> {
    const ctx = context.current();
    if (ctx.phase !== 'ready' || !pageFlag(ctx, 'preview')) return;
    const run = ++state.feedRun;
    const atEpoch = epoch;
    state.feedLoading = true;
    state.feedSince = clock.now();
    changedFor(state.handle);
    const pingWindow = ctx.settings?.generation.windows.ping;
    const answer = await rpc.request('feed.read', {
      pageId: state.pageId,
      fanRef: state.fanRef,
      cursor: null,
      limit: feedLimit(),
      ...(pingWindow === undefined ? {} : { summaryWindow: pingWindow }),
    });
    if (disposed || atEpoch !== epoch || state.feedRun !== run || targets.get(state.handle) !== state) return;
    state.feedLoading = false;
    state.feedSince = null;
    if (answer.ok) {
      state.feed = firstFeedPage(answer.payload);
      state.feedError = null;
      state.olderError = null;
      state.feedLoadedAt = clock.now();
      const poll = state.poll;
      // The archive moved past the head the held send was waiting on: stop asking.
      if (poll !== null && (state.feed.head?.messageRef ?? null) !== poll.head) stopPoll(state);
    } else state.feedError = answer.error;
    changedFor(state.handle);
  }

  async function loadOlder(state: TargetState): Promise<void> {
    const feed = state.feed;
    const cursor = feed?.nextOlderCursor ?? null;
    if (feed === null || cursor === null || state.olderLoading) return;
    const run = state.feedRun;
    const atEpoch = epoch;
    state.olderLoading = true;
    state.olderError = null;
    changedFor(state.handle);
    const answer = await rpc.request('feed.read', { pageId: state.pageId, fanRef: state.fanRef, cursor, limit: feedLimit() });
    if (disposed || atEpoch !== epoch || targets.get(state.handle) !== state) return;
    state.olderLoading = false;
    // A first page was read meanwhile: this page belongs to the walk it replaced.
    if (state.feedRun !== run || state.feed === null) return changedFor(state.handle);
    if (answer.ok) {
      const step = olderFeedPage(state.feed, cursor, answer.payload);
      if (step.kind === 'appended') state.feed = step.state;
      // Another snapshot answered the cursor: the pass starts over from the first page (a safe read).
      else if (step.reason === 'snapshot') void loadFeed(state);
    } else if (answer.error.code === 'CG-HUB-REQUEST') {
      // The cursor is no longer valid (the archive was rebuilt): a new pass from the first page.
      void loadFeed(state);
    } else state.olderError = answer.error;
    changedFor(state.handle);
  }

  async function loadCard(state: TargetState): Promise<void> {
    if (state.source === 'newcomers' || context.current().phase !== 'ready') return;
    const run = ++state.cardRun;
    const atEpoch = epoch;
    const answer = await rpc.request('fan.card', { pageId: state.pageId, fanRef: state.fanRef, period: '30d' });
    if (disposed || atEpoch !== epoch || state.cardRun !== run || targets.get(state.handle) !== state) return;
    state.card = answer.ok ? answer.payload : null;
    changedFor(state.handle);
    const opId = currentOp.get(state.handle);
    const track = opId === undefined ? undefined : tracks.get(opId);
    if (track !== undefined) void refreshPreflight(track);
  }

  function stopPoll(state: TargetState): void {
    if (state.poll === null) return;
    clock.clearTimer(state.poll.timer);
    state.poll = null;
  }

  /** While a send is held for the fan's new message, the archive is asked every 5 s for up to 2 min. */
  function startPoll(state: TargetState): void {
    if (state.poll !== null) return;
    const until = clock.now() + SEND_LIMITS.archivePollMaxMs;
    const head = state.feed?.head?.messageRef ?? null;
    const tick = (): void => {
      const poll = state.poll;
      if (poll === null || disposed || targets.get(state.handle) !== state) return;
      if (clock.now() >= poll.until) return stopPoll(state);
      poll.timer = clock.setTimer(SEND_LIMITS.archivePollMs, tick);
      if (!state.feedLoading) void loadFeed(state);
    };
    state.poll = { timer: clock.setTimer(SEND_LIMITS.archivePollMs, tick), until, head };
  }

  function openTarget(source: PreviewSource, handle: TargetHandle): void {
    const info = deps.directories[source]?.resolve(handle) ?? null;
    if (info === null) return;
    const saved = kept.find((entry) => entry.key === handle) ?? null;
    const state: TargetState = {
      handle,
      source,
      pageId: info.pageId,
      fanRef: info.fanRef,
      info,
      feed: saved?.first ?? null,
      feedLoading: false,
      feedError: null,
      feedRun: 0,
      feedSince: null,
      feedLoadedAt: saved?.keptAt ?? null,
      olderLoading: false,
      olderError: null,
      card: null,
      cardRun: 0,
      tone: null,
      poll: null,
      rows: null,
    };
    targets.set(handle, state);
    deps.greeting?.touch(info.fanRef, false);
    void loadFeed(state);
    void loadCard(state);
    void restoreOp(state);
  }

  function closeTarget(handle: TargetHandle): void {
    const state = targets.get(handle);
    if (state === undefined) return;
    stopPoll(state);
    if (state.feed !== null) kept = keepFeed(kept, { key: handle, first: state.feed, keptAt: state.feedLoadedAt ?? clock.now() });
    targets.delete(handle);
    // The person closed the preview before the chat opened: the pending insert is given up (§6.5).
    if (pendingInsert !== null && pendingInsert.track.handle === handle && !closingForNavigation) cancelInsert('preview-closed');
  }

  // ── operations ──

  function pruneTracks(): void {
    const now = clock.now();
    for (const [opId, track] of tracks) {
      const ended = track.mirror.done?.endedAt ?? null;
      const held = [...track.attempts.values()].some((attempt) => attempt.view.state === 'uncertain' || inFlight(attempt.view.state));
      if (held || currentOp.get(track.handle) === opId) continue;
      if (ended !== null && now - ended > OP_LIMITS.resultTtlMs) {
        clearHoldTimers(track);
        tracks.delete(opId);
      }
    }
    while (tracks.size > TRACKS_MAX) {
      const oldest = [...tracks.values()].filter((track) => currentOp.get(track.handle) !== track.opId).sort((a, b) => a.startedAt - b.startedAt)[0];
      if (oldest === undefined) break;
      clearHoldTimers(oldest);
      tracks.delete(oldest.opId);
    }
  }

  function trackOf(view: OpView, state: TargetState, extra: Partial<Pick<OpTrack, 'checkpoint' | 'previewRevision' | 'fixSource' | 'splitRequested' | 'personaDefinitionId'>> = {}): OpTrack {
    return {
      opId: view.opId,
      handle: state.handle,
      source: state.source,
      pageId: state.pageId,
      fanRef: state.fanRef,
      feature: view.feature,
      surface: view.surface,
      target: view.target,
      mirror: mirrorFromView(view),
      lastSeq: 0,
      startedAt: view.startedAt,
      checkpoint: extra.checkpoint ?? null,
      previewRevision: extra.previewRevision ?? draftRevision(state),
      fixSource: extra.fixSource ?? null,
      toneUsed: view.toneUsed,
      splitRequested: extra.splitRequested ?? (view.result?.kind === 'parts' ? view.result.splitRequested : false),
      personaDefinitionId: extra.personaDefinitionId ?? null,
      hidden: false,
      expanded: false,
      cachedAt: null,
      attempts: new Map(),
      clicked: new Set(),
      copy: new Map(),
      preflight: null,
      preflightRun: 0,
      fanWrote: false,
      fanWroteAt: null,
      openInsert: null,
      holdTimers: new Map(),
    };
  }

  /** The newest result of this chat that a preview made, after a reopen or a tab reload. */
  async function restoreOp(state: TargetState): Promise<void> {
    if (currentOp.has(state.handle)) return;
    const binding = context.current().binding;
    if (binding === null) return;
    const atEpoch = epoch;
    const chatKey = chatKeyOf({ host: 'chatspace', hostAccountId: binding.hostAccountId, platformFanId: state.fanRef });
    const answer = await rpc.request('op.list', { scope: 'tab', chatKey });
    if (disposed || atEpoch !== epoch || !answer.ok || currentOp.has(state.handle) || targets.get(state.handle) !== state) return;
    const view = answer.payload.ops.find((op) => op.surface === surfaceOf(state.source));
    if (view === undefined) return;
    // The checkpoint of that generation stayed with the background: such a result can be inserted, not sent.
    const track = tracks.get(view.opId) ?? trackOf(view, state);
    tracks.set(view.opId, track);
    currentOp.set(state.handle, view.opId);
    changedFor(state.handle);
  }

  async function syncOp(track: OpTrack): Promise<void> {
    const answer = await rpc.request('op.list', { scope: 'tab', chatKey: chatKeyOf(track.target.chat) });
    if (disposed || !answer.ok || tracks.get(track.opId) !== track) return;
    const view = answer.payload.ops.find((op) => op.opId === track.opId);
    if (view === undefined) return;
    if (isTerminalOpState(view.state)) return finish(track, view);
    const ahead = (view.text ?? '').length > track.mirror.text.length || view.state !== track.mirror.state;
    if (ahead && track.mirror.done === null) {
      track.mirror = { ...mirrorFromView(view), seq: track.lastSeq };
      changedFor(track.handle);
    }
  }

  function onUpdate(update: TabEventPayload<'op.update'>): void {
    const track = tracks.get(update.opId);
    if (track === undefined) return;
    track.lastSeq = Math.max(track.lastSeq, update.seq);
    const step = applyOpUpdate(track.mirror, update);
    if (step.outcome === 'applied') {
      track.mirror = step.mirror;
      changedFor(track.handle);
    } else if (step.outcome === 'gap') void syncOp(track);
  }

  /** The terminal view; the button's preflight is asked first, so a finished result never flashes a wrong «Отправить». */
  function finish(track: OpTrack, view: OpView): void {
    const apply = (): void => {
      if (tracks.get(track.opId) !== track) return;
      const step = applyOpDone(track.mirror, view);
      if (step.outcome !== 'applied') return;
      track.mirror = step.mirror;
      track.toneUsed = view.toneUsed;
      if (view.result?.kind === 'parts') track.splitRequested = view.result.splitRequested;
      deps.greeting?.touch(track.fanRef, false);
      if (view.stale?.reason === 'fan-wrote') markFanWrote(track, view.stale.at);
      changedFor(track.handle);
    };
    if (view.state !== 'done' || track.mirror.done !== null || localGate(track, view).ok === false) return apply();
    refreshPreflight(track, view).then(apply, apply);
  }

  function markFanWrote(track: OpTrack, at: string | null): void {
    track.fanWrote = true;
    track.fanWroteAt = at ?? track.fanWroteAt;
    const state = targets.get(track.handle);
    if (state !== undefined) startPoll(state);
  }

  // ── the send gate ──

  function groupOf(track: OpTrack, variant: number, view: OpView | null = track.mirror.done): SendGroup | null {
    const texts = partsOfResult(view?.result, variant);
    const ref = view?.generationRef;
    return texts === null || ref === undefined ? null : { generationRef: ref, variant, partCount: texts.length };
  }

  /** The hub confirms a current subscription of the fan to this page (X8 condition 9). */
  function subscribed(track: OpTrack): boolean {
    if (track.source === 'newcomers') return deps.greeting?.subscribed(track.fanRef) ?? false;
    const page = targetPage(targets.get(track.handle)?.card ?? null, track.pageId);
    if (page === null || !page.isSubscriber) return false;
    if (page.subscriptionExpiresAt === null) return true;
    const ends = Date.parse(page.subscriptionExpiresAt);
    return !Number.isNaN(ends) && ends > clock.now();
  }

  /**
   * NF-016, §6.4 row 2: the sign-in, the binding or the persona is no longer
   * the one the operation was frozen for — its text is neither sent nor inserted.
   */
  function identityChanged(track: OpTrack): boolean {
    const ctx = context.current();
    const binding = ctx.binding;
    const frozen = track.target.binding;
    if (ctx.phase !== 'ready' || binding === null || binding.pageId !== frozen.pageId || binding.bindingRevision !== frozen.bindingRevision || binding.loginEpoch !== frozen.loginEpoch || binding.hubOrigin !== frozen.hubOrigin) {
      return true;
    }
    return track.personaDefinitionId !== null && ctx.persona?.definitionId !== track.personaDefinitionId;
  }

  /** The controller's own conditions, in the order of §6.7.4; MAIN's preflight covers the page's. */
  function localGate(track: OpTrack, view: OpView | null = track.mirror.done): PreviewSendPreflight {
    const ctx = context.current();
    if (deps.sender === null) return refusal('CG-SEND-HOST');
    if (view === null || view.state !== 'done' || view.generationRef === undefined) return refusal('CG-SEND-PART');
    const first = partsOfResult(view.result, 0);
    if (first === null) return refusal('CG-SEND-PART');
    if (identityChanged(track)) return refusal('CG-CONTEXT-CHANGED');
    if (!pageFlag(ctx, 'previewSend') || (track.source === 'newcomers' && !pageFlag(ctx, 'newcomers'))) return refusal('CG-SEND-OFF');
    if ((ctx.bootstrap?.limits.previewSendReceiptProfiles.length ?? 0) === 0) return refusal('CG-SEND-RECEIPT');
    if (host.previewSend === null) return refusal('CG-SEND-HOST');
    const route = host.current().route;
    if (route.chat !== null && chatKeyOf(route.chat) === chatKeyOf(track.target.chat)) return refusal('CG-SEND-ACTIVE-CHAT');
    if (!subscribed(track)) return refusal('CG-SEND-FAN');
    if (track.feature === 'fix' && draftRevision(track) !== track.previewRevision) return refusal('CG-SEND-PART');
    if (track.checkpoint === null) return refusal('CG-SEND-FRESHNESS');
    if (track.fanWrote || view.stale?.reason === 'fan-wrote') return refusal('CG-SEND-STALE');
    const served = servedContextHold(track.checkpoint, view.servedContext);
    if (served !== null) return refusal(served);
    return { ok: true };
  }

  /** The gate of one part: the result's own, the usable output of its variant, the «Новые» lease, then MAIN's answer. */
  function gateOf(track: OpTrack, variant: number): PreviewSendPreflight {
    const local = localGate(track);
    if (!local.ok) return local;
    const texts = partsOfResult(track.mirror.done?.result, variant);
    if (texts === null || greetingOutputProblem(texts) !== null) return refusal('CG-SEND-PART');
    // Parts of another variant are not sent once a part of one variant reached ChatSpace's queue.
    const started = [...track.attempts].filter(([, attempt]) => attempt.view.state !== 'held' && attempt.view.state !== 'notEnqueued' && attempt.view.state !== 'ready').map(([key]) => Number(key.split(':')[0]));
    if (started.length > 0 && !started.includes(variant)) return refusal('CG-SEND-PART');
    if (track.source === 'newcomers' && deps.greeting !== null) {
      const greeted = [...track.attempts.values()].some((attempt) => attempt.view.state === 'sentObserved');
      // Until the first part is confirmed the greeting goes under this tab's live lease; after it, the group's owner may finish it.
      if (!greeted && deps.greeting.leaseToken(track.fanRef) === null) {
        const claim = deps.greeting.claim(track.fanRef);
        return refusal(claim.s === 'other' || claim.s === 'elsewhere' ? 'CG-CLAIM-BUSY' : 'CG-CLAIM-EXPIRED');
      }
    }
    return track.preflight ?? { ok: true };
  }

  function requestOf(track: OpTrack, view: OpView, variant: number, index: number, text: string, attemptId: string, checkpoint: FreshnessCheckpoint): PreviewSendRequest | null {
    if (view.generationRef === undefined) return null;
    return {
      attemptId,
      target: track.target,
      generationRef: view.generationRef,
      part: partRef(track, variant, index),
      previewRevision: track.previewRevision,
      plainText: text,
      isAiGenerated: pageFlag(context.current(), 'previewSendMarkAiGenerated'),
      checkpoint,
      cause: DISPLAY_CAUSE,
    };
  }

  /** Asks MAIN, without side effects, whether the first unsent part could go now: the reason for the button. */
  async function refreshPreflight(track: OpTrack, view: OpView | null = track.mirror.done): Promise<void> {
    const port = host.previewSend;
    const checkpoint = track.checkpoint;
    if (port === null || checkpoint === null || view === null || view.state !== 'done' || !localGate(track, view).ok) return;
    const variant = Number([...track.attempts.keys()][0]?.split(':')[0] ?? 0);
    const texts = partsOfResult(view.result, variant) ?? [];
    const index = Math.max(
      0,
      texts.findIndex((_, i) => track.attempts.get(partKey(variant, i))?.view.state !== 'sentObserved'),
    );
    const text = texts[index];
    if (text === undefined) return;
    const request = requestOf(track, view, variant, index, text, ids.uuid(), checkpoint);
    if (request === null) return;
    const run = ++track.preflightRun;
    let answer: PreviewSendPreflight;
    try {
      answer = await port.preflight(request);
    } catch {
      answer = refusal('CG-SEND-HOST');
    }
    if (disposed || track.preflightRun !== run) return;
    track.preflight = answer;
    if (!answer.ok && answer.code === 'CG-SEND-STALE') markFanWrote(track, null);
    changedFor(track.handle);
  }

  const partRef = (track: OpTrack, variant: number, index: number): PartRef => (track.mirror.done?.result?.kind === 'variants' ? { variant, index } : { index });

  // ── part rows ──

  function openInsertBlock(track: OpTrack): ReasonVM | null {
    const ctx = context.current();
    if (ctx.phase !== 'ready' || !pageFlag(ctx, 'insertion')) return reason('feature-disabled');
    const capabilities = host.current().contract.capabilities;
    if (capabilities.navigate.state !== 'on' || capabilities.insert.state !== 'on') return reason('host-degraded');
    if (track.source === 'newcomers' && deps.greeting !== null && deps.greeting.leaseToken(track.fanRef) === null) {
      const greeted = [...track.attempts.values()].some((attempt) => attempt.view.state === 'sentObserved');
      // §6.5: in «Новые» the insert needs a live lease (the greeting is not confirmed yet).
      if (!greeted) return reason(deps.greeting.claim(track.fanRef).s === 'other' ? 'claim-busy' : 'claim-expired');
    }
    return null;
  }

  function rowsOf(track: OpTrack, variant: number | null, index: number): PartRows {
    const v = variant ?? 0;
    const key = partKey(v, index);
    const group = groupOf(track, v);
    const attempts = group === null ? [] : fanAttempts(track.attempts, purposeOf(track.source), group, track.clicked);
    const row = sendRow({ attempt: track.attempts.get(key) ?? null, clicked: track.clicked.has(key), gate: gateOf(track, v), staleAt: track.fanWroteAt ?? track.mirror.done?.stale?.at ?? null, nowIso: nowIso() });
    const settled = row.s === 'sent' || row.s === 'uncertain' || row.s === 'queued' || row.s === 'sending' || row.s === 'accepted';
    const order = group === null || settled ? null : partOrder(group, index, attempts);
    return {
      send: row,
      order,
      openInsert: openInsertRow({ row, waitingUntil: track.openInsert?.key === key ? track.openInsert.until : null, blocked: openInsertBlock(track) }),
    };
  }

  function progress(track: OpTrack): { readonly variant: number; readonly sent: number; readonly total: number; readonly uncertainPart: number | null; readonly inFlight: boolean; readonly sentAt: string | null } | null {
    const variant = [...track.attempts.keys(), ...track.clicked].map((key) => Number(key.split(':')[0]))[0];
    if (variant === undefined) return null;
    const group = groupOf(track, variant);
    if (group === null) return null;
    const attempts = fanAttempts(track.attempts, purposeOf(track.source), group, track.clicked);
    const counts = progressOf(group, attempts);
    const uncertain = attempts.filter((attempt) => attempt.state === 'uncertain').map((attempt) => attempt.partIndex).sort((a, b) => a - b)[0];
    const sentAt = [...track.attempts.values()].map((attempt) => attempt.sentAt).filter((at): at is string => at !== null).sort()[0] ?? null;
    return { variant, sent: counts.sent, total: counts.total, uncertainPart: uncertain ?? null, inFlight: attempts.some((attempt) => inFlight(attempt.state)), sentAt };
  }

  function reportProgress(track: OpTrack): void {
    if (track.source !== 'newcomers' || deps.greeting === null) return;
    const p = progress(track);
    deps.greeting.noteProgress(track.fanRef, p === null ? null : { sent: p.sent, total: p.total, uncertainPart: p.uncertainPart, inFlight: p.inFlight, sentAt: p.sentAt });
    deps.greeting.touch(track.fanRef, p?.inFlight ?? false);
  }

  /** A state of an attempt, from the click's answer, the driver or the background. */
  function onAttemptView(view: SendAttemptView): void {
    const owner = attemptOwner.get(view.attemptId);
    if (owner === undefined) {
      if (unclaimed.size > 64) unclaimed.clear();
      const before = unclaimed.get(view.attemptId);
      if (before === undefined || attemptReachable(before.state, view.state)) unclaimed.set(view.attemptId, view);
      return;
    }
    const track = tracks.get(owner.opId);
    const current = track?.attempts.get(owner.key);
    if (track === undefined || current === undefined || current.attemptId !== view.attemptId) return;
    const moved = attemptReachable(current.view.state, view.state);
    // The same state again may bring the receipt's message id; anything else that is not ahead is late (RB-020).
    if (!moved && !(current.view.state === view.state && view.platformMessageId !== undefined && current.view.platformMessageId === undefined)) return;
    track.attempts.set(owner.key, {
      attemptId: view.attemptId,
      view,
      sentAt: view.state === 'sentObserved' ? (current.sentAt ?? nowIso()) : current.sentAt,
      uncertainSince: view.state === 'uncertain' ? (current.uncertainSince ?? nowIso()) : current.uncertainSince,
    });
    afterAttempt(track, view);
  }

  /**
   * A hold only the background could see ends (the hub's minute of the rate
   * limit passed, the greeting lease was taken again): the held attempt is
   * dropped and the row is the gate's again. Nothing reached ChatSpace under
   * a held attempt, so nothing is repeated — the next send is a new click.
   */
  function dropHold(track: OpTrack, key: string, code: CgCode): void {
    const attempt = track.attempts.get(key);
    if (attempt === undefined || attempt.view.state !== 'held' || attempt.view.code !== code) return;
    track.attempts.delete(key);
    reportProgress(track);
    changedFor(track.handle);
    void refreshPreflight(track);
  }

  function clearHoldTimers(track: OpTrack): void {
    for (const timer of track.holdTimers.values()) clock.clearTimer(timer);
    track.holdTimers.clear();
  }

  function afterAttempt(track: OpTrack, view: SendAttemptView): void {
    if (view.state === 'held' && view.code === 'CG-SEND-STALE') markFanWrote(track, null);
    if (view.code === 'CG-CLAIM-EXPIRED' || view.code === 'CG-CLAIM-BUSY') deps.greeting?.noteRefusal(track.fanRef, view.code);
    if (view.state === 'held' && view.code === 'CG-HUB-RATE-LIMIT') {
      const key = attemptOwner.get(view.attemptId)?.key;
      if (key !== undefined && !track.holdTimers.has(key)) {
        track.holdTimers.set(
          key,
          clock.setTimer(RATE_LIMIT_HOLD_MS, () => {
            track.holdTimers.delete(key);
            if (!disposed && tracks.get(track.opId) === track) dropHold(track, key, 'CG-HUB-RATE-LIMIT');
          }),
        );
      }
    }
    if (view.state === 'sentObserved' && track.source === 'newcomers') {
      // NF-012: the greeting draft has done its work once a part is confirmed.
      const key = ownerKey(track.source, track.pageId, track.fanRef);
      if (key !== null && findDraft(drafts, key, clock.now()) !== null) {
        drafts = removeDraft(drafts, key);
        saveDrafts();
        draftsChanged();
      }
    }
    reportProgress(track);
    changedFor(track.handle);
    if (!inFlight(view.state)) void refreshPreflight(track);
  }

  // ── view model ──

  function feedItems(state: TargetState): FeedItemVM[] {
    const feed = state.feed;
    if (feed === null) return [];
    if (state.rows === null || state.rows.feed !== feed || state.rows.language !== i18n.language) {
      state.rows = { feed, language: i18n.language, items: feedRows(feed, (at) => i18n.formatTime(at, 'day')) };
    }
    return state.rows.items;
  }

  function contextBlock(ctx: PageContextState, state: TargetState | null): VmView | null {
    const retry: UiAction | null = state === null ? null : { type: 'RefreshArchive', targetHandle: state.handle };
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, retry);
    if (!pageFlag(ctx, 'preview')) {
      const why = flagReason(ctx, 'preview');
      return failureView(why === null ? { code: 'CG-FEATURE-DISABLED' } : { code: 'CG-FEATURE-DISABLED', detail: why }, i18n, retry);
    }
    return null;
  }

  function gateReason(state: TargetState, feature: PreviewActionId, otherRunning: boolean): ReasonVM | null {
    const ctx = context.current();
    if (ctx.phase !== 'ready') {
      const code = ctx.blocker?.code;
      const id: BoardReasonId = code === 'CG-AUTH-REQUIRED' || code === 'CG-AUTH-REVOKED' || code === 'CG-AUTH-EXPIRED' ? 'not-signed-in' : code === 'CG-BINDING-NOT-GRANTED' ? 'not-granted' : code === 'CG-BINDING-MISSING' || code === 'CG-BINDING-AMBIGUOUS' ? 'no-binding' : 'hub-down';
      return reason(id);
    }
    if (!pageFlag(ctx, 'preview')) return reason('feature-disabled');
    if (ctx.persona === null) return reason('no-persona');
    if (otherRunning) return reason('chat-busy');
    if (feature === 'fix' && draftText(state).trim().length === 0) return reason('needs-draft');
    if (feature === 'hi') {
      if (state.source === 'newcomers') {
        const blocked = deps.greeting?.hiBlocked(state.fanRef) ?? null;
        if (blocked !== null) return blocked;
      }
      // NF-015: a thread the archive proves to be a dialogue gets no Hi, and no AI call is spent on it.
      if (state.feed !== null && tooManyForHi(personalMessages(state.feed.items))) return reason('hi-gate');
    }
    return null;
  }

  function barOf(state: TargetState, track: OpTrack | null): PreviewVM['bar'] {
    const running = track !== null && !isTerminalOpState(track.mirror.state);
    const actions: Partial<Record<PreviewActionId, DockActionVM>> = {};
    for (const feature of featuresOf(state.source)) {
      const busy = running && track.feature === feature;
      const why = busy ? null : gateReason(state, feature, running);
      actions[feature] = { enabled: why === null, busy, active: track !== null && track.feature === feature && !track.hidden && !running, reason: why, hotkey: null, badge: null };
    }
    const locked = running ? reason('locked-during-generation') : null;
    return { actions, tone: state.tone, tones: TONES, split: context.current().settings?.generation.split ?? false, locked: running, toneReason: locked, splitReason: locked };
  }

  function closedVM(source: PreviewSource): PreviewVM {
    const off = reason('send-unavailable');
    return {
      view: { s: 'empty', why: msg('preview.empty') },
      from: source,
      handle: null,
      header: null,
      openChat: button('common.openChat', CLOSE_PREVIEW, { enabled: false, reason: off }),
      close: CLOSE_PREVIEW,
      unread: 'kept',
      archive: { stamp: stamp(null, 'unknown'), lagMinutes: null, refreshing: false, refresh: button('common.refreshArchive', CLOSE_PREVIEW, { enabled: false, reason: off }) },
      fanWroteNew: false,
      feed: { items: [], hasOlder: false, loadingOlder: false, olderError: null },
      ping: null,
      draft: { text: '', maxChars: SEND_LIMITS.previewDraftMaxChars, placeholder: msg('preview.draft.placeholder') },
      bar: { actions: {}, tone: null, tones: TONES, split: false, locked: false, toneReason: null, splitReason: null },
      result: null,
      idleHint: null,
      neighbors: { previous: null, next: null },
      claim: null,
      greeting: null,
      stoppedNote: null,
    };
  }

  function build(source: PreviewSource): PreviewVM {
    const handle = surfaces.current().preview[source];
    const state = handle === null ? undefined : targets.get(handle);
    if (handle === null || state === undefined) return closedVM(source);
    const ctx = context.current();
    const info = deps.directories[source]?.resolve(handle) ?? state.info;
    state.info = info;
    const feed = state.feed;
    const opId = currentOp.get(handle);
    const track = opId === undefined ? null : (tracks.get(opId) ?? null);
    const lag = feed === null ? null : archiveLag(feed);

    let view: VmView;
    const blocked = contextBlock(ctx, state);
    if (blocked !== null) view = blocked;
    else if (feed === null) view = state.feedError !== null ? failureView(state.feedError, i18n, { type: 'RefreshArchive', targetHandle: handle }) : loadingView(state.feedSince);
    else {
      const gaps: PartialGap[] = [];
      if (feed.coverage !== 'complete') gaps.push({ kind: 'coverage', level: feed.coverage });
      if (lag !== null) gaps.push({ kind: 'archive-lag', messages: null, minutes: lag.minutes });
      if (feed.truncated) gaps.push({ kind: 'truncated', shown: feed.items.length, total: null });
      if (state.feedLoading) gaps.push({ kind: 'stale-cache', asOf: feed.asOf });
      if (state.feedError !== null) {
        view = failureClass(state.feedError.code) === 'error' ? dataView([...gaps, { kind: 'source-failed', source: 'feed', code: state.feedError.code }]) : failureView(state.feedError, i18n, { type: 'RefreshArchive', targetHandle: handle }, state.feedLoadedAt);
      } else if (feed.items.length === 0 && gaps.length === 0) {
        view = { s: 'empty', why: info.newcomer === null ? msg('preview.feed.empty') : msg('preview.feed.emptySubscribed', { name: info.name, age: { age: info.newcomer.subscribedAt } }) };
      } else view = dataView(gaps);
    }

    const card = state.card;
    const shown = track !== null && !track.hidden ? track : null;
    const p = shown === null ? null : progress(shown);
    const sendStarted = shown !== null && (shown.clicked.size > 0 || [...shown.attempts.values()].some((attempt) => attempt.view.state !== 'ready' && attempt.view.state !== 'held'));
    const result =
      shown === null
        ? null
        : previewResult({
            mirror: shown.mirror,
            feature: shown.feature,
            surface: shown.surface,
            startedAt: shown.startedAt,
            now: clock.now(),
            targetName: info.name,
            toneUsed: shown.toneUsed,
            splitRequested: shown.splitRequested,
            expanded: shown.expanded,
            cachedAt: shown.cachedAt,
            fixSource: shown.fixSource,
            unusable: unusable(shown),
            i18n,
            rows: (variant, index) => rowsOf(shown, variant, index),
            copy: (variant, index) => shown.copy.get(partKey(variant, index)) ?? 'idle',
            progress: p !== null && p.sent > 0 ? { sent: p.sent, total: p.total } : null,
            sendStarted,
            regenerate: regenerateRule(shown, p),
          });

    const around = deps.directories[source]?.neighbours(handle) ?? { previous: null, next: null };
    const openChat: UiAction = { type: 'Navigate', to: { kind: 'chat', targetHandle: handle } };
    return {
      view,
      from: source,
      handle,
      header: {
        name: info.name,
        username: info.username,
        lifetime: info.lifetime ?? card?.metrics.lifetime.scopeGrossAmountMills ?? null,
        period30: info.period30 ?? card?.metrics.window?.grossAmountMills ?? null,
        weWroteAt: info.weWroteAt,
        fanWroteAt: info.fanWroteAt,
        newcomer: info.newcomer,
      },
      openChat: button('common.openChat', openChat),
      close: CLOSE_PREVIEW,
      unread: sendStarted ? 'read-after-send' : 'kept',
      archive: {
        stamp: stamp(feed?.asOf ?? null, feed?.coverage ?? 'unknown'),
        lagMinutes: lag?.minutes ?? null,
        refreshing: state.feedLoading,
        refresh: button('common.refreshArchive', { type: 'RefreshArchive', targetHandle: handle }, { enabled: !state.feedLoading }),
      },
      fanWroteNew: shown !== null && (shown.fanWrote || shown.mirror.done?.stale?.reason === 'fan-wrote'),
      feed: {
        items: feedItems(state),
        hasOlder: feed !== null && feed.nextOlderCursor !== null,
        loadingOlder: state.olderLoading,
        olderError: state.olderError === null ? null : errorOf(state.olderError, i18n),
      },
      ping: source === 'newcomers' || feed === null || feed.ping === null ? null : { segment: feed.ping.segment, fanSilenceDays: feed.ping.fanSilenceDays },
      draft: { text: draftText(state), maxChars: SEND_LIMITS.previewDraftMaxChars, placeholder: msg('preview.draft.placeholder') },
      bar: barOf(state, track),
      result,
      idleHint: result === null && feed !== null && blocked === null ? msg('preview.empty') : null,
      neighbors: {
        previous: around.previous === null ? null : { type: 'OpenPreview', targetHandle: around.previous },
        next: around.next === null ? null : { type: 'OpenPreview', targetHandle: around.next },
      },
      claim: source === 'newcomers' && deps.greeting !== null ? deps.greeting.claim(state.fanRef) : null,
      greeting: source === 'newcomers' && deps.greeting !== null ? deps.greeting.greeting(state.fanRef) : null,
      stoppedNote: p !== null && p.uncertainPart !== null && p.uncertainPart + 1 < p.total ? msg('newcomers.stopped', { n: p.uncertainPart + 1 }) : null,
    };
  }

  /** NF-017: the parts of the variant in work (or the first one) cannot be sent as they are. */
  function unusable(track: OpTrack): boolean {
    const result = track.mirror.done?.result;
    if (result === undefined) return false;
    if (result.kind === 'parts') return greetingOutputProblem(result.parts) !== null;
    if (result.kind === 'variants') return result.variants.every((texts) => greetingOutputProblem(texts) !== null);
    return false;
  }

  function regenerateRule(track: OpTrack, p: ReturnType<typeof progress>): { readonly allowed: boolean; readonly reason: ReasonVM | null } {
    if (p !== null && p.uncertainPart !== null) return { allowed: false, reason: reason('part-uncertain', { n: p.uncertainPart + 1 }) };
    if (p !== null && p.inFlight) return { allowed: false, reason: reason('parts-sending') };
    return { allowed: true, reason: null };
  }

  // ── actions: generation ──

  function runningVMs(active: readonly { readonly opId: string; readonly feature: FeatureId; readonly chat: Target['chat']; readonly fanLabel: string | null; readonly startedAt: number; readonly inThisTab: boolean }[]): RunningOpVM[] {
    const binding = context.current().binding;
    return active.map((op) => ({
      opId: op.opId,
      feature: op.feature,
      fanLabel: op.fanLabel,
      startedAt: op.startedAt,
      inThisTab: op.inThisTab,
      // A running chat of this account opens by its handle; one of another account is reached from the palette.
      go:
        binding !== null && op.chat.hostAccountId === binding.hostAccountId
          ? { type: 'Navigate', to: { kind: 'chat', targetHandle: fanHandle('spenders', binding.pageId, op.chat.platformFanId) } }
          : { type: 'Navigate', to: { kind: 'surface', surface: 'palette', open: true } },
      cancel: { type: 'CancelGeneration', operationId: op.opId },
    }));
  }

  async function generate(type: UiActionType, state: TargetState, feature: FeatureId, options: UserOptions, regenerateOf: OpTrack | null): Promise<ActionReceipt> {
    const ctx = context.current();
    const allowed = featuresOf(state.source);
    const known = allowed.find((f) => f === feature);
    if (known === undefined) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
    const existing = currentOp.get(state.handle);
    const current = existing === undefined ? null : (tracks.get(existing) ?? null);
    if (current !== null && !isTerminalOpState(current.mirror.state)) {
      // A click while this chat generates shows what is running; nothing new starts (§7).
      if (current.feature === feature) {
        current.hidden = false;
        changedFor(state.handle);
        return done(type, 'noop', { opId: current.opId });
      }
      return refused(type, localError('CG-OP-CHAT-BUSY', i18n));
    }
    const why = gateReason(state, known, false);
    if (why !== null) return refused(type, localError(why.code ?? 'CG-FEATURE-DISABLED', i18n));
    const binding = ctx.binding;
    const settings = ctx.settings;
    const bootstrap = ctx.bootstrap;
    if (binding === null || settings === null || bootstrap === null) return refused(type, localError('CG-HUB-UNAVAILABLE', i18n));

    const chat = { host: 'chatspace' as const, hostAccountId: binding.hostAccountId, platformFanId: state.fanRef };
    const target: Target = { binding, chat, fanRef: state.fanRef, conversationRef: state.fanRef };
    const atEpoch = epoch;
    deps.greeting?.touch(state.fanRef, true);
    // §6.7.5: the checkpoint is taken at the click — before the lease and before the hub request.
    const checkpoint: FreshnessCheckpoint | null = await host.checkpoint(chat).catch(() => null);
    if (state.source === 'newcomers' && deps.greeting !== null) {
      const lease = await deps.greeting.claimForGenerate(state.fanRef);
      if (!lease.ok) return refused(type, lease.error);
    }
    const issued = await issueCause(rpc, 'generate', surfaceOf(state.source));
    if (!issued.ok) return refused(type, localError(issued.code, i18n));
    if (disposed || atEpoch !== epoch) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));

    const source = draftText(state);
    const tone = feature === 'reply' ? (regenerateOf !== null ? regenerateOf.toneUsed : options.tone !== undefined ? options.tone : state.tone) : null;
    const split = regenerateOf !== null ? regenerateOf.splitRequested : (options.split ?? settings.generation.split);
    const start: StartOp = {
      feature,
      surface: surfaceOf(state.source),
      target,
      cause: issued.cause,
      tone,
      split,
      window: options.window ?? messageWindowFor(feature, settings.generation.windows, bootstrap.limits.deepMax),
      ...(feature === 'fix' ? { draft: { text: source, revision: draftRevision(state), digest: digestHex(source) } } : {}),
      ...(feature === 'hi' ? { variantCount: state.source === 'newcomers' ? (1 as const) : (options.variants ?? 3) } : {}),
      ...(checkpoint === null ? {} : { checkpoint }),
      ...(regenerateOf === null ? {} : { regenerateOf: regenerateOf.opId, force: true }),
    };
    const admission = await rpc.request('op.start', start);
    if (disposed || atEpoch !== epoch) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    if (!admission.ok) return refused(type, errorOf(admission.error, i18n));
    if (!admission.payload.ok) {
      return { ok: false, type, code: admission.payload.code, error: localError(admission.payload.code, i18n), running: runningVMs(admission.payload.active) };
    }
    const opId = admission.payload.opId;
    // The tone was for this one Reply (Б1).
    if (feature === 'reply') state.tone = null;
    let track = tracks.get(opId);
    if (track === undefined) {
      const now = clock.now();
      track = {
        ...trackOf({ opId, feature, surface: start.surface, target, state: 'admitted', phase: { name: 'admitted', since: now }, startedAt: now, toneUsed: tone }, state, {
          checkpoint,
          previewRevision: draftRevision(state),
          fixSource: feature === 'fix' ? source : null,
          splitRequested: split,
          personaDefinitionId: ctx.persona?.definitionId ?? null,
        }),
        mirror: newMirror(opId, { name: 'admitted', since: now }),
      };
      tracks.set(opId, track);
      // The same request may have reopened a finished result: nothing more would arrive for it.
      void syncOp(track);
    } else {
      track.hidden = false;
      track.cachedAt = track.mirror.done?.endedAt ?? null;
    }
    currentOp.set(state.handle, opId);
    pruneTracks();
    changedFor(state.handle);
    return done(type, 'started', { opId });
  }

  // ── actions: send ──

  async function sendPart(type: UiActionType, track: OpTrack, variant: number, index: number): Promise<ActionReceipt> {
    const sender = deps.sender;
    const view = track.mirror.done;
    const texts = partsOfResult(view?.result, variant);
    const text = texts?.[index];
    const group = groupOf(track, variant);
    const checkpoint = track.checkpoint;
    if (sender === null || view === null || text === undefined || group === null) return refused(type, localError('CG-SEND-PART', i18n));
    const key = partKey(variant, index);
    const rows = rowsOf(track, variant, index);
    if (!clickable(rows.send, rows.order)) {
      const code: CgCode = rows.order !== null ? 'CG-SEND-BUSY' : rows.send.s === 'unavailable' || rows.send.s === 'rejected' ? rows.send.code : rows.send.s === 'held-stale' ? 'CG-SEND-STALE' : rows.send.s === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-BUSY';
      return refused(type, localError(code, i18n));
    }
    if (checkpoint === null) return refused(type, localError('CG-SEND-FRESHNESS', i18n));
    // The button is off from the first click, before anything answers (§6.7.7, lock 1).
    track.clicked.add(key);
    reportProgress(track);
    changedFor(track.handle);
    const settle = (): void => {
      track.clicked.delete(key);
    };
    const issued = await issueCause(rpc, 'send', track.surface);
    if (!issued.ok) {
      settle();
      reportProgress(track);
      changedFor(track.handle);
      return refused(type, localError(issued.code, i18n));
    }
    const leaseToken = track.source === 'newcomers' ? (deps.greeting?.leaseToken(track.fanRef) ?? null) : null;
    const click: PreviewSendClick = {
      opId: track.opId,
      target: track.target,
      purpose: purposeOf(track.source),
      group,
      part: partRef(track, variant, index),
      previewRevision: track.previewRevision,
      textRevision: 0,
      checkpoint,
      documentEpoch: checkpoint.documentEpoch,
      cause: issued.cause,
      ...(leaseToken === null ? {} : { leaseToken }),
      plainText: text,
      isAiGenerated: pageFlag(context.current(), 'previewSendMarkAiGenerated'),
    };
    let answered: SendAttemptView;
    try {
      answered = await sender.send(click);
    } catch {
      settle();
      reportProgress(track);
      changedFor(track.handle);
      // The click never reached the coordinator's journal: nothing was sent.
      return refused(type, localError('CG-SEND-HOST', i18n));
    }
    settle();
    // States that arrived before the click's own answer are the same attempt's: the most advanced one stands.
    const early = unclaimed.get(answered.attemptId);
    unclaimed.delete(answered.attemptId);
    const latest = early !== undefined && attemptReachable(answered.state, early.state) ? early : answered;
    attemptOwner.set(latest.attemptId, { opId: track.opId, key });
    track.attempts.set(key, {
      attemptId: latest.attemptId,
      view: latest,
      sentAt: latest.state === 'sentObserved' ? nowIso() : null,
      uncertainSince: latest.state === 'uncertain' ? nowIso() : null,
    });
    afterAttempt(track, latest);
    return done(type, 'started', { attemptId: latest.attemptId });
  }

  // ── actions: open and insert ──

  function finishInsert(outcome: DeferredOutcome | null): ActionReceipt | null {
    const pending = pendingInsert;
    if (outcome === null || pending === null || outcome.insert.navigationId !== pending.navigationId) return null;
    pendingInsert = null;
    if (pending.timer !== null) clock.clearTimer(pending.timer);
    pending.track.openInsert = null;
    changedFor(pending.track.handle);
    if (outcome.kind === 'inserted') return done('OpenAndInsertPart', 'opened', { opId: pending.track.opId });
    if (outcome.kind === 'needs-confirm') return done('OpenAndInsertPart', 'needs-confirm', { opId: pending.track.opId });
    // The preview is gone by now: the person hears it as a toast («Вставка отменена», «Чат не готов…»).
    deps.notifier?.notify(outcome.code, `preview:${pending.track.handle}`);
    return refused('OpenAndInsertPart', localError(outcome.code, i18n));
  }

  /** SP-035: the chat opened — the boards get out of its way. This is not the person closing the preview. */
  function closeForNavigation(): void {
    closingForNavigation = true;
    surfaces.closeBoards();
    closingForNavigation = false;
  }

  function cancelInsert(why: 'human-navigation' | 'preview-closed' | 'session' | 'persona'): void {
    const pending = pendingInsert;
    if (pending === null) return;
    pending.abort.abort();
    finishInsert(slot.cancel(why));
  }

  async function openAndInsert(type: UiActionType, track: OpTrack, variant: number, index: number): Promise<ActionReceipt> {
    const text = partsOfResult(track.mirror.done?.result, variant)?.[index];
    if (text === undefined) return refused(type, localError('CG-INSERT-FAILED', i18n));
    const rows = rowsOf(track, variant, index);
    if (rows.openInsert.s !== 'available') {
      const code: CgCode = rows.openInsert.s === 'unavailable' ? (rows.openInsert.reason.code ?? 'CG-FEATURE-DISABLED') : rows.send.s === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-INSERT-FAILED';
      return refused(type, localError(code, i18n));
    }
    // The text was written for another sign-in, binding or persona: it is not put into a chat (the click says why).
    if (identityChanged(track)) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    const identity = host.current().identity;
    if (identity === null) return refused(type, localError('CG-HOST-NOT-READY', i18n));
    const issued = await issueCause(rpc, 'navigate', track.surface);
    if (!issued.ok) return refused(type, localError(issued.code, i18n));
    if (identityChanged(track)) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    const now = clock.now();
    const timeoutMs = (context.current().bootstrap?.limits.navInsertTimeoutSec ?? 20) * 1000;
    const chat = track.target.chat;
    const part = partRef(track, variant, index);
    const insert = buildDeferredInsert({ intentId: ids.uuid(), operationId: track.opId, part, target: chat, text, documentEpoch: identity.documentEpoch, now, timeoutMs });
    if (!insert.ok) return refused(type, localError(insert.code, i18n));
    const navigation = buildOpenAndInsert({ intentId: ids.uuid(), cause: issued.cause, insert: insert.intent });
    if (!navigation.ok) return refused(type, localError(navigation.code, i18n));

    // A newer «Открыть и вставить» replaces the one still waiting.
    const previous = pendingInsert;
    const displaced = slot.begin({ navigationId: navigation.intent.intentId, insertIntentId: insert.intent.intentId, opId: track.opId, part, chat, expiresAt: insert.intent.expiresAt });
    if (previous !== null) {
      previous.abort.abort();
      finishInsert(displaced);
    }
    const abort = new AbortFlag();
    const pending: PendingInsert = { navigationId: navigation.intent.intentId, track, key: partKey(variant, index), abort, timer: null };
    pendingInsert = pending;
    pending.timer = clock.setTimer(timeoutMs + DEFERRED_GRACE_MS, () => {
      if (pendingInsert !== pending) return;
      pending.timer = null;
      pending.abort.abort();
      finishInsert(slot.expire(clock.now()));
    });
    track.openInsert = { key: pending.key, until: insert.intent.expiresAt };
    deps.greeting?.touch(track.fanRef, true);
    changedFor(track.handle);

    // A bridge failure of a write may have run: the navigation failed, the insert's outcome is unknown and is never repeated.
    const receipt = await host.navigate(navigation.intent, { signal: abort }).catch((): NavigationReceipt => ({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } }));
    if (receipt.state === 'navigated') closeForNavigation();
    const applied = receipt.insert;
    if (applied !== null) void rpc.request('op.reportInsert', { opId: track.opId, part, receipt: applied });
    deps.greeting?.touch(track.fanRef, false);
    return finishInsert(slot.settle(navigation.intent.intentId, receipt)) ?? refused(type, localError('CG-INSERT-CANCELED', i18n));
  }

  // ── actions: the rest ──

  async function copy(type: UiActionType, track: OpTrack, variant: number, index: number): Promise<ActionReceipt> {
    const key = partKey(variant, index);
    const text = partsOfResult(track.mirror.done?.result, variant)?.[index];
    const wrote = text !== undefined && deps.clipboard !== null && (await deps.clipboard.writeText(text).catch(() => false));
    track.copy.set(key, wrote ? 'done' : 'failed');
    changedFor(track.handle);
    if (!wrote) return refused(type, localError('CG-CLIPBOARD', i18n));
    // `copied` is reported only after the clipboard took the text (Б14).
    void rpc.request('op.reportCopy', { opId: track.opId, part: partRef(track, variant, index) });
    clock.setTimer(COPY_MARK_MS, () => {
      if (track.copy.get(key) !== 'done') return;
      track.copy.delete(key);
      changedFor(track.handle);
    });
    return done(type);
  }

  async function openChat(type: UiActionType, fanRef: string, surface: Surface): Promise<ActionReceipt> {
    const binding = context.current().binding;
    if (binding === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    const receipt = await navigator.open({ host: 'chatspace', hostAccountId: binding.hostAccountId, platformFanId: fanRef }, surface);
    if (receipt.state === 'failed') return refused(type, localError(receipt.code, i18n));
    surfaces.closeBoards();
    return done(type, 'opened');
  }

  function setDraft(state: TargetState, text: string): void {
    const key = ownerKey(state.source, state.pageId, state.fanRef);
    if (key === null) return;
    const before = revisions.get(key) ?? findDraft(drafts, key, clock.now())?.revision ?? 0;
    const put = putDraft(drafts, key, text, clock.now(), state.source === 'newcomers' ? (deps.greeting?.threadRevision(state.fanRef) ?? null) : null);
    drafts = put.store;
    revisions.set(key, Math.max(before + 1, put.revision));
    deps.greeting?.touch(state.fanRef, false);
    saveDrafts();
    changedFor(state.handle);
    draftsChanged();
  }

  const stateOf = (handle: TargetHandle): TargetState | null => {
    const state = targets.get(handle);
    return state !== undefined && SOURCES.some((s) => surfaces.current().preview[s] === handle) ? state : null;
  };

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    const type = action.type;
    if (action.type === 'OpenPreview') {
      const parsed = parseFanHandle(action.targetHandle);
      if (parsed === null) return null;
      const info = deps.directories[parsed.source]?.resolve(action.targetHandle) ?? null;
      if (info === null) return Promise.resolve(refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n)));
      surfaces.setPreview(parsed.source, action.targetHandle);
      return Promise.resolve(done(type, 'opened'));
    }
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind === 'surface' && to.surface === 'preview') {
        if (to.open) return Promise.resolve(done(type, 'noop'));
        for (const s of SOURCES) surfaces.setPreview(s, null);
        return Promise.resolve(done(type));
      }
      if (to.kind === 'chat') {
        const parsed = parseFanHandle(to.targetHandle);
        // A list answers for its own handles; the palette's fans have no list.
        return parsed !== null && parsed.source === 'palette' && parsed.pageId === context.current().binding?.pageId ? openChat(type, parsed.fanRef, 'preview') : null;
      }
      return null;
    }
    if (action.type === 'RefreshArchive' || action.type === 'LoadOlder' || action.type === 'SetPreviewDraft' || action.type === 'SetTone' || action.type === 'Generate') {
      if (parseFanHandle(action.targetHandle) === null) return null;
      const state = stateOf(action.targetHandle);
      if (state === null) return Promise.resolve(refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n)));
      if (action.type === 'RefreshArchive') {
        const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
        return reads.then(() => Promise.all([loadFeed(state), loadCard(state)])).then(() => done(type));
      }
      if (action.type === 'LoadOlder') return loadOlder(state).then(() => done(type));
      if (action.type === 'SetPreviewDraft') {
        setDraft(state, action.text);
        return Promise.resolve(done(type));
      }
      if (action.type === 'SetTone') {
        state.tone = action.tone;
        changedFor(state.handle);
        return Promise.resolve(done(type));
      }
      return generate(type, state, action.feature, action.options, null);
    }
    if (action.type === 'Copy') {
      const part = parsePartHandle(action.artifactHandle);
      const track = part === null ? undefined : tracks.get(part.opId);
      return part === null || track === undefined ? null : copy(type, track, part.variant, part.index);
    }
    if (action.type === 'OpenChatToVerify') {
      const owner = attemptOwner.get(action.attemptId);
      const track = owner === undefined ? undefined : tracks.get(owner.opId);
      // §6.7.8: the only way on from an unknown outcome — look at the chat. Nothing is sent or inserted.
      return track === undefined ? null : openChat(type, track.fanRef, track.surface);
    }
    if (action.type === 'Regenerate' || action.type === 'CancelGeneration' || action.type === 'HideResult' || action.type === 'ExpandResult' || action.type === 'SendPart' || action.type === 'OpenAndInsertPart') {
      const track = tracks.get(action.operationId);
      if (track === undefined) return null;
      if (action.type === 'CancelGeneration') {
        return rpc.request('op.cancel', { opId: track.opId }).then((answer) => (answer.ok ? done(type) : refused(type, errorOf(answer.error, i18n))));
      }
      if (action.type === 'HideResult') {
        track.hidden = true;
        changedFor(track.handle);
        return Promise.resolve(done(type));
      }
      if (action.type === 'ExpandResult') {
        track.expanded = action.expanded;
        changedFor(track.handle);
        return Promise.resolve(done(type));
      }
      if (action.type === 'Regenerate') {
        const state = stateOf(track.handle);
        if (state === null) return Promise.resolve(refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n)));
        const rule = regenerateRule(track, progress(track));
        if (!rule.allowed) return Promise.resolve(refused(type, localError(rule.reason?.code ?? 'CG-SEND-BUSY', i18n)));
        return generate(type, state, track.feature, {}, track);
      }
      if (action.type === 'SendPart') return sendPart(type, track, action.variant ?? 0, action.part);
      return openAndInsert(type, track, action.variant ?? 0, action.part);
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'preview') return null;
      const handle = surfaces.current().preview[action.selector.from];
      const state = handle === null ? null : stateOf(handle);
      return context.refresh().then(async () => {
        if (state !== null) await Promise.all([loadFeed(state), loadCard(state)]);
        return done(type);
      });
    }
    return null;
  }

  // ── subscriptions ──

  const offs: (() => void)[] = [];
  offs.push(
    surfaces.subscribe((state, previous) => {
      for (const s of SOURCES) {
        const before = previous.preview[s];
        const after = state.preview[s];
        if (before === after) continue;
        if (before !== null && !SOURCES.some((other) => state.preview[other] === before)) closeTarget(before);
        if (after !== null && !targets.has(after)) openTarget(s, after);
        cells[s].invalidate();
      }
    }),
    context.subscribe((state) => {
      if (state.epoch !== epoch) {
        // Another sign-in, hub or account: nothing of the old identity is shown, inserted or kept.
        epoch = state.epoch;
        cancelInsert('session');
        for (const target of targets.values()) stopPoll(target);
        for (const track of tracks.values()) clearHoldTimers(track);
        targets.clear();
        kept = [];
        tracks.clear();
        currentOp.clear();
        attemptOwner.clear();
        unclaimed.clear();
        for (const s of SOURCES) surfaces.setPreview(s, null);
        if (state.session !== null) drafts = keepOnlyUser(drafts, state.session.hubOrigin, state.session.userId);
      } else if (pendingInsert !== null && pendingInsert.track.personaDefinitionId !== null && state.persona?.definitionId !== pendingInsert.track.personaDefinitionId) {
        cancelInsert('persona');
      }
      for (const target of targets.values()) if (target.feed === null && !target.feedLoading && target.feedError === null) void loadFeed(target);
      changed();
      draftsChanged();
    }),
    i18n.subscribe(() => changed()),
    rpc.onEvent('op.update', onUpdate),
    rpc.onEvent('op.done', ({ view }) => {
      const track = tracks.get(view.opId);
      if (track !== undefined) finish(track, view);
    }),
    rpc.onEvent('send.state', ({ view }) => onAttemptView(view)),
    host.subscribe((event: HostEvent) => {
      if (event.type === 'route') {
        const pending = pendingInsert;
        if (pending !== null && event.route.chat !== null) {
          // Our chat opened: the board closes while the insert waits for the composer. Another chat: the person went elsewhere, the insert is given up (§6.5).
          if (chatKeyOf(event.route.chat) === chatKeyOf(pending.track.target.chat)) closeForNavigation();
          else cancelInsert('human-navigation');
        }
        for (const track of tracks.values()) if (track.mirror.done !== null && currentOp.get(track.handle) === track.opId) void refreshPreflight(track);
        changed();
        return;
      }
      if (event.type === 'incoming') {
        const fact = event.fact;
        if (!fact.fromFan) return;
        for (const track of tracks.values()) {
          if (track.target.chat.hostAccountId !== fact.hostAccountId || track.fanRef !== fact.platformFanId || track.fanWrote) continue;
          // A fan message after the checkpoint holds every send of this result; its text never enters the preview (§6.7.5).
          if (track.checkpoint !== null && track.checkpoint.knownFanMessageIds.includes(fact.platformMessageId)) continue;
          markFanWrote(track, fact.sentAt);
          changedFor(track.handle);
        }
        return;
      }
      if (event.type === 'coverage' || event.type === 'accounts') {
        for (const track of tracks.values()) if (track.mirror.done !== null && currentOp.get(track.handle) === track.opId) void refreshPreflight(track);
      }
    }),
  );
  if (deps.sender !== null) offs.push(deps.sender.onView(onAttemptView));
  const desk = deps.greeting;
  if (desk !== null) {
    offs.push(
      desk.subscribe(() => {
        // The lease was taken again: a part the hub held for an expired lease may be sent by a new click.
        for (const track of tracks.values()) {
          if (track.source !== 'newcomers' || desk.leaseToken(track.fanRef) === null) continue;
          for (const key of [...track.attempts.keys()]) dropHold(track, key, 'CG-CLAIM-EXPIRED');
        }
        changed('newcomers');
      }),
    );
  }
  for (const s of SOURCES) {
    const directory = deps.directories[s];
    if (directory !== null) offs.push(directory.subscribe(() => cells[s].invalidate()));
  }

  return {
    kinds: ['preview'],
    getSnapshot: (selector) => cells[selector.from].get(),
    subscribe: (selector, listener) => cells[selector.from].subscribe(listener),
    dispatch,
    ready: () => readyPromise,
    draftOf(source, pageId, fanRef) {
      const key = ownerKey(source, pageId, fanRef);
      const draft = key === null ? null : findDraft(drafts, key, clock.now());
      return draft === null ? null : { text: draft.text, threadRevision: draft.threadRevision };
    },
    onDrafts(listener) {
      draftListeners.add(listener);
      return () => {
        draftListeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      draftListeners.clear();
      for (const off of offs) off();
      for (const target of targets.values()) stopPoll(target);
      for (const track of tracks.values()) clearHoldTimers(track);
      if (pendingInsert !== null) {
        pendingInsert.abort.abort();
        if (pendingInsert.timer !== null) clock.clearTimer(pendingInsert.timer);
        pendingInsert = null;
      }
      for (const s of SOURCES) cells[s].clear();
    },
  };
}
