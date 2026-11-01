// A batch of generations over the rows of a list (contracts 1.32.0, vm/batch): the fans the person ticked, one click
// «Сгенерировать для N», and a queue that starts at most BATCH_LIMITS.parallel of them at a time. Each list says
// how one fan's generation starts and ends (`start`): the Spenders board and «Новые» of a hub list through the
// preview's own Generate, a «Новые» list a background pass checks through its card's greeting. The batch only
// generates: each result waits on its fan's card, and only the person's click there sends it (X8) — or, on «Новые»,
// the person's one click «Отправить всем» (the owner, 2026-10-27; see `sendAll`).
//
// The one click is the person's consent for the whole batch: the tab's gate gives it up to `grantTokens` generate
// tokens for `grantTtlMs` (composition/tab/action-gate.ts). A start that finds no token (the grant ran out, the
// window closed) stops the batch: the fans left go back to ticked, for a new click.

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type MediaFanState } from '@cg/contracts/media';
import { BATCH_LIMITS, type ActionReceipt, type BatchRowState, type BatchRowVM, type BatchSendRunVM, type BatchVM, type MediaPickerVM, type Msg, type NewcomerRowSendVM, type OutreachMediaVM, type PreviewSendView, type UiAction, type UiActionType } from '@cg/contracts/vm';

import { type BoardsClock } from './ports';
import { done } from './surface';

/** How one fan's start ended. */
export type BatchOutcome =
  | { readonly s: 'ready'; readonly text: string | null }
  | { readonly s: 'failed'; readonly code: string }
  /** The background is at its limit for the tab: the fan waits its turn again. */
  | { readonly s: 'busy' }
  /** No token of the click is left: the batch stops, the fans left are ticked again. */
  | { readonly s: 'spent'; readonly code: string };

/** The registry's title of a shared code; a site's own code has none here (its window names it). */
const titleOf = (code: string): Msg | null => (Object.hasOwn(CG_REGISTRY, code) ? { key: CG_REGISTRY[code as keyof typeof CG_REGISTRY].title } : null);

/** After the background said «limit of the tab», the queue tries again this much later (or when a generation ends). */
export const BATCH_BUSY_RETRY_MS = 5_000;

/** Generations of batches remembered for the toasts: a few whole batches. */
const BATCH_OPS_KEPT = 4 * BATCH_LIMITS.picks;

/**
 * A generation a batch started: its end is said by its row, never by «AI готово · фан» over whatever the person does
 * meanwhile (tab/toast-events.ts). The oldest are forgotten past BATCH_OPS_KEPT.
 */
export function noteBatchOp(ops: Set<string>, opId: string): void {
  ops.add(opId);
  for (const old of ops) {
    if (ops.size <= BATCH_OPS_KEPT) return;
    ops.delete(old);
  }
}

/**
 * How a fan's ready greeting stands for «Отправить всем»: its row's «Отправить» would go now; it will after a wait (the
 * pause after a send, an earlier part still on its way); it went (or its last part is on its way); it cannot go by
 * the row's click (a warning, a refusal, an unknown outcome — the row says why).
 */
export type BatchSendState = 'now' | 'wait' | 'done' | 'no';

/** What «Отправить всем» asks of its list. */
export interface BatchSender {
  state(handle: string): BatchSendState;
  /** The row's own «Отправить», exactly as its click sends it. */
  send(handle: string): Promise<ActionReceipt>;
  /** The hub's limit of sends a minute: the run never goes faster. */
  perMinute(): number;
}

/** A fan whose row waits (a part on its way, the pause) longer than this is left to its row. */
export const BATCH_SEND_WAIT_MS = 90_000;
/** How often a waiting row is looked at again. */
const BATCH_SEND_POLL_MS = 500;
/** Parts of one greeting the run sends at most. */
const BATCH_SEND_PARTS = 6;
/** A refusal «busy» (nothing went: the pause, another click on the fan) is tried again this many times. */
const BATCH_SEND_BUSY_TRIES = 3;
/** The hub counts a minute; a little room over it. */
const MINUTE_MS = 61_000;

export interface BatchDeps {
  readonly clock: BoardsClock;
  /** Starts the fan's generation; resolves when it ended (or did not start). */
  start(handle: string): Promise<BatchOutcome>;
  /** The fan may be ticked now (absent — every fan of the list may). */
  pickable?(handle: string): boolean;
  /** What the fan's result is now — its card may have sent it; null — as the batch last heard. */
  live?(handle: string): { readonly text: string | null; readonly sent: boolean } | null;
  /**
   * Starts at once (default BATCH_LIMITS.parallel). «Онлайн» starts every click at once: its click's token lives
   * seconds, so a click left waiting its turn would end with nothing written.
   */
  readonly parallel?: number;
  /** «Отправить всем» (the owner, 2026-10-27); absent — the list has none. */
  readonly sender?: BatchSender;
  changed(): void;
}

export interface Batch {
  /** Ticks or unticks fans; false — nothing changed. Never more than `picks` fans in a batch. */
  pick(handles: readonly string[], picked: boolean): boolean;
  /** «Сгенерировать для N»: the ticked fans join the queue; false — none was ticked. */
  run(): boolean;
  /**
   * These fans join the queue now, at its end, whatever they had (a result, a tick): «Ещё раз» of one fan, «Переписать N».
   * One generating stays as it is. False — none joined.
   */
  queue(handles: readonly string[]): boolean;
  /** «Остановить»: the fans waiting their turn are ticked again; those generating finish. */
  stop(): boolean;
  /** «Очистить»: the rows forget the batch (a generation running goes on and is still shown). */
  clear(): boolean;
  /** These fans forget the batch — their tick, their result as the batch heard it (one generating goes on). */
  drop(handles: readonly string[]): boolean;
  /**
   * 2026-11-01, «Рассылки» kept on this computer: these fans have their written result again, as it was kept — nothing is
   * generated; a fan generating now keeps their generation.
   */
  restore(entries: readonly { readonly handle: string; readonly text: string }[]): void;
  /**
   * «Отправить всем»: the ready greetings go one by one, BATCH_LIMITS.sendGapMs apart and never faster than the hub's
   * minute, each by its row's own send. A refusal or an unknown outcome is never sent again: the fan stays for the
   * person. False — nothing to send, or a run is going.
   */
  sendAll(): boolean;
  /** «Остановить» of «Отправить всем»: a send already asked for goes on; nothing more starts. */
  stopSend(): boolean;
  row(handle: string): BatchRowVM;
  vm(reason: Msg | null): BatchVM;
  /** Someone is ticked, waiting, generating or has a result in the batch. */
  active(): boolean;
  /** The fans ticked for the next click, in the order they were ticked. */
  picked(): readonly string[];
  /** Another sign-in, account or list: everything goes. */
  reset(): void;
  dispose(): void;
}

interface Item {
  state: BatchRowState;
  text: string | null;
  code: string | null;
}

/**
 * The run of «Отправить всем» as it goes. What went is read from the rows themselves, not from the run: a send ChatSpace
 * took into its queue may still be refused there, and its row says so.
 */
interface SendRun {
  running: boolean;
  readonly handles: readonly string[];
  /** The fans the run has been through: asked to send (`asked`), or left to their rows (`failed`). */
  readonly outcome: Map<string, 'asked' | 'failed'>;
  held: boolean;
}

const IDLE: BatchRowVM = { pickable: true, picked: false, state: null, text: null, failure: null };

export function createBatch(deps: BatchDeps): Batch {
  const { clock } = deps;
  const picks = new Set<string>();
  const items = new Map<string, Item>();
  let generation = 0;
  let retry: number | null = null;
  let disposed = false;

  /** «Отправить всем»: the run on screen, and the times of its sends within the last minute. */
  let run: SendRun | null = null;
  const sentAt: number[] = [];
  let nextAt = 0;
  let wake: { readonly timer: number; readonly resolve: () => void } | null = null;

  const generating = (): number => [...items.values()].filter((item) => item.state === 'generating').length;
  const holding = (): number => [...items.values()].filter((item) => item.state === 'queued' || item.state === 'generating').length;

  function pump(): void {
    if (disposed) return;
    for (const [handle, item] of items) {
      if (retry !== null || generating() >= (deps.parallel ?? BATCH_LIMITS.parallel)) return;
      if (item.state !== 'queued') continue;
      item.state = 'generating';
      void launch(handle, item);
    }
  }

  async function launch(handle: string, item: Item): Promise<void> {
    const at = generation;
    deps.changed();
    const outcome = await deps.start(handle).catch((): BatchOutcome => ({ s: 'failed', code: 'CG-UI-FAILED' }));
    if (disposed || at !== generation || items.get(handle) !== item) return;
    if (outcome.s === 'ready') Object.assign(item, { state: 'ready', text: outcome.text, code: null });
    else if (outcome.s === 'failed') Object.assign(item, { state: 'failed', text: null, code: outcome.code });
    else if (outcome.s === 'busy') {
      item.state = 'queued';
      if (retry === null)
        retry = clock.setTimer(BATCH_BUSY_RETRY_MS, () => {
          retry = null;
          pump();
        });
    } else {
      Object.assign(item, { state: 'failed', text: null, code: outcome.code });
      requeue();
    }
    deps.changed();
    pump();
  }

  /** The fans waiting their turn are ticked again. */
  function requeue(): boolean {
    let moved = false;
    for (const [handle, item] of [...items]) {
      if (item.state !== 'queued') continue;
      items.delete(handle);
      picks.add(handle);
      moved = true;
    }
    return moved;
  }

  function dropRetry(): void {
    if (retry !== null) clock.clearTimer(retry);
    retry = null;
  }

  function row(handle: string): BatchRowVM {
    const picked = picks.has(handle);
    const pickable = deps.pickable?.(handle) ?? true;
    const item = items.get(handle);
    if (item === undefined) return picked || !pickable ? { ...IDLE, pickable, picked } : IDLE;
    const live = item.state === 'ready' ? (deps.live?.(handle) ?? null) : null;
    const state: BatchRowState = live?.sent === true ? 'sent' : item.state;
    return { pickable, picked, state, text: live?.text ?? item.text, failure: item.code === null ? null : { code: item.code, title: titleOf(item.code) } };
  }

  // ── «Отправить всем» ──

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = clock.setTimer(Math.max(1, ms), () => {
        wake = null;
        resolve();
      });
      wake = { timer, resolve };
    });
  }

  function endSend(): boolean {
    if (run === null || !run.running) return false;
    run.running = false;
    run.held = false;
    if (wake !== null) {
      clock.clearTimer(wake.timer);
      const { resolve } = wake;
      wake = null;
      resolve();
    }
    return true;
  }

  /** The run as its rows stand now: gone out, or left to the row (refused by the run, or after it by the site). */
  function runView(sender: BatchSender, mine: SendRun): BatchSendRunVM {
    let sent = 0;
    let failed = 0;
    for (const handle of mine.handles) {
      const outcome = mine.outcome.get(handle);
      if (outcome === undefined) continue;
      if (row(handle).state === 'sent') sent += 1;
      else if (outcome === 'failed' || sender.state(handle) === 'no') failed += 1;
    }
    return { running: mine.running, total: mine.handles.length, done: mine.outcome.size, sent, failed, held: mine.held };
  }

  /** The ready greetings a click would send, in the batch's order. */
  function sendable(): string[] {
    const sender = deps.sender;
    if (sender === undefined) return [];
    return [...items.keys()].filter((handle) => {
      if (row(handle).state !== 'ready') return false;
      const state = sender.state(handle);
      return state === 'now' || state === 'wait';
    });
  }

  /** One fan of the run: its parts as its row sends them. */
  async function sendOne(sender: BatchSender, mine: SendRun, handle: string): Promise<'sent' | 'failed' | 'stopped'> {
    let parts = 0;
    let busy = 0;
    let waited = 0;
    for (;;) {
      if (!mine.running || disposed) return 'stopped';
      const state = sender.state(handle);
      if (state === 'done') return 'sent';
      if (state === 'no') return 'failed';
      const now = clock.now();
      if (state === 'wait' || now < nextAt) {
        if (waited >= BATCH_SEND_WAIT_MS) return 'failed';
        const step = state === 'wait' ? BATCH_SEND_POLL_MS : nextAt - now;
        await sleep(step);
        waited += step;
        continue;
      }
      while (sentAt.length > 0 && (sentAt[0] ?? 0) <= now - MINUTE_MS) sentAt.shift();
      if (sentAt.length >= Math.max(1, sender.perMinute())) {
        // The hub's minute is full: the next goes when its first send of the minute leaves it.
        mine.held = true;
        deps.changed();
        await sleep((sentAt[0] ?? now) + MINUTE_MS - now);
        mine.held = false;
        deps.changed();
        continue;
      }
      if (parts >= BATCH_SEND_PARTS) return 'failed';
      parts += 1;
      sentAt.push(now);
      nextAt = now + BATCH_LIMITS.sendGapMs;
      const receipt = await sender.send(handle).catch((): null => null);
      if (receipt === null) return 'failed';
      if (!receipt.ok) {
        // No token is left of the click (its grant is spent or too old): the run is over, the rest wait for a click.
        if (receipt.code === 'CG-UI-FAILED') {
          endSend();
          return 'failed';
        }
        // Nothing went (the pause, another click on the same fan): the same part, after a wait.
        if (receipt.code === 'CG-SEND-BUSY' && busy < BATCH_SEND_BUSY_TRIES) {
          busy += 1;
          parts -= 1;
          continue;
        }
        return 'failed';
      }
      waited = 0;
    }
  }

  async function runSend(sender: BatchSender, mine: SendRun, handles: readonly string[]): Promise<void> {
    for (const handle of handles) {
      if (!mine.running || disposed) break;
      const outcome = await sendOne(sender, mine, handle);
      if (outcome !== 'stopped') mine.outcome.set(handle, outcome === 'sent' ? 'asked' : 'failed');
      if (!disposed) deps.changed();
    }
    mine.running = false;
    mine.held = false;
    if (!disposed) deps.changed();
  }

  return {
    pick(handles, picked) {
      let moved = false;
      for (const handle of handles) {
        if (picked) {
          if (picks.has(handle) || items.get(handle)?.state === 'queued' || items.get(handle)?.state === 'generating' || deps.pickable?.(handle) === false) continue;
          if (picks.size + holding() >= BATCH_LIMITS.picks) break;
          picks.add(handle);
          moved = true;
        } else if (picks.delete(handle)) moved = true;
      }
      if (moved) deps.changed();
      return moved;
    },
    run() {
      if (picks.size === 0) return false;
      for (const handle of picks) {
        // A fan run again goes to the end of the queue.
        items.delete(handle);
        items.set(handle, { state: 'queued', text: null, code: null });
      }
      picks.clear();
      dropRetry();
      deps.changed();
      pump();
      return true;
    },
    queue(handles) {
      let moved = false;
      for (const handle of handles) {
        if (items.get(handle)?.state === 'generating') continue;
        picks.delete(handle);
        items.delete(handle);
        items.set(handle, { state: 'queued', text: null, code: null });
        moved = true;
      }
      if (!moved) return false;
      deps.changed();
      pump();
      return true;
    },
    stop() {
      dropRetry();
      const moved = requeue();
      if (moved) deps.changed();
      return moved;
    },
    sendAll() {
      const sender = deps.sender;
      if (sender === undefined || run?.running === true) return false;
      const handles = sendable();
      if (handles.length === 0) return false;
      const mine: SendRun = { running: true, handles, outcome: new Map(), held: false };
      run = mine;
      deps.changed();
      void runSend(sender, mine, handles);
      return true;
    },
    stopSend() {
      const stopped = endSend();
      if (stopped) deps.changed();
      return stopped;
    },
    clear() {
      endSend();
      run = null;
      const had = picks.size > 0 || items.size > 0;
      picks.clear();
      dropRetry();
      for (const [handle, item] of [...items]) if (item.state !== 'generating') items.delete(handle);
      if (had) deps.changed();
      return had;
    },
    drop(handles) {
      let moved = false;
      for (const handle of handles) {
        if (picks.delete(handle)) moved = true;
        const item = items.get(handle);
        if (item !== undefined && item.state !== 'generating') {
          items.delete(handle);
          moved = true;
        }
      }
      if (moved) deps.changed();
      return moved;
    },
    restore(entries) {
      for (const { handle, text } of entries) {
        if (items.get(handle)?.state === 'generating') continue;
        picks.delete(handle);
        items.set(handle, { state: 'ready', text, code: null });
      }
      if (entries.length > 0) deps.changed();
    },
    row,
    vm(reason) {
      const count = (state: BatchRowState): number => [...items.keys()].filter((handle) => row(handle).state === state).length;
      return {
        picked: picks.size,
        max: BATCH_LIMITS.picks,
        queued: count('queued'),
        generating: count('generating'),
        ready: count('ready'),
        sent: count('sent'),
        failed: count('failed'),
        reason,
        ...(deps.sender === undefined ? {} : { send: { ready: run?.running === true ? 0 : sendable().length, perMinute: deps.sender.perMinute(), run: run === null ? null : runView(deps.sender, run) } }),
      };
    },
    active: () => picks.size > 0 || items.size > 0,
    picked: () => [...picks],
    reset() {
      generation += 1;
      dropRetry();
      endSend();
      run = null;
      const had = picks.size > 0 || items.size > 0;
      picks.clear();
      items.clear();
      if (had) deps.changed();
    },
    dispose() {
      disposed = true;
      generation += 1;
      dropRetry();
      endSend();
      picks.clear();
      items.clear();
    },
  };
}

/**
 * «Рассылка» on a site whose cards send (X8): the fan's version as their card holds it — the text that goes, how its
 * «Отправить» stands, what goes with it.
 */
export interface OutreachCardRow {
  /** The result whose first part is the version. */
  readonly opId: string;
  /** The text that goes: the person's edit, else Fix's. */
  readonly text: string;
  /** 1.72.0: Fix's version itself (the person's edit aside). */
  readonly fix: string;
  readonly edited: boolean;
  /** The person may change it now (it has not started to go). */
  readonly editable: boolean;
  /** Its «Отправить» as the card shows it; null — the card has none for it. */
  readonly send: PreviewSendView | null;
  /** The card would send it by one plain click now. */
  readonly can: boolean;
  /** Only the half second after a send of the tab holds it. */
  readonly paused: boolean;
  /** What goes with it: the fan's picks (the outreach's, or their own); null — nothing. */
  readonly media: OutreachMediaVM | null;
  /** The fan's picks are their own, not the outreach's. */
  readonly ownMedia: boolean;
  /** The archive's time of the fan's feed on their card (what the version was made by); null — not read. */
  readonly archiveAt: string | null;
}

/** What a list's batch asks of the preview (its controller, bound late: the preview is made after the lists). */
export interface BatchPreviewPort {
  /** `outreach` — «Рассылка»: a Fix of the common text made personal for the fan (the card's draft stays as it is). */
  batchStart(source: 'spenders' | 'newcomers' | 'outreach' | 'online' | 'queue', handle: string, feature: 'reply' | 'ping' | 'hi' | 'fix', outreach?: { readonly draft: string }, opts?: { readonly again?: boolean; readonly single?: boolean }): Promise<BatchOutcome>;
  batchLive(handle: string): { readonly text: string | null; readonly sent: boolean } | null;
  /** 2026-10-29, «Hi» inside a greeting reminder's toast: the ready result's next part and its send (absent — none here). */
  batchNext?(handle: string): { readonly opId: string; readonly part: number | null; readonly text: string | null; readonly send: PreviewSendView | null; readonly waits: boolean } | null;
  /** X59 on a hub's «Новые»: the row's own «Отправить» of the fan's greeting; null — no part waits (absent — none here). */
  batchSend?(handle: string): NewcomerRowSendVM | null;
  /** «Отправить всем» of a hub's «Новые»: how the fan's greeting stands for the run (absent — no such send here). */
  batchSendState?(handle: string): BatchSendState;
  /** «Отправить всем»: the row's own «Отправить», as its click sends it. */
  batchSendNow?(handle: string): Promise<ActionReceipt>;
  /** «Рассылка» exists (its window open or folded): the cards of its fans take its media; false — no card send here. */
  setOutreach?(on: boolean): boolean;
  /** The outreach's media as picked; null — none (text only). */
  outreachMedia?(): OutreachMediaVM | null;
  /** The outreach's media sheet while open (the vault picker); null — closed. */
  outreachPicker?(): MediaPickerVM | null;
  /** The fan's version on their card; null — no version there. */
  outreachRow?(handle: string): OutreachCardRow | null;
  /** The card's own send of the fan's version (X8) with the fan's media, by this click; `anyway` passes the card's warning. */
  outreachSend?(type: UiActionType, handle: string, anyway: boolean): Promise<ActionReceipt>;
  /** The person's words for the fan's version (null — Fix's again); false — the version cannot change now. */
  outreachEdit?(handle: string, text: string | null): boolean;
  /**
   * 1.72.0: a version the hub keeps (written on another computer, by a colleague, or before a reload) goes into the fan's
   * card as its result, sent like the person's own words; false — the card cannot take it now (the board does not list
   * the fan yet, a send of the fan is on its way).
   */
  outreachAdopt?(handle: string, text: string): Promise<boolean>;
  /** What these fans got of these media, as the site's vault says (bought, sent unbought, free); null — the site cannot tell. */
  outreachStates?(fans: readonly string[], ids: readonly string[]): Promise<ReadonlyMap<string, readonly MediaFanState[]> | null>;
  /** «Онлайн»: a text of the team's guide becomes the fan's open card's result, for its own send (X8); false — not now. */
  onlineText?(handle: string, text: string): Promise<boolean>;
  /** «Онлайн»: the fan's draft (the card's field «Свой текст») emptied once its words became the card's text. */
  clearDraft?(handle: string): void;
  onBatch(listener: () => void): () => void;
}

export type BatchAction = Extract<UiAction, { type: 'SetBatchPick' | 'GenerateBatch' | 'StopBatch' | 'ClearBatch' | 'SendBatch' | 'StopBatchSend' }>;

export const isBatchAction = (action: UiAction): action is BatchAction =>
  action.type === 'SetBatchPick' || action.type === 'GenerateBatch' || action.type === 'StopBatch' || action.type === 'ClearBatch' || action.type === 'SendBatch' || action.type === 'StopBatchSend';

/** One action of a list's batch; `own` — the handle is a fan of this list. */
export function batchDispatch(batch: Batch, action: BatchAction, own: (handle: string) => boolean): ActionReceipt {
  switch (action.type) {
    case 'SetBatchPick':
      return done(action.type, batch.pick(action.targetHandles.filter(own), action.picked) ? 'done' : 'noop');
    case 'GenerateBatch':
      return done(action.type, batch.run() ? 'started' : 'noop');
    case 'StopBatch':
      return done(action.type, batch.stop() ? 'done' : 'noop');
    case 'ClearBatch':
      return done(action.type, batch.clear() ? 'done' : 'noop');
    case 'SendBatch':
      return done(action.type, batch.sendAll() ? 'started' : 'noop');
    case 'StopBatchSend':
      return done(action.type, batch.stopSend() ? 'done' : 'noop');
  }
}
