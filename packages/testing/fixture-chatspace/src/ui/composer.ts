// Composers (metadata.ts «composer-dom»): one per visited chat tab of the
// route's account, all rendered, only the active one shown (v-show), keyed
// `${tabId}:${accountId}:${chatId}`; the active one is hidden while the route
// chat is not found or its fan is blocked. The stand's `remountComposers`
// renders them all again (a round number in the Vue key), with a pause or in
// one step.
//
// Inside each, the OnlyFans composer exists only when ChatSpace would let the
// human compose (canComposeMessages): the role may send (no
// of_block_message_sending, unless the user owns the organisation), the fan
// can receive messages (a missing fan does not forbid it), and — Mimic being
// available on OnlyFans — Mimic data has loaded and Mimic does not run the
// chat. Otherwise there is no composer, no slot and no bridge: a Mimic panel
// when Mimic runs the chat, an «unavailable» notice once Mimic data is in, and
// nothing at all while it loads.
//
//   div[data-stand-composer-slot]               ← per tab (v-show)
//     div.relative
//       div.relative[data-stand-composer]       ← composer root
//         div.composer-frame.overflow-hidden    ← clips its content
//           div.h-10 (top strip)
//             … quick buttons …
//             div.inline-flex (trailing group)
//               div[data-id="browser-composer-translator"]  ← bridge slot, Vue never renders children
//               button Templates
//           div.om-rich-text-editor > .ProseMirror (TipTap, created asynchronously)
//           footer: translator chip, Send
//
// Alt+S (by `code`, any other modifiers) toggles the translator in a capture
// listener on the composer root; the Templates panel carries
// `data-dismissible-open` while open.

import type { JSONContent } from '@tiptap/core';
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, vShow, watch, withDirectives, type PropType, type VNode } from 'vue';

import { env, isBroken } from '../env';
import { record } from '../journal';
import { isOwner } from '../net/auth';
import { api } from '../net/http';
import { useQueryCache } from '../query/cache';
import type { FansMap } from '../query/model';
import { keys } from '../query/queries';
import { useComposerTranslator, useOfComposerInsert } from '../stores/composer';
import { isMimicTakeover, usePendingMessages, type QueueInput } from '../stores/pending-messages';
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

/** The OnlyFans composer itself (mounted only when the human may compose). */
const OfComposer = defineComponent({
  name: 'OfComposer',
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
      return h('div', { ref: root, class: 'relative', 'data-stand-composer': props.composerKey }, [
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
            h('button', { type: 'button', class: 'send-button', 'data-stand-send': '', onClick: () => void submit() }, 'Send'),
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

const ROLE_CANNOT_SEND = 'of_block_message_sending';

/** One visited chat tab: the composer when the human may compose, else a Mimic panel or a notice (or nothing yet). */
const ConversationComposer = defineComponent({
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
    const roleBlocked = computed(() => (cache.getQueryData<string[]>(keys.userPermissions()) ?? []).includes(ROLE_CANNOT_SEND) && !isOwner.value);
    const fan = computed(() => cache.getQueryData<FansMap>(keys.fansMap(props.accountId))?.[props.chatId]);
    const canReceive = computed(() => fan.value?.canReceiveMessages !== false);
    const loaded = (key: readonly string[]): boolean => {
      const status = cache.get(key)?.state.value.status;
      return status !== undefined && status !== 'pending';
    };
    const mimicLoaded = computed(() => loaded(keys.mimicSettings()) && loaded(keys.mimicChats()));
    const takeover = computed(() => isMimicTakeover(cache, props.accountId, props.chatId));
    // The stand's accounts are all OnlyFans, where Mimic is available.
    const canCompose = computed(() => !roleBlocked.value && canReceive.value && mimicLoaded.value && !takeover.value);
    const unavailableReason = computed(() => {
      if (roleBlocked.value) return 'Your role cannot send messages';
      if (canReceive.value) return null;
      return fan.value?.isExpired === true ? 'Subscription expired' : 'Messaging restricted';
    });
    watch(
      canCompose,
      (can) => record('composer-can-compose', { key: props.composerKey, can, roleBlocked: roleBlocked.value, canReceive: canReceive.value, mimicLoaded: mimicLoaded.value, takeover: takeover.value }),
      { immediate: true },
    );
    return (): VNode =>
      h('div', { 'data-stand-composer-slot': props.composerKey }, [
        takeover.value
          ? h('div', { class: 'composer-mimic', 'data-stand-mimic-panel': '' }, 'Mimic is answering in this chat')
          : !canCompose.value && mimicLoaded.value
            ? h('div', { class: 'composer-unavailable', 'data-testid': 'chat-unavailable-notice' }, [
                h('strong', 'Chat unavailable'),
                unavailableReason.value !== null ? h('span', { 'data-testid': 'chat-unavailable-reason' }, unavailableReason.value) : null,
              ])
            : null,
        canCompose.value
          ? h('div', { class: 'relative' }, [h(OfComposer, { composerKey: props.composerKey, tabId: props.tabId, accountId: props.accountId, chatId: props.chatId, shown: props.shown })])
          : null,
      ]);
  },
});

export interface ComposerSlot {
  readonly key: string;
  readonly tabId: string;
  readonly accountId: string;
  readonly chatId: string;
}

/** `remountComposers`: the block's composers are down, and the round of re-renders (part of their Vue keys). */
const remount = ref({ down: false, round: 0 });

/**
 * The stand's control `remountComposers`: ChatSpace renders its composers again without a store change — every
 * composer of the block is taken down and, `gapMs` later, rendered anew: new nodes, the same chats and tabs. `gapMs`
 * 0 — in one step: one render of the block swaps the old nodes for the new ones (a changed key), the page is never
 * without a composer. Nothing of Pinia or the query cache moves, so MAIN, which reads the composer on store events,
 * hears nothing of it.
 */
export async function remountComposers(gapMs: number): Promise<void> {
  record('stand-composers-remount', { gapMs });
  if (gapMs > 0) {
    remount.value = { down: true, round: remount.value.round };
    await nextTick();
    await delay(gapMs);
  }
  remount.value = { down: false, round: remount.value.round + 1 };
  await nextTick();
}

/** The block of composers under the message list. */
export const ConversationComposers = defineComponent({
  name: 'ConversationComposers',
  props: {
    slots: { type: Array as PropType<readonly ComposerSlot[]>, required: true },
    activeTabId: { type: String as PropType<string | null>, default: null },
    /** The route chat is not found or its fan is blocked: the active composer stays hidden. */
    hideActive: { type: Boolean, required: true },
  },
  setup(props) {
    return (): VNode =>
      h(
        'div',
        { class: 'shrink-0 composers', 'data-stand-composers': '' },
        remount.value.down
          ? []
          : props.slots.map((slot) => {
              const shown = slot.tabId === props.activeTabId && !props.hideActive;
              const key = `${slot.key}#${remount.value.round}`;
              return withDirectives(h(ConversationComposer, { key, composerKey: slot.key, tabId: slot.tabId, accountId: slot.accountId, chatId: slot.chatId, shown }), [[vShow, shown]]);
            }),
      );
  },
});
