// A batch of generations over the rows of a list (contracts 1.32.0, vm/batch): the fans the person ticked, one click
// «Сгенерировать для N», and a queue that starts at most BATCH_LIMITS.parallel of them at a time. Each list says
// how one fan's generation starts and ends (`start`): the Spenders board and «Новые» of a hub list through the
// preview's own Generate, a «Новые» list a background pass checks through its card's greeting. The batch only
// generates: each result waits on its fan's card, and only the person's click there sends it (X8).
//
// The one click is the person's consent for the whole batch: the tab's gate gives it up to `grantTokens` generate
// tokens for `grantTtlMs` (composition/tab/action-gate.ts). A start that finds no token (the grant ran out, the
// window closed) stops the batch: the fans left go back to ticked, for a new click.

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { BATCH_LIMITS, type ActionReceipt, type BatchRowState, type BatchRowVM, type BatchVM, type Msg, type NewcomerRowSendVM, type UiAction } from '@cg/contracts/vm';

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

export interface BatchDeps {
  readonly clock: BoardsClock;
  /** Starts the fan's generation; resolves when it ended (or did not start). */
  start(handle: string): Promise<BatchOutcome>;
  /** The fan may be ticked now (absent — every fan of the list may). */
  pickable?(handle: string): boolean;
  /** What the fan's result is now — its card may have sent it; null — as the batch last heard. */
  live?(handle: string): { readonly text: string | null; readonly sent: boolean } | null;
  changed(): void;
}

export interface Batch {
  /** Ticks or unticks fans; false — nothing changed. Never more than `picks` fans in a batch. */
  pick(handles: readonly string[], picked: boolean): boolean;
  /** «Сгенерировать для N»: the ticked fans join the queue; false — none was ticked. */
  run(): boolean;
  /** «Остановить»: the fans waiting their turn are ticked again; those generating finish. */
  stop(): boolean;
  /** «Очистить»: the rows forget the batch (a generation running goes on and is still shown). */
  clear(): boolean;
  row(handle: string): BatchRowVM;
  vm(reason: Msg | null): BatchVM;
  /** Someone is ticked, waiting, generating or has a result in the batch. */
  active(): boolean;
  /** Another sign-in, account or list: everything goes. */
  reset(): void;
  dispose(): void;
}

interface Item {
  state: BatchRowState;
  text: string | null;
  code: string | null;
}

const IDLE: BatchRowVM = { pickable: true, picked: false, state: null, text: null, failure: null };

export function createBatch(deps: BatchDeps): Batch {
  const { clock } = deps;
  const picks = new Set<string>();
  const items = new Map<string, Item>();
  let generation = 0;
  let retry: number | null = null;
  let disposed = false;

  const generating = (): number => [...items.values()].filter((item) => item.state === 'generating').length;
  const holding = (): number => [...items.values()].filter((item) => item.state === 'queued' || item.state === 'generating').length;

  function pump(): void {
    if (disposed) return;
    for (const [handle, item] of items) {
      if (retry !== null || generating() >= BATCH_LIMITS.parallel) return;
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
    stop() {
      dropRetry();
      const moved = requeue();
      if (moved) deps.changed();
      return moved;
    },
    clear() {
      const had = picks.size > 0 || items.size > 0;
      picks.clear();
      dropRetry();
      for (const [handle, item] of [...items]) if (item.state !== 'generating') items.delete(handle);
      if (had) deps.changed();
      return had;
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
      };
    },
    active: () => picks.size > 0 || items.size > 0,
    reset() {
      generation += 1;
      dropRetry();
      const had = picks.size > 0 || items.size > 0;
      picks.clear();
      items.clear();
      if (had) deps.changed();
    },
    dispose() {
      disposed = true;
      generation += 1;
      dropRetry();
      picks.clear();
      items.clear();
    },
  };
}

/** What a list's batch asks of the preview (its controller, bound late: the preview is made after the lists). */
export interface BatchPreviewPort {
  batchStart(source: 'spenders' | 'newcomers', handle: string, feature: 'reply' | 'ping' | 'hi'): Promise<BatchOutcome>;
  batchLive(handle: string): { readonly text: string | null; readonly sent: boolean } | null;
  /** X59 on a hub's «Новые»: the row's own «Отправить» of the fan's greeting; null — no part waits (absent — none here). */
  batchSend?(handle: string): NewcomerRowSendVM | null;
  onBatch(listener: () => void): () => void;
}

export type BatchAction = Extract<UiAction, { type: 'SetBatchPick' | 'GenerateBatch' | 'StopBatch' | 'ClearBatch' }>;

export const isBatchAction = (action: UiAction): action is BatchAction =>
  action.type === 'SetBatchPick' || action.type === 'GenerateBatch' || action.type === 'StopBatch' || action.type === 'ClearBatch';

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
  }
}
