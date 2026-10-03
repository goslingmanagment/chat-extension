// The composer draft as ChatSpace persists it (architecture.md §6.1, §6.4):
// `localStorage['chat-space:draft:of:{acc}:{fan}']` = `{ body: { json, … },
// updatedAt }`, written by a Vue watcher a microtask after each edit; an
// empty draft removes the key. The isolated side reads it — same origin, no
// request — to verify an insert against the target's own key (NEW-06) and to
// learn whether the key still exists (§6.2 anchor `draftKey`).
//
// The page storage arrives as a port (`DraftStorage`) from the composition
// root: host-chatspace touches no storage API itself (§4, lint).

import type { ChatRef } from '@cg/contracts/ids';

import { draftKey } from './host-contract';

/** Read access to the page's localStorage (same origin), given by the composition root. */
export interface DraftStorage {
  getItem(key: string): string | null;
}

export type StoredDraft =
  | { readonly state: 'absent' }
  /** The key holds no readable draft (a new format?). */
  | { readonly state: 'unreadable' }
  | { readonly state: 'present'; readonly text: string };

interface DocNode {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
}

/** Tiptap JSON → text the way `editor.getText()` gives it: blocks apart by a blank line, a hard break a newline. */
export function tiptapText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const { type, text, content } = node as DocNode;
  if (type === 'text') return typeof text === 'string' ? text : '';
  if (type === 'hardBreak') return '\n';
  const children = Array.isArray(content) ? (content as unknown[]) : [];
  const blocks = children.some((child) => typeof child === 'object' && child !== null && Array.isArray((child as DocNode).content));
  return children.map(tiptapText).join(type === 'doc' && blocks ? '\n\n' : '');
}

/** Line breaks and non-breaking spaces made plain, runs of spaces folded, outer whitespace trimmed (= MAIN's comparison). */
export const normalizeDraftText = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();

/** Reads the target chat's own draft key; never another chat's (§6.4 п. 4). */
export function readStoredDraft(drafts: DraftStorage, chat: ChatRef): StoredDraft {
  let raw: string | null;
  try {
    raw = drafts.getItem(draftKey(chat.hostAccountId, chat.platformFanId));
  } catch {
    return { state: 'unreadable' };
  }
  if (raw === null) return { state: 'absent' };
  try {
    const parsed = JSON.parse(raw) as { body?: { json?: unknown } } | null;
    const json = parsed?.body?.json;
    if (json === undefined) return { state: 'unreadable' };
    return { state: 'present', text: json === null ? '' : tiptapText(json) };
  } catch {
    return { state: 'unreadable' };
  }
}

/** Does the stored draft agree with what the insert wrote? `null` — the key does not say (absent or unreadable). */
export function storedDraftAgrees(stored: StoredDraft, text: string, mode: 'replace' | 'append'): boolean | null {
  if (stored.state !== 'present') return null;
  const value = normalizeDraftText(stored.text);
  const wanted = normalizeDraftText(text);
  return mode === 'append' ? value.endsWith(wanted) : value === wanted;
}
