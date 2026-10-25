// «Очередь» of the fan panel (Chat Memory week 3, hub plan week-3 §5): the page of the open tab, whatever chat is
// open — it stays as it is when a chat opens.
// - «Ждут»: every fan who wrote in 30 days and is not answered yet (`spenders.queue` with `everyone`; a mass message is
//   no answer), the longest wait first among the payers.
// - «Вернуть» (`win-back-v1`): a few fans to win back with the reason, and the owner's approaches as chips: a tap
//   records the pick (one call, never repeated) and the fan leaves the list. Nothing is sent: the chatter writes.
// - «Передача» (`handoff-v1`): whom the team wrote to in 12 hours, who waits, the open promises.
// Only the shown tab is read, and only while the panel shows «Очередь»: then again every 30 s ± 10 %, slower after
// failures, as «Новые» polls (domain/newcomers/poll.ts). A row opens the fan's chat through the tab's own navigation.

import { type CgErrorWire } from '@cg/contracts/errors';
import { hasCapability, type Handoff, type QueuePage, type WinBackList } from '@cg/contracts/hub';
import { type ActionReceipt, type I18n, type QueueCustomVM, type QueueFanVM, type QueueTab, type QueueVM, type QueueWaitingVM, type UiAction, type VmView } from '@cg/contracts/vm';

import { queueName, winBackReason } from '../../domain/fanpanel/queue';
import { POLL_OPEN_MS, nextPollDelay } from '../../domain/newcomers/poll';
import { type PageContextPort, pageFlag } from '../boards/context';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { done, refused } from '../boards/surface';
import { dataView, errorOf, failureView, loadingView, msg } from '../boards/views';
import { chatHandle } from '../navigation/chat-handle';

/** Rows of «Ждут»: a shift's worth; the total says how many more. */
export const QUEUE_WAITING_ROWS = 50;

const SELECTOR = { of: 'fan-panel' } as const;

interface List<T> {
  data: T | null;
  error: CgErrorWire | null;
  loading: boolean;
  since: number | null;
  loadedAt: number | null;
  /** When the list is read again while it is shown. */
  nextAt: number;
  failures: number;
  run: number;
}

const list = <T>(): List<T> => ({ data: null, error: null, loading: false, since: null, loadedAt: null, nextAt: 0, failures: 0, run: 0 });

export interface QueuePanelDeps {
  readonly rpc: TabRpc;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly i18n: I18n;
  readonly changed: () => void;
  /** [0, 1); the poll's spread. */
  readonly random?: () => number;
}

export interface QueuePanel {
  /** The panel shows «Очередь» now: the shown tab is read when due and polled; false stops the polling. */
  setActive(active: boolean): void;
  /** Absent — the page has no fan panel (no tab). */
  view(): QueueVM | undefined;
  dispatch(action: UiAction): Promise<ActionReceipt> | null;
  /** «Повторить» of the shown tab. */
  reload(): void;
  /** Another page, or the context read anew: nothing of the old page is shown. */
  reset(): void;
  dispose(): void;
}

export function createQueuePanel(deps: QueuePanelDeps): QueuePanel {
  const { rpc, clock, context, i18n, changed } = deps;
  const random = deps.random ?? Math.random;
  let tab: QueueTab = 'waiting';
  let active = false;
  let pageId: number | null = null;
  let waiting = list<QueuePage>();
  let winBack = list<WinBackList>();
  let handoff = list<Handoff>();
  /** Picks on their way, by fan. */
  const picking = new Set<string>();
  let picked: NonNullable<QueueVM['winBack']>['picked'] = null;
  let pickError: CgErrorWire | null = null;
  let timer: number | null = null;
  let disposed = false;

  const served = (capability: 'win-back-v1' | 'handoff-v1'): boolean => {
    const bootstrap = context.current().bootstrap;
    return bootstrap !== null && hasCapability(bootstrap.capabilities, capability);
  };
  const tabs = (): QueueTab[] => ['waiting', ...(served('win-back-v1') ? (['winback'] as const) : []), ...(served('handoff-v1') ? (['handoff'] as const) : [])];
  const shown = (): QueueTab => (tabs().includes(tab) ? tab : 'waiting');
  const listOf = (of: QueueTab): List<unknown> => (of === 'waiting' ? waiting : of === 'winback' ? winBack : handoff);

  function stop(): void {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  }

  function reset(): void {
    waiting = list();
    winBack = list();
    handoff = list();
    picking.clear();
    picked = null;
    pickError = null;
  }

  /** The page the panel reads: the context's, when the panel's switch is on. */
  function page(): number | null {
    const ctx = context.current();
    if (ctx.phase !== 'ready' || !pageFlag(ctx, 'fanPanel')) return null;
    return ctx.binding?.pageId ?? null;
  }

  async function read<T>(target: List<T>, ask: (pageId: number) => Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire }>): Promise<void> {
    const id = page();
    if (id === null) return;
    const run = ++target.run;
    target.loading = true;
    target.since = clock.now();
    changed();
    const answer = await ask(id);
    if (disposed || target.run !== run || pageId !== id) return;
    target.loading = false;
    target.since = null;
    if (answer.ok) {
      target.data = answer.payload;
      target.error = null;
      target.loadedAt = clock.now();
      target.failures = 0;
    } else {
      target.error = answer.error;
      target.failures += 1;
    }
    target.nextAt = clock.now() + (nextPollDelay({ mode: 'open', online: true, failures: target.failures }, random()) ?? POLL_OPEN_MS);
    changed();
  }

  function load(of: QueueTab): Promise<void> {
    if (of === 'waiting') return read(waiting, (id) => rpc.request('spenders.queue', { pageId: id, cursor: null, limit: QUEUE_WAITING_ROWS, everyone: true }));
    if (of === 'winback') return read(winBack, (id) => rpc.request('queue.winback', { pageId: id }));
    return read(handoff, (id) => rpc.request('queue.handoff', { pageId: id }));
  }

  /** Reads the shown tab when it is due, then waits for its next read. */
  function tick(): void {
    stop();
    if (disposed || !active) return;
    const id = page();
    if (id !== pageId) {
      pageId = id;
      reset();
    }
    if (id === null) return;
    const of = shown();
    const target = listOf(of);
    if (target.loading) return;
    const wait = target.nextAt - clock.now();
    if (wait <= 0) {
      void load(of).then(tick);
      return;
    }
    timer = clock.setTimer(wait, tick);
  }

  /** The fan's chat in this tab, the panel left open; null — the tab is bound to no account. */
  function openOf(fanRef: string, conversationRef: string | null | undefined): UiAction | null {
    const account = context.current().binding?.hostAccountId;
    if (account === undefined) return null;
    return { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle({ hostAccountId: account, platformFanId: fanRef }, conversationRef ?? undefined) } };
  }

  const handleOf = (fanRef: string): string => `queue:${String(pageId ?? 0)}:${fanRef}`;
  const spentOf = (mills: number): number | null => (mills > 0 ? mills : null);

  function fanOf(row: { readonly fanRef: string; readonly conversationRef?: string | null | undefined; readonly alias?: string | null | undefined; readonly displayName?: string | null | undefined; readonly username: string | null }, mills: number | null): QueueFanVM {
    return { key: row.fanRef, handle: handleOf(row.fanRef), ...queueName(row), spent: mills === null ? null : spentOf(mills), open: openOf(row.fanRef, row.conversationRef) };
  }

  function stateView<T>(target: List<T>, empty: boolean, why: Parameters<typeof msg>[0]): VmView {
    const retry: UiAction = { type: 'ReloadView', selector: SELECTOR };
    if (target.data === null) return target.error !== null ? failureView(target.error, i18n, retry) : loadingView(target.since);
    if (target.error !== null) return failureView(target.error, i18n, retry, target.loadedAt);
    if (empty) return { s: 'empty', why: msg(why) };
    return dataView(target.loading ? [{ kind: 'stale-cache', asOf: new Date(target.loadedAt ?? clock.now()).toISOString() }] : []);
  }

  function view(): QueueVM | undefined {
    const ctx = context.current();
    if (ctx.binding === null || (ctx.phase === 'ready' && !pageFlag(ctx, 'fanPanel'))) return undefined;
    const of = shown();
    const now = clock.now();
    const waitingRows: QueueWaitingVM[] = (waiting.data?.items ?? []).map((row) => ({ ...fanOf(row, row.lifetimeGrossMills), since: row.lastFanMessageAt }));
    const approaches = winBack.data?.approaches ?? [];
    const winBackRows = (winBack.data?.items ?? []).map((row) => ({
      ...fanOf(row, row.lifetimeGrossMills),
      reason: winBackReason(row.reason, row.reasonAt, now),
      approaches: approaches.map((approach) => ({ id: approach.id, label: approach.label, pick: { type: 'PickWinBack', fanRef: row.fanRef, approachId: approach.id } as const })),
      busy: picking.has(row.fanRef),
    }));
    const recent = (handoff.data?.recent ?? []).map((row) => ({ ...fanOf(row, null), lastSentAt: row.lastSentAt, messages: row.messages, chatters: row.chatters, inConversation: row.inConversation }));
    const handoffWaiting = (handoff.data?.waiting.head ?? []).map((row) => ({ ...fanOf(row, row.lifetimeGrossMills), since: row.lastFanMessageAt }));
    // A promise names its fan when a row of the handoff does.
    const names = new Map([...handoffWaiting, ...recent].map((row) => [row.key, row.name]));
    const customs = handoff.data?.customs?.map((custom): QueueCustomVM => ({
      key: `${custom.fanRef}:${custom.createdAt}`,
      description: custom.description,
      state: custom.state === 'ordered' || custom.state === 'paid' ? custom.state : null,
      paidAt: custom.paidAt,
      createdAt: custom.createdAt,
      name: names.get(custom.fanRef) ?? null,
      open: openOf(custom.fanRef, custom.conversationRef),
    }));
    const promises = (handoff.data?.promises ?? []).map((promise) => ({
      key: `${promise.fanRef}:${promise.messageRef}`,
      text: promise.text,
      at: promise.messageAt,
      name: names.get(promise.fanRef) ?? null,
      open: openOf(promise.fanRef, promise.conversationRef),
    }));
    const blocked = ctx.phase === 'blocked' ? (ctx.blocker ?? { code: 'CG-UNKNOWN' as const }) : null;
    const shownView: VmView =
      blocked !== null
        ? failureView(blocked, i18n, { type: 'ReloadView', selector: SELECTOR })
        : ctx.phase === 'loading'
          ? loadingView(null)
          : of === 'waiting'
            ? stateView(waiting, waitingRows.length === 0, 'queue.waiting.none')
            : of === 'winback'
              ? stateView(winBack, winBackRows.length === 0 && picked === null, 'queue.winback.none')
              : stateView(handoff, false, 'queue.waiting.none');
    return {
      tab: of,
      tabs: tabs(),
      view: shownView,
      waiting: waiting.data === null ? null : { total: waiting.data.total, rows: waitingRows },
      winBack: winBack.data === null ? null : { rows: winBackRows, picked },
      handoff: handoff.data === null ? null : { recent, waitingTotal: handoff.data.waiting.total, waiting: handoffWaiting, promises, ...(customs === undefined ? {} : { customs }) },
      error: pickError === null ? null : errorOf(pickError, i18n),
    };
  }

  /** «Вернуть»: the pick of an approach — one call, never repeated; the fan leaves the list with its answer. */
  async function pick(fanRef: string, approachId: number): Promise<ActionReceipt> {
    const id = page();
    const row = winBack.data?.items.find((item) => item.fanRef === fanRef);
    const approach = winBack.data?.approaches.find((item) => item.id === approachId);
    if (id === null || row === undefined || approach === undefined || picking.has(fanRef)) return done('PickWinBack', 'noop');
    picking.add(fanRef);
    pickError = null;
    changed();
    const answer = await rpc.request('queue.winback.pick', { pageId: id, fanRef, approachId });
    picking.delete(fanRef);
    if (disposed || pageId !== id) return done('PickWinBack', 'noop');
    if (answer.ok) {
      // A read of the list on its way began before this pick: its answer is older than this one.
      winBack.run += 1;
      winBack.loading = false;
      winBack.since = null;
      winBack.data = answer.payload.list;
      winBack.loadedAt = clock.now();
      picked = { name: queueName(row).name, approach: approach.label, open: openOf(row.fanRef, row.conversationRef) };
    } else {
      pickError = answer.error;
      // «not_listed» / «approach_inactive»: the list moved — read it again.
      winBack.nextAt = 0;
    }
    changed();
    tick();
    return answer.ok ? done('PickWinBack') : refused('PickWinBack', errorOf(answer.error, i18n));
  }

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    if (action.type === 'SetQueueTab') {
      if (tab !== action.tab) {
        tab = action.tab;
        pickError = null;
        changed();
        tick();
      }
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'PickWinBack') return pick(action.fanRef, action.approachId);
    return null;
  }

  return {
    setActive(next) {
      // Called again on every change of the context too: a page that became readable is read now.
      active = next;
      tick();
    },
    view,
    dispatch,
    reload() {
      const target = listOf(shown());
      target.nextAt = 0;
      tick();
    },
    reset() {
      pageId = null;
      reset();
      tick();
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
