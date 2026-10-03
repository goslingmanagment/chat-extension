// Local drafts of previews (architecture.md §9.4 «черновики превью», §5.6
// `newcomers.drafts`; NF-012, NEW-10): the text a chatter types in a preview
// — the source of Fix in a Spenders preview, a greeting draft in «Новые».
// It never goes to ChatSpace by itself. Up to 5000 characters each, kept 24
// hours, at most 100 drafts and one MiB together; the oldest go first. Kept
// per hub, user, page, list and fan, so one person's draft never shows to
// another. Pure: the controller reads and writes the store through its port.

import { SEND_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';

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
  readonly updatedAt: number;
}

export interface DraftStore {
  readonly v: typeof DRAFT_STORE_VERSION;
  /** Newest first. */
  readonly drafts: readonly PreviewDraft[];
}

export const EMPTY_DRAFTS: DraftStore = { v: DRAFT_STORE_VERSION, drafts: [] };

export interface DraftOwner {
  readonly hubOrigin: string;
  readonly userId: number;
  readonly pageId: number;
  readonly list: 'spenders' | 'newcomers' | 'palette';
  readonly fanRef: string;
}

const userPrefix = (hubOrigin: string, userId: number): string => `${hubOrigin}|${userId}|`;

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

const draftBytes = (draft: PreviewDraft): number => utf8Bytes(draft.text) + utf8Bytes(draft.key) + 96;

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
    typeof d['updatedAt'] === 'number' &&
    Number.isFinite(d['updatedAt'])
  );
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
  return { v: DRAFT_STORE_VERSION, drafts: fit(record['drafts'].filter(isDraft), now) };
}

export function findDraft(store: DraftStore, key: string, now: number): PreviewDraft | null {
  const draft = store.drafts.find((d) => d.key === key);
  return draft !== undefined && now - draft.updatedAt < STORAGE_LIMITS.previewDraftTtlMs ? draft : null;
}

/**
 * Writes a draft. An empty text removes it (its revision still moves, so a
 * result made from the old text is void). Text beyond the limit is cut at it.
 */
export function putDraft(store: DraftStore, key: string, text: string, now: number, threadRevision: string | null = null): { readonly store: DraftStore; readonly draft: PreviewDraft | null; readonly revision: number } {
  const previous = store.drafts.find((d) => d.key === key);
  const revision = (previous?.revision ?? 0) + 1;
  const rest = store.drafts.filter((d) => d.key !== key);
  const clipped = text.slice(0, SEND_LIMITS.previewDraftMaxChars);
  if (clipped.trim().length === 0) return { store: { v: DRAFT_STORE_VERSION, drafts: fit(rest, now) }, draft: null, revision };
  const draft: PreviewDraft = { key, text: clipped, revision, threadRevision, updatedAt: now };
  const drafts = fit([draft, ...rest], now);
  return { store: { v: DRAFT_STORE_VERSION, drafts }, draft: drafts.some((d) => d.key === key) ? draft : null, revision };
}

export function removeDraft(store: DraftStore, key: string): DraftStore {
  return store.drafts.some((d) => d.key === key) ? { v: DRAFT_STORE_VERSION, drafts: store.drafts.filter((d) => d.key !== key) } : store;
}

/** Sign-out or another user: everything of other users goes (§9.4 «при выходе всё, что связано с пользователем, очищается»). */
export function keepOnlyUser(store: DraftStore, hubOrigin: string, userId: number): DraftStore {
  const prefix = userPrefix(hubOrigin, userId);
  const drafts = store.drafts.filter((d) => d.key.startsWith(prefix));
  return drafts.length === store.drafts.length ? store : { v: DRAFT_STORE_VERSION, drafts };
}
