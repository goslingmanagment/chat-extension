// The rules of temporary chat pins on Fansly (2026-11-12; contracts fansly-pins.ts), pure over a creator's list and a
// moment: what the background applies to the stored pins (services/hosts/fansly/pins.ts) and nothing else does.
//
// - A pin lives while its chat had activity within six hours (`touchedAt`); an older one is gone at the next read.
// - Pinning a chat that is pinned keeps its place and its `pinnedAt` (the strip's order never changes by itself); a new
//   one goes last. Past the limit the quietest of the others goes (the smallest `touchedAt`, then the oldest pinned).
// - A touch only ever moves `touchedAt` forward and never brings back a pin that is gone.
// - Inside one operation the touch is applied before the prune: activity seen just before the boundary keeps the pin
//   even when the background hears of it just after.
// - The stored value is one person's: an envelope of another owner (another ChatGoose user signed in on this browser)
//   is read as nothing.

import { FANSLY_PIN_LIMITS, FanslyPinSchema, type FanslyPin, type FanslyPinOp, type FanslyPinTarget } from '@cg/contracts/fansly-pins';

/** The pin had activity within the quiet time; a `touchedAt` after now (another tab's clock) is alive. */
export const pinAlive = (pin: FanslyPin, now: number): boolean => now - pin.touchedAt < FANSLY_PIN_LIMITS.quietMs;

/** The pins still alive at `now`, in their order. The same array when none went. */
export function prunePins(pins: readonly FanslyPin[], now: number): readonly FanslyPin[] {
  const alive = pins.filter((pin) => pinAlive(pin, now));
  return alive.length === pins.length ? pins : alive;
}

/** A chat pinned: kept in its place with fresh names, or added last; the quietest other goes past the limit. */
export function pinChat(pins: readonly FanslyPin[], target: FanslyPinTarget, now: number): readonly FanslyPin[] {
  const names = { fanId: target.fanId, name: target.name, ...(target.username === undefined ? {} : { username: target.username }) };
  const index = pins.findIndex((pin) => pin.groupId === target.groupId);
  if (index >= 0) {
    const old = pins[index] as FanslyPin;
    const kept: FanslyPin = { groupId: old.groupId, ...names, pinnedAt: old.pinnedAt, touchedAt: Math.max(old.touchedAt, now) };
    return pins.map((pin, at) => (at === index ? kept : pin));
  }
  let next: FanslyPin[] = [...pins, { groupId: target.groupId, ...names, pinnedAt: now, touchedAt: now }];
  while (next.length > FANSLY_PIN_LIMITS.max) {
    const others = next.slice(0, -1);
    const quietest = others.reduce((a, b) => (b.touchedAt < a.touchedAt || (b.touchedAt === a.touchedAt && b.pinnedAt < a.pinnedAt) ? b : a));
    next = next.filter((pin) => pin !== quietest);
  }
  return next;
}

export function unpinChat(pins: readonly FanslyPin[], groupId: string): readonly FanslyPin[] {
  return pins.some((pin) => pin.groupId === groupId) ? pins.filter((pin) => pin.groupId !== groupId) : pins;
}

/** Activity at `at` in a pinned chat: its `touchedAt` forward, never back; a chat not pinned stays not pinned. */
export function touchChat(pins: readonly FanslyPin[], groupId: string, at: number): readonly FanslyPin[] {
  const index = pins.findIndex((pin) => pin.groupId === groupId);
  const old = index < 0 ? undefined : pins[index];
  if (old === undefined || at <= old.touchedAt) return pins;
  return pins.map((pin, i) => (i === index ? { ...pin, touchedAt: at } : pin));
}

/** One operation at `now`: a touch (its moment never after now) before the prune; a pin and an unpin after it. */
export function applyPinOp(pins: readonly FanslyPin[], op: FanslyPinOp, now: number): readonly FanslyPin[] {
  switch (op.op) {
    case 'touch':
      return prunePins(touchChat(pins, op.groupId, Math.min(op.at, now)), now);
    case 'pin':
      return pinChat(prunePins(pins, now), op.pin, now);
    case 'unpin':
      return unpinChat(prunePins(pins, now), op.groupId);
  }
}

/** Whether two lists show the same chips: the same chats in the same order under the same names. */
export function samePinChips(a: readonly FanslyPin[], b: readonly FanslyPin[]): boolean {
  return a.length === b.length && a.every((pin, i) => {
    const other = b[i];
    return other !== undefined && other.groupId === pin.groupId && other.fanId === pin.fanId && other.name === pin.name && other.username === pin.username;
  });
}

// ── The stored value: one key, one person ─────────────────────────────────────

export const PIN_STORE_VERSION = 1;

/** `fansly.pins` in storage.local: the owner (`<hubOrigin>|<userId>`) and each creator's pins. */
export interface PinStore {
  readonly v: typeof PIN_STORE_VERSION;
  readonly owner: string;
  readonly accounts: Readonly<Record<string, readonly FanslyPin[]>>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The stored value as `owner` may read it: every creator's pins that read, in their order. Another owner's value, an
 * unknown version or anything else reads as none (`foreign` — there was a value, and it is not this owner's).
 */
export function readPinStore(raw: unknown, owner: string): { readonly accounts: Readonly<Record<string, readonly FanslyPin[]>>; readonly foreign: boolean } {
  if (raw === undefined || raw === null) return { accounts: {}, foreign: false };
  if (!isRecord(raw) || raw['v'] !== PIN_STORE_VERSION || raw['owner'] !== owner || !isRecord(raw['accounts'])) return { accounts: {}, foreign: true };
  const accounts: Record<string, readonly FanslyPin[]> = {};
  for (const [creator, list] of Object.entries(raw['accounts'])) {
    if (!Array.isArray(list)) continue;
    const pins: FanslyPin[] = [];
    for (const item of list) {
      const parsed = FanslyPinSchema.safeParse(item);
      if (parsed.success && !pins.some((pin) => pin.groupId === parsed.data.groupId)) pins.push(parsed.data);
    }
    if (pins.length > 0) accounts[creator] = pins.slice(0, FANSLY_PIN_LIMITS.max);
  }
  return { accounts, foreign: false };
}

/** UTF-8 bytes of a JSON text (the storage budget counts them), without an encoder of the platform's. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The value to store: every creator's pins alive at `now`, a creator with none dropped; past `maxBytes` the creators
 * whose newest activity is the oldest go first, never `keep` (the creator just written).
 */
export function pinStoreOf(owner: string, accounts: Readonly<Record<string, readonly FanslyPin[]>>, now: number, keep: string, maxBytes: number): PinStore {
  const live: Record<string, readonly FanslyPin[]> = {};
  for (const [creator, pins] of Object.entries(accounts)) {
    const alive = prunePins(pins, now);
    if (alive.length > 0) live[creator] = alive;
  }
  const newest = (creator: string): number => Math.max(...(live[creator] ?? []).map((pin) => pin.touchedAt));
  let store: PinStore = { v: PIN_STORE_VERSION, owner, accounts: live };
  while (utf8Bytes(JSON.stringify(store)) > maxBytes) {
    const others = Object.keys(store.accounts).filter((creator) => creator !== keep);
    if (others.length === 0) break;
    const oldest = others.reduce((a, b) => (newest(b) < newest(a) ? b : a));
    const { [oldest]: _gone, ...rest } = store.accounts;
    store = { ...store, accounts: rest };
  }
  return store;
}
