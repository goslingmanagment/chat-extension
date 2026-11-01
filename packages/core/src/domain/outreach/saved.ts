// «Рассылки» kept on this computer (Dmitriy, 2026-11-01: «локально хранить состояние всех рассылок, чтобы можно было к
// любой вернуться с того же момента»): every outreach of a page with its text, who it is for, each fan's version, the
// person's words for it, what went and what came of it — so a reload of the page (Fansly loads a chat by its address
// when the site does not open it), a restart of the browser or another outreach started meanwhile never loses one.
//
// One key of storage.local (`outreach.saved`) every tab of the browser shares, per hub, user and page, so one person's
// outreaches never show to another. A write merges what the tab holds with what is stored, outreach by outreach and
// fan by fan: the newer outreach wins, and inside it a send that went (or may have) is never undone by a tab that still
// held the version unsent. Kept at most SAVED_TTL_MS after their last change, SAVED_PER_PAGE a page and SAVED_MAX_BYTES
// in all; the oldest go first. Pure: the controller reads and writes the key through its port.

import { type MoneyMills } from '@cg/contracts/primitives';
import { MEDIA_TYPES, type MediaType } from '@cg/contracts/send-media';

import { utf8Bytes } from '../newcomers/drafts';
import { DEFAULT_CONDITIONS, type OutreachConditions } from './audience';

export const OUTREACH_STORE_KEY = 'outreach.saved';
export const OUTREACH_STORE_VERSION = 1;
/** An outreach untouched this long is forgotten. */
export const SAVED_TTL_MS = 30 * 86_400_000;
/** Outreaches kept a page, the newest first. */
export const SAVED_PER_PAGE = 20;
/** After a reload the outreach open or folded when the page went comes back as its chip if it was kept this recently. */
export const OUTREACH_CHIP_BACK_MS = 30 * 60_000;
/** The key's whole budget; the oldest outreaches go first past it. */
export const SAVED_MAX_BYTES = 2 * 1024 * 1024;
/** A text kept at most this long (the window's own limit). */
const TEXT_MAX = 5_000;
/** Fans of one outreach at most (a batch takes 60; picked fans may be more). */
const FANS_MAX = 1_000;
const ID_MAX = 64;

/** A medium of the offer as it went (no picture: the vault's links expire). */
export interface SavedMedium {
  readonly id: string;
  readonly type: MediaType;
  readonly duration: number;
  readonly free: boolean;
}

export interface SavedMedia {
  readonly items: readonly SavedMedium[];
  readonly posts: number;
  readonly priceCents: number;
}

/** A send that went, may have, or was refused. One on its way when the tab went is `uncertain`: never sent again. */
export interface SavedSend {
  readonly state: 'sent' | 'uncertain' | 'failed';
  readonly code: string | null;
  readonly clickedAt: number | null;
  readonly at: number | null;
  /** The version as it went; null — not known (the card's own send). */
  readonly text: string | null;
  readonly media: SavedMedia | null;
}

/** What came of a send, as far as read. */
export interface SavedOutcome {
  readonly sentAt: number;
  readonly mills: MoneyMills | null;
  readonly paidIds: readonly string[];
  readonly bought: { readonly mills: MoneyMills | null; readonly at: string | null } | null;
  readonly replied: { readonly at: string; readonly text: string | null } | null;
  readonly checks: number;
}

export interface SavedFan {
  readonly fanRef: string;
  /** The name the board gave the fan, for the list once the board no longer lists them. */
  readonly name: string | null;
  /** Fix's version; null — none written (or it was not kept). */
  readonly version: string | null;
  /** The common text's revision the version was written from. */
  readonly revision: number;
  /** The person's own words for the version; null — Fix's stand. */
  readonly edit: string | null;
  readonly send: SavedSend | null;
  readonly outcome: SavedOutcome | null;
}

export type SavedSource = { readonly kind: 'tiers'; readonly on: readonly string[] } | { readonly kind: 'picked'; readonly fans: readonly string[] };

export interface SavedItem {
  readonly contentType: 1 | 2;
  readonly contentId: string;
}

export interface SavedOutreach {
  readonly id: string;
  /** `hubOrigin|userId|pageId`: whose outreach of which page. */
  readonly owner: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly text: string;
  readonly textRevision: number;
  readonly textChangedAt: number | null;
  readonly source: SavedSource | null;
  readonly conditions: OutreachConditions;
  readonly amountTyped: string;
  /** The fans of the outreach once its versions are written, in order; null — not written yet. */
  readonly locked: readonly string[] | null;
  readonly unticked: readonly string[];
  /** Fansly: the page's «Copied …» list as the outreach knew it, and the picked ones (`contentType:contentId`). */
  readonly items: readonly SavedItem[];
  readonly picked: readonly string[];
  /** The offer's media as the window showed them (ChatSpace's vault); null — none, or the site's own list. */
  readonly media: SavedMedia | null;
  readonly fans: readonly SavedFan[];
  /** The window was open or folded into its chip when last kept: after a reload its chip stands again. */
  readonly folded: boolean;
}

export interface OutreachStore {
  readonly v: typeof OUTREACH_STORE_VERSION;
  /** Newest first. */
  readonly outreaches: readonly SavedOutreach[];
  /** The outreach each owner worked on last: it opens with the window. */
  readonly current: Readonly<Record<string, string>>;
}

export const EMPTY_OUTREACH_STORE: OutreachStore = { v: OUTREACH_STORE_VERSION, outreaches: [], current: {} };

export const outreachOwner = (hubOrigin: string, userId: number, pageId: number): string => `${hubOrigin}|${userId}|${pageId}`;

// ── reading what is stored: whatever shape it has, never thrown on ──

type Rec = Readonly<Record<string, unknown>>;
const isRec = (value: unknown): value is Rec => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= ID_MAX;
const text = (value: unknown): string | null => (typeof value === 'string' ? value.slice(0, TEXT_MAX) : null);
const timeOrNull = (value: unknown): number | null => (isTime(value) ? value : null);
const ids = (value: unknown, max = FANS_MAX): string[] => (Array.isArray(value) ? value.filter(isId).slice(0, max) : []);
const KNOWN_MEDIA: readonly string[] = MEDIA_TYPES;

function mediaOf(value: unknown): SavedMedia | null {
  if (!isRec(value) || !Array.isArray(value['items']) || !isCount(value['posts']) || !isCount(value['priceCents'])) return null;
  const items = value['items'].flatMap((item): SavedMedium[] =>
    isRec(item) && isId(item['id']) && typeof item['type'] === 'string' && KNOWN_MEDIA.includes(item['type']) && isTime(item['duration']) && typeof item['free'] === 'boolean'
      ? [{ id: item['id'], type: item['type'] as MediaType, duration: item['duration'], free: item['free'] }]
      : [],
  );
  return { items: items.slice(0, 40), posts: value['posts'], priceCents: value['priceCents'] };
}

function sendOf(value: unknown): SavedSend | null {
  if (!isRec(value)) return null;
  const state = value['state'];
  if (state !== 'sent' && state !== 'uncertain' && state !== 'failed') return null;
  return { state, code: typeof value['code'] === 'string' ? value['code'].slice(0, 64) : null, clickedAt: timeOrNull(value['clickedAt']), at: timeOrNull(value['at']), text: text(value['text']), media: mediaOf(value['media']) };
}

function outcomeOf(value: unknown): SavedOutcome | null {
  if (!isRec(value) || !isTime(value['sentAt']) || !isCount(value['checks'])) return null;
  const bought = isRec(value['bought']) ? { mills: isCount(value['bought']['mills']) ? value['bought']['mills'] : null, at: typeof value['bought']['at'] === 'string' ? value['bought']['at'] : null } : null;
  const replied = isRec(value['replied']) && typeof value['replied']['at'] === 'string' ? { at: value['replied']['at'], text: text(value['replied']['text']) } : null;
  return { sentAt: value['sentAt'], mills: isCount(value['mills']) ? value['mills'] : null, paidIds: ids(value['paidIds'], 40), bought, replied, checks: value['checks'] };
}

function fanOf(value: unknown): SavedFan | null {
  if (!isRec(value) || !isId(value['fanRef'])) return null;
  return {
    fanRef: value['fanRef'],
    name: typeof value['name'] === 'string' ? value['name'].slice(0, 200) : null,
    version: text(value['version']),
    revision: isCount(value['revision']) ? value['revision'] : 0,
    edit: text(value['edit']),
    send: sendOf(value['send']),
    outcome: outcomeOf(value['outcome']),
  };
}

function conditionsOf(value: unknown): OutreachConditions {
  if (!isRec(value)) return DEFAULT_CONDITIONS;
  const on = (id: keyof OutreachConditions): boolean => {
    const condition = value[id];
    return isRec(condition) && typeof condition['on'] === 'boolean' ? condition['on'] : DEFAULT_CONDITIONS[id].on;
  };
  const spent = value['spent'];
  const minMills = isRec(spent) && isCount(spent['minMills']) ? spent['minMills'] : DEFAULT_CONDITIONS.spent.minMills;
  return { spent: { on: on('spent'), minMills }, active: { on: on('active') }, notBought: { on: on('notBought') }, noWaiting: { on: on('noWaiting') }, noGone: { on: on('noGone') } };
}

function sourceOf(value: unknown): SavedSource | null {
  if (!isRec(value)) return null;
  if (value['kind'] === 'tiers') return { kind: 'tiers', on: ids(value['on'], 50) };
  if (value['kind'] === 'picked') return { kind: 'picked', fans: ids(value['fans']) };
  return null;
}

function outreachOf(value: unknown): SavedOutreach | null {
  if (!isRec(value) || !isId(value['id']) || typeof value['owner'] !== 'string' || value['owner'].length > 512 || !isTime(value['createdAt']) || !isTime(value['updatedAt'])) return null;
  const seen = new Set<string>();
  const fans = (Array.isArray(value['fans']) ? value['fans'] : []).flatMap((item) => {
    const fan = fanOf(item);
    if (fan === null || seen.has(fan.fanRef)) return [];
    seen.add(fan.fanRef);
    return [fan];
  });
  const items = (Array.isArray(value['items']) ? value['items'] : []).flatMap((item): SavedItem[] =>
    isRec(item) && (item['contentType'] === 1 || item['contentType'] === 2) && isId(item['contentId']) ? [{ contentType: item['contentType'], contentId: item['contentId'] }] : [],
  );
  return {
    id: value['id'],
    owner: value['owner'],
    createdAt: value['createdAt'],
    updatedAt: value['updatedAt'],
    text: text(value['text']) ?? '',
    textRevision: isCount(value['textRevision']) ? value['textRevision'] : 0,
    textChangedAt: timeOrNull(value['textChangedAt']),
    source: sourceOf(value['source']),
    conditions: conditionsOf(value['conditions']),
    amountTyped: typeof value['amountTyped'] === 'string' ? value['amountTyped'].slice(0, 16) : '1,000',
    locked: Array.isArray(value['locked']) ? ids(value['locked']) : null,
    unticked: ids(value['unticked']),
    items: items.slice(0, 100),
    picked: Array.isArray(value['picked']) ? value['picked'].filter((key): key is string => typeof key === 'string' && key.length <= ID_MAX + 2).slice(0, 100) : [],
    media: mediaOf(value['media']),
    fans: fans.slice(0, FANS_MAX),
    folded: value['folded'] === true,
  };
}

/** Whatever is stored, as a store this build can use: unknown shapes and broken entries are dropped. */
export function readOutreachStore(raw: unknown, now: number): OutreachStore {
  if (!isRec(raw) || raw['v'] !== OUTREACH_STORE_VERSION || !Array.isArray(raw['outreaches'])) return EMPTY_OUTREACH_STORE;
  const outreaches = raw['outreaches'].flatMap((item) => {
    const outreach = outreachOf(item);
    return outreach === null ? [] : [outreach];
  });
  const current: Record<string, string> = {};
  if (isRec(raw['current'])) for (const [owner, id] of Object.entries(raw['current'])) if (isId(id)) current[owner] = id;
  return fitStore({ v: OUTREACH_STORE_VERSION, outreaches, current }, now);
}

// ── merging and fitting ──

/** How far a fan's send got: a send that went, or may have, outranks one refused, which outranks none. */
const sendRank = (send: SavedSend | null): number => (send === null ? 0 : send.state === 'failed' ? 1 : 2);

/** One fan as two tabs saved them: the newer outreach's word, except that what went is never undone. */
function mergeFan(newer: SavedFan, older: SavedFan | undefined): SavedFan {
  if (older === undefined) return newer;
  const send = sendRank(older.send) > sendRank(newer.send) ? older.send : newer.send;
  const outcome = newer.outcome ?? older.outcome;
  return send === newer.send && outcome === newer.outcome ? newer : { ...newer, send, outcome };
}

function mergeOutreach(a: SavedOutreach, b: SavedOutreach): SavedOutreach {
  const [newer, older] = a.updatedAt >= b.updatedAt ? [a, b] : [b, a];
  const olderFans = new Map(older.fans.map((fan) => [fan.fanRef, fan] as const));
  const fans = newer.fans.map((fan) => mergeFan(fan, olderFans.get(fan.fanRef)));
  // A fan the older copy sent to that the newer copy never had (a fan written for one by one in another tab) stays.
  for (const fan of older.fans) if (sendRank(fan.send) === 2 && !newer.fans.some((item) => item.fanRef === fan.fanRef)) fans.push(fan);
  const locked = newer.locked === null ? older.locked : [...newer.locked, ...(older.locked ?? []).filter((fanRef) => !newer.locked?.includes(fanRef) && sendRank(olderFans.get(fanRef)?.send ?? null) === 2)];
  return { ...newer, fans, locked };
}

/** The tab's store over the stored one: outreach by outreach, fan by fan; the tab's own `current` wins for its owner. */
export function mergeOutreachStores(stored: OutreachStore, mine: OutreachStore, now: number): OutreachStore {
  const byId = new Map<string, SavedOutreach>();
  for (const outreach of stored.outreaches) byId.set(outreach.id, outreach);
  for (const outreach of mine.outreaches) {
    const other = byId.get(outreach.id);
    byId.set(outreach.id, other === undefined ? outreach : mergeOutreach(outreach, other));
  }
  return fitStore({ v: OUTREACH_STORE_VERSION, outreaches: [...byId.values()], current: { ...stored.current, ...mine.current } }, now);
}

/** Rough JSON size of an outreach: its texts and a little for every field around them. */
function outreachBytes(outreach: SavedOutreach): number {
  let bytes = 400 + utf8Bytes(outreach.text) + utf8Bytes(outreach.owner);
  for (const fan of outreach.fans) bytes += 160 + utf8Bytes(fan.version ?? '') + utf8Bytes(fan.edit ?? '') + utf8Bytes(fan.send?.text ?? '') + utf8Bytes(fan.outcome?.replied?.text ?? '') + utf8Bytes(fan.name ?? '');
  return bytes + 40 * ((outreach.locked?.length ?? 0) + outreach.unticked.length + outreach.items.length);
}

/** Past their lifetime and beyond the page's count and the key's bytes: the oldest go. */
export function fitStore(store: OutreachStore, now: number): OutreachStore {
  const fresh = store.outreaches.filter((outreach) => now - outreach.updatedAt < SAVED_TTL_MS && outreach.updatedAt <= now + 60_000).sort((a, b) => b.updatedAt - a.updatedAt);
  const perOwner = new Map<string, number>();
  const kept: SavedOutreach[] = [];
  let bytes = 0;
  for (const outreach of fresh) {
    const count = perOwner.get(outreach.owner) ?? 0;
    if (count >= SAVED_PER_PAGE) continue;
    const size = outreachBytes(outreach);
    if (bytes + size > SAVED_MAX_BYTES) continue;
    perOwner.set(outreach.owner, count + 1);
    bytes += size;
    kept.push(outreach);
  }
  const current: Record<string, string> = {};
  for (const [owner, id] of Object.entries(store.current)) if (kept.some((outreach) => outreach.id === id && outreach.owner === owner)) current[owner] = id;
  return { v: OUTREACH_STORE_VERSION, outreaches: kept, current };
}

/** The tab's outreach into the store (newest first), and it is its owner's current one. */
export function putOutreach(store: OutreachStore, outreach: SavedOutreach, now: number): OutreachStore {
  const rest = store.outreaches.filter((item) => item.id !== outreach.id);
  return fitStore({ v: OUTREACH_STORE_VERSION, outreaches: [outreach, ...rest], current: { ...store.current, [outreach.owner]: outreach.id } }, now);
}

/** The owner's outreaches, newest first. */
export function outreachesOf(store: OutreachStore, owner: string): SavedOutreach[] {
  return store.outreaches.filter((outreach) => outreach.owner === owner).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The store holds an outreach whose window was open or folded into its chip when it was last kept, this recently: the
 * tab starts its boards at once so the chip can stand again (a light look at the raw value, no full read).
 */
export function foldedRecently(raw: unknown, now: number, withinMs: number): boolean {
  if (!isRec(raw) || raw['v'] !== OUTREACH_STORE_VERSION || !Array.isArray(raw['outreaches'])) return false;
  return raw['outreaches'].some((item) => isRec(item) && item['folded'] === true && isTime(item['updatedAt']) && now - item['updatedAt'] < withinMs && item['updatedAt'] <= now + 60_000);
}

/** An outreach worth keeping: a text, or versions written. */
export const worthKeeping = (outreach: Pick<SavedOutreach, 'text' | 'locked'>): boolean => outreach.text.trim().length > 0 || (outreach.locked?.length ?? 0) > 0;
