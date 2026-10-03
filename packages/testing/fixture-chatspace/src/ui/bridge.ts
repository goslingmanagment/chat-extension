// `__omComposerBridge` on the translator slot (metadata.ts «composer-bridge»),
// and the composer's draft in localStorage (metadata.ts «draft»).
// The bridge is set by a directive on the slot, like ChatSpace's: on mount and
// on EVERY update of the composer that renders the slot, with a NEW object each
// time, holding the editor component's surface (editor-handle.ts). So the
// bridge appears as soon as the composer mounts — before TipTap has loaded —
// and its methods then silently do nothing. setText = clear + `<p>` + text with
// `& < >` escaped (in that order) and `\n` → `<br>`, then focus; insertText
// inserts at the cursor with a hard break per `\n`, then focus (which keeps
// the selection, it does not jump to the end); insertMessage replaces the whole
// draft through the insert-payload store.

import type { JSONContent } from '@tiptap/core';
import { watch, type ObjectDirective, type Ref } from 'vue';

import { isBroken } from '../env';
import { record } from '../journal';
import type { ComposerContent } from '../stores/pending-messages';
import type { EditorHandle } from './editor-handle';

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
  /** The editor component's surface; null only before the composer has one. */
  readonly editor: EditorHandle | null;
  readonly accountId: string;
  readonly chatId: string;
  readonly setInsertPayload: (accountId: string, chatId: string, payload: ComposerContent) => void;
}

export function applyBridge(element: HTMLElement, target: BridgeTarget): void {
  const host = element as BridgeHost;
  const editor = target.editor;
  if (editor === null || isBroken('composer-bridge')) {
    delete host.__omComposerBridge;
    return;
  }
  const call = (method: string): void => record('bridge-call', { method, accountId: target.accountId, chatId: target.chatId, editorReady: editor.tiptap !== null });
  host.__omComposerBridge = {
    setText: (text) => {
      call('setText');
      editor.clear();
      if (text !== '') editor.insertContent(textToParagraph(text));
      editor.focus();
    },
    insertText: (text) => {
      call('insertText');
      editor.insertContent(textToNodes(text));
      editor.focus();
    },
    focus: () => {
      call('focus');
      editor.focus();
    },
    insertMessage: (raw) => {
      call('insertMessage');
      const content = typeof raw === 'object' && raw !== null ? (raw as { content?: unknown }).content : null;
      target.setInsertPayload(target.accountId, target.chatId, { html: typeof content === 'string' ? content : '', media: null, gif: null, taggedCreators: [] });
    },
  };
}

export function removeBridge(element: HTMLElement): void {
  delete (element as BridgeHost).__omComposerBridge;
}

/** The slot's directive: a fresh bridge on mount and on every update of the owning component. */
export const vComposerBridge: ObjectDirective<HTMLElement, BridgeTarget> = {
  mounted: (element, binding) => applyBridge(element, binding.value),
  updated: (element, binding) => applyBridge(element, binding.value),
  unmounted: (element) => removeBridge(element),
};

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

/**
 * The watcher that persists the composer's model (TipTap JSON); empty → key
 * removed. A deep watcher with Vue's default (pre) flush, as ChatSpace's: the
 * key changes a microtask after the edit, not inside it, and several edits in
 * one tick make one write.
 */
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
    { deep: true },
  );
}
