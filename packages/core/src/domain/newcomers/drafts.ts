// Local drafts of previews (architecture.md §9.4 «черновики превью», §5.6
// `newcomers.drafts`; NF-012, NEW-10): the text a chatter types in a preview
// — the source of Fix in a Spenders preview, a greeting draft in «Новые».
// It never goes to ChatSpace by itself. Up to 5000 characters each, kept 24
// hours, at most 100 drafts and one MiB together; the oldest go first. Kept
// per hub, user, page, list and fan, so one person's draft never shows to
// another. Pure: the controller reads and writes the store through its port.
//
// Several ChatSpace tabs share the one key, so a store is never written over
// whole: a write merges, draft by draft, what the tab holds with what is
// stored, and the newer entry of each draft wins. A removed draft leaves a
// small mark without text (`removed`, 24 hours), so a removal in one tab is
// not undone by another tab that still held the old text.

import { SEND_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { GreetingDraftGenerationSchema, type GreetingDraftGeneration } from '@cg/contracts/ops';

export const DRAFT_STORE_VERSION = 1;
/** Left of the key's byte budget for the JSON around the texts. */
const BYTES_HEADROOM = 16 * 1024;

export interface PreviewDraft {
  readonly key: string;
  readonly text: string;
  /** Grows on every change of this draft; a result made from an older revision is void (CG-SEND-PART). */
  readonly revision: number;
  /** The fan's thread as the list showed it when the draft was written (NF-018); null — not tracked. */
  readonly threadRevision: string | null;
  readonly generation?: GreetingDraftGeneration;
  readonly updatedAt: number;
}

/** A draft that was cleared or has done its work: its revision and when, never its text. */
export interface DraftRemoval {
  readonly key: string;
  readonly revision: number;
  readonly removedAt: number;
}

export interface DraftStore {
  readonly v: typeof DRAFT_STORE_VERSION;
  /** Newest first. */
  readonly drafts: readonly PreviewDraft[];
  /** Removal marks, newest first; absent — none. */
  readonly removed?: readonly DraftRemoval[];
}

export const EMPTY_DRAFTS: DraftStore = { v: DRAFT_STORE_VERSION, drafts: [] };

/** Removal marks kept: enough for every draft of the store to be cleared once. */
const REMOVALS_MAX = 2 * STORAGE_LIMITS.previewDrafts;

export interface DraftOwner {
  readonly hubOrigin: string;
  readonly userId: number;
  readonly pageId: number;
  readonly list: 'spenders' | 'newcomers' | 'palette';
  readonly fanRef: string;
}

/** The start of every draft key of one user of one hub. */
export const draftUserPrefix = (hubOrigin: string, userId: number): string => `${hubOrigin}|${userId}|`;
const userPrefix = draftUserPrefix;

export function draftKey(owner: DraftOwner): string {
  return `${userPrefix(owner.hubOrigin, owner.userId)}${owner.pageId}|${owner.list}|${owner.fanRef}`;
}

/** UTF-8 bytes of a string (no TextEncoder in a pure module). */
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

const draftBytes = (draft: PreviewDraft): number => utf8Bytes(draft.text) + utf8Bytes(draft.key) + 96 + (draft.generation === undefined ? 0 : utf8Bytes(JSON.stringify(draft.generation)));

function isDraft(value: unknown): value is PreviewDraft {
  if (value === null || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d['key'] === 'string' &&
    d['key'].length > 0 &&
    d['key'].length <= 512 &&
    typeof d['text'] === 'string' &&
    d['text'].length > 0 &&
    d['text'].length <= SEND_LIMITS.previewDraftMaxChars &&
    typeof d['revision'] === 'number' &&
    Number.isInteger(d['revision']) &&
    d['revision'] >= 0 &&
    (d['threadRevision'] === null || typeof d['threadRevision'] === 'string') &&
    (d['generation'] === undefined || GreetingDraftGenerationSchema.safeParse(d['generation']).success) &&
    typeof d['updatedAt'] === 'number' &&
    Number.isFinite(d['updatedAt'])
  );
}

function isRemoval(value: unknown): value is DraftRemoval {
  if (value === null || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d['key'] === 'string' &&
    d['key'].length > 0 &&
    d['key'].length <= 512 &&
    typeof d['revision'] === 'number' &&
    Number.isInteger(d['revision']) &&
    d['revision'] >= 0 &&
    typeof d['removedAt'] === 'number' &&
    Number.isFinite(d['removedAt'])
  );
}

/** Removal marks within their 24 hours, one per draft, newest first, at most REMOVALS_MAX. */
function fitRemovals(removed: readonly DraftRemoval[], now: number): DraftRemoval[] {
  const seen = new Set<string>();
  const out: DraftRemoval[] = [];
  for (const mark of [...removed].sort((a, b) => b.removedAt - a.removedAt)) {
    if (now - mark.removedAt >= STORAGE_LIMITS.previewDraftTtlMs || mark.removedAt > now + 60_000 || seen.has(mark.key)) continue;
    seen.add(mark.key);
    out.push(mark);
    if (out.length >= REMOVALS_MAX) break;
  }
  return out;
}

function storeOf(drafts: readonly PreviewDraft[], removed: readonly DraftRemoval[], now: number): DraftStore {
  const kept = fit(drafts, now);
  const marks = fitRemovals(removed, now);
  return marks.length === 0 ? { v: DRAFT_STORE_VERSION, drafts: kept } : { v: DRAFT_STORE_VERSION, drafts: kept, removed: marks };
}

/** Drops drafts past their 24 hours and the oldest beyond the count and byte caps. */
function fit(drafts: readonly PreviewDraft[], now: number): PreviewDraft[] {
  const fresh = drafts
    .filter((draft) => now - draft.updatedAt < STORAGE_LIMITS.previewDraftTtlMs && draft.updatedAt <= now + 60_000)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = new Set<string>();
  const out: PreviewDraft[] = [];
  let bytes = 0;
  for (const draft of fresh) {
    if (seen.has(draft.key)) continue;
    if (out.length >= STORAGE_LIMITS.previewDrafts) break;
    const size = draftBytes(draft);
    if (bytes + size > STORAGE_LIMITS.previewDraftsTotalBytes - BYTES_HEADROOM) break;
    seen.add(draft.key);
    bytes += size;
    out.push(draft);
  }
  return out;
}

/** Whatever is stored, as a store this build can use: unknown shapes and broken entries are dropped, never thrown on. */
export function readDraftStore(raw: unknown, now: number): DraftStore {
  if (raw === null || typeof raw !== 'object') return EMPTY_DRAFTS;
  const record = raw as Record<string, unknown>;
  if (record['v'] !== DRAFT_STORE_VERSION || !Array.isArray(record['drafts'])) return EMPTY_DRAFTS;
  const removed = Array.isArray(record['removed']) ? record['removed'].filter(isRemoval) : [];
  // A store written by hand may hold a draft and its removal at once: the newer stands.
  return mergeDraftStores(storeOf(record['drafts'].filter(isDraft), [], now), storeOf([], removed, now), now);
}

export function findDraft(store: DraftStore, key: string, now: number): PreviewDraft | null {
  const draft = store.drafts.find((d) => d.key === key);
  return draft !== undefined && now - draft.updatedAt < STORAGE_LIMITS.previewDraftTtlMs ? draft : null;
}

/**
 * Writes a draft. An empty text removes it (its revision still moves, so a
 * result made from the old text is void). Text beyond the limit is cut at it.
 */
export function putDraft(store: DraftStore, key: string, text: string, now: number, threadRevision: string | null = null, generation?: GreetingDraftGeneration): { readonly store: DraftStore; readonly draft: PreviewDraft | null; readonly revision: number } {
  const previous = store.drafts.find((d) => d.key === key)?.revision ?? store.removed?.find((mark) => mark.key === key)?.revision ?? 0;
  const revision = previous + 1;
  const rest = store.drafts.filter((d) => d.key !== key);
  const marks = (store.removed ?? []).filter((mark) => mark.key !== key);
  const clipped = text.slice(0, SEND_LIMITS.previewDraftMaxChars);
  if (clipped.trim().length === 0) return { store: storeOf(rest, [{ key, revision, removedAt: now }, ...marks], now), draft: null, revision };
  const draft: PreviewDraft = { key, text: clipped, revision, threadRevision, updatedAt: now, ...(generation === undefined ? {} : { generation }) };
  const next = storeOf([draft, ...rest], marks, now);
  return { store: next, draft: next.drafts.some((d) => d.key === key) ? draft : null, revision };
}

/** The draft has done its work (a greeting part was confirmed): it goes, and a mark keeps other tabs from bringing it back. */
export function removeDraft(store: DraftStore, key: string, now: number): DraftStore {
  const draft = store.drafts.find((d) => d.key === key);
  if (draft === undefined) return store;
  return storeOf(
    store.drafts.filter((d) => d.key !== key),
    [{ key, revision: draft.revision + 1, removedAt: Math.max(now, draft.updatedAt + 1) }, ...(store.removed ?? []).filter((mark) => mark.key !== key)],
    now,
  );
}

/** Drafts and marks whose key passes `keep`; the same store when nothing goes. */
export function keepOnly(store: DraftStore, keep: (key: string) => boolean): DraftStore {
  const drafts = store.drafts.filter((d) => keep(d.key));
  const removed = (store.removed ?? []).filter((mark) => keep(mark.key));
  if (drafts.length === store.drafts.length && removed.length === (store.removed ?? []).length) return store;
  return removed.length === 0 ? { v: DRAFT_STORE_VERSION, drafts } : { v: DRAFT_STORE_VERSION, drafts, removed };
}

/** Sign-out or another user: everything of other users goes (§9.4 «при выходе всё, что связано с пользователем, очищается»). */
export function keepOnlyUser(store: DraftStore, hubOrigin: string, userId: number): DraftStore {
  const prefix = userPrefix(hubOrigin, userId);
  return keepOnly(store, (key) => key.startsWith(prefix));
}

type Entry = { readonly kind: 'draft'; readonly at: number; readonly revision: number; readonly draft: PreviewDraft } | { readonly kind: 'removed'; readonly at: number; readonly revision: number; readonly mark: DraftRemoval };

const entryText = (entry: Entry): string => (entry.kind === 'draft' ? `${entry.draft.text}\u0000${entry.draft.threadRevision ?? ''}\u0000${entry.draft.generation === undefined ? '' : JSON.stringify(entry.draft.generation)}` : '');

/** The newer of two entries of one draft; the same answer whichever is passed first, so every tab merges alike. */
function newer(a: Entry, b: Entry): Entry {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (a.revision !== b.revision) return a.revision > b.revision ? a : b;
  // A tie keeps the text a person typed over a removal, then the larger text.
  if (a.kind !== b.kind) return a.kind === 'draft' ? a : b;
  return entryText(a) >= entryText(b) ? a : b;
}

function entries(store: DraftStore): Entry[] {
  return [
    ...store.drafts.map((draft): Entry => ({ kind: 'draft', at: draft.updatedAt, revision: draft.revision, draft })),
    ...(store.removed ?? []).map((mark): Entry => ({ kind: 'removed', at: mark.removedAt, revision: mark.revision, mark })),
  ];
}

/**
 * Two stores of the same key — what this tab holds and what another tab
 * wrote — as one: for each draft the newer entry (text or removal mark)
 * stands. Order-free, so tabs that merge the same two stores agree.
 */
export function mergeDraftStores(a: DraftStore, b: DraftStore, now: number): DraftStore {
  const winners = new Map<string, Entry>();
  for (const entry of [...entries(a), ...entries(b)]) {
    const key = entry.kind === 'draft' ? entry.draft.key : entry.mark.key;
    const held = winners.get(key);
    winners.set(key, held === undefined ? entry : newer(held, entry));
  }
  const drafts: PreviewDraft[] = [];
  const removed: DraftRemoval[] = [];
  for (const entry of winners.values()) {
    if (entry.kind === 'draft') drafts.push(entry.draft);
    else removed.push(entry.mark);
  }
  return storeOf(drafts, removed, now);
}

/** Whether two stores hold the same drafts and marks (order aside). */
export function sameDraftStore(a: DraftStore, b: DraftStore): boolean {
  const flat = (store: DraftStore): string[] => entries(store).map((entry) => (entry.kind === 'draft' ? `d|${entry.draft.key}|${entry.at}|${entry.revision}|${entryText(entry)}` : `r|${entry.mark.key}|${entry.at}|${entry.revision}`)).sort();
  const x = flat(a);
  const y = flat(b);
  return x.length === y.length && x.every((item, i) => item === y[i]);
}

/** The entry of a draft that differs between two stores: what another tab changed. */
export function changedDraftKeys(before: DraftStore, after: DraftStore): string[] {
  const sig = (store: DraftStore): Map<string, string> =>
    new Map(entries(store).map((entry) => [entry.kind === 'draft' ? entry.draft.key : entry.mark.key, `${entry.kind}|${entry.at}|${entry.revision}|${entryText(entry)}`]));
  const a = sig(before);
  const b = sig(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter((key) => a.get(key) !== b.get(key));
}
