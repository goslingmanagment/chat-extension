// Composers (metadata.ts «composer-dom»): one per chat tab visited in this
// session, all rendered, only the active one shown (v-show), keyed
// `${tabId}:${accountId}:${chatId}`; a blocked fan's composer stays hidden.
//
//   div.relative                              ← composer root (one per tab)
//     div.composer-frame.overflow-hidden      ← clips its content
//       div.h-10 (top strip)
//         … quick buttons …
//         div.inline-flex (trailing group)
//           div[data-id="browser-composer-translator"]  ← bridge slot, Vue never renders children
//           button Templates
//       div.om-rich-text-editor > .ProseMirror (TipTap, created asynchronously)
//       footer: translator chip, Send
//
// Alt+S (by `code`, any other modifiers) toggles the translator in a capture
// listener on the composer root; the Templates panel carries
// `data-dismissible-open` while open.

import type { JSONContent } from '@tiptap/core';
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, vShow, watch, withDirectives, type PropType, type VNode } from 'vue';

import { env, isBroken } from '../env';
import { record } from '../journal';
import { api } from '../net/http';
import { useQueryCache } from '../query/cache';
import type { Account, FansMap } from '../query/model';
import { keys } from '../query/queries';
import { useComposerTranslator, useOfComposerInsert } from '../stores/composer';
import { usePendingMessages, type QueueInput } from '../stores/pending-messages';
import { draftKey, loadDraft, persistDraft, textToParagraph, vComposerBridge, type DraftBody } from './bridge';
import { createEditorHandle } from './editor-handle';
import { registerComposer, unregisterComposer } from './registry';

const TYPING_THROTTLE_MS = 3000;
const TRANSLATE_MS = 60;
const QUICK_REPLIES = ['(◕‿◕)', 'ok!', '♡'];
const TEMPLATES = ['Синтетический шаблон: привет!', 'Stand template: how was your day?', 'Тестовый шаблон №3'];
const PLACEHOLDER = 'Stand message…';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The stand's «translation» of a text (clearly synthetic). */
export const syntheticTranslation = (text: string): string => `[EN] ${text}`;

export const ConversationComposer = defineComponent({
  name: 'ConversationComposer',
  props: {
    composerKey: { type: String, required: true },
    tabId: { type: String, required: true },
    accountId: { type: String, required: true },
    chatId: { type: String, required: true },
    shown: { type: Boolean, required: true },
  },
  setup(props) {
    const cache = useQueryCache();
    // Created when the first composer mounts, like ChatSpace's queue.
    const pending = usePendingMessages();
    const translator = useComposerTranslator();
    const inserts = useOfComposerInsert();
    const settings = translator.getAccountSettings(props.accountId);
    const nativeTranslatorOwner = computed(() => (cache.getQueryData<string[]>(keys.userPermissions()) ?? []).includes('om_message_translator'));

    const root = ref<HTMLElement | null>(null);
    const slot = ref<HTMLElement | null>(null);
    const editorHost = ref<HTMLElement | null>(null);
    // The editor component's surface exists from the start; TipTap attaches to it when its chunk has loaded.
    const editor = createEditorHandle();
    const templatesOpen = ref(false);
    const notice = ref<string | null>(null);
    const key = draftKey(props.accountId, props.chatId);
    const model = ref<DraftBody>(loadDraft(key));
    let editorText = '';
    persistDraft(key, model, () => editorText);
    let lastPaste = '';
    let lastTypingAt = 0;
    let alive = true;

    const flash = (text: string): void => {
      notice.value = text;
      setTimeout(() => {
        if (notice.value === text) notice.value = null;
      }, 2500);
    };

    const toggleTranslator = (): void => {
      settings.value = { ...settings.value, enabled: !settings.value.enabled };
      record('translator-toggled', { accountId: props.accountId, enabled: settings.value.enabled });
    };

    const onKeydownCapture = (event: KeyboardEvent): void => {
      if (!event.altKey || !nativeTranslatorOwner.value || (event.code !== 'KeyS' && event.code !== 'KeyA')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'KeyS') toggleTranslator();
    };

    const notifyTyping = (): void => {
      const now = Date.now();
      if (now - lastTypingAt < TYPING_THROTTLE_MS) return;
      lastTypingAt = now;
      api.post(`api/v0/accounts/${props.accountId}/chats/${props.chatId}/typing`, { timeout: 3000 }).catch(() => undefined);
    };

    /** The composer's own wrapper of the queue: it passes no `isAiGenerated`. */
    const toQueue = (input: Omit<QueueInput, 'isAiGenerated'>) => pending.enqueue(input);

    const submit = async (): Promise<void> => {
      const current = editor;
      if (current.tiptap === null || current.getText().trim() === '' || templatesOpen.value) return;
      if (settings.value.enabled && settings.value.autoTranslate) {
        const before = current.getText();
        record('translator-translating', { accountId: props.accountId, chatId: props.chatId });
        await new Promise((resolve) => setTimeout(resolve, TRANSLATE_MS));
        if (current.getText() !== before) {
          flash('Text changed while translating — not sent');
          return;
        }
        // The translation replaces the text in the editor before sending.
        current.clear();
        current.insertContent(textToParagraph(syntheticTranslation(before)));
      }
      const html = current.getText().trim() === '' ? '' : current.getHTML();
      const entry = toQueue({
        accountId: props.accountId,
        chatId: props.chatId,
        platform: 'onlyfans',
        text: html,
        hasAttachments: false,
        platformMetadata: {},
        composerContent: { html, media: null, gif: null, taggedCreators: [] },
        internalTemplateId: null,
        isCopied: lastPaste !== '' && current.getText().trim() === lastPaste.trim(),
      });
      if (entry === null) {
        flash('Queue is full or Mimic runs this chat');
        return;
      }
      current.clear();
      lastPaste = '';
    };

    const insertTemplate = (text: string): void => {
      templatesOpen.value = false;
      editor.insertContent(textToParagraph(text));
      editor.focus();
    };

    const onDocumentKeydown = (event: KeyboardEvent): void => {
      if (templatesOpen.value && event.key === 'Escape') templatesOpen.value = false;
    };

    onMounted(async () => {
      record('composer-mounted', { key: props.composerKey });
      root.value?.addEventListener('keydown', onKeydownCapture, { capture: true });
      document.addEventListener('keydown', onDocumentKeydown);
      if (root.value !== null) registerComposer(props.composerKey, { root: root.value, accountId: props.accountId, chatId: props.chatId, tabId: props.tabId, editor, slot: () => slot.value, shown: () => props.shown });
      const module = await import('./editor');
      // Tests may stretch the chunk load to reach the window where the bridge exists but does nothing.
      if (env.editorChunkDelayMs > 0) await delay(env.editorChunkDelayMs);
      if (!alive || editorHost.value === null) return;
      const created = module.createOmEditor(editorHost.value, model.value.json, PLACEHOLDER, {
        onEnter: () => void submit(),
        onUpdate: (json: JSONContent, text: string) => {
          editorText = text;
          model.value = { ...model.value, json };
          if (text.trim() !== '') notifyTyping();
        },
        onPaste: (text) => {
          lastPaste = text;
        },
        hideHandle: isBroken('editor-handle'),
      });
      editorText = created.getText();
      editor.attach(created);
      record('composer-editor-ready', { key: props.composerKey });
    });

    // A model changed from elsewhere (not by the editor itself) is pushed into the editor.
    watch(
      () => model.value.json,
      (json) => {
        const current = editor.tiptap;
        if (current !== null && JSON.stringify(current.getJSON()) !== JSON.stringify(json)) current.commands.setContent(json ?? '');
      },
    );

    onBeforeUnmount(() => {
      alive = false;
      root.value?.removeEventListener('keydown', onKeydownCapture, { capture: true });
      document.removeEventListener('keydown', onDocumentKeydown);
      editor.detach();
      unregisterComposer(props.composerKey);
      record('composer-unmounted', { key: props.composerKey });
    });

    // An insert payload REPLACES the draft; only changes count (no initial run).
    watch(
      () => inserts.getInsertPayload(props.accountId, props.chatId),
      (payload) => {
        if (payload === null || editor.tiptap === null) return;
        editor.clear();
        editor.insertContent(payload.html);
        editor.focus();
        inserts.clearInsertPayload(props.accountId, props.chatId);
      },
    );

    return (): VNode => {
      const frameClass = isBroken('composer-frame') ? 'composer-shell overflow-hidden' : 'composer-frame overflow-hidden';
      const slotProps: Record<string, string> = { 'data-id': isBroken('composer-slot') ? 'browser-composer-tools' : 'browser-composer-translator', class: 'inline-flex shrink-0 items-center' };
      if (nativeTranslatorOwner.value) slotProps['data-native-translator'] = '1';
      const translatorOn = settings.value.enabled;
      return h('div', { ref: root, class: 'relative composer-root', 'data-stand-composer': props.composerKey }, [
        h('div', { class: frameClass }, [
          h('div', { class: 'h-10 composer-strip' }, [
            h(
              'div',
              { class: 'composer-strip__quick' },
              QUICK_REPLIES.map((text) => h('button', { type: 'button', class: 'chip', onClick: () => editor.insertContent(text) }, text)),
            ),
            h('div', { class: 'composer-strip__trailing inline-flex' }, [
              withDirectives(h('div', { ref: slot, ...slotProps }), [
                [vComposerBridge, { editor, accountId: props.accountId, chatId: props.chatId, setInsertPayload: inserts.setInsertPayload }],
              ]),
              h('button', { type: 'button', class: 'chip', 'data-stand-templates': '', 'aria-expanded': String(templatesOpen.value), onClick: () => (templatesOpen.value = !templatesOpen.value) }, 'Templates'),
            ]),
          ]),
          h('div', { ref: editorHost, class: 'om-rich-text-editor' }),
          h('div', { class: 'composer-footer' }, [
            h('button', { type: 'button', class: ['chip', translatorOn ? 'chip--on' : ''], title: 'Alt+S', onClick: toggleTranslator }, translatorOn ? `Translate: on${settings.value.autoTranslate ? ' (auto)' : ''}` : 'Translate: off'),
            notice.value !== null ? h('span', { class: 'composer-notice' }, notice.value) : null,
            h('button', { type: 'button', class: 'send-button', onClick: () => void submit() }, 'Send'),
          ]),
        ]),
        templatesOpen.value
          ? h(
              'div',
              { class: 'templates-panel', 'data-dismissible-open': '' },
              TEMPLATES.map((text) => h('button', { type: 'button', class: 'templates-panel__item', onClick: () => insertTemplate(text) }, text)),
            )
          : null,
      ]);
    };
  },
});

interface ComposerSlot {
  readonly key: string;
  readonly tabId: string;
  readonly accountId: string;
  readonly chatId: string;
}

/** The block of composers under the message list: every visited chat tab keeps its composer. */
export const ConversationComposers = defineComponent({
  name: 'ConversationComposers',
  props: {
    accountId: { type: String, required: true },
    chatId: { type: String as PropType<string | null>, default: null },
    activeTabId: { type: String as PropType<string | null>, default: null },
    visited: { type: Array as PropType<readonly ComposerSlot[]>, required: true },
  },
  setup(props) {
    const cache = useQueryCache();
    const isShown = (slot: ComposerSlot): boolean => {
      if (slot.tabId !== props.activeTabId || slot.accountId !== props.accountId || slot.chatId !== props.chatId) return false;
      const accountKnown = (cache.getQueryData<Account[]>(keys.accounts()) ?? []).some((account) => String(account.id) === slot.accountId);
      const fan = cache.getQueryData<FansMap>(keys.fansMap(slot.accountId))?.[slot.chatId];
      // Hidden for a fan known to be missing or blocked; an unknown fan does not hide it.
      return accountKnown && fan !== null && fan?.isBlocked !== true;
    };
    return (): VNode =>
      h(
        'div',
        { class: 'shrink-0 composers' },
        props.visited.map((slot) => {
          const shown = isShown(slot);
          return withDirectives(h(ConversationComposer, { key: slot.key, composerKey: slot.key, tabId: slot.tabId, accountId: slot.accountId, chatId: slot.chatId, shown }), [[vShow, shown]]);
        }),
      );
  },
});
