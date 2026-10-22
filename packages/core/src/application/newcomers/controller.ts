// «Новые» as a surface controller (architecture.md §8.5 «Новые», hub H-7,
// §10.2 NewcomersVM; NF-001…NF-028): who subscribed or came back in the
// window, where each greeting stands, and the greeting lease. The list is a
// cursor pass with a fixed window, read again every 30 s while the window is
// open (and every 60 s for the subscriber sound, when this tab is asked to
// watch) with a spread and pauses while offline. No lease is taken (2026-10-20
// audit, row 11, as the old clients did): the hub claims the fan at the send
// and refuses one a colleague greeted; a colleague's lease an older client
// still holds is shown, never counted down. Nothing here sends: «AI ничего не
// отправляет сам» (NF-028).

import { type CgCode, type CgErrorView, type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { type HostEvent, type HostPort } from '@cg/contracts/host';
import { type ClaimState } from '@cg/contracts/hub';
import { chatKeyOf } from '@cg/contracts/ids';
import {
  type ActionReceipt,
  type ClaimVM,
  type GreetingFilter,
  type GreetingStatusVM,
  type I18n,
  type NewcomerRowVM,
  type NewcomersTab,
  type NewcomersVM,
  type PartialGap,
  type TargetHandle,
  type UiAction,
  type UiActionType,
  type VmView,
} from '@cg/contracts/vm';

import { RENEW_RETRY_MS, RowLocks, claimRefusal, leaseNow, leaseOfClaim, leasePolicy, shouldRenew, type LeasePolicy, type LeaseView } from '../../domain/newcomers/claim';
import { draftStale } from '../../domain/newcomers/greeting';
import { NO_SEEN_EVENTS, nextPollDelay, observeEvents, pollMode, resumeDelay, unprime, type SeenEvents } from '../../domain/newcomers/poll';
import { greetingStatus, hiBlock, inTab, matchesSearch, newcomerRow, passesFilter, progressOfClaim, threadRevision, type LocalGreeting, type NewcomerRow } from '../../domain/newcomers/rows';
import { WINDOW_HOURS, appendAudiencePage, clampWindow, startWalk, walkHasMore, walkIncomplete, windowLimit, windowOptions, type AudienceWalk } from '../../domain/newcomers/window';
import { batchDispatch, createBatch, isBatchAction, type BatchPreviewPort } from '../boards/batch';
import { type PageContextPort, type PageContextState, flagFailure, pageFlag, pageFlagOf } from '../boards/context';
import { flagReasonVm } from '../flag-reason';
import { fanHandle, parseFanHandle } from '../boards/handles';
import { type ChatNavigator } from '../boards/navigate';
import { type BoardsClock, type Connectivity, type RandomSource, type TabRpc } from '../boards/ports';
import { type GreetingDesk, type PreviewDirectory, type PreviewTargetInfo, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { button, dataView, errorOf, failureClass, failureView, loadingView, localError, msg, reason, stamp } from '../boards/views';

/** The search waits this long after the last keystroke, as on the Spenders board. */
export const NEWCOMERS_SEARCH_DEBOUNCE_MS = 150;

const SELECTOR = { of: 'newcomers' } as const;
const TABS = ['todo', 'all'] as const satisfies readonly NewcomersTab[];
const TAB_LABELS: Readonly<Record<NewcomersTab, I18nKey>> = { todo: 'newcomers.tab.todo', all: 'newcomers.tab.all' };
const FILTERS = ['any', 'none', 'sending', 'stopped', 'greeted', 'replied'] as const satisfies readonly GreetingFilter[];
const FILTER_LABELS: Readonly<Record<GreetingFilter, I18nKey>> = {
  any: 'newcomers.filter.any',
  none: 'newcomers.filter.none',
  sending: 'newcomers.filter.sending',
  stopped: 'newcomers.filter.stopped',
  greeted: 'newcomers.filter.greeted',
  replied: 'newcomers.filter.replied',
};

interface LeaseRecord {
  view: LeaseView;
  /** The last claim answer for the fan: the hub's own part numbers and greeting time. */
  detail: ClaimState | null;
  /** Why the last claim call was refused; cleared by the next answer. */
  refusal: { readonly kind: ReturnType<typeof claimRefusal>; readonly error: CgErrorWire } | null;
  /** The last renewal of a lease of ours did not go through; cleared by the next answer. */
  renewError: CgErrorWire | null;
  progress: LocalGreeting['progress'];
  lastActivityAt: number;
  busy: boolean;
  timer: number | null;
}

export interface NewcomersControllerDeps {
  readonly rpc: TabRpc;
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly navigator: ChatNavigator;
  /** The browser's online state; null — always online. */
  readonly connectivity: Connectivity | null;
  /** [0, 1) for the poll spread. */
  readonly random: RandomSource;
  /**
   * This tab also watches for new subscribers while the window is closed
   * (every 60 s, for the subscriber sound). Off by default: one watcher per
   * browser is enough, and the composition root decides which.
   */
  readonly watchForSound?: boolean;
  /** Subscriptions that are news (never the first snapshot or the one after a reconnect), by the hub's event id. */
  readonly onNewSubscribers?: (events: readonly { readonly eventRef: string; readonly fanRef: string }[]) => void;
  /** The saved greeting draft of a fan, if any (the preview keeps the drafts). */
  readonly draftOf?: (pageId: number, fanRef: string) => { readonly text: string; readonly threadRevision: string | null } | null;
}

export interface NewcomersController extends SurfaceController<'newcomers'> {
  readonly directory: PreviewDirectory;
  readonly greeting: GreetingDesk;
  /** Reads the list now (the background's `newcomers.changed`, a test). */
  refresh(): Promise<void>;
  /** A greeting draft was written or cleared: the rows' «есть черновик» follows. */
  draftsChanged(): void;
  /** 1.32.0: the preview that starts a batch's Hi (made after the list); a list without it has no batch. */
  attachBatch?(port: BatchPreviewPort): void;
  /** A batch of the list's own (a pass's greetings) started this generation: no toast for its end. */
  fromBatch?(opId: string): boolean;
}

export function createNewcomersController(deps: NewcomersControllerDeps): NewcomersController {
  const { rpc, host, i18n, clock, context, surfaces, navigator } = deps;

  let windowHours: number = WINDOW_HOURS.default;
  let tab: NewcomersTab = 'todo';
  let filter: GreetingFilter = 'any';
  let typed = '';
  let applied = '';
  let searchTimer: number | null = null;
  let walk: AudienceWalk = startWalk(windowHours);
  let rows: NewcomerRow[] = [];
  let loading = false;
  let loadingMore = false;
  let since: number | null = null;
  let loadedAt: number | null = null;
  let error: CgErrorWire | null = null;
  let run = 0;
  let failures = 0;
  let seen: SeenEvents = NO_SEEN_EVENTS;
  let pollTimer: number | null = null;
  let online = deps.connectivity?.online() ?? true;
  let epoch = context.current().epoch;
  let disposed = false;
  const leases = new Map<string, LeaseRecord>();
  const locks = new RowLocks();
  const deskListeners = new Set<() => void>();
  const directoryListeners = new Set<() => void>();

  /** 1.32.0: the batch of Hi; nothing is sent by it. */
  let batchPort: BatchPreviewPort | null = null;
  let offBatch: (() => void) | null = null;
  const batch = createBatch({
    clock,
    start: (handle) => (batchPort === null || own(handle) === null ? Promise.resolve({ s: 'failed', code: 'CG-CONTEXT-CHANGED' }) : batchPort.batchStart('newcomers', handle, 'hi')),
    // A fan nobody greeted, holds or is sending to — as Hi of the card would start.
    pickable: (handle) => {
      const fanRef = own(handle);
      return fanRef !== null && hiBlock(statusOf(fanRef)) === null;
    },
    live: (handle) => batchPort?.batchLive(handle) ?? null,
    changed: () => {
      if (!disposed) cell.invalidate();
    },
  });

  /** A row's batch, and the row's own «Отправить» of its ready draft (X59: the card's send by one click in the list). */
  function batchOf(handle: TargetHandle): Pick<NewcomerRowVM, 'batch' | 'send'> {
    const row = batch.row(handle);
    const send = row.state === 'ready' ? (batchPort?.batchSend?.(handle) ?? null) : null;
    return send === null ? { batch: row } : { batch: row, send };
  }

  const cell = new ViewCell(build);
  const changed = (): void => {
    if (disposed) return;
    cell.invalidate();
    for (const listener of [...directoryListeners]) listener();
    for (const listener of [...deskListeners]) listener();
  };

  const pageId = (): number | null => context.current().binding?.pageId ?? null;
  const handleOf = (fanRef: string): TargetHandle => fanHandle('newcomers', pageId() ?? 0, fanRef);
  const policy = (): LeasePolicy => leasePolicy(context.current().bootstrap?.limits);
  const limit = (): number => windowLimit(context.current().bootstrap?.limits.audienceWindowHours);
  const usable = (): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && pageFlag(ctx, 'newcomers');
  };
  const own = (handle: TargetHandle): string | null => {
    const parsed = parseFanHandle(handle);
    return parsed !== null && parsed.source === 'newcomers' && parsed.pageId === pageId() ? parsed.fanRef : null;
  };
  const rowOf = (fanRef: string): NewcomerRow | null => rows.find((row) => row.fanRef === fanRef) ?? null;

  // ── the lease ──

  function recordOf(fanRef: string): LeaseRecord {
    let record = leases.get(fanRef);
    if (record === undefined) {
      record = { view: { s: 'none' }, detail: null, refusal: null, renewError: null, progress: null, lastActivityAt: clock.now(), busy: false, timer: null };
      leases.set(fanRef, record);
    }
    return record;
  }

  const leaseOf = (fanRef: string): LeaseView => {
    const record = leases.get(fanRef);
    return record === undefined ? { s: 'none' } : leaseNow(record.view, clock.now());
  };

  /** What this tab itself knows about the fan's greeting, for the status column: the parts it sent (no lease is a status, 2026-10-22). */
  function localOf(fanRef: string): LocalGreeting {
    const record = leases.get(fanRef);
    return record === undefined ? { progress: null } : { progress: record.progress ?? progressOfClaim(record.detail) };
  }

  const NO_CLAIM = { greeting: 'none', lease: 'none', heldBy: null, custody: null } as const;

  function statusOf(fanRef: string): GreetingStatusVM {
    const row = rowOf(fanRef);
    const detail = leases.get(fanRef)?.detail ?? null;
    const confirmed = detail?.greeting.state === 'confirmed';
    const claim = row?.claim ?? NO_CLAIM;
    const fanWrote = (row?.thread?.lastFanMessageAt ?? null) !== null;
    return greetingStatus(confirmed ? { ...claim, greeting: 'confirmed' } : claim, localOf(fanRef), detail?.greeting.at ?? null, fanWrote);
  }

  function stopTimer(record: LeaseRecord): void {
    if (record.timer !== null) clock.clearTimer(record.timer);
    record.timer = null;
  }

  /** Something of this fan is in flight, or the fan's chat is the open route — for a while after the last sign of life (`shouldRenew`, BUSY_MAX_MS). */
  function working(fanRef: string, record: LeaseRecord): boolean {
    if (record.busy) return true;
    const binding = context.current().binding;
    const route = host.current().route.chat;
    return binding !== null && route !== null && chatKeyOf(route) === chatKeyOf({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: fanRef });
  }

  /**
   * One timer per lease: renew when the person works with the fan, otherwise
   * let the lease run out and say so. `retry` — the last renewal did not go
   * through: the next one comes sooner, and no later than the deadline.
   */
  function scheduleLease(fanRef: string, retry = false): void {
    const record = recordOf(fanRef);
    stopTimer(record);
    const lease = record.view;
    if (lease.s !== 'mine') return;
    const now = clock.now();
    const p = policy();
    const untilExpiry = Math.max(0, lease.until - now);
    record.timer = clock.setTimer(Math.min(retry ? RENEW_RETRY_MS : p.renewMs, untilExpiry), () => {
      record.timer = null;
      if (disposed || leases.get(fanRef) !== record) return;
      const at = clock.now();
      const current = leaseNow(record.view, at);
      if (current.s !== 'mine') {
        // The lease ran out unrenewed: «бронь истекла — нажмите Hi ещё раз».
        record.view = { s: 'expired' };
        record.renewError = null;
        changed();
        return;
      }
      if (!shouldRenew(current, { lastActivityAt: record.lastActivityAt, busy: working(fanRef, record) }, at, p)) return scheduleLease(fanRef);
      void claimCall(fanRef, 'renew').then((answer) => {
        if (disposed || leases.get(fanRef) !== record || record.timer !== null || record.view.s !== 'mine') return;
        // The renewal did not go through and the lease is still ours: it is tried again, never left to lapse in silence.
        // (Another action of this fan in flight is not a failure: its own answer decides.)
        if (!answer.ok && answer.code !== 'CG-CLAIM-ROW-BUSY' && record.renewError === null) {
          record.renewError = { code: answer.code };
          changed();
        }
        scheduleLease(fanRef, !answer.ok);
      });
    });
  }

  function applyClaim(fanRef: string, state: ClaimState, receivedAt: number): void {
    const record = recordOf(fanRef);
    record.detail = state;
    record.refusal = null;
    record.renewError = null;
    record.view = leaseOfClaim(state, receivedAt, policy());
    scheduleLease(fanRef);
  }

  /** One claim action for a fan. NF-023: a second action while one runs is refused, never queued. */
  async function claimCall(fanRef: string, action: 'claim' | 'renew' | 'release'): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: CgCode; readonly error: CgErrorView }> {
    const id = pageId();
    if (id === null || !usable()) return { ok: false, code: 'CG-FEATURE-DISABLED', error: localError('CG-FEATURE-DISABLED', i18n) };
    if (!locks.acquire(fanRef)) return { ok: false, code: 'CG-CLAIM-ROW-BUSY', error: localError('CG-CLAIM-ROW-BUSY', i18n) };
    const atEpoch = epoch;
    const record = recordOf(fanRef);
    let answer;
    try {
      answer = await rpc.request('newcomers.claim', { pageId: id, fanRef, action });
    } finally {
      locks.release(fanRef);
    }
    // NF-026: an answer for another sign-in, hub or account is nobody's.
    if (disposed || atEpoch !== epoch || leases.get(fanRef) !== record) return { ok: false, code: 'CG-CONTEXT-CHANGED', error: localError('CG-CONTEXT-CHANGED', i18n) };
    if (answer.ok) {
      applyClaim(fanRef, answer.payload, clock.now());
      changed();
      const lease = record.view;
      if (action === 'release' || lease.s === 'mine') return { ok: true };
      const code: CgCode = lease.s === 'expired' ? 'CG-CLAIM-EXPIRED' : 'CG-CLAIM-BUSY';
      return { ok: false, code, error: claimError(fanRef, code) };
    }
    noteRefusal(fanRef, answer.error);
    // A renewal that failed while the lease is still ours: the card says so (the lease's own timer tries again).
    if (action === 'renew' && record.view.s === 'mine') {
      record.renewError = answer.error;
      changed();
    }
    return { ok: false, code: answer.error.code, error: claimError(fanRef, answer.error.code, answer.error) };
  }

  /** NF-024: a refusal names the fan and the reason; the row stays. */
  function claimError(fanRef: string, code: CgCode, wire: CgErrorWire = { code }): CgErrorView {
    const view = errorOf(wire, i18n);
    if (code !== 'CG-CLAIM-BUSY') return view;
    return { ...view, title: i18n.t('cg.claimBusy.named', { fan: rowOf(fanRef)?.name ?? fanRef }), body: i18n.t('cg.claimBusy.release') };
  }

  function noteRefusal(fanRef: string, wire: CgErrorWire): void {
    const record = recordOf(fanRef);
    const kind = claimRefusal(wire.code);
    record.refusal = { kind, error: wire };
    if (kind === 'other') record.view = { s: 'other' };
    else if (kind === 'expired') record.view = { s: 'expired' };
    if (record.view.s !== 'mine') {
      stopTimer(record);
      record.renewError = null;
    }
    changed();
  }

  /**
   * What the card says of the greeting beside its result: an unknown outcome (in the words of the preview:
   * «Не подтвердилось — откройте чат»), a refusal the hub gave a send, a lease of ours an older flow took. A
   * colleague's lease or send in flight is no card any more (2026-10-22): it holds nothing here.
   */
  function claimVM(fanRef: string): ClaimVM {
    const record = leases.get(fanRef);
    const local = localOf(fanRef);
    const uncertain = local.progress?.uncertainPart ?? null;
    if (uncertain !== null) return { s: 'held-uncertain', part: uncertain + 1, error: errorOf({ code: 'CG-SEND-UNCERTAIN' }, i18n) };
    const refusal = record?.refusal ?? null;
    if (refusal !== null && refusal.kind === 'held-uncertain') return { s: 'held-uncertain', part: (progressOfClaim(record?.detail ?? null)?.uncertainPart ?? 0) + 1, error: errorOf(refusal.error, i18n) };
    if (refusal !== null && refusal.kind === 'row-changed') return { s: 'row-changed', error: errorOf(refusal.error, i18n) };
    const lease = leaseOf(fanRef);
    const handle = handleOf(fanRef);
    switch (lease.s) {
      case 'mine': {
        const mine = { s: 'mine', until: lease.until, renew: button('newcomers.claim.renew', { type: 'RenewClaim', targetHandle: handle }), release: button('newcomers.claim.release', { type: 'ReleaseClaim', targetHandle: handle }) } as const;
        const failed = record?.renewError ?? null;
        return failed === null ? mine : { ...mine, renewError: errorOf(failed, i18n) };
      }
      // The hub refused a send: an older client of a colleague holds the fan.
      case 'other':
        return { s: 'other', error: claimError(fanRef, 'CG-CLAIM-BUSY') };
      case 'expired':
        return { s: 'expired', error: errorOf({ code: 'CG-CLAIM-EXPIRED' }, i18n) };
      // This person's lease in another tab holds nothing here; what the list knows of leases is no card either.
      case 'elsewhere':
      case 'none':
        return { s: 'none' };
    }
  }

  const greeting: GreetingDesk = {
    // 2026-10-20 audit, row 11: Generate takes no lease — the hub claims the fan at «Отправить» (as the old clients did).
    claimForGenerate(fanRef) {
      const block = hiBlock(statusOf(fanRef));
      // §6.7.9: once a part is confirmed the fan is greeted — another generation would be a second greeting.
      if (block === 'greeted') return Promise.resolve({ ok: false, code: 'CG-GATE-HI', error: localError('CG-GATE-HI', i18n) });
      if (block === 'sending') return Promise.resolve({ ok: false, code: 'CG-SEND-BUSY', error: localError('CG-SEND-BUSY', i18n) });
      recordOf(fanRef).lastActivityAt = clock.now();
      return Promise.resolve({ ok: true, taken: false });
    },
    giveBack: () => undefined,
    // A greeting goes with no lease token: the hub admits it at the send.
    leaseToken: () => null,
    claim: claimVM,
    greeting: statusOf,
    hiBlocked(fanRef) {
      const block = hiBlock(statusOf(fanRef));
      if (block === null) return null;
      if (block === 'sending') return reason('parts-sending');
      // X5: a part of the greeting is confirmed — no second greeting; the reason says it in its own words.
      return reason('hi-greeted');
    },
    threadRevision(fanRef) {
      const row = rowOf(fanRef);
      return row === null ? null : threadRevision(row);
    },
    noteProgress(fanRef, progress) {
      const record = recordOf(fanRef);
      record.progress = progress;
      changed();
    },
    touch(fanRef, busy) {
      const record = recordOf(fanRef);
      record.lastActivityAt = clock.now();
      record.busy = busy;
    },
    noteRefusal(fanRef, code) {
      noteRefusal(fanRef, { code });
    },
    subscribe(listener) {
      deskListeners.add(listener);
      return () => {
        deskListeners.delete(listener);
      };
    },
  };

  // ── the list ──

  /** One page behind `cursor` into `into`; null — the read failed or was overtaken. */
  async function page(into: AudienceWalk, cursor: string | null, mine: number): Promise<AudienceWalk | CgErrorWire | null> {
    const id = pageId();
    if (id === null) return null;
    const atEpoch = epoch;
    const answer = await rpc.request('newcomers.list', { pageId: id, windowHours: into.windowHours, cursor });
    if (disposed || atEpoch !== epoch || mine !== run) return null;
    if (!answer.ok) return answer.error;
    const step = appendAudiencePage(into, cursor, answer.payload);
    return step.kind === 'appended' ? step.walk : null;
  }

  /** A new pass from the first page, as deep as the list on screen; the rows swap when it is whole (NF-004). */
  async function refresh(): Promise<void> {
    if (!usable()) return;
    const mine = ++run;
    const depth = Math.max(1, walk.windowHours === windowHours ? walk.pages : 1);
    loading = true;
    since = clock.now();
    cell.invalidate();
    let next: AudienceWalk = startWalk(windowHours);
    let failed: CgErrorWire | null = null;
    for (let i = 0; i < depth; i += 1) {
      const cursor = i === 0 ? null : next.nextCursor;
      if (i > 0 && cursor === null) break;
      const step = await page(next, cursor, mine);
      if (step === null) {
        if (disposed || mine !== run) return;
        break;
      }
      if ('code' in step) {
        failed = step;
        break;
      }
      next = step;
    }
    if (disposed || mine !== run) return;
    loading = false;
    since = null;
    if (failed !== null || !next.started) {
      error = failed ?? { code: 'CG-DATA-UNAVAILABLE' };
      failures += 1;
      // A failed poll is a reconnect: the next snapshot is not news (SN-012).
      seen = unprime(seen);
    } else {
      walk = next;
      rows = next.items.map(newcomerRow);
      error = null;
      failures = 0;
      loadedAt = clock.now();
      pruneLeases();
      const observed = observeEvents(seen, next.items.map((item) => item.eventRef));
      seen = observed.seen;
      if (observed.fresh.length > 0 && deps.onNewSubscribers !== undefined) {
        const fresh = new Set(observed.fresh);
        deps.onNewSubscribers(next.items.filter((item) => fresh.has(item.eventRef)).map((item) => ({ eventRef: item.eventRef, fanRef: item.fanRef })));
      }
    }
    changed();
    schedulePoll();
  }

  /** Lease records of fans that left the list and hold nothing any more are dropped (the map does not grow with every card ever opened). */
  function pruneLeases(): void {
    const listed = new Set(rows.map((row) => row.fanRef));
    const now = clock.now();
    const open = surfaces.current().preview.newcomers;
    const selected = open === null ? null : own(open);
    for (const [fanRef, record] of leases) {
      if (listed.has(fanRef) || fanRef === selected || record.timer !== null || record.busy || record.progress !== null || locks.has(fanRef) || leaseNow(record.view, now).s === 'mine') continue;
      leases.delete(fanRef);
    }
  }

  async function loadMore(): Promise<void> {
    if (loading || loadingMore || !walkHasMore(walk)) return;
    const mine = run;
    loadingMore = true;
    cell.invalidate();
    const step = await page(walk, walk.nextCursor, mine);
    loadingMore = false;
    if (disposed || mine !== run) return;
    if (step !== null && 'code' in step) error = step;
    else if (step !== null) {
      walk = step;
      rows = step.items.map(newcomerRow);
      seen = observeEvents(seen, step.items.map((item) => item.eventRef)).seen;
    }
    changed();
  }

  function stopPoll(): void {
    if (pollTimer !== null) clock.clearTimer(pollTimer);
    pollTimer = null;
  }

  function schedulePoll(resume = false): void {
    stopPoll();
    if (disposed || !usable()) return;
    const mode = pollMode({ windowOpen: surfaces.current().newcomers, liveTab: deps.watchForSound === true, soundOn: context.current().settings?.sound.subscribers.on ?? false });
    const delay = resume ? resumeDelay(deps.random()) : nextPollDelay({ mode, online, failures }, deps.random());
    if (delay === null || mode === 'off') return;
    pollTimer = clock.setTimer(delay, () => {
      pollTimer = null;
      void refresh();
    });
  }

  function reset(): void {
    run += 1;
    stopPoll();
    for (const record of leases.values()) stopTimer(record);
    leases.clear();
    locks.clear();
    windowHours = clampWindow(WINDOW_HOURS.default, limit());
    walk = startWalk(windowHours);
    rows = [];
    loading = false;
    loadingMore = false;
    since = null;
    loadedAt = null;
    error = null;
    failures = 0;
    seen = NO_SEEN_EVENTS;
    tab = 'todo';
    filter = 'any';
    typed = '';
    applied = '';
    if (searchTimer !== null) clock.clearTimer(searchTimer);
    searchTimer = null;
  }

  // ── view model ──

  function contextView(ctx: PageContextState): VmView | null {
    const retry: UiAction = { type: 'ReloadView', selector: SELECTOR };
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, retry);
    if (!pageFlag(ctx, 'newcomers')) return failureView(flagFailure(ctx, 'newcomers'), i18n, retry);
    return null;
  }

  /** «48 часов», «7 дней»: the window in the words of the hint and the footer. */
  function windowText(hours: number): string {
    return hours >= 96 && hours % 24 === 0 ? i18n.plural('common.days', hours / 24) : i18n.plural('common.hours', hours);
  }

  function build(): NewcomersVM {
    const ctx = context.current();
    const id = ctx.binding?.pageId ?? null;
    const selected = (() => {
      const handle = surfaces.current().preview.newcomers;
      return handle === null ? null : own(handle);
    })();
    const statuses = new Map(rows.map((row) => [row.fanRef, statusOf(row.fanRef)]));
    const status = (row: NewcomerRow): GreetingStatusVM => statuses.get(row.fanRef) ?? { s: 'none' };
    const searched = rows.filter((row) => matchesSearch(row, applied));
    const inThisTab = searched.filter((row) => inTab(status(row), tab));
    const visible = inThisTab.filter((row) => passesFilter(status(row), filter));

    const rowVMs: NewcomerRowVM[] = visible.map((row) => {
      const draft = id === null ? null : (deps.draftOf?.(id, row.fanRef) ?? null);
      return {
        handle: fanHandle('newcomers', id ?? 0, row.fanRef),
        name: row.name,
        username: row.username,
        kind: row.kind,
        subscribedAt: row.subscribedAt,
        greeting: status(row),
        hasDraft: draft !== null,
        draftStale: draft !== null && draftStale(draft.threadRevision, threadRevision(row)),
        selected: row.fanRef === selected,
        ...(batchPort === null ? {} : batchOf(fanHandle('newcomers', id ?? 0, row.fanRef))),
      };
    });

    let view: VmView;
    const blocked = contextView(ctx);
    if (blocked !== null) view = blocked;
    else if (!walk.started) view = error !== null ? failureView(error, i18n, { type: 'ReloadView', selector: SELECTOR }) : loadingView(since, msg('common.loading'));
    else {
      const gaps: PartialGap[] = [];
      if (walk.coverage !== 'complete') gaps.push({ kind: 'coverage', level: walk.coverage });
      if (walk.truncated) gaps.push({ kind: 'truncated', shown: walk.items.length, total: null });
      if (!online) view = failureView({ code: 'CG-NETWORK' }, i18n, { type: 'ReloadView', selector: SELECTOR }, loadedAt);
      else if (error !== null) {
        view = failureClass(error.code) === 'error' ? dataView([...gaps, { kind: 'source-failed', source: 'newcomers', code: error.code }]) : failureView(error, i18n, { type: 'ReloadView', selector: SELECTOR }, loadedAt);
      } else if (rows.length === 0) view = { s: 'empty', why: msg('common.empty') };
      else if (rowVMs.length === 0) view = { s: 'empty', why: msg('spenders.empty') };
      else view = dataView(gaps);
    }

    return {
      view,
      pageName: ctx.page?.title ?? null,
      personaLabel: ctx.persona?.label ?? null,
      tab,
      tabs: TABS.map((t) => ({ id: t, label: msg(TAB_LABELS[t]), count: walk.started ? searched.filter((row) => inTab(status(row), t)).length : null })),
      windowHours,
      windowOptions: windowOptions(limit()),
      filters: FILTERS.map((f) => ({ id: f, label: msg(FILTER_LABELS[f]), count: walk.started ? inThisTab.filter((row) => passesFilter(status(row), f)).length : null, pressed: f === filter })),
      query: typed,
      rows: rowVMs,
      cardOpen: surfaces.current().preview.newcomers !== null,
      scan: loading || loadingMore ? { stage: msg('common.loading'), done: walk.started ? walk.items.length : null, total: null } : null,
      // The reason only: the window prints the title «Результат неполный» (`newcomers.incomplete`) itself.
      incomplete: walkIncomplete(walk) ? msg('newcomers.incomplete.body') : null,
      footer: { count: rows.length, stamp: stamp(walk.snapshotAt, walk.coverage) },
      canLoadMore: walkHasMore(walk) && !loading && !loadingMore,
      hint: msg('newcomers.hint', { window: windowText(windowHours) }),
      noAutoSend: msg('newcomers.noAutoSend'),
      ...(batchPort === null ? {} : { batch: batch.vm(pageFlag(ctx, 'preview') ? null : flagReasonVm(pageFlagOf(ctx, 'preview')).text) }),
    };
  }

  // ── directory ──

  const directory: PreviewDirectory = {
    resolve(handle) {
      const fanRef = own(handle);
      const id = pageId();
      const row = fanRef === null ? null : rowOf(fanRef);
      if (row === null || id === null) return null;
      const info: PreviewTargetInfo = {
        handle,
        source: 'newcomers',
        pageId: id,
        fanRef: row.fanRef,
        name: row.name,
        username: row.username,
        // A new subscriber's money is not on this list: unknown, not zero.
        lifetime: null,
        period30: null,
        weWroteAt: row.thread?.lastModelMessageAt ?? null,
        fanWroteAt: row.thread?.lastFanMessageAt ?? null,
        newcomer: { kind: row.kind, subscribedAt: row.subscribedAt },
      };
      return info;
    },
    neighbours(handle) {
      const fanRef = own(handle);
      const order = cell.get().rows.map((row) => row.handle);
      const at = fanRef === null ? -1 : order.indexOf(handle);
      if (at < 0) return { previous: null, next: null };
      return { previous: order[at - 1] ?? null, next: order[at + 1] ?? null };
    },
    subscribe(listener) {
      directoryListeners.add(listener);
      return () => {
        directoryListeners.delete(listener);
      };
    },
  };

  // ── actions ──

  async function openChat(type: UiActionType, fanRef: string): Promise<ActionReceipt> {
    const binding = context.current().binding;
    if (binding === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    // The person's click on this fan in «Новые»: the list's own switch on its page, not `navigation`.
    const receipt = await navigator.open({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: fanRef }, 'newcomers', ['newcomers']);
    if (receipt.state === 'failed') return refused(type, localError(receipt.code, i18n));
    surfaces.closeBoards();
    return done(type, 'opened');
  }

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    const type = action.type;
    if (isBatchAction(action)) {
      if (action.list !== 'newcomers' || batchPort === null) return null;
      return Promise.resolve(batchDispatch(batch, action, (handle) => own(handle) !== null));
    }
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind === 'surface' && to.surface === 'newcomers') {
        surfaces.setList('newcomers', to.open);
        return Promise.resolve(done(type, to.open ? 'opened' : 'done'));
      }
      if (to.kind === 'chat') {
        const fanRef = own(to.targetHandle);
        return fanRef === null ? null : openChat(type, fanRef);
      }
      return null;
    }
    if (action.type === 'SetNewcomersTab') {
      tab = action.tab;
      changed();
      return Promise.resolve(done(type));
    }
    if (action.type === 'SetNewcomersFilter') {
      filter = action.filter;
      changed();
      return Promise.resolve(done(type));
    }
    if (action.type === 'SetNewcomersWindow') {
      const hours = clampWindow(action.hours, limit());
      if (hours === windowHours) return Promise.resolve(done(type, 'noop'));
      // A cursor is never continued with another window: the new window is a new pass from the first page.
      windowHours = hours;
      walk = startWalk(hours);
      rows = [];
      error = null;
      seen = NO_SEEN_EVENTS;
      changed();
      return refresh().then(() => done(type));
    }
    if (action.type === 'Search') {
      if (action.list !== 'newcomers') return null;
      typed = action.query;
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = clock.setTimer(NEWCOMERS_SEARCH_DEBOUNCE_MS, () => {
        searchTimer = null;
        if (applied === typed) return;
        applied = typed;
        changed();
      });
      cell.invalidate();
      return Promise.resolve(done(type));
    }
    if (action.type === 'ResetFilters') {
      if (action.list !== 'newcomers') return null;
      filter = 'any';
      typed = '';
      applied = '';
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = null;
      changed();
      return Promise.resolve(done(type));
    }
    if (action.type === 'LoadMore') {
      if (action.list !== 'newcomers') return null;
      if (!walkHasMore(walk)) return Promise.resolve(done(type, 'noop'));
      return loadMore().then(() => done(type));
    }
    if (action.type === 'RenewClaim' || action.type === 'ReleaseClaim') {
      const fanRef = own(action.targetHandle);
      if (fanRef === null) return parseFanHandle(action.targetHandle)?.source === 'newcomers' ? Promise.resolve(refused(type, localError('CG-CONTEXT-CHANGED', i18n))) : null;
      recordOf(fanRef).lastActivityAt = clock.now();
      if (action.type === 'ReleaseClaim') {
        if (leaseOf(fanRef).s !== 'mine') return Promise.resolve(done(type, 'noop'));
        return claimCall(fanRef, 'release').then((answer) => (answer.ok ? done(type) : refused(type, answer.error)));
      }
      return claimCall(fanRef, leaseOf(fanRef).s === 'mine' ? 'renew' : 'claim').then((answer) => (answer.ok ? done(type) : refused(type, answer.error)));
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'newcomers') return null;
      const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
      return reads.then(() => refresh()).then(() => done(type));
    }
    return null;
  }

  // ── subscriptions ──

  const offs: (() => void)[] = [
    context.subscribe((state) => {
      if (state.epoch !== epoch) {
        // NF-026: another sign-in, hub or account — the list, the leases and the pass in flight are dropped.
        epoch = state.epoch;
        reset();
        batch.reset();
        surfaces.setList('newcomers', false);
      } else windowHours = clampWindow(windowHours, limit());
      changed();
      if (surfaces.current().newcomers && !walk.started && !loading && error === null) void refresh();
      else schedulePoll();
    }),
    surfaces.subscribe((state, previous) => {
      if (state.newcomers && !previous.newcomers) {
        // The window opened: read now, then every 30 s.
        void refresh();
      } else if (!state.newcomers && previous.newcomers) {
        // Closing the window cancels the pass in flight (NF-026).
        run += 1;
        loading = false;
        loadingMore = false;
        if (searchTimer !== null) clock.clearTimer(searchTimer);
        searchTimer = null;
        applied = typed;
        schedulePoll();
      }
      if (state.newcomers !== previous.newcomers || state.preview.newcomers !== previous.preview.newcomers) {
        const opened = state.preview.newcomers === null ? null : own(state.preview.newcomers);
        if (opened !== null) recordOf(opened).lastActivityAt = clock.now();
        cell.invalidate();
      }
    }),
    i18n.subscribe(() => changed()),
    host.subscribe((event: HostEvent) => {
      // After «Открыть и вставить» the person works in the fan's own chat: typing there is working with the fan (the open chat alone is not).
      if (event.type !== 'composer' || event.composer === null) return;
      const chat = event.composer.chat;
      if (chat.hostAccountId !== context.current().binding?.hostAccountId) return;
      const record = leases.get(chat.platformFanId);
      if (record !== undefined) record.lastActivityAt = clock.now();
    }),
    rpc.onEvent('newcomers.changed', (payload) => {
      if (payload.pageId === pageId() && (surfaces.current().newcomers || deps.watchForSound === true) && !loading) void refresh();
    }),
  ];
  if (deps.connectivity !== null) {
    offs.push(
      deps.connectivity.subscribe((next) => {
        if (next === online) return;
        online = next;
        if (!next) {
          // Offline: no polls until the browser is back.
          stopPoll();
        } else {
          // Back online is a reconnect: the next snapshot is silent, and its poll is spread out.
          seen = unprime(seen);
          schedulePoll(true);
        }
        cell.invalidate();
      }),
    );
  }
  schedulePoll();

  return {
    kinds: ['newcomers'],
    getSnapshot: () => cell.get(),
    subscribe: (_selector, listener) => cell.subscribe(listener),
    dispatch,
    directory,
    greeting,
    refresh,
    draftsChanged() {
      if (!disposed) cell.invalidate();
    },
    attachBatch(port) {
      offBatch?.();
      batchPort = port;
      offBatch = port.onBatch(() => {
        if (!disposed) cell.invalidate();
      });
      cell.invalidate();
    },
    dispose() {
      disposed = true;
      offBatch?.();
      batch.dispose();
      for (const off of offs) off();
      stopPoll();
      for (const record of leases.values()) stopTimer(record);
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      deskListeners.clear();
      directoryListeners.clear();
      cell.clear();
    },
  };
}
