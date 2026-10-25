// «Новые» checked by a background pass, as a surface controller (R20 P10a; docs/project-unite/architecture.md §8.7,
// §8.17; FS-NEW-1; NF-001…NF-011, NF-025…NF-027, FX-017): the view `newcomers` — the shared `NewcomersVM` with its
// `pass` — over a source port (./source.ts) a site implements over its own messages. It opens the pass when the window
// opens (NF-004), reads its rows a page at a time (NF-006), hears the rows that change as the background tells them —
// never a poll —, filters, searches, keeps the selected fan's card with the conversation as the pass read it, up to
// the source's cap (NF-009, NF-010), and gives the way into the fan's chat as an address the person opens in a new
// tab, so the window stays (NF-011). A failed read is a failed list, never «nobody new» (FX-017).
//
// The identity guard (NF-026): another sign-in, hub, account or binding — the context's epoch — and another period end
// everything in flight: late answers and changes of the old pass are dropped, the pass is let go. A pass of another
// account is nobody's here. A closed window only lets the background's work stand: what it showed waits for the next
// open, which goes on with the same pass (the owner, 2026-10-23).
//
// R20 P10b1, NF-038: the queue's buttons — «Пауза», «Проверить оставшихся» (`SetNewcomersPassRunning`), «Проверить
// следующим» / «Проверить чат» (`CheckNewcomerNext`) — ask the source; what changed comes back as the pass's changes.
// R20 P10b2, FS-NEW-2: «Исключить из очереди» / «Вернуть в очередь» (`ExcludeNewcomer`) of a fan nobody can write to,
// the same way: one request, the row comes back as the pass's change (and leaves «К обработке» or returns).
//
// R20 P10c (FS-NEW-3, FS-NEW-6, FS-NEW-7): the card's greeting — the draft, «Сгенерировать», «Отправить», «Открыть и
// вставить» — is ./greeting.ts over the source's greeting port; this controller hands it the card and its actions.
// X59 (the owner, 2026-10-18): the period opens on the one the person chose last (the site remembers it, 12 hours
// before any choice); a row with a batch's draft has its own «Отправить» — the card's send by one click in the list,
// with all of its checks (`NewcomerRowVM.send`): generate for many at once, send each by a click.
// It names no site; the hub's list (ChatSpace) is ./controller.ts.

import { isCgCode, type CgCode, type CgErrorView } from '@cg/contracts/errors';
import {
  NEWCOMER_CHECK_FILTERS,
  type ActionReceipt,
  type GreetingStatusVM,
  type I18n,
  type NewcomerCardVM,
  type NewcomerCheckFilter,
  type NewcomerHistoryVM,
  type NewcomerMessageVM,
  type NewcomerRowVM,
  type NewcomersFailureVM,
  type NewcomersPassStage,
  type NewcomersPassVM,
  type NewcomersTab,
  type NewcomersVM,
  type PartialGap,
  type TargetHandle,
  type UiAction,
  type VmView,
} from '@cg/contracts/vm';

import { filterLeavesTodo, historyReadable, placePassPage, prependHistory, writable } from '../../domain/newcomers/pass';
import { parseFanHandle } from '../boards/handles';
import { type PageContextPort, type PageContextState, flagFailure, pageFlag } from '../boards/context';
import { issueCause } from '../boards/navigate';
import { type BoardsClock } from '../boards/ports';
import { type GreetingDesk, type PreviewDirectory, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused } from '../boards/surface';
import { dataView, failureView, loadingView, localError, msg, reason, stamp } from '../boards/views';
import { type GreetCardAnswer, type GreetedChat, type NewcomersController } from './controller';
import { batchDispatch, createBatch, isBatchAction } from '../boards/batch';
import { createCardGreeting, type PassGreetingDeps } from './greeting';
import { type NewcomersPassSource, type PassChange, type PassCounts, type PassQuery, type PassRow, type PassState } from './source';

/** The search waits this long after the last keystroke, as on the hub's list. */
export const PASS_SEARCH_DEBOUNCE_MS = 150;
/**
 * A greeting reminder's «Hi» waits this long for the pass to list and check its fan — inside the click's deferred greet
 * grant (the tab's action gate, 2026-10-25: a window opened cold checks its first fans in tens of seconds); a fan not
 * checked by then stays on the card for the person's own Hi.
 */
export const GREET_CARD_WAIT_MS = 45_000;
/** A reminder's Hi that leaves the fan's card to the person. */
const ON_CARD: GreetCardAnswer = { s: 'card' };
/** Conversations kept in the tab at once (up to 750 messages each): the fans looked at last; an older one is read again. */
export const PASS_HISTORIES_KEPT = 12;

const SELECTOR = { of: 'newcomers' } as const;
const RELOAD: UiAction = { type: 'ReloadView', selector: SELECTOR };
const TABS = ['todo', 'all'] as const satisfies readonly NewcomersTab[];
const HANDLE = /^pass:([0-9a-f-]{36}):([1-9]\d{0,29})$/;

export interface PassNewcomersDeps {
  readonly source: NewcomersPassSource;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  /** R20 P10c: what the card's greeting needs of the tab (its port, the host, ids, the site's verdict); absent — no greeting. */
  readonly greeting?: PassGreetingDeps;
}

/** The selected fan's conversation, per pass. */
interface History {
  s: 'loading' | 'ready' | 'failed';
  /** Oldest first. */
  messages: NewcomerMessageVM[];
  more: boolean;
  loadingMore: boolean;
  capped: boolean;
  failure: NewcomersFailureVM | null;
}

const NO_FAILURE = null;

/** A failure the shared registry knows renders as its own card; a site's own code reads as «данные недоступны» there (its words are the site's). */
function sharedCode(failure: NewcomersFailureVM): CgCode {
  return isCgCode(failure.code) ? failure.code : 'CG-DATA-UNAVAILABLE';
}

export function passHandle(passId: string, fanRef: string): TargetHandle {
  return `pass:${passId}:${fanRef}`;
}

export function parsePassHandle(handle: string): { readonly passId: string; readonly fanRef: string } | null {
  const match = HANDLE.exec(handle);
  return match === null ? null : { passId: match[1] as string, fanRef: match[2] as string };
}

/** No preview of the hub's archive for a fan of the pass: its card is the window's own (`NewcomersVM.pass.card`). */
const NO_DIRECTORY: PreviewDirectory = {
  resolve: () => null,
  neighbours: () => ({ previous: null, next: null }),
  subscribe: () => () => undefined,
};

export function createPassNewcomersController(deps: PassNewcomersDeps): NewcomersController {
  const { source, i18n, clock, context, surfaces } = deps;

  let windowHours = clampHours(source.windows.initial);
  let tab: NewcomersTab = 'todo';
  let filter: NewcomerCheckFilter = 'any';
  let typed = '';
  let applied = '';
  let searchTimer: number | null = null;
  let stage: 'idle' | 'connecting' | 'live' | 'failed' = 'idle';
  let listFailure: NewcomersFailureVM | null = null;
  let pass: PassState | null = null;
  let rows: PassRow[] = [];
  let total = 0;
  let counts: PassCounts | null = null;
  /** Changes with a query or a resync: older pages cannot replace this query's rows or counters. */
  let readRun = 0;
  /** The last change applied; null — none known yet. */
  let seq: number | null = null;
  /** Changes heard while the first page was on its way. */
  let held: PassChange[] = [];
  let reading = false;
  let loadingMore = false;
  let moreFailure: NewcomersFailureVM | null = null;
  let selected: string | null = null;
  /**
   * The fan the person is on (a click, the keys, a draft, a button of the card): the card stays on them when the pass
   * moves them out of the list on screen — «Уже писали» found by a check, another filter — instead of jumping to another
   * fan while they read or type (the old window's `pinned`). Their row as last told; null — none.
   */
  let pinned: string | null = null;
  let pinnedRow: PassRow | null = null;
  let regone = false;
  /** R20 P10b1: a button of the queue waits for the background's answer. */
  let acting = false;
  const histories = new Map<string, History>();
  /** Grows with every window, period and identity: an answer of an older run is nobody's (NF-026). */
  let run = 0;
  let epoch = context.current().epoch;
  let account = context.current().account?.hostAccountId ?? null;
  let disposed = false;

  const cell = new ViewCell(build);
  const changed = (): void => {
    if (disposed) return;
    reselect();
    cell.invalidate();
  };
  const greetingSource = source.greeting;
  const card = deps.greeting === undefined || greetingSource === undefined ? null : createCardGreeting({ greeting: deps.greeting, source: greetingSource, i18n, clock, context, surfaces, changed });
  /** 1.32.0: the batch of Hi over the pass's rows, through each fan's card; nothing is sent by it. */
  const batch = createBatch({
    clock,
    start(handle) {
      const fanRef = own(handle);
      const row = fanRef === null ? null : rowOf(fanRef);
      if (row === null || pass === null || card === null) return Promise.resolve({ s: 'failed', code: 'CG-CONTEXT-CHANGED' });
      return card.batchStart(pass.passId, row);
    },
    // A fan whose history the pass read to its start, nobody greeted, and who can be written to.
    pickable(handle) {
      const fanRef = own(handle);
      const row = fanRef === null ? null : rowOf(fanRef);
      return row !== null && (row.check === 'ready' || row.check === 'reply') && row.conversationRef !== null;
    },
    live(handle) {
      const parsed = parsePassHandle(handle);
      return parsed === null || card === null ? null : card.batchLive(parsed.passId, parsed.fanRef);
    },
    changed: () => {
      if (!disposed) cell.invalidate();
    },
  });

  function clampHours(hours: number): number {
    return Math.min(source.windows.max, Math.max(source.windows.min, Math.round(hours)));
  }

  const open = (): boolean => surfaces.current().newcomers;
  const usable = (): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && pageFlag(ctx, 'newcomers');
  };

  /** Everything of the pass on screen goes; `close` — the pass is let go too (another period or identity, the window closed). */
  function letGo(close: boolean): void {
    run += 1;
    readRun += 1;
    if (close && pass !== null) source.close(pass.passId);
    pass = null;
    rows = [];
    total = 0;
    counts = null;
    seq = null;
    held = [];
    reading = false;
    loadingMore = false;
    moreFailure = null;
    listFailure = null;
    selected = null;
    pinned = null;
    pinnedRow = null;
    acting = false;
    histories.clear();
    card?.reset();
    batch.reset();
    stage = 'idle';
  }

  // ── the pass and its rows ──

  const query = (): PassQuery => ({ search: applied, tab, filter });

  /** A new query starts its own pages: it must reach the source even when the previous result had no list to scroll. */
  function queryChanged(): Promise<void> {
    if (pass === null || stage !== 'live') {
      changed();
      return Promise.resolve();
    }
    rows = [];
    total = 0;
    counts = null;
    return firstPage(run, source.pageSize);
  }

  /**
   * Opens the pass of this tab's creator and period, then reads its first page (NF-004). `close` — the pass on screen
   * is another period's: it is let go. Without it — the window opened again, ⟳, a pass the background lost — what is
   * on screen (the rows, the card, the batch's drafts) stays while the background answers (the owner, 2026-10-23): the
   * same pass goes on with all of it, another one replaces it.
   * `chosen` (X59) — the period the person just chose; null — the one the site remembers (their last choice anywhere).
   */
  async function start(close = true, chosen: number | null = null): Promise<void> {
    const creator = context.current().account?.hostAccountId ?? null;
    const kept = !close && stage === 'live' && pass !== null && creator !== null && creator === account ? pass.passId : null;
    if (kept === null) letGo(close);
    const mine = run;
    if (disposed || !open() || !usable()) return changed();
    account = creator;
    if (creator === null) {
      stage = 'failed';
      listFailure = { code: 'CG-HOST-NOT-READY', retryAt: null };
      return changed();
    }
    if (kept === null) {
      stage = 'connecting';
      changed();
    }
    const scanned = await source.scan(creator, chosen);
    if (disposed || mine !== run) return;
    if (!scanned.ok || scanned.value.hostAccountId !== creator) {
      if (kept !== null) letGo(false);
      // NF-026: a pass of another creator is nobody's here.
      return fail(scanned.ok ? { code: 'CG-CONTEXT-CHANGED', retryAt: null } : scanned.failure);
    }
    if (kept !== null && scanned.value.passId !== kept) return replaced(scanned.value);
    pass = scanned.value;
    windowHours = clampHours(pass.windowHours);
    stage = 'live';
    changed();
    knownOutcomes(mine);
    await firstPage(mine, Math.max(source.pageSize, rows.length, 1));
  }

  /**
   * 2026-10-22 (the old window's «Нужно проверить» in the list): where each fan's greeting stands as the site keeps its
   * attempts, read once per pass — a greeting whose outcome is unknown says so in its row before its card is opened,
   * never «Не писали» (a second greeting's risk). A failed read leaves the rows to their cards.
   */
  function knownOutcomes(mine: number): void {
    if (card === null || pass === null || greetingSource?.outcomes === undefined) return;
    const passId = pass.passId;
    void greetingSource.outcomes(passId).then(
      (answer) => {
        if (disposed || mine !== run || pass?.passId !== passId || !answer.ok) return;
        card.known(passId, answer.value);
      },
      () => undefined,
    );
  }

  function fail(failure: NewcomersFailureVM): void {
    stage = 'failed';
    listFailure = failure;
    changed();
  }

  /** Another window replaced the pass: its period, rows and conversations now belong to the current pass. */
  function replaced(current: PassState): Promise<void> {
    if (current.hostAccountId !== account) {
      fail({ code: 'CG-CONTEXT-CHANGED', retryAt: null });
      return Promise.resolve();
    }
    letGo(false);
    pass = current;
    windowHours = clampHours(current.windowHours);
    stage = 'live';
    knownOutcomes(run);
    return firstPage(run, source.pageSize);
  }

  /** The first rows, or the rows on screen again (a gap in the changes, a port that came back): `limit` rows from the top. */
  async function firstPage(mine: number, limit: number): Promise<void> {
    if (pass === null) return;
    const request = ++readRun;
    const wanted = query();
    reading = true;
    loadingMore = false;
    held = [];
    changed();
    const read: PassRow[] = [];
    let latest: PassState | null = null;
    let count = 0;
    let latestCounts: PassCounts | null = null;
    // The first read's change: the rows of later reads are at least as new, and the changes after it are heard.
    let firstSeq: number | null | undefined;
    for (let offset = 0; offset < limit; ) {
      const step = Math.min(source.readMax, limit - offset);
      const answer = await source.read(pass.passId, offset, step, wanted);
      if (disposed || mine !== run || request !== readRun) return;
      if (!answer.ok) {
        reading = false;
        // Rows already on screen stay with the reason beside them; with none, the list was not read (FX-017).
        if (rows.length === 0) return fail(answer.failure);
        moreFailure = answer.failure;
        return changed();
      }
      if (answer.value.pass === null) return gone(mine);
      if (answer.value.pass.hostAccountId !== account) return fail({ code: 'CG-CONTEXT-CHANGED', retryAt: null });
      if (answer.value.pass.passId !== pass.passId) return replaced(answer.value.pass);
      read.push(...answer.value.rows);
      latest = answer.value.pass;
      count = answer.value.total;
      latestCounts = answer.value.counts;
      if (firstSeq === undefined) firstSeq = answer.value.seq;
      offset += answer.value.rows.length;
      if (answer.value.rows.length < step || offset >= answer.value.total) break;
    }
    reading = false;
    regone = false;
    moreFailure = null;
    if (latest !== null) {
      pass = latest;
      total = count;
      counts = latestCounts;
      rows = placePassPage([], 0, read);
      track(rows);
      seq = firstSeq ?? null;
    }
    const pending = held;
    held = [];
    // An unfiltered event can move a fan into or out of this query, even beyond its loaded page. Read the query
    // again for correct rows AND whole-pass counts; concurrent events are coalesced behind the in-flight read.
    if (pending.some((change) => seq === null || change.seq > seq)) return firstPage(mine, limit);
    changed();
  }

  /** The background holds the pass no more (it ended, the event page restarted): opened again once, then a failure. */
  function gone(mine: number): void {
    reading = false;
    if (regone || mine !== run) return fail({ code: 'CG-DATA-UNAVAILABLE', retryAt: null });
    regone = true;
    void start(false);
  }

  async function nextPage(): Promise<void> {
    if (pass === null || reading || loadingMore || rows.length >= total) return;
    const mine = run;
    const request = readRun;
    loadingMore = true;
    moreFailure = null;
    changed();
    const answer = await source.read(pass.passId, rows.length, source.pageSize, query());
    if (disposed || mine !== run || request !== readRun) return;
    loadingMore = false;
    if (!answer.ok) moreFailure = answer.failure;
    else if (answer.value.pass === null) return gone(mine);
    else if (answer.value.pass.passId !== pass.passId) return replaced(answer.value.pass);
    else {
      rows = placePassPage(rows, rows.length, answer.value.rows);
      track(answer.value.rows);
      total = answer.value.total;
      counts = answer.value.counts;
      pass = answer.value.pass;
    }
    const pending = held;
    held = [];
    if (pending.some((change) => seq === null || change.seq > seq)) return firstPage(mine, Math.max(rows.length, source.pageSize));
    changed();
  }

  /** Changes carry raw rows, not this query's counts: refresh its loaded pages, never filter a partial raw list. */
  function apply(change: PassChange): void {
    if (pass === null || change.pass.passId !== pass.passId) return;
    if (seq !== null && change.seq <= seq) return;
    pass = change.pass;
    void firstPage(run, Math.max(rows.length, source.pageSize));
  }

  function heard(change: PassChange): void {
    if (disposed || !open() || pass === null || change.pass.passId !== pass.passId) return;
    // The pinned fan's row as the pass tells it, also once it is out of the list on screen.
    track(change.rows);
    if (reading || loadingMore) {
      held.push(change);
      return;
    }
    apply(change);
  }

  // ── the conversation of the card ──

  /** The rows by fan, rebuilt once per new `rows` (a lookup per row of every build stays O(1)). */
  let index: { readonly of: PassRow[]; readonly byFan: Map<string, PassRow> } | null = null;
  /** A fan's row in the list on screen; null — not in it. */
  function listed(fanRef: string): PassRow | null {
    if (index === null || index.of !== rows) index = { of: rows, byFan: new Map(rows.map((row) => [row.fanRef, row])) };
    return index.byFan.get(fanRef) ?? null;
  }
  /** A fan's row: in the list, or the pinned one out of it. */
  function rowOf(fanRef: string): PassRow | null {
    return listed(fanRef) ?? (fanRef === pinned ? pinnedRow : null);
  }

  /** The person is on this fan: the card stays on them (the old window's pin). */
  function pin(fanRef: string): void {
    const row = rowOf(fanRef);
    if (row === null) return;
    pinned = fanRef;
    pinnedRow = row;
  }

  function unpin(fanRef?: string): void {
    if (fanRef !== undefined && pinned !== fanRef) return;
    pinned = null;
    pinnedRow = null;
  }

  function track(told: readonly PassRow[]): void {
    if (pinned === null) return;
    const row = told.find((entry) => entry.fanRef === pinned);
    if (row !== undefined) pinnedRow = row;
  }

  /** A click on a fan the queue has not reached: a running queue checks them next; a standing one is not started. */
  function nudge(fanRef: string): void {
    const row = rowOf(fanRef);
    if (pass === null || row === null || row.check !== 'pending') return;
    if (pass.state !== 'scanning' && pass.state !== 'queue' && pass.state !== 'cooldown') return;
    void source.checkNext(pass.passId, fanRef, true).catch(() => undefined);
  }

  /** Resolves true once `ready()` holds (asked at every change of the window), or with `ready()` after `ms`. */
  function until(ready: () => boolean, ms: number): Promise<boolean> {
    if (ready()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let off = (): void => undefined;
      const timer = clock.setTimer(ms, () => {
        off();
        resolve(ready());
      });
      off = cell.subscribe(() => {
        if (!ready()) return;
        clock.clearTimer(timer);
        off();
        resolve(true);
      });
    });
  }

  /**
   * «Hi» of a greeting reminder's toast (2026-10-25), the window opened by the same click: the list shows «Все» with no
   * search or filter, so the fan is in it whatever the pass found — a fan somebody wrote to meanwhile is not in «К
   * обработке» (the owner: «если один нажал на hi и там месага уже есть — ошибка и чат открылся»). The card goes to the
   * fan as soon as their row is there, a fan not checked yet is checked next; once checked: `hi` with the pass's handle
   * (Hi then starts under that click, and its greeting goes into the fan's chat), or `greeted` with their chat. Not
   * listed or not checked within GREET_CARD_WAIT_MS: `card`, the card's own Hi is the person's next click.
   * 2026-10-25: `hi` also waits for the card's draft. A window opened again goes on with its pass, and a card it had not
   * shown reads its draft only now — a Hi started before that was refused and wrote nothing; a draft that cannot be read
   * is `card`, and the card says why. A pass another one replaced meanwhile (the background let it go): the fan's card in
   * the new one.
   */
  async function greetCard(handle: TargetHandle): Promise<GreetCardAnswer> {
    const fan = parseFanHandle(handle);
    if (disposed || fan === null || fan.source !== 'newcomers') return ON_CARD;
    const fanRef = fan.fanRef;
    const deadline = clock.now() + GREET_CARD_WAIT_MS;
    const left = (): number => Math.max(0, deadline - clock.now());
    const query = tab !== 'all' || filter !== 'any' || applied !== '' || typed !== '';
    tab = 'all';
    filter = 'any';
    typed = '';
    applied = '';
    if (searchTimer !== null) clock.clearTimer(searchTimer);
    searchTimer = null;
    if (query) await queryChanged();
    const shown = (): TargetHandle | null => (pass === null || stage !== 'live' || listed(fanRef) === null ? null : passHandle(pass.passId, fanRef));
    const settled = (): boolean => {
      const row = rowOf(fanRef);
      return row !== null && (row.check === 'greeted' || ((row.check === 'ready' || row.check === 'reply') && row.conversationRef !== null));
    };
    for (;;) {
      if (!(await until(() => shown() !== null, left()))) return ON_CARD;
      const target = shown();
      const passId = pass?.passId ?? null;
      // Listed at the change, off the list by now (another pass took this one's place meanwhile): looked for again.
      if (target === null || passId === null) continue;
      selected = fanRef;
      pin(fanRef);
      nudge(fanRef);
      changed();
      ensureHistory();
      if (card === null || !(await until(settled, left()))) return ON_CARD;
      if (shown() === target) {
        const greeted = greetedChat(handle);
        if (greeted !== null) return { s: 'greeted', ...greeted };
        const ready = await card.ready(passId, fanRef);
        if (shown() === target) return ready ? { s: 'hi', handle: target } : ON_CARD;
      }
      // The fan is looked for again only in a pass that took this one's place; one the person's search hid stays hidden.
      if (pass === null || pass.passId === passId || left() === 0) return ON_CARD;
    }
  }

  /**
   * The reminder's fan as the pass knows them now: somebody wrote to them — the row is «Уже писали», or the card's Hi
   * stopped on the history read again while it generated (`CG-SEND-PART`) — their chat; null — not that.
   */
  function greetedChat(handle: TargetHandle): GreetedChat | null {
    const fan = parseFanHandle(handle);
    const binding = context.current().binding;
    if (fan === null || fan.source !== 'newcomers' || binding === null || fan.pageId !== binding.pageId || pass === null) return null;
    const row = rowOf(fan.fanRef);
    if (row === null) return null;
    const ended = card?.stateOf(pass.passId, fan.fanRef) ?? null;
    if (row.check !== 'greeted' && !(ended?.s === 'not-drafted' && ended.failure.code === 'CG-SEND-PART')) return null;
    return { chat: { host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: fan.fanRef }, conversationRef: row.conversationRef, name: nameOf(row) };
  }

  /**
   * «Hi» of a reminder about another model's fan, pressed in this tab (2026-10-25): the click's `navigate` token goes to
   * the site, which brings a tab of that model forward and greets there. null — the fan is this tab's page. `grant` —
   * the click's grant of that one navigation, opened right before its token is asked for.
   */
  async function greetElsewhere(handle: TargetHandle, grant: () => void): Promise<boolean | null> {
    const fan = parseFanHandle(handle);
    const ctx = context.current();
    if (fan === null || fan.source !== 'newcomers' || ctx.phase !== 'ready' || ctx.binding?.pageId === fan.pageId) return null;
    const rpc = deps.greeting?.rpc;
    if (rpc === undefined || source.handover === undefined) return false;
    grant();
    const issued = await issueCause(rpc, 'navigate', 'newcomers');
    if (!issued.ok) return false;
    return source.handover(fan.pageId, fan.fanRef, issued.cause).catch(() => false);
  }

  /**
   * `first` — the first page, once; `older` — the page before the oldest shown («Более ранние сообщения»); `again` —
   * «Повторить загрузку»: the older page when that is what failed, else the newest again.
   */
  async function loadHistory(fanRef: string, mode: 'first' | 'older' | 'again'): Promise<void> {
    const row = rowOf(fanRef);
    if (pass === null || row === null || !historyReadable(row.check, row.conversationRef)) return;
    const known = histories.get(fanRef);
    const older = mode === 'older' || (mode === 'again' && known !== undefined && known.s === 'ready' && known.failure !== null && known.messages.length > 0);
    if (older) {
      if (known === undefined || known.s !== 'ready' || known.loadingMore || (mode === 'older' && !known.more)) return;
    } else if (known !== undefined && (known.s === 'loading' || (mode === 'first' && known.s !== 'failed'))) return;
    const mine = run;
    const passId = pass.passId;
    const history: History = known ?? { s: 'loading', messages: [], more: false, loadingMore: false, capped: false, failure: NO_FAILURE };
    if (older) history.loadingMore = true;
    else history.s = 'loading';
    history.failure = NO_FAILURE;
    // The last one looked at goes to the end; past the bound the longest unseen goes (never the card's own).
    histories.delete(fanRef);
    histories.set(fanRef, history);
    for (const key of histories.keys()) {
      if (histories.size <= PASS_HISTORIES_KEPT) break;
      if (key !== selected && key !== fanRef) histories.delete(key);
    }
    changed();
    const before = older ? (history.messages[0]?.id ?? null) : null;
    const room = source.historyCap - (older ? history.messages.length : 0);
    const answer = await source.history(passId, fanRef, before, Math.max(1, Math.min(source.historyPage, room)));
    if (disposed || mine !== run || histories.get(fanRef) !== history) return;
    history.loadingMore = false;
    if (!answer.ok) {
      if (!older) {
        history.s = 'failed';
        history.messages = [];
      }
      history.failure = answer.failure;
      return changed();
    }
    const placed = prependHistory(older ? history.messages : [], answer.value.messages, source.historyCap);
    history.messages = placed.messages;
    // The cap is reached when something is left out of it: the rest is in the chat itself.
    history.capped = placed.messages.length >= source.historyCap && (placed.truncated || answer.value.more);
    history.more = answer.value.more && !history.capped;
    history.s = 'ready';
    changed();
  }

  /**
   * The card is on a fan of the list as it is now: the one chosen, else the first one a greeting may be written to,
   * else the first (the old window's choice). A new choice reads its conversation — after this change, never inside it.
   */
  function reselect(): void {
    if (reading && rows.length === 0) return;
    if (selected === null || rowOf(selected) === null) selected = (rows.find((row) => writable(row.check)) ?? rows[0])?.fanRef ?? null;
    // The chosen fan's chat may have become readable meanwhile (the pass gave its verdict): it is read once.
    if (selected !== null && !histories.has(selected)) void Promise.resolve().then(ensureHistory);
    // R20 P10c: the card's draft is read once it is on screen.
    if (selected !== null && pass !== null) card?.open(pass.passId, selected);
  }

  /** The card shows the selected fan's conversation when the pass read it: asked once per fan and pass. */
  function ensureHistory(): void {
    if (disposed) return;
    const fanRef = selected;
    if (fanRef === null || histories.has(fanRef)) return;
    const row = rowOf(fanRef);
    if (row !== null && historyReadable(row.check, row.conversationRef)) void loadHistory(fanRef, 'first');
  }

  // ── the view ──

  function contextView(ctx: PageContextState): VmView | null {
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, RELOAD);
    if (!pageFlag(ctx, 'newcomers')) return failureView(flagFailure(ctx, 'newcomers'), i18n, RELOAD);
    return null;
  }

  function stageOf(): NewcomersPassStage {
    if (stage === 'failed') return 'failed';
    if (stage !== 'live' || pass === null) return 'connecting';
    // A pass that stopped before it read anyone: the list was not read (FX-017), not «nobody».
    if (pass.state === 'stopped' && pass.failure !== null && pass.total === 0) return 'failed';
    return pass.state;
  }

  function historyVM(row: PassRow): NewcomerHistoryVM {
    const base = { messages: [] as NewcomerMessageVM[], more: false, loadingMore: false, capped: false, cap: source.historyCap, failure: null };
    if (!historyReadable(row.check, row.conversationRef)) {
      if (row.check === 'failed') return { ...base, s: 'failed', failure: row.failure };
      if (row.check === 'pending' || row.check === 'checking' || row.check === 'unverified') return { ...base, s: 'unchecked' };
      return { ...base, s: 'none' };
    }
    const history = histories.get(row.fanRef);
    if (history === undefined) return { ...base, s: 'loading' };
    return { s: history.s, messages: history.messages, more: history.more, loadingMore: history.loadingMore, capped: history.capped, cap: source.historyCap, failure: history.failure };
  }

  function cardOf(row: PassRow, passId: string): NewcomerCardVM {
    return {
      handle: passHandle(passId, row.fanRef),
      name: nameOf(row),
      username: row.username,
      customName: row.customName,
      followedAt: row.followedAt,
      checkedAt: row.checkedAt,
      bio: row.bio,
      check: row.check,
      dmClosed: row.dmClosed,
      dmPriceMills: row.dmPriceMills ?? null,
      failure: row.failure,
      proof: row.proof,
      history: historyVM(row),
      openHref: row.conversationRef === null ? null : source.chatHref(row.conversationRef),
      avatarUrl: row.avatarUrl ?? null,
      // The pinned fan the pass moved out of the list on screen: the card stays and says so.
      ...(listed(row.fanRef) === null ? { moved: true } : {}),
    };
  }

  /** The row's word for its greeting (X59): going out, gone, or unknown; a fan the pass found written to is greeted. */
  function greetingOf(passId: string, row: PassRow): GreetingStatusVM {
    if (row.check === 'greeted') return { s: 'greeted', at: null };
    const state = card?.stateOf(passId, row.fanRef) ?? null;
    if (state?.s === 'sending') return { s: 'sending', sent: 0, total: 1 };
    if (state?.s === 'sent') return { s: 'greeted', at: state.at };
    if (state?.s === 'uncertain') return { s: 'stopped', sent: 0, total: 1, part: 1 };
    return { s: 'none' };
  }

  /** X59: the row's own «Отправить» of a batch's draft: whether the card's checks let it go now, and why a click did not. */
  function sendOf(passId: string, row: PassRow): NonNullable<NewcomerRowVM['send']> {
    const state = card?.stateOf(passId, row.fanRef) ?? null;
    return { can: card?.vm(passId, row)?.canSend === true, refused: state?.s === 'refused' ? state.failure : null };
  }

  function windowText(hours: number): string {
    return hours >= 168 && hours % 24 === 0 ? i18n.plural('common.days', hours / 24) : i18n.plural('common.hours', hours);
  }

  function build(): NewcomersVM {
    const ctx = context.current();
    const now = stageOf();
    const passId = pass?.passId ?? null;
    const pageId = ctx.binding?.pageId ?? null;
    const rowVMs: NewcomerRowVM[] =
      passId === null
        ? []
        : rows.map((row) => {
            const handle = passHandle(passId, row.fanRef);
            const inBatch = card === null ? null : batch.row(handle);
            return {
              handle,
              // The pass's handle names its pass, not its page: the mark is looked up by the page's fan.
              ...(pageId === null ? {} : { talking: `newcomers:${String(pageId)}:${row.fanRef}` }),
              name: nameOf(row),
              username: row.username,
              kind: 'new',
              subscribedAt: row.followedAt,
              greeting: greetingOf(passId, row),
              hasDraft: false,
              draftStale: false,
              selected: row.fanRef === selected,
              check: { status: row.check, customName: row.customName, dmClosed: row.dmClosed },
              avatarUrl: row.avatarUrl ?? null,
              ...(inBatch === null ? {} : { batch: inBatch }),
              // Only a draft the batch made is read and sent from the list.
              ...(inBatch?.state === 'ready' ? { send: sendOf(passId, row) } : {}),
            };
          });

    let view: VmView;
    const blocked = contextView(ctx);
    if (blocked !== null) view = blocked;
    else if (now === 'failed') {
      const failure = listFailure ?? pass?.failure ?? { code: 'CG-DATA-UNAVAILABLE', retryAt: null };
      view = failureView({ code: sharedCode(failure) }, i18n, RELOAD);
      // A failure the shared registry reads as `offline` or `forbidden` is still a list not read, not an empty one: the card says so.
    } else if (now === 'connecting' || (rows.length === 0 && (reading || counts === null || ((now === 'scanning' || now === 'queue') && pass?.total === 0)))) view = loadingView(null, msg('common.loading'));
    else if (rows.length === 0) view = { s: 'empty', why: msg('common.empty') };
    else {
      const gaps: PartialGap[] = [];
      if (pass?.partial === true) gaps.push({ kind: 'coverage', level: 'partial' });
      if (moreFailure !== null) gaps.push({ kind: 'source-failed', source: 'newcomers', code: sharedCode(moreFailure) });
      view = dataView(gaps);
    }

    const selectedRow = selected === null ? null : rowOf(selected);
    const passVM: NewcomersPassVM = {
      passId,
      creator: ctx.account?.username ?? null,
      stage: now,
      phase: pass !== null && now === 'scanning' ? pass.phase : null,
      checked: pass?.checked ?? null,
      total: pass === null ? null : Math.max(pass.total, rows.length),
      range: pass === null ? null : { from: new Date(Date.parse(pass.startedAt) - pass.windowHours * 3_600_000).toISOString(), to: pass.startedAt },
      cooldownUntil: pass?.state === 'cooldown' ? pass.cooldownUntil : null,
      filters: NEWCOMER_CHECK_FILTERS.map((id) => ({ id, count: counts?.filters[id] ?? null, pressed: id === filter })),
      failure: now === 'failed' ? (listFailure ?? pass?.failure ?? null) : (moreFailure ?? pass?.failure ?? null),
      card:
        selectedRow === null || passId === null || blocked !== null
          ? null
          : { ...cardOf(selectedRow, passId), checkNext: checkNextOf(selectedRow.check, now), exclude: excludeOf(selectedRow.check), ...(card === null ? {} : { greeting: card.vm(passId, selectedRow) }) },
      ...(pass === null || blocked !== null || now === 'failed' || now === 'connecting' ? {} : { run: runOf(now, pass) }),
    };

    return {
      view,
      pageName: ctx.page?.title ?? null,
      personaLabel: ctx.persona?.label ?? null,
      tab,
      tabs: TABS.map((t) => ({ id: t, label: msg(t === 'todo' ? 'newcomers.tab.todo' : 'newcomers.tab.all'), count: counts?.tabs[t] ?? null })),
      windowHours,
      windowOptions: source.windows.options,
      // The hub list's filters; a pass filters by its verdicts (`pass.filters`).
      filters: [],
      query: typed,
      rows: rowVMs,
      cardOpen: passVM.card !== null,
      scan: pass !== null && (now === 'scanning' || now === 'queue') ? { stage: msg('common.loading'), done: pass.checked, total: passVM.total } : null,
      incomplete: pass?.partial === true ? msg('newcomers.incomplete.body') : null,
      footer: { count: passVM.total ?? rows.length, stamp: stamp(pass?.startedAt ?? null, pass?.partial === true ? 'partial' : 'complete') },
      canLoadMore: stage === 'live' && !reading && !loadingMore && rows.length < total,
      hint: msg('newcomers.hint', { window: windowText(windowHours) }),
      noAutoSend: msg('newcomers.noAutoSend'),
      pass: passVM,
      ...(card === null ? {} : { batch: batch.vm(null) }),
    };
  }

  /** R20 P10b1, NF-038: «Пауза» while the queue runs (once the list itself is read), «Проверить оставшихся» while it stands. */
  function runOf(now: NewcomersPassStage, state: PassState): NonNullable<NewcomersPassVM['run']> {
    const running = now === 'queue' || now === 'cooldown' || (now === 'scanning' && (state.phase === 'profiles' || state.phase === 'checking'));
    const remaining = Math.max(0, Math.max(state.total, rows.length) - state.checked);
    return { pause: running, resume: !running && now !== 'scanning' && remaining > 0, remaining, busy: acting };
  }

  /**
   * «Проверить следующим» while the queue runs, «Проверить чат» while it stands — paused, done or stopped (the old window
   * offered it for any fan not checked, 2026-10-22); nothing for a fan already checked.
   */
  function checkNextOf(check: PassRow['check'], now: NewcomersPassStage): 'next' | 'now' | null {
    if (check !== 'pending' && check !== 'failed' && check !== 'unverified') return null;
    if (now === 'scanning' || now === 'queue' || now === 'cooldown') return 'next';
    return now === 'paused' || now === 'done' || now === 'stopped' ? 'now' : null;
  }

  /** R20 P10b2, FS-NEW-2: only a fan nobody can write to leaves «К обработке» by hand, and comes back. */
  function excludeOf(check: PassRow['check']): 'exclude' | 'restore' | null {
    return check === 'dm-closed' ? 'exclude' : check === 'excluded' ? 'restore' : null;
  }

  /** A button of the queue: the background answers; the rows and the pass's state come as its changes (no poll). */
  function act(type: UiAction['type'], ask: () => Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly failure: NewcomersFailureVM }>): Promise<ActionReceipt> {
    const mine = run;
    acting = true;
    changed();
    return ask().then(
      (answer) => {
        if (mine === run) acting = false;
        changed();
        if (disposed || mine !== run) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
        if (!answer.ok) return refused(type, localError(sharedCode(answer.failure), i18n));
        return done(type, answer.value === false ? 'noop' : 'done');
      },
      () => {
        if (mine === run) acting = false;
        changed();
        return refused(type, localError('CG-RUNTIME-UNREACHABLE', i18n));
      },
    );
  }

  // ── the actions ──

  /** The handle of a fan of the open pass; a handle of an older pass or another fan — null. */
  function own(handle: TargetHandle): string | null {
    const parsed = parsePassHandle(handle);
    if (parsed === null || pass === null || parsed.passId !== pass.passId) return null;
    return rowOf(parsed.fanRef) === null ? null : parsed.fanRef;
  }

  const stale = (type: UiAction['type']): Promise<ActionReceipt> => Promise.resolve(refused(type, localError('CG-CONTEXT-CHANGED', i18n)));

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    const type = action.type;
    if (isBatchAction(action)) {
      if (action.list !== 'newcomers' || card === null) return null;
      return Promise.resolve(batchDispatch(batch, action, (handle) => own(handle) !== null));
    }
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind !== 'surface' || to.surface !== 'newcomers') return null;
      surfaces.setList('newcomers', to.open);
      return Promise.resolve(done(type, to.open ? 'opened' : 'done'));
    }
    if (action.type === 'SetNewcomersTab') {
      // Another list on purpose: the card follows it.
      unpin();
      tab = action.tab;
      filter = 'any';
      return queryChanged().then(() => done(type));
    }
    if (action.type === 'SetNewcomersCheckFilter') {
      unpin();
      filter = action.filter;
      if (filterLeavesTodo(action.filter)) tab = 'all';
      return queryChanged().then(() => done(type));
    }
    if (action.type === 'SetNewcomersWindow') {
      const hours = clampHours(action.hours);
      if (hours === windowHours) return Promise.resolve(done(type, 'noop'));
      // Another period is another pass: the old one is let go, its late answers are nobody's. X59: the choice is remembered.
      windowHours = hours;
      return start(true, hours).then(() => done(type));
    }
    if (action.type === 'Search') {
      if (action.list !== 'newcomers') return null;
      typed = action.query;
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = clock.setTimer(PASS_SEARCH_DEBOUNCE_MS, () => {
        searchTimer = null;
        if (applied === typed) return;
        applied = typed;
        unpin();
        void queryChanged();
      });
      cell.invalidate();
      return Promise.resolve(done(type));
    }
    if (action.type === 'ResetFilters') {
      if (action.list !== 'newcomers') return null;
      unpin();
      filter = 'any';
      typed = '';
      applied = '';
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = null;
      return queryChanged().then(() => done(type));
    }
    if (action.type === 'LoadMore') {
      if (action.list !== 'newcomers') return null;
      if (pass === null || rows.length >= total) return Promise.resolve(done(type, 'noop'));
      return nextPage().then(() => done(type));
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'newcomers') return null;
      const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
      return reads.then(() => start(false)).then(() => done(type));
    }
    if (action.type === 'SetNewcomersPassRunning') {
      if (pass === null || stage !== 'live') return stale(type);
      const passId = pass.passId;
      return act(type, () => source.setRunning(passId, action.running));
    }
    if (action.type === 'CheckNewcomerNext') {
      if (parsePassHandle(action.targetHandle) === null) return null;
      const fanRef = own(action.targetHandle);
      if (fanRef === null || pass === null) return stale(type);
      const passId = pass.passId;
      if (fanRef === selected) pin(fanRef);
      return act(type, () => source.checkNext(passId, fanRef));
    }
    if (action.type === 'ExcludeNewcomer') {
      if (parsePassHandle(action.targetHandle) === null) return null;
      const fanRef = own(action.targetHandle);
      if (fanRef === null || pass === null) return stale(type);
      const passId = pass.passId;
      // Out of «К обработке» on the person's own click: the card goes on to the next fan (the old window).
      return act(type, () => source.exclude(passId, fanRef, action.excluded)).then((receipt) => {
        if (receipt.ok && action.excluded) {
          unpin(fanRef);
          changed();
        }
        return receipt;
      });
    }
    if (action.type === 'SetPreviewDraft' || action.type === 'Generate' || action.type === 'SendNewcomerGreeting' || action.type === 'InsertNewcomerGreeting') {
      // R20 P10c: the card's greeting; a handle that is not the pass's is a preview's or the dock's.
      if (parsePassHandle(action.targetHandle) === null) return null;
      const fanRef = own(action.targetHandle);
      const row = fanRef === null ? null : rowOf(fanRef);
      if (row === null || pass === null || card === null) return stale(type);
      // Typing, generating, sending on the card: the person is on this fan.
      if (row.fanRef === selected) pin(row.fanRef);
      const passId = pass.passId;
      const going = card.dispatch(action, passId, row);
      if (going === null) return stale(type);
      if (action.type !== 'SendNewcomerGreeting') return going;
      // Our greeting went: the card goes on to the next fan, as the old window did after «Отправлено». A refusal — written to
      // by someone else meanwhile, a cooldown — keeps the card on the fan with why.
      return going.then((receipt) => {
        if (receipt.ok && pass?.passId === passId && card.stateOf(passId, row.fanRef)?.s === 'sent') {
          unpin(row.fanRef);
          changed();
        }
        return receipt;
      });
    }
    if (action.type === 'OpenPreview' || action.type === 'LoadOlder' || action.type === 'RefreshArchive') {
      // A handle of the pass is this window's; any other is a list's or the dock's.
      if (parsePassHandle(action.targetHandle) === null) return null;
      const fanRef = own(action.targetHandle);
      if (fanRef === null) return stale(type);
      if (action.type === 'OpenPreview') {
        selected = fanRef;
        pin(fanRef);
        // The old window: a click on a fan not checked yet puts them first in a running queue.
        nudge(fanRef);
        changed();
        ensureHistory();
        return Promise.resolve(done(type, 'opened'));
      }
      return loadHistory(fanRef, action.type === 'LoadOlder' ? 'older' : 'again').then(() => done(type));
    }
    return null;
  }

  // ── what the window hears ──

  const offs: (() => void)[] = [
    source.onChange(heard),
    source.onReconnect(() => {
      // A closed window reads nothing (a read would hold the pass for it again): the next open reads what is on screen.
      if (!open()) return;
      card?.refresh();
      if (pass !== null && stage === 'live' && !disposed) knownOutcomes(run);
      // The changes while the port was down are lost: what is on screen is read again.
      if (pass !== null && stage === 'live' && !disposed) void firstPage(run, Math.max(rows.length, source.pageSize));
    }),
    context.subscribe((state) => {
      const creator = state.account?.hostAccountId ?? null;
      if (state.epoch !== epoch || creator !== account) {
        // NF-026: another sign-in, hub, account or binding — the pass, its rows and everything in flight go.
        epoch = state.epoch;
        account = creator;
        letGo(true);
        changed();
        if (open()) void start();
        return;
      }
      if (state.phase === 'ready' && !pageFlag(state, 'newcomers') && stage !== 'idle') {
        // The owner's switch went off on the page: the pass is let go, nothing more is read. (A context blocked while
        // the port is down keeps what is shown; the port's return reads it again.)
        letGo(true);
        changed();
      } else if (open() && stage === 'idle' && usable()) void start();
      else changed();
    }),
    surfaces.subscribe((state, previous) => {
      if (state.newcomers && !previous.newcomers) void start(false);
      else if (!state.newcomers && previous.newcomers) {
        // Closing the window lets the background's work stand (FS-NEW-4); what the window shows — the rows, the card,
        // the batch's drafts — stays for the next open of the same pass (the owner, 2026-10-23). A window that showed
        // no pass lets everything go.
        if (pass !== null && stage === 'live') source.close(pass.passId);
        else letGo(true);
        if (searchTimer !== null) clock.clearTimer(searchTimer);
        searchTimer = null;
        applied = typed;
        changed();
      }
    }),
    i18n.subscribe(() => changed()),
  ];

  const greeting = noGreeting(i18n);

  return {
    kinds: ['newcomers'],
    getSnapshot: () => cell.get(),
    subscribe: (_selector, listener) => cell.subscribe(listener),
    dispatch,
    directory: NO_DIRECTORY,
    greeting,
    refresh: () => start(false),
    greetCard,
    greetedChat,
    greetElsewhere,
    draftsChanged: () => undefined,
    fromBatch: (opId) => card?.fromBatch(opId) ?? false,
    inCard: (opId) => open() && (card?.fromCard(opId) ?? false),
    dispose() {
      disposed = true;
      batch.dispose();
      card?.dispose();
      for (const off of offs.splice(0)) off();
      if (pass !== null) source.close(pass.passId);
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      run += 1;
      histories.clear();
      cell.clear();
    },
  };
}

function nameOf(row: PassRow): string {
  return row.displayName ?? row.username ?? row.fanRef;
}

/**
 * The greeting desk the preview asks for «Новые» fans: a fan of the pass is never in the preview (`NO_DIRECTORY`),
 * and the pass's own greeting is the card's (P10c). Everything here says no.
 */
function noGreeting(i18n: I18n): GreetingDesk {
  const off = (): CgErrorView => localError('CG-FEATURE-DISABLED', i18n);
  return {
    claimForGenerate: () => Promise.resolve({ ok: false, code: 'CG-FEATURE-DISABLED', error: off() }),
    giveBack: () => undefined,
    leaseToken: () => null,
    claim: () => ({ s: 'none' }),
    greeting: () => ({ s: 'none' }),
    hiBlocked: () => reason('feature-disabled'),
    threadRevision: () => null,
    noteProgress: () => undefined,
    touch: () => undefined,
    noteRefusal: () => undefined,
    subscribe: () => () => undefined,
  };
}
