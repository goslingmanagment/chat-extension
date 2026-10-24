// «Рассылка» of the Spenders board (Fansly): each fan of the board's batch gets their personal line — the first part of
// the batch's Reply or Ping, written by the hub from the fan's own history — then the common text, with the copied
// items the person picked from the page's own «Copied …» list (Fansly's attach menu). Only the person's click on the
// fan's row sends it (X8: one send — one click; no key, no «send all»), one attempt, never repeated; every «Отправить»
// of the board rests half a second after a click (#343, #349). What reached a fan stays marked while the tab lives.

import { type ActionReceipt, type I18n, type OutreachItemVM, type OutreachRowVM, type OutreachVM, type UiAction } from '@cg/contracts/vm';

import { issueCause } from '../boards/navigate';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { done, refused } from '../boards/surface';
import { localError } from '../boards/views';

/** One «Отправить» of the board each half second, as the preview's (#343, #349: a run of clicks never goes out in one burst). */
export const OUTREACH_PACE_MS = 500;

/** An item of Fansly's «Copied …» list: 2 — «Copied Bundle», 1 — «Copied Media». */
export interface OutreachItem {
  readonly contentType: 1 | 2;
  readonly contentId: string;
}

/** What goes to one fan: the background's `fansly.spenders.outreach`. */
export interface OutreachRequest {
  readonly hostAccountId: string;
  readonly fanRef: string;
  readonly groupId: string;
  readonly text: string;
  readonly attachments: readonly OutreachItem[];
  readonly cause: { readonly kind: 'click' | 'key'; readonly actionToken: string };
}

export type OutreachAnswer = { readonly ok: true; readonly messageId: string } | { readonly ok: false; readonly code: string };

/**
 * The page's «Copied …» list as read. `checked` — Fansly said which ids are bundles (its own reload files copied
 * bundles as «Copied Media», and a bundle sent as media reaches the fan as nothing); false — as the page stored them.
 */
export interface OutreachCopied {
  readonly items: readonly OutreachItem[];
  readonly checked: boolean;
}

/** The site's half: the page's «Copied …» list and the background's send. */
export interface OutreachPort {
  /**
   * How a row's «Отправить» sends: `own` (default) — this port's send with the copied items (Fansly); `preview` — the
   * fan's card's send of its batch result with the outreach's vault media (OnlyFans, X8 and X53), handled by the preview.
   */
  readonly channel?: 'own' | 'preview';
  /** The creator's list; `hostAccountId` null — the board is bound to no account, nothing is asked of Fansly. */
  copied(hostAccountId: string | null): Promise<OutreachCopied>;
  send(request: OutreachRequest): Promise<OutreachAnswer>;
}

/** The fan a row's click sends to, as the board knows them at the click. */
export interface OutreachTarget {
  readonly hostAccountId: string;
  readonly fanRef: string;
  /** The batch's line for the fan (its result's first part); null — none ready. */
  readonly line: string | null;
  /** The fan's group, found by the board (its row, the page's memory, the inbox search); null — not found. */
  group(): Promise<string | null>;
}

/** The message of one fan: the personal line, a blank line, the common text. */
export function outreachText(line: string, text: string): string {
  return [line.trim(), text.trim()].filter((part) => part.length > 0).join('\n\n');
}

const keyOf = (item: OutreachItem): string => `${item.contentType}:${item.contentId}`;

type RowState = { state: 'sending' | 'sent' | 'uncertain' | 'failed'; code: string | null };

export interface OutreachDeps {
  readonly port: OutreachPort;
  /** The creator the board is bound to (the platform's account id); null — none. */
  readonly account: () => string | null;
  /** The hub rewrites a mass message for one fan (`outreach-fix-v1`): «Подстроить под фана» is offered. */
  readonly canAdapt: () => boolean;
  /** `preview` channel: the vault media every fan takes, as the preview has them; null — none set. */
  readonly media?: () => OutreachVM['media'];
  /** `preview` channel: the outreach's own media window while open. */
  readonly picker?: () => OutreachVM['picker'];
  readonly rpc: TabRpc;
  readonly clock: BoardsClock;
  readonly i18n: I18n;
  /** `rows` — a row's «Отправить» may read otherwise now; false — only the bar did (its text). */
  readonly changed: (rows: boolean) => void;
}

export function createOutreach(deps: OutreachDeps) {
  const { port, rpc, clock, i18n } = deps;
  let open = false;
  let text = '';
  /** «Подстроить под фана», on by default where the hub can. */
  let adapt = true;
  let items: readonly OutreachItem[] = [];
  let itemsState: OutreachVM['itemsState'] = 'checked';
  /** The latest read: an answer of an earlier one is dropped. */
  let reads = 0;
  /** Picked by default: every «Copied Bundle» of the list as read; the person's own ticks after that. */
  const picked = new Set<string>();
  const rows = new Map<string, RowState>();
  let pacedUntil = 0;
  let paceTimer: number | null = null;
  let epoch = 0;

  function read(): void {
    if (channel === 'preview') return;
    const at = ++reads;
    const atEpoch = epoch;
    itemsState = 'reading';
    const current = (): boolean => at === reads && atEpoch === epoch;
    void port.copied(deps.account()).then(
      (next) => {
        if (!current()) return;
        const known = new Set(items.map(keyOf));
        for (const item of next.items) if (!known.has(keyOf(item)) && item.contentType === 2) picked.add(keyOf(item));
        items = next.items;
        itemsState = next.checked ? 'checked' : 'unchecked';
        deps.changed(true);
      },
      () => {
        if (!current()) return;
        itemsState = 'unchecked';
        deps.changed(true);
      },
    );
  }

  const paced = (): boolean => clock.now() < pacedUntil;

  function pace(): void {
    pacedUntil = clock.now() + OUTREACH_PACE_MS;
    if (paceTimer !== null) clock.clearTimer(paceTimer);
    paceTimer = clock.setTimer(OUTREACH_PACE_MS, () => {
      paceTimer = null;
      deps.changed(true);
    });
  }

  const channel = port.channel ?? 'own';
  /** The batch's Fix writes each fan's whole message from the common text; from the card (`preview`) always: its send is the result's. */
  const adapting = (): boolean => (channel === 'preview' || adapt) && deps.canAdapt();

  function vm(): OutreachVM {
    const list: OutreachItemVM[] = items.map((item) => ({ ...item, picked: picked.has(keyOf(item)) }));
    return {
      open,
      text,
      adapt: deps.canAdapt() ? channel === 'preview' || adapt : null,
      items: list,
      itemsState,
      sent: [...rows.values()].filter((row) => row.state === 'sent').length,
      channel,
      media: channel === 'preview' ? (deps.media?.() ?? null) : null,
      picker: channel === 'preview' ? (deps.picker?.() ?? null) : null,
    };
  }

  /** What the board's batch writes for a fan while the bar is open: the Fix of the common text, or null — its own Reply / Ping. */
  function batchFix(): { readonly draft: string } | null {
    return open && adapting() ? { draft: text } : null;
  }

  /** Why the batch cannot start now: the Fix has no common text to rewrite. */
  const needsText = (): boolean => open && adapting() && text.trim().length === 0;

  /** The row's «Отправить»: only while the bar is open and the fan's line is ready, or once a send of it began. */
  function row(handle: string, lineReady: boolean): OutreachRowVM | undefined {
    const own = rows.get(handle);
    if (own !== undefined) return { state: own.state, can: own.state === 'failed' && !paced() && !sending(), code: own.code };
    if (!open || !lineReady) return undefined;
    return { state: 'ready', can: !paced() && !sending(), code: null };
  }

  const sending = (): boolean => [...rows.values()].some((row) => row.state === 'sending');

  async function send(type: UiAction['type'], handle: string, target: OutreachTarget): Promise<ActionReceipt> {
    const own = rows.get(handle);
    // A message that left (or may have) never goes again by this button: «Неизвестно, ушло ли» is checked in the chat.
    if (own !== undefined && own.state !== 'failed') return refused(type, localError(own.state === 'sending' ? 'CG-SEND-BUSY' : 'CG-SEND-PART', i18n));
    if (target.line === null || target.line.trim().length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    if (paced() || sending()) return refused(type, localError('CG-SEND-BUSY', i18n));
    // «Подстроить под фана»: the line IS the fan's whole message (the Fix of the common text); else the line, then the text.
    const body = adapting() ? target.line.trim() : outreachText(target.line, text);
    const attachments = items.filter((item) => picked.has(keyOf(item)));
    // The button is off from the click on, before anything answers.
    rows.set(handle, { state: 'sending', code: null });
    pace();
    deps.changed(true);
    const at = epoch;
    const end = (state: RowState): ActionReceipt => {
      if (at === epoch) {
        rows.set(handle, state);
        deps.changed(true);
      }
      return state.state === 'sent' ? done(type) : refused(type, localError(state.state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-REJECTED', i18n, state.code ?? undefined));
    };
    // The click's token first: it is the person's consent for this one send.
    const cause = await issueCause(rpc, 'send', 'preview');
    if (!cause.ok) return end({ state: 'failed', code: cause.code });
    const groupId = await target.group().catch(() => null);
    if (groupId === null) return end({ state: 'failed', code: 'CG-HOST-CHAT-NOT-FOUND' });
    const answer = await port.send({ hostAccountId: target.hostAccountId, fanRef: target.fanRef, groupId, text: body, attachments, cause: cause.cause }).catch((): OutreachAnswer => ({ ok: false, code: 'CG-SEND-UNCERTAIN' }));
    if (answer.ok) return end({ state: 'sent', code: null });
    return end({ state: answer.code === 'CG-SEND-UNCERTAIN' ? 'uncertain' : 'failed', code: answer.code });
  }

  /** `SetOutreach`: the bar shown, its list read again, its text, an item ticked. */
  function set(action: Extract<UiAction, { type: 'SetOutreach' }>): ActionReceipt {
    let moved = false;
    if (action.open !== undefined && action.open !== open) {
      open = action.open;
      moved = true;
      if (open) read();
    }
    if (action.refresh === true) {
      read();
      moved = true;
    }
    const rowsMoved = moved;
    if (action.adapt !== undefined && action.adapt !== adapt) {
      adapt = action.adapt;
      moved = true;
    }
    if (action.text !== undefined && action.text !== text) {
      text = action.text;
      moved = true;
    }
    if (action.item !== undefined) {
      const key = keyOf(action.item);
      if (items.some((item) => keyOf(item) === key) && picked.has(key) !== action.item.picked) {
        if (action.item.picked) picked.add(key);
        else picked.delete(key);
        moved = true;
      }
    }
    // The text is the bar's alone: typing it never redraws the list's rows.
    if (moved) deps.changed(rowsMoved);
    return done(action.type, moved ? 'done' : 'noop');
  }

  return {
    channel,
    vm,
    batchFix,
    needsText,
    row,
    set,
    send,
    /** Another sign-in, account or page: the marks and the bar's state go. */
    reset() {
      epoch += 1;
      open = false;
      text = '';
      adapt = true;
      items = [];
      itemsState = 'checked';
      picked.clear();
      rows.clear();
    },
    dispose() {
      epoch += 1;
      if (paceTimer !== null) clock.clearTimer(paceTimer);
      paceTimer = null;
    },
  };
}

export type Outreach = ReturnType<typeof createOutreach>;
