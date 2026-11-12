// Temporary chat pins in a Fansly tab (2026-11-12; contracts fansly-pins.ts): the controller between the background's
// pins of the tab's creator, the page's rows and the strip and the header button the UI draws. No DOM, no request.
//
// - It holds the person's switch, the creator, the open chat, the pins (the background's answer, with the changes this
//   tab asked for and has not heard back laid over it: a row's mark comes at the click), the words of the chats and
//   whether the pointer is over the list's column.
// - The background's answer is the truth: a change of another tab arrives as `changed`, a missed one is read again on
//   the tab's return to view; a timer reads at the nearest expiry (the read prunes, its answer sets the next timer). A
//   read answered after a newer change or event was taken says nothing of the pins; a first read that failed is asked
//   again after 1, 5 and 30 s.
// - Activity in a pinned chat — a person's message of either side the page saw, the page's own send, the chatter
//   opening the chat — tells the background at most once in 30 s per chat, leading and trailing, each with its own time.
//   Activity seen before the first answer is kept and told once after it.
// - Nothing moves under the pointer (a neighbour sliding under it is a click into the wrong chat, and opening a chat
//   marks it read): the strip's height and its chips change only while the pointer is not over the list's column, and
//   the chips also stand while the focus is in the strip — a chip taken off stays as an inert, invisible placeholder, a
//   new one waits — and the real set comes when they leave (the rules: domain/hosts/fansly/pins.ts `layPinChips`). Both
//   are decided here, not in the component.
// - A chip opens its chat through the page's own router by the person's click (a navigation token of the `pins`
//   surface); the open chat's own chip does nothing; a failed navigation leaves the chip. The header's button pins the
//   open chat once MAIN names it (asked again a few times); a newer pin or unpin of that chat, the switch off, another
//   creator or sign-in give a late answer up.

import type { FanslyChatMeta, FanslyPagePort } from '@cg/contracts/fansly';
import { FANSLY_PIN_LIMITS, type FanslyPin, type FanslyPinChip, type FanslyPinOp, type FanslyPinsClient, type FanslyPinsCopy, type FanslyPinsView } from '@cg/contracts/fansly-pins';

import { layPinChips, pinChat, pinChipClosed, pinChipEntered, pinHue, pinInitial, pinTargetOf, prunePins, touchChat, unpinChat, type ShownPin } from '../../../domain/hosts/fansly/pins';

export interface FanslyPinsDeps {
  readonly page: Pick<FanslyPagePort, 'rowPins' | 'words' | 'onActivity' | 'inboxPointer' | 'chatMeta'>;
  /** The creator the tab is on; null — none known yet. */
  creator(): string | null;
  /** The open chat: its group and whether it is known to be a group chat (no fan to pin it by); null — none. */
  openChat(): { readonly groupId: string; readonly group: boolean } | null;
  /** `fansly.pins.read`; null — no answer. */
  read(creator: string): Promise<{ readonly on: boolean; readonly pins: readonly FanslyPin[] } | null>;
  /** `fansly.pins.change`; null — no answer. */
  change(creator: string, op: FanslyPinOp): Promise<readonly FanslyPin[] | null>;
  /** The chat opened through the page's own router, by the person's click; false — it did not open. */
  navigate(target: { readonly creator: string; readonly fanId: string; readonly groupId: string }): Promise<boolean>;
  /** The words of the tab's language now. */
  copy(): FanslyPinsCopy;
  now(): number;
  readonly timers: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** Test builds only: the controller's state and counts after every change of it (the e2e's report). */
  readonly observe?: (stats: FanslyPinsStats) => void;
}

export interface FanslyPinsStats {
  readonly on: boolean | null;
  readonly creator: string | null;
  readonly pins: readonly string[];
  readonly chips: readonly { readonly groupId: string; readonly state: FanslyPinChip['state']; readonly waiting: boolean; readonly open: boolean }[];
  readonly height: 0 | 44;
  readonly visible: boolean;
  readonly held: boolean;
  readonly listInside: boolean;
  /** Test builds only (`observe`): requests made, and when the strip's chips last changed (epoch ms). */
  readonly counts: { readonly reads: number; readonly changes: number; readonly touches: number; readonly changedAt: number } | null;
}

export interface FanslyPinsController extends FanslyPinsClient {
  /** The creator or the open chat changed. */
  sync(): void;
  /** The background told every tab a creator's pins changed. */
  changed(creator: string, pins: readonly FanslyPin[]): void;
  /** «Закрепы чатов» switched on the settings page. */
  switched(on: boolean): void;
  /** The tab came back into view: read again (an event may have been missed meanwhile). */
  refresh(): void;
  /** Another sign-in, or none: a late answer of the header's pin is given up, the pins read again. */
  sessionChanged(): void;
  /** The switch is not off and the tab's creator is known: the header button and the rows' buttons may show. */
  active(): boolean;
  stats(): FanslyPinsStats;
  dispose(): void;
}

/** A chip enters over this long (its CSS), then it is plain `shown`. */
const ENTER_MS = 260;
/** A chip's place closes over this long (its fade, then its width), then it is gone. */
const CLOSE_MS = 320;
/** The strip folds over this long before its host goes. */
const FOLD_MS = 220;
/** A read after the nearest expiry, a little late: the background's clock decides. */
const EXPIRY_SLACK_MS = 1000;
/** A first read that got no answer is asked again after these pauses (then on the tab's return to view). */
const FIRST_READ_RETRY_MS = [1_000, 5_000, 30_000] as const;
/** The header's pin waits for MAIN to name the open chat: asked again this often, this many times. */
const META_RETRY_MS = 300;
const META_RETRIES = 4;
/** The strip is let go only when the pointer and the focus stay out of it this long. */
const RELEASE_MS = 60;

export function createFanslyPins(deps: FanslyPinsDeps): FanslyPinsController {
  const { page, timers } = deps;
  const STRIP = FANSLY_PIN_LIMITS.stripPx;
  let disposed = false;
  let on: boolean | null = null;
  /** The creator the pins held are of. */
  let owner: string | null = null;
  let pins: readonly FanslyPin[] = [];
  /** The background has answered for this creator. */
  let known = false;
  /** Grows with every answer and event taken: a read issued before a newer one says nothing of the pins. */
  let knowledge = 0;
  /** Changes asked and not answered yet, laid over every answer until theirs comes. */
  const pending = new Map<number, FanslyPinOp>();
  let serial = 0;
  /** The newest read: an older answer is not taken. */
  let readSerial = 0;
  let firstReadTries = 0;
  /** Activity seen before the first answer: the newest moment of each chat, told once after it. */
  const early = new Map<string, number>();
  /** The newest pin or unpin of each chat (the header's late answer of MAIN is given up by a newer one). */
  const intents = new Map<string, number>();
  let intentSerial = 0;
  let shown: readonly ShownPin[] = [];
  let height: 0 | typeof STRIP = 0;
  let folding = false;
  let held = false;
  let lastOpen: string | null = null;
  let expiry: { readonly handle: unknown; readonly at: number } | null = null;
  let foldTimer: unknown = null;
  let retryTimer: unknown = null;
  let releaseTimer: unknown = null;
  const timersOf = new Map<string, unknown>();
  const touches = new Map<string, { sentAt: number; owed: number | null; timer: unknown }>();
  const listeners = new Set<(view: FanslyPinsView) => void>();
  let view: FanslyPinsView = { visible: false, height: 0, chips: [], header: null };
  let viewKey = JSON.stringify(view);
  let rowsKey = '';
  const counts = deps.observe === undefined ? null : { reads: 0, changes: 0, touches: 0, changedAt: 0 };

  /** The switch is not off (on, or not read yet: the default is on) and the tab's creator is the one the pins are of. */
  const active = (): boolean => on !== false && owner !== null && owner === deps.creator();
  /** The pins the person has now: none while the switch is off, another creator is on the tab, or nothing was read yet. */
  const real = (): readonly FanslyPin[] => (active() && known ? pins : []);
  const pinned = (groupId: string): boolean => real().some((pin) => pin.groupId === groupId);

  const local = (list: readonly FanslyPin[], op: FanslyPinOp): readonly FanslyPin[] => {
    const now = deps.now();
    if (op.op === 'pin') return pinChat(prunePins(list, now), op.pin, now);
    if (op.op === 'unpin') return unpinChat(list, op.groupId);
    return touchChat(list, op.groupId, Math.min(op.at, now));
  };

  const later = (key: string, ms: number, run: () => void): void => {
    const old = timersOf.get(key);
    if (old !== undefined) timers.clear(old);
    timersOf.set(
      key,
      timers.set(() => {
        timersOf.delete(key);
        if (!disposed) run();
      }, ms),
    );
  };

  const take = (list: readonly FanslyPin[]): void => {
    const first = !known;
    pins = [...pending.values()].reduce(local, list);
    known = true;
    knowledge += 1;
    firstReadTries = 0;
    // The trailing touches of chats that are not pinned any more go.
    for (const [groupId, entry] of [...touches]) {
      if (pins.some((pin) => pin.groupId === groupId)) continue;
      if (entry.timer !== null) timers.clear(entry.timer);
      touches.delete(groupId);
    }
    update();
    if (first && early.size > 0) {
      const seen = [...early];
      early.clear();
      for (const [groupId, at] of seen) touch(groupId, at);
    }
  };

  // ── what the page and the strip show ──
  /** The chips as the rules allow them now (domain `layPinChips`): frozen while the pointer is over the list or in the strip. */
  const lay = (): void => {
    const frozen = held || page.inboxPointer.inside();
    const laid = layPinChips(shown, real(), frozen, shown.length > 0 && height === STRIP);
    shown = laid.shown;
    for (const groupId of laid.closing) {
      later(`close:${groupId}`, CLOSE_MS, () => {
        shown = pinChipClosed(shown, groupId);
        update();
      });
    }
    for (const groupId of laid.entering) {
      later(`in:${groupId}`, ENTER_MS, () => {
        shown = pinChipEntered(shown, groupId);
        update();
      });
    }
  };

  /** The height the strip may have: it moves only while the pointer is not over the list's column. */
  const settle = (): void => {
    const want: 0 | typeof STRIP = real().length > 0 || (held && shown.length > 0) ? STRIP : 0;
    if (want === height || page.inboxPointer.inside()) return;
    height = want;
    folding = height === 0;
    if (foldTimer !== null) timers.clear(foldTimer);
    foldTimer = null;
    if (folding) {
      foldTimer = timers.set(() => {
        foldTimer = null;
        folding = false;
        update();
      }, FOLD_MS);
    }
  };

  const compute = (): FanslyPinsView => {
    const open = deps.openChat();
    const visible = active() && known && (height === STRIP || folding || real().length > 0);
    const chips: FanslyPinChip[] = visible
      ? shown.map(({ pin, state }) => ({
          groupId: pin.groupId,
          name: pin.name,
          username: pin.username ?? null,
          initial: pinInitial(pin.name),
          hue: pinHue(pin.groupId),
          waiting: page.words.get(pin.groupId) === 'fan',
          open: open?.groupId === pin.groupId,
          state,
        }))
      : [];
    // The header's button does not wait for the pins (nothing of the header moves after it came); it stays unseen
    // until the switch is known, so a person who switched pins off never sees it come and go.
    const header = active() && open !== null && !open.group ? { pinned: pinned(open.groupId), settled: on !== null } : null;
    return { visible, height, chips, header };
  };

  const rows = (): void => {
    const list = real();
    const words = deps.copy();
    const shows = active() && known;
    const key = shows ? `${list.map((pin) => pin.groupId).join(',')}|${words.pin}|${words.unpin}` : 'off';
    if (key === rowsKey) return;
    rowsKey = key;
    page.rowPins.set(shows ? { pinned: new Set(list.map((pin) => pin.groupId)), words: { pin: words.pin, unpin: words.unpin } } : null);
  };

  /** One timer to the nearest expiry, set again only when that moment moved. */
  const arm = (): void => {
    const list = real();
    const at = list.length === 0 || owner === null ? null : Math.min(...list.map((pin) => pin.touchedAt)) + FANSLY_PIN_LIMITS.quietMs + EXPIRY_SLACK_MS;
    if (at === (expiry?.at ?? null)) return;
    if (expiry !== null) timers.clear(expiry.handle);
    expiry = null;
    if (at === null) return;
    expiry = {
      at,
      handle: timers.set(() => {
        expiry = null;
        if (!disposed) read();
      }, Math.max(0, at - deps.now())),
    };
  };

  const stats = (): FanslyPinsStats => ({
    on,
    creator: owner,
    pins: real().map((pin) => pin.groupId),
    chips: view.chips.map((chip) => ({ groupId: chip.groupId, state: chip.state, waiting: chip.waiting, open: chip.open })),
    height: view.height,
    visible: view.visible,
    held,
    listInside: page.inboxPointer.inside(),
    counts: counts === null ? null : { ...counts },
  });

  function update(): void {
    if (disposed) return;
    lay();
    settle();
    rows();
    arm();
    const next = compute();
    const key = JSON.stringify(next);
    if (key !== viewKey) {
      if (counts !== null && JSON.stringify(next.chips.map((chip) => [chip.groupId, chip.state])) !== JSON.stringify(view.chips.map((chip) => [chip.groupId, chip.state]))) counts.changedAt = deps.now();
      view = next;
      viewKey = key;
      for (const listener of [...listeners]) listener(view);
    }
    deps.observe?.(stats());
  }

  // ── the background ──
  function read(): void {
    const creator = owner;
    if (creator === null || disposed) return;
    const mine = (readSerial += 1);
    const since = knowledge;
    if (counts !== null) counts.reads += 1;
    const failed = (): void => {
      // A first read with no answer is asked again a little later; once something is known, the next event says more.
      if (disposed || owner !== creator || known || mine !== readSerial || firstReadTries >= FIRST_READ_RETRY_MS.length) return;
      const pause = FIRST_READ_RETRY_MS[firstReadTries] ?? 30_000;
      firstReadTries += 1;
      if (retryTimer !== null) timers.clear(retryTimer);
      retryTimer = timers.set(() => {
        retryTimer = null;
        if (!disposed && !known) read();
      }, pause);
    };
    void deps.read(creator).then((answer) => {
      if (disposed || owner !== creator || mine !== readSerial) return;
      if (answer === null) {
        failed();
        return;
      }
      on = answer.on;
      // Something newer was taken while this read waited: its pins are older than what the tab knows.
      if (knowledge !== since) update();
      else take(answer.pins);
    }, failed);
  }

  const bump = (groupId: string): number => {
    intentSerial += 1;
    intents.set(groupId, intentSerial);
    return intentSerial;
  };

  const ask = (op: FanslyPinOp): void => {
    const creator = owner;
    if (creator === null || !active()) return;
    const id = (serial += 1);
    pending.set(id, op);
    if (op.op !== 'touch') {
      bump(op.op === 'pin' ? op.pin.groupId : op.groupId);
      pins = local(pins, op);
      update();
    }
    if (counts !== null) {
      if (op.op === 'touch') counts.touches += 1;
      else counts.changes += 1;
    }
    void deps.change(creator, op).then(
      (answer) => {
        pending.delete(id);
        if (disposed || owner !== creator) return;
        if (answer === null) read();
        else take(answer);
      },
      () => {
        pending.delete(id);
        if (!disposed && owner === creator) read();
      },
    );
  };

  /** Activity in a pinned chat: at most one touch per chat in 30 s, leading and trailing, each with its own moment. */
  function touch(groupId: string, at: number): void {
    if (!known) {
      // Before the first answer nobody knows what is pinned: kept, and told once after it.
      if (owner !== null) early.set(groupId, Math.max(early.get(groupId) ?? 0, at));
      return;
    }
    if (!pinned(groupId)) return;
    const now = deps.now();
    const entry = touches.get(groupId);
    if (entry === undefined || now - entry.sentAt >= FANSLY_PIN_LIMITS.touchEveryMs) {
      if (entry !== undefined && entry.timer !== null) timers.clear(entry.timer);
      touches.set(groupId, { sentAt: now, owed: null, timer: null });
      ask({ op: 'touch', groupId, at });
      return;
    }
    entry.owed = Math.max(entry.owed ?? 0, at);
    if (entry.timer !== null) return;
    entry.timer = timers.set(() => {
      entry.timer = null;
      const owed = entry.owed;
      entry.owed = null;
      if (owed === null || disposed) return;
      entry.sentAt = deps.now();
      if (pinned(groupId)) ask({ op: 'touch', groupId, at: owed });
      else touches.delete(groupId);
    }, entry.sentAt + FANSLY_PIN_LIMITS.touchEveryMs - now);
  }

  const pinMeta = (meta: FanslyChatMeta & { readonly fanId: string }): void => {
    if (!active()) return;
    if (pinned(meta.groupId)) ask({ op: 'unpin', groupId: meta.groupId });
    else ask({ op: 'pin', pin: pinTargetOf(meta, deps.copy().chat) });
  };

  const clearTimers = (): void => {
    for (const handle of timersOf.values()) timers.clear(handle);
    timersOf.clear();
    for (const entry of touches.values()) if (entry.timer !== null) timers.clear(entry.timer);
    touches.clear();
  };

  const forget = (): void => {
    pins = [];
    known = false;
    pending.clear();
    early.clear();
    intents.clear();
    shown = [];
    height = 0;
    folding = false;
    held = false;
    if (releaseTimer !== null) timers.clear(releaseTimer);
    releaseTimer = null;
    firstReadTries = 0;
    if (retryTimer !== null) timers.clear(retryTimer);
    retryTimer = null;
    clearTimers();
  };

  const sync = (): void => {
    if (disposed) return;
    const creator = deps.creator();
    if (creator !== owner) {
      // Another creator on the tab: everything of the old one goes at once, then the new one's pins are read.
      owner = creator;
      forget();
      lastOpen = null;
      update();
      read();
    }
    const open = deps.openChat()?.groupId ?? null;
    if (open !== lastOpen) {
      lastOpen = open;
      // The chatter opening a pinned chat is its activity.
      if (open !== null) touch(open, deps.now());
    }
    update();
  };

  const offs = [
    page.rowPins.onToggle((meta) => pinMeta(meta)),
    page.words.onChange(() => update()),
    page.onActivity(({ groupId, at }) => touch(groupId, at)),
    page.inboxPointer.onChange(() => update()),
  ];

  return {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(groupId) {
      const creator = owner;
      const pin = real().find((item) => item.groupId === groupId);
      if (creator === null || pin === undefined || deps.openChat()?.groupId === groupId) return;
      void deps.navigate({ creator, fanId: pin.fanId, groupId }).catch(() => false);
    },
    unpin(groupId) {
      if (pinned(groupId)) ask({ op: 'unpin', groupId });
    },
    toggleOpen() {
      const open = deps.openChat();
      if (open === null || open.group || !active()) return;
      if (pinned(open.groupId)) {
        ask({ op: 'unpin', groupId: open.groupId });
        return;
      }
      const creator = owner;
      const intent = bump(open.groupId);
      const attempt = (left: number): void => {
        void page.chatMeta(open.groupId).then((meta) => {
          // The same creator, the same chat still open, the switch still on, and no newer pin or unpin of it meanwhile.
          if (disposed || owner !== creator || intents.get(open.groupId) !== intent || !active() || deps.openChat()?.groupId !== open.groupId) return;
          if (meta === null) {
            if (left > 0) later(`meta:${open.groupId}`, META_RETRY_MS, () => attempt(left - 1));
            return;
          }
          if (meta.kind !== 'direct' || meta.fanId === null || pinned(open.groupId)) return;
          ask({ op: 'pin', pin: pinTargetOf({ ...meta, fanId: meta.fanId }, deps.copy().chat) });
        }, () => undefined);
      };
      attempt(META_RETRIES);
    },
    hold(inside) {
      // A leave undone at once (Firefox says leave and enter again between two chips) frees nothing.
      if (releaseTimer !== null) timers.clear(releaseTimer);
      releaseTimer = null;
      if (inside) {
        if (held) return;
        held = true;
        update();
        return;
      }
      if (!held) return;
      releaseTimer = timers.set(() => {
        releaseTimer = null;
        if (disposed || !held) return;
        held = false;
        update();
      }, RELEASE_MS);
    },
    sync,
    changed(creator, list) {
      if (disposed || creator !== owner) return;
      take(list);
    },
    switched(next) {
      if (disposed || next === on) return;
      on = next;
      intents.clear();
      if (on) {
        // Back on: what changed meanwhile (other tabs, expiries) is read again.
        read();
      } else {
        // Off: the strip is gone; switched on again, it comes as for the first pin (never under the pointer).
        shown = [];
        height = 0;
        folding = false;
        clearTimers();
      }
      update();
    },
    refresh: () => read(),
    sessionChanged() {
      intents.clear();
      read();
    },
    active,
    stats,
    dispose() {
      disposed = true;
      for (const off of offs.splice(0)) off();
      if (expiry !== null) timers.clear(expiry.handle);
      if (foldTimer !== null) timers.clear(foldTimer);
      forget();
      listeners.clear();
      page.rowPins.set(null);
    },
  };
}
