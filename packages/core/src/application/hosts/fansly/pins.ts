// Temporary chat pins in a Fansly tab (2026-11-12; contracts fansly-pins.ts): the controller between the background's
// pins of the tab's creator, the page's rows and the strip and the header button the UI draws. No DOM, no request.
//
// - It holds the person's switch, the creator, the open chat, the pins (the background's answer, with the changes this
//   tab asked for and has not heard back laid over it: a row's mark comes at the click), the words of the chats and
//   whether the pointer is over the list's column.
// - The background's answer is the truth: a change of another tab arrives as `changed`, a missed one is read again on
//   the tab's return to view; a timer reads at the nearest expiry (the read prunes, its answer sets the next timer).
// - Activity in a pinned chat — a person's message of either side the page saw, the page's own send, the chatter
//   opening the chat — tells the background at most once in 30 s per chat, leading and trailing, each with its own time.
// - Nothing moves under the pointer (a neighbour sliding under it is a click into the wrong chat, and opening a chat
//   marks it read): the strip's height changes only while the pointer is not over the list's column; while the pointer
//   or the focus is in the strip its whole layout stands — a chip taken off stays as an inert, invisible placeholder,
//   a new one waits — and the real set comes when they leave. Both are decided here, not in the component.
// - A chip opens its chat through the page's own router by the person's click (a navigation token of the `pins`
//   surface); the open chat's own chip does nothing; a failed navigation leaves the chip.

import type { FanslyChatMeta, FanslyPagePort } from '@cg/contracts/fansly';
import { FANSLY_PIN_LIMITS, type FanslyPin, type FanslyPinChip, type FanslyPinOp, type FanslyPinsClient, type FanslyPinsCopy, type FanslyPinsView, type FanslyPinTarget } from '@cg/contracts/fansly-pins';

import { pinChat, prunePins, touchChat, unpinChat } from '../../../domain/hosts/fansly/pins';

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
  readonly reads: number;
  readonly changes: number;
  readonly touches: number;
  /** When the strip's chips last changed (epoch ms): another tab's change is timed by it. */
  readonly changedAt: number;
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
  /** The switch is on and the tab's creator is known: the header button and the rows' buttons may show. */
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

/** The circle's hue from the group id: the same chat, the same colour, in every tab. */
export function pinHue(groupId: string): number {
  // FNV-1a over the id's digits, spread by the golden ratio: neighbouring ids (one creator's chats) land far apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < groupId.length; i += 1) hash = Math.imul(hash ^ groupId.charCodeAt(i), 0x01000193) >>> 0;
  return Math.floor(((hash * 0.618033988749895) % 1) * 360);
}

/** The circle's letter: the name's first letter or digit, upper case; `#` when there is none. */
export function pinInitial(name: string): string {
  const letter = [...name.replace(/^@/, '')].find((char) => /[\p{L}\p{N}]/u.test(char));
  return letter === undefined ? '#' : letter.toLocaleUpperCase();
}

const cut = (text: string, max: number): string => {
  const chars = [...text.trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
};

/** A pin of a chat as MAIN names it: the creator's own name for the fan first, then the display name, then the handle. */
export function pinTargetOf(meta: FanslyChatMeta & { readonly fanId: string }, fallback: string): FanslyPinTarget {
  const username = meta.username !== null && /^[A-Za-z0-9_.-]{1,64}$/.test(meta.username) ? meta.username : null;
  const named = meta.customName ?? meta.displayName ?? (username === null ? null : `@${username}`);
  const name = cut(named === null || named.trim() === '' ? fallback : named, FANSLY_PIN_LIMITS.nameMaxChars);
  return { groupId: meta.groupId, fanId: meta.fanId, name, ...(username === null ? {} : { username }) };
}

interface Shown {
  readonly pin: FanslyPin;
  readonly state: FanslyPinChip['state'];
}

export function createFanslyPins(deps: FanslyPinsDeps): FanslyPinsController {
  const { page, timers } = deps;
  let disposed = false;
  let on: boolean | null = null;
  /** The creator the pins held are of. */
  let owner: string | null = null;
  let pins: readonly FanslyPin[] = [];
  /** The background has answered for this creator. */
  let known = false;
  /** Changes asked and not answered yet, laid over every answer until theirs comes. */
  const pending = new Map<number, FanslyPinOp>();
  let serial = 0;
  /** The newest read: an older answer is not taken. */
  let readSerial = 0;
  let shown: Shown[] = [];
  let height: 0 | 44 = 0;
  let folding = false;
  let held = false;
  let lastOpen: string | null = null;
  let reads = 0;
  let changes = 0;
  let touchesSent = 0;
  let changedAt = 0;
  let expiry: unknown = null;
  let foldTimer: unknown = null;
  const chipTimers = new Map<string, unknown>();
  const touches = new Map<string, { sentAt: number; owed: number | null; timer: unknown }>();
  const listeners = new Set<(view: FanslyPinsView) => void>();
  let view: FanslyPinsView = { visible: false, height: 0, chips: [], header: null };
  let viewKey = JSON.stringify(view);
  let rowsKey = '';

  /** The switch is not off (on, or not read yet: the default is on) and the tab's creator is the one the pins are of. */
  const active = (): boolean => on !== false && owner !== null && owner === deps.creator();
  /** The pins the person has now: none while the switch is off, another creator is on the tab, or nothing was read yet. */
  const real = (): readonly FanslyPin[] => (active() && known ? pins : []);

  const local = (list: readonly FanslyPin[], op: FanslyPinOp): readonly FanslyPin[] => {
    const now = deps.now();
    if (op.op === 'pin') return pinChat(prunePins(list, now), op.pin, now);
    if (op.op === 'unpin') return unpinChat(list, op.groupId);
    return touchChat(list, op.groupId, Math.min(op.at, now));
  };
  const take = (list: readonly FanslyPin[]): void => {
    pins = [...pending.values()].reduce(local, list);
    known = true;
    update();
  };

  // ── what the page and the strip show ──
  const later = (key: string, ms: number, run: () => void): void => {
    const old = chipTimers.get(key);
    if (old !== undefined) timers.clear(old);
    chipTimers.set(key, timers.set(() => {
      chipTimers.delete(key);
      if (!disposed) run();
    }, ms));
  };

  /** The chips as the rules allow them now: frozen while held, the real set otherwise. */
  const lay = (): void => {
    const now = real();
    const byId = new Map(now.map((pin) => [pin.groupId, pin]));
    const next: Shown[] = [];
    const strip = shown.length > 0 && height === 44;
    for (const entry of shown) {
      const pin = byId.get(entry.pin.groupId);
      if (held) {
        // Frozen: a chip taken off stays as an inert placeholder; the names stay as they are.
        next.push(pin === undefined && entry.state !== 'closing' ? { pin: entry.pin, state: 'tombstone' } : entry);
        continue;
      }
      if (pin === undefined) {
        if (entry.state !== 'closing') later(`close:${entry.pin.groupId}`, CLOSE_MS, () => {
          shown = shown.filter((item) => !(item.pin.groupId === entry.pin.groupId && item.state === 'closing'));
          update();
        });
        next.push({ pin: entry.pin, state: 'closing' });
      } else next.push({ pin, state: entry.state === 'tombstone' || entry.state === 'closing' ? 'shown' : entry.state });
    }
    if (!held) {
      for (const pin of now) {
        if (next.some((entry) => entry.pin.groupId === pin.groupId && entry.state !== 'closing')) continue;
        // A chip pinned again while its place was closing takes that place back.
        const closing = next.findIndex((entry) => entry.pin.groupId === pin.groupId);
        const entering: Shown = { pin, state: strip ? 'in' : 'shown' };
        if (closing >= 0) next[closing] = entering;
        else next.push(entering);
        if (entering.state === 'in') later(`in:${pin.groupId}`, ENTER_MS, () => {
          shown = shown.map((item) => (item.pin.groupId === pin.groupId && item.state === 'in' ? { pin: item.pin, state: 'shown' } : item));
          update();
        });
      }
      // The strip's order is the pins' order; places still closing keep theirs.
      const rank = new Map(now.map((pin, i) => [pin.groupId, i]));
      const live = next.filter((entry) => entry.state !== 'closing').sort((a, b) => (rank.get(a.pin.groupId) ?? 0) - (rank.get(b.pin.groupId) ?? 0));
      let at = 0;
      for (let i = 0; i < next.length; i += 1) if ((next[i] as Shown).state !== 'closing') next[i] = live[at++] as Shown;
    }
    shown = next;
  };

  /** The height the strip may have: it moves only while the pointer is not over the list's column. */
  const settle = (): void => {
    const want: 0 | 44 = real().length > 0 || (held && shown.length > 0) ? 44 : 0;
    if (want === height || page.inboxPointer.inside()) return;
    height = want;
    if (height === 0) {
      folding = true;
      if (foldTimer !== null) timers.clear(foldTimer);
      foldTimer = timers.set(() => {
        foldTimer = null;
        folding = false;
        update();
      }, FOLD_MS);
    } else folding = false;
  };

  const compute = (): FanslyPinsView => {
    const open = deps.openChat();
    const copy = deps.copy();
    const chips: FanslyPinChip[] = shown.map(({ pin, state }) => ({
      groupId: pin.groupId,
      name: pin.name || copy.chat,
      username: pin.username ?? null,
      initial: pinInitial(pin.name),
      hue: pinHue(pin.groupId),
      waiting: page.words.get(pin.groupId) === 'fan',
      open: open?.groupId === pin.groupId,
      state,
    }));
    const visible = active() && known && (height === 44 || folding || real().length > 0);
    // The header's button does not wait for the pins (nothing of the header moves after it came): pinned once known.
    const header = active() && open !== null && !open.group ? { pinned: real().some((pin) => pin.groupId === open.groupId) } : null;
    return { visible, height, chips: visible ? chips : [], header };
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

  const arm = (): void => {
    if (expiry !== null) timers.clear(expiry);
    expiry = null;
    const list = real();
    if (list.length === 0 || owner === null) return;
    const nearest = Math.min(...list.map((pin) => pin.touchedAt)) + FANSLY_PIN_LIMITS.quietMs - deps.now();
    expiry = timers.set(() => {
      expiry = null;
      if (!disposed) read();
    }, Math.max(0, nearest) + EXPIRY_SLACK_MS);
  };

  function update(): void {
    if (disposed) return;
    lay();
    settle();
    rows();
    arm();
    const next = compute();
    const key = JSON.stringify(next);
    if (key !== viewKey) {
      const chipsBefore = JSON.stringify(view.chips.map((chip) => [chip.groupId, chip.state]));
      view = next;
      viewKey = key;
      if (JSON.stringify(next.chips.map((chip) => [chip.groupId, chip.state])) !== chipsBefore) changedAt = deps.now();
    }
    // Said after every change of state: the same view object when nothing it shows moved (a component keeps its render).
    for (const listener of [...listeners]) listener(view);
  }

  // ── the background ──
  function read(): void {
    const creator = owner;
    if (creator === null || disposed) return;
    const mine = (readSerial += 1);
    reads += 1;
    void deps.read(creator).then((answer) => {
      if (disposed || answer === null || owner !== creator || mine !== readSerial) return;
      on = answer.on;
      take(answer.pins);
    }, () => undefined);
  }

  const ask = (op: FanslyPinOp): void => {
    const creator = owner;
    if (creator === null || !active()) return;
    const id = (serial += 1);
    pending.set(id, op);
    if (op.op !== 'touch') {
      pins = local(pins, op);
      update();
    }
    changes += op.op === 'touch' ? 0 : 1;
    touchesSent += op.op === 'touch' ? 1 : 0;
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
  const touch = (groupId: string, at: number): void => {
    if (!real().some((pin) => pin.groupId === groupId)) return;
    const now = deps.now();
    const entry = touches.get(groupId);
    if (entry === undefined || now - entry.sentAt >= FANSLY_PIN_LIMITS.touchEveryMs) {
      if (entry?.timer !== undefined && entry.timer !== null) timers.clear(entry.timer);
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
      if (real().some((pin) => pin.groupId === groupId)) ask({ op: 'touch', groupId, at: owed });
    }, entry.sentAt + FANSLY_PIN_LIMITS.touchEveryMs - now);
  };

  const pinMeta = (meta: FanslyChatMeta & { readonly fanId: string }): void => {
    if (!active()) return;
    if (real().some((pin) => pin.groupId === meta.groupId)) ask({ op: 'unpin', groupId: meta.groupId });
    else ask({ op: 'pin', pin: pinTargetOf(meta, deps.copy().chat) });
  };

  const forget = (): void => {
    pins = [];
    known = false;
    pending.clear();
    shown = [];
    height = 0;
    folding = false;
    held = false;
    for (const handle of chipTimers.values()) timers.clear(handle);
    chipTimers.clear();
    for (const entry of touches.values()) if (entry.timer !== null) timers.clear(entry.timer);
    touches.clear();
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
      if (real().some((pin) => pin.groupId === groupId)) ask({ op: 'unpin', groupId });
    },
    toggleOpen() {
      const open = deps.openChat();
      if (open === null || open.group || !active()) return;
      if (real().some((pin) => pin.groupId === open.groupId)) {
        ask({ op: 'unpin', groupId: open.groupId });
        return;
      }
      const creator = owner;
      void page.chatMeta(open.groupId).then((meta) => {
        // The same creator, the same chat still open, the switch still on, and not pinned meanwhile.
        if (disposed || owner !== creator || meta === null || meta.kind !== 'direct' || meta.fanId === null || deps.openChat()?.groupId !== open.groupId) return;
        if (!active() || real().some((pin) => pin.groupId === open.groupId)) return;
        ask({ op: 'pin', pin: pinTargetOf({ ...meta, fanId: meta.fanId }, deps.copy().chat) });
      }, () => undefined);
    },
    hold(inside) {
      if (inside === held) return;
      held = inside;
      update();
    },
    sync,
    changed(creator, list) {
      if (disposed || creator !== owner) return;
      take(list);
    },
    switched(next) {
      if (disposed || next === on) return;
      on = next;
      // Back on: what changed meanwhile (other tabs, expiries) is read again.
      if (on) read();
      update();
    },
    refresh: () => read(),
    active,
    stats: () => ({
      on,
      creator: owner,
      pins: real().map((pin) => pin.groupId),
      chips: view.chips.map((chip) => ({ groupId: chip.groupId, state: chip.state, waiting: chip.waiting, open: chip.open })),
      height: view.height,
      visible: view.visible,
      held,
      listInside: page.inboxPointer.inside(),
      reads,
      changes,
      touches: touchesSent,
      changedAt,
    }),
    dispose() {
      disposed = true;
      for (const off of offs.splice(0)) off();
      if (expiry !== null) timers.clear(expiry);
      if (foldTimer !== null) timers.clear(foldTimer);
      forget();
      listeners.clear();
      page.rowPins.set(null);
    },
  };
}
