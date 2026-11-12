// The rules of temporary chat pins on Fansly (2026-11-12; contracts fansly-pins.ts), pure over a creator's list and a
// moment: what the background applies to the stored pins (services/hosts/fansly/pins.ts) and nothing else does.
//
// - A pin lives while its chat had activity within six hours (`touchedAt`); an older one is gone at the next read.
// - Pinning a chat that is pinned keeps its place and its `pinnedAt` (the strip's order never changes by itself); a new
//   one goes last. Past the limit the quietest of the others goes (the smallest `touchedAt`, then the oldest pinned).
// - A touch only ever moves `touchedAt` forward and never brings back a pin that is gone — nor one already quiet for six
//   hours that no read pruned yet.
// - Inside one operation the touch is applied before the prune: activity seen just before the boundary keeps the pin
//   even when the background hears of it just after.
// - The stored value is one person's: an envelope of another owner (another ChatGoose user signed in on this browser)
//   is read as nothing.

import type { FanslyChatMeta } from '@cg/contracts/fansly';
import { FANSLY_PIN_LIMITS, FanslyPinSchema, type FanslyPin, type FanslyPinChip, type FanslyPinOp, type FanslyPinTarget } from '@cg/contracts/fansly-pins';

import { isPlainRecord, jsonUtf8Bytes } from '../../storage/json';

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

/**
 * Activity at `at` in a pinned chat: its `touchedAt` forward, never back; a chat not pinned stays not pinned, and a pin
 * already quiet for six hours at `at` is not brought back (the next prune takes it).
 */
export function touchChat(pins: readonly FanslyPin[], groupId: string, at: number): readonly FanslyPin[] {
  const index = pins.findIndex((pin) => pin.groupId === groupId);
  const old = index < 0 ? undefined : pins[index];
  if (old === undefined || at <= old.touchedAt || at - old.touchedAt >= FANSLY_PIN_LIMITS.quietMs) return pins;
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

/**
 * The stored value as `owner` may read it: every creator's pins that read, in their order. Another owner's value, an
 * unknown version or anything else reads as none (`foreign` — there was a value, and it is not this owner's).
 */
export function readPinStore(raw: unknown, owner: string): { readonly accounts: Readonly<Record<string, readonly FanslyPin[]>>; readonly foreign: boolean } {
  if (raw === undefined || raw === null) return { accounts: {}, foreign: false };
  if (!isPlainRecord(raw) || raw['v'] !== PIN_STORE_VERSION || raw['owner'] !== owner || !isPlainRecord(raw['accounts'])) return { accounts: {}, foreign: true };
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

/**
 * The value to store: every creator's pins alive at `now`, a creator with none dropped. Past `maxBytes` — the last
 * resort, far above a working day (six pins of every creator worked on within six hours) — the creators whose newest
 * activity is the oldest go first, never `keep` (the creator just written).
 */
export function pinStoreOf(owner: string, accounts: Readonly<Record<string, readonly FanslyPin[]>>, now: number, keep: string, maxBytes: number): PinStore {
  const live: Record<string, readonly FanslyPin[]> = {};
  for (const [creator, pins] of Object.entries(accounts)) {
    const alive = prunePins(pins, now);
    if (alive.length > 0) live[creator] = alive;
  }
  const newest = (creator: string): number => Math.max(...(live[creator] ?? []).map((pin) => pin.touchedAt));
  let store: PinStore = { v: PIN_STORE_VERSION, owner, accounts: live };
  while ((jsonUtf8Bytes(store) ?? 0) > maxBytes) {
    const others = Object.keys(store.accounts).filter((creator) => creator !== keep);
    if (others.length === 0) break;
    const oldest = others.reduce((a, b) => (newest(b) < newest(a) ? b : a));
    const { [oldest]: _gone, ...rest } = store.accounts;
    store = { ...store, accounts: rest };
  }
  return store;
}

// ── What a chip shows ─────────────────────────────────────────────────────────

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

/** A name within `max` UTF-16 units (the schema counts them), «…» at the cut, never half of a surrogate pair. */
export function cutPinName(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  let end = max - 1;
  const last = trimmed.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${trimmed.slice(0, end)}…`;
}

/**
 * A pin of a chat as MAIN names it: the creator's own name for the fan first, then the display name, then the handle
 * as it is, without «@» — Fansly's own row shows a fan who has no display name by the bare handle, in bold.
 */
export function pinTargetOf(meta: FanslyChatMeta & { readonly fanId: string }, fallback: string): FanslyPinTarget {
  const username = meta.username !== null && /^[A-Za-z0-9_.-]{1,64}$/.test(meta.username) ? meta.username : null;
  const named = meta.customName ?? meta.displayName ?? username;
  const name = cutPinName(named === null || named.trim() === '' ? fallback : named, FANSLY_PIN_LIMITS.nameMaxChars);
  return { groupId: meta.groupId, fanId: meta.fanId, name, ...(username === null ? {} : { username }) };
}

// ── The strip's chips: nothing moves under the pointer ────────────────────────

/** A chip as the strip holds it: the pin it shows (its names as they were when it last could change) and its state. */
export interface ShownPin {
  readonly pin: FanslyPin;
  readonly state: FanslyPinChip['state'];
}

/**
 * Who holds the strip still: the pointer or the focus in the strip itself (`strip`), the pointer over the list's column
 * but not in the strip (`list`), or nobody (`none`).
 */
export type PinStripHold = 'strip' | 'list' | 'none';

/**
 * The strip's chips after the pins changed. A chip never leaves its place for another one: a chat pinned again takes
 * its own place back, a new one comes last.
 * - `strip`: nothing moves — a chip taken off is an inert placeholder of its own width (`tombstone`), a new one waits,
 *   every chip keeps its name.
 * - `list` (the person is on Fansly's rows, where a row's button pins): a chip taken off is a placeholder too, its
 *   place closes later (its neighbours would slide while the pointer may be on its way to them), and the chips that
 *   stand keep their names. But what moves no chip is done at once: a chat pinned again gets its chip back in its
 *   place, a new one comes last.
 * - `none`: the real set — a chip taken off (or a placeholder) closes its place, one pinned again while closing takes
 *   it back, a new one comes last, every chip takes its pin's name.
 * A chip that comes grows in (`in`) only into a strip that already stands (`standing`); else it is simply there, to
 * come with the strip. `closing` and `entering` name the chips that began to close or to enter now: their timers are
 * the caller's.
 */
export function layPinChips(shown: readonly ShownPin[], real: readonly FanslyPin[], hold: PinStripHold, standing: boolean): { readonly shown: readonly ShownPin[]; readonly closing: readonly string[]; readonly entering: readonly string[] } {
  const byId = new Map(real.map((pin) => [pin.groupId, pin]));
  const gone = (entry: ShownPin): boolean => entry.state === 'closing' || entry.state === 'tombstone';
  const placeholder = (entry: ShownPin): ShownPin => (gone(entry) ? entry : { pin: entry.pin, state: 'tombstone' });
  if (hold === 'strip') {
    return { shown: shown.map((entry) => (byId.has(entry.pin.groupId) ? entry : placeholder(entry))), closing: [], entering: [] };
  }
  const closing: string[] = [];
  const entering: string[] = [];
  const next: ShownPin[] = shown.map((entry) => {
    const pin = byId.get(entry.pin.groupId);
    if (pin === undefined) {
      if (hold === 'list') return placeholder(entry);
      if (entry.state !== 'closing') closing.push(entry.pin.groupId);
      return { pin: entry.pin, state: 'closing' };
    }
    if (hold === 'list') return gone(entry) ? { pin, state: 'shown' } : entry;
    return { pin, state: entry.state === 'in' ? 'in' : 'shown' };
  });
  for (const pin of real) {
    if (next.some((entry) => entry.pin.groupId === pin.groupId)) continue;
    next.push({ pin, state: standing ? 'in' : 'shown' });
    if (standing) entering.push(pin.groupId);
  }
  return { shown: next, closing, entering };
}

/** A closing chip's place has closed: it is gone (a chip pinned again meanwhile is not closing any more and stays). */
export function pinChipClosed(shown: readonly ShownPin[], groupId: string): readonly ShownPin[] {
  return shown.filter((entry) => !(entry.pin.groupId === groupId && entry.state === 'closing'));
}

/** An entering chip has grown into its place. */
export function pinChipEntered(shown: readonly ShownPin[], groupId: string): readonly ShownPin[] {
  return shown.map((entry) => (entry.pin.groupId === groupId && entry.state === 'in' ? { pin: entry.pin, state: 'shown' } : entry));
}
