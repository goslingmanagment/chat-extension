// `__omComposerBridge` on the translator slot (metadata.ts «composer-bridge»),
// and the composer's draft in localStorage (metadata.ts «draft»).
// Bridge: setText = clear + `<p>` + text with `& < >` escaped (in that order)
// and `\n` → `<br>`, then focus; insertText inserts at the cursor with a hard
// break per `\n`; focus; insertMessage replaces the whole draft through the
// insert-payload store. No editor yet → no bridge property at all.

import type { JSONContent } from '@tiptap/core';
import { watch, type Ref } from 'vue';

import { isBroken } from '../env';
import { record } from '../journal';
import type { ComposerContent } from '../stores/pending-messages';
import type { OmEditor } from './editor';

export interface ComposerBridge {
  setText(text: string): void;
  insertText(text: string): void;
  focus(): void;
  insertMessage(raw: unknown): void;
}

type BridgeHost = HTMLElement & { __omComposerBridge?: ComposerBridge };

/** Only `&`, `<` and `>` — `&` first. */
export const escapeText = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const textToParagraph = (text: string): string => `<p>${escapeText(text).replaceAll('\n', '<br>')}</p>`;
export const textToNodes = (text: string): JSONContent[] =>
  text.split('\n').flatMap((part, index) => [...(index > 0 ? [{ type: 'hardBreak' }] : []), ...(part !== '' ? [{ type: 'text', text: part }] : [])]);

export interface BridgeTarget {
  readonly editor: OmEditor | null;
  readonly accountId: string;
  readonly chatId: string;
  readonly setInsertPayload: (accountId: string, chatId: string, payload: ComposerContent) => void;
}

export function applyBridge(element: HTMLElement | null, target: BridgeTarget): void {
  if (element === null) return;
  const host = element as BridgeHost;
  const editor = target.editor;
  if (editor === null || isBroken('composer-bridge')) {
    delete host.__omComposerBridge;
    return;
  }
  host.__omComposerBridge = {
    setText: (text) => {
      record('bridge-call', { method: 'setText', accountId: target.accountId, chatId: target.chatId });
      editor.clear();
      if (text !== '') editor.insertContent(textToParagraph(text));
      editor.focus();
    },
    insertText: (text) => {
      record('bridge-call', { method: 'insertText', accountId: target.accountId, chatId: target.chatId });
      editor.insertContent(textToNodes(text));
      editor.focus();
    },
    focus: () => editor.focus(),
    insertMessage: (raw) => {
      record('bridge-call', { method: 'insertMessage', accountId: target.accountId, chatId: target.chatId });
      const content = typeof raw === 'object' && raw !== null ? (raw as { content?: unknown }).content : null;
      target.setInsertPayload(target.accountId, target.chatId, { html: typeof content === 'string' ? content : '', media: null, gif: null, taggedCreators: [] });
    },
  };
}

export function removeBridge(element: HTMLElement | null): void {
  if (element !== null) delete (element as BridgeHost).__omComposerBridge;
}

// ── Draft ──

export interface DraftBody {
  readonly json: JSONContent | null;
  readonly gif: null;
  readonly media: null;
  readonly taggedCreators: readonly unknown[];
}

const DRAFT_TTL_MS = 30 * 24 * 3600 * 1000;
export const emptyDraft = (): DraftBody => ({ json: null, gif: null, media: null, taggedCreators: [] });

/** `chat-space:draft:of:{acc}:{fan}`; a «build» that moved it uses another key. */
export function draftKey(accountId: string, chatId: string): string {
  return isBroken('draft-key') ? `chat-space:composer-draft:of:${accountId}:${chatId}` : `chat-space:draft:of:${accountId}:${chatId}`;
}

export function loadDraft(key: string): DraftBody {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return emptyDraft();
    const parsed = JSON.parse(raw) as { body?: Partial<DraftBody>; updatedAt?: unknown };
    if (typeof parsed.updatedAt !== 'number' || Date.now() - parsed.updatedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(key);
      return emptyDraft();
    }
    return { ...emptyDraft(), ...parsed.body };
  } catch {
    return emptyDraft();
  }
}

const isEmptyDraft = (draft: DraftBody, text: string): boolean => text.trim() === '' && draft.gif === null && draft.media === null && draft.taggedCreators.length === 0;

/** The watcher that persists the composer's model (TipTap JSON) on every change; empty → key removed. */
export function persistDraft(key: string, model: Ref<DraftBody>, text: () => string): void {
  watch(
    model,
    (draft) => {
      try {
        if (isEmptyDraft(draft, text())) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ body: draft, updatedAt: Date.now() }));
      } catch {
        // Storage blocked: the draft lives in memory only.
      }
    },
    // Every document change writes at once (ChatSpace writes the draft synchronously on input).
    { deep: true, flush: 'sync' },
  );
}
