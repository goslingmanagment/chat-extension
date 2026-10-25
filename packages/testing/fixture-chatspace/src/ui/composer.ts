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
//       div.relative[data-stand-composer]       ← composer root: the frame root, ChatSpace's drop zone
//         div.composer-frame.overflow-hidden    ← clips its content
//           div.h-10 (top strip)
//             … quick buttons …
//             div.inline-flex (trailing group)
//               div[data-id="browser-composer-translator"]  ← bridge slot, Vue never renders children
//               button Templates
//           div.composer-audio                  ← the draft's audio tiles (only with an audio)
//           div.composer-media-zone             ← other media and the uploads' tiles (only with one)
//           div.om-rich-text-editor > .ProseMirror (TipTap, created asynchronously)
//           footer: translator chip, Send
//         toasts, the drop overlay              ← beside the frame, as ChatSpace's are outside it
//
// Alt+S (by `code`, any other modifiers) toggles the translator in a capture
// listener on the composer root; the Templates panel carries
// `data-dismissible-open` while open.
//
// Files (1.47.0, as ChatSpace 0.233.0's composer): the composer root is a drop
// zone like ChatSpace's (VueUse useDropZone) — a drag whose items hold a file
// is taken, and on the drop the PAGE's own listener reads `files` (so a
// DataTransfer an extension builds in its isolated world reaches it empty, as
// in Firefox). Only with the role's «Media uploader» (om_view_media_uploader
// or om_upload_media_hub) and no GIF; the type by MIME or extension, at most
// 4 GB, one audio and 40 media a message (the uploads counted) — else a toast
// and nothing. Each file shows an uploading tile while the stand «uploads» it
// (env.upload: delay, failure); then, in one step, the medium joins the
// draft's `media` (with `uploadDescriptor.name` = the file's name) and its
// tile takes the upload's place — or the tile goes and a toast says it
// failed. Send waits while anything uploads and takes media without text.

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
import { draftKey, loadDraft, persistDraft, textToParagraph, vComposerBridge, type DraftBody, type DraftMedium } from './bridge';
import { createEditorHandle } from './editor-handle';
import { registerComposer, unregisterComposer } from './registry';

const TYPING_THROTTLE_MS = 3000;
const TRANSLATE_MS = 60;
const QUICK_REPLIES = ['(◕‿◕)', 'ok!', '♡'];
const TEMPLATES = env.showcase
  ? ['hey you 💕 how is your day going?', 'good morning ☀️ did you sleep well?', 'thank you for the tip, you spoil me 🥰']
  : ['Синтетический шаблон: привет!', 'Stand template: how was your day?', 'Тестовый шаблон №3'];
const PLACEHOLDER = env.showcase ? 'Type a message…' : 'Stand message…';
/** ChatSpace's «Media uploader»: either permission lets a file into the composer. */
const UPLOAD_PERMISSIONS = ['om_view_media_uploader', 'om_upload_media_hub'];
/** What ChatSpace's composer takes: these MIME types, or a name with one of these extensions. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/gif', 'audio/mpeg', 'video/mp4', 'audio/ogg', 'audio/wav', 'video/quicktime'];
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.mp3', '.mp4', '.ogg', '.wav', '.mov'];
const MAX_FILE_BYTES = 4 * 1024 ** 3;
const MAX_MEDIA = 40;
/** How long a metadata read of a file waits before its length counts as unknown. */
const DURATION_WAIT_MS = 3000;
const NOTICE_MS = 2500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A file on its way up (ChatSpace's uploading list). */
interface UploadingFile {
  readonly id: string;
  readonly type: DraftMedium['type'];
  readonly name: string;
  readonly file: File;
}

/** The medium's kind by MIME, as ChatSpace tells it (a file of no known MIME counts as an image). */
const mediaTypeOf = (mime: string): DraftMedium['type'] =>
  mime.startsWith('image/gif') ? 'gif' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image';

/** A file's length in seconds, as ChatSpace reads it (a media element's metadata); 0 — not told. */
const durationOf = (file: File, type: DraftMedium['type']): Promise<number> =>
  type !== 'audio' && type !== 'video'
    ? Promise.resolve(0)
    : new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const element = document.createElement(type);
        let done = false;
        const finish = (seconds: number): void => {
          if (done) return;
          done = true;
          URL.revokeObjectURL(url);
          resolve(seconds);
        };
        element.preload = 'metadata';
        element.onloadedmetadata = () => finish(Number.isFinite(element.duration) ? Math.floor(element.duration) : 0);
        element.onerror = () => finish(0);
        setTimeout(() => finish(0), DURATION_WAIT_MS);
        element.src = url;
      });

/** `m:ss`; an unknown length — `–:––`. */
export const clockOf = (seconds: number | undefined): string => (seconds !== undefined && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '–:––');

let uploads = 0;

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
      }, NOTICE_MS);
    };

    // ── files: the drop zone, the uploads, the draft's media (1.47.0) ──
    const canUpload = computed(() => (cache.getQueryData<string[]>(keys.userPermissions()) ?? []).some((permission) => UPLOAD_PERMISSIONS.includes(permission)));
    const uploading = ref<UploadingFile[]>([]);
    /** Drags with a file over the root (in minus out): ChatSpace's drop overlay shows while there is one. */
    const dragging = ref(0);
    /** ChatSpace's toasts of a file: outside the frame, as its own are. */
    const toast = ref<string | null>(null);
    const playingId = ref<string | null>(null);
    let player: HTMLAudioElement | null = null;

    const notify = (text: string): void => {
      toast.value = text;
      record('composer-toast', { key: props.composerKey, text });
      setTimeout(() => {
        if (toast.value === text) toast.value = null;
      }, NOTICE_MS);
    };
    const medias = (): readonly DraftMedium[] => model.value.media?.medias ?? [];
    /** The draft's media from now on; a medium that leaves it lets its file go. */
    const setMedias = (next: readonly DraftMedium[]): void => {
      for (const medium of medias()) if (!next.includes(medium) && medium.playableContentUrl?.startsWith('blob:') === true) URL.revokeObjectURL(medium.playableContentUrl);
      model.value = { ...model.value, media: next.length > 0 ? { medias: next, price: null, lockedText: false } : null };
    };

    /** The stand's upload of one file: `env.upload` says how long it takes and whether it fails. */
    const upload = async (item: UploadingFile): Promise<void> => {
      const duration = await durationOf(item.file, item.type);
      await delay(env.upload.delayMs);
      // Canceled meanwhile, or the composer went (ChatSpace cancels its upload with it).
      if (!alive || !uploading.value.some((entry) => entry.id === item.id)) return;
      const rest = uploading.value.filter((entry) => entry.id !== item.id);
      if (env.upload.fail) {
        uploading.value = rest;
        record('composer-upload-failed', { key: props.composerKey, name: item.name });
        notify('Upload failed');
        return;
      }
      const processId = `stand-upload-${item.id}`;
      const medium: DraftMedium = {
        id: processId,
        type: item.type,
        ...(duration > 0 ? { duration } : {}),
        isFree: true,
        ...(item.type === 'audio' || item.type === 'video' ? { playableContentUrl: URL.createObjectURL(item.file) } : {}),
        uploadDescriptor: { processId, host: 'stand', name: item.name, extra: { duration } },
      };
      // One step, as ChatSpace's: the medium joins the draft and its tile takes the upload's place.
      setMedias([...medias(), medium]);
      uploading.value = rest;
      record('composer-uploaded', { key: props.composerKey, name: item.name, type: item.type });
    };

    /** ChatSpace's `addFiles`: its types, its size, one audio and 40 media a message (the uploads counted), then an upload each. */
    const addFiles = (files: readonly File[]): void => {
      const known = files.filter((file) => ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension)));
      if (known.length < files.length) notify('Unsupported file type');
      const sized = known.filter((file) => file.size <= MAX_FILE_BYTES);
      if (sized.length < known.length) notify('File is too large');
      const held = [...medias(), ...uploading.value];
      let audios = held.filter((item) => item.type === 'audio').length;
      let count = held.length;
      for (const file of sized) {
        const type = mediaTypeOf(file.type);
        if ((type === 'audio' && audios >= 1) || count >= MAX_MEDIA) {
          notify('Reached Platform Limit');
          continue;
        }
        if (type === 'audio') audios += 1;
        count += 1;
        uploads += 1;
        const item: UploadingFile = { id: String(uploads), type, name: file.name, file };
        uploading.value = [...uploading.value, item];
        record('composer-upload', { key: props.composerKey, name: file.name, type, size: file.size });
        void upload(item);
      }
    };

    const hasFile = (event: DragEvent): boolean => Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file');
    /** VueUse's zone: a drag whose items hold a file is taken; `delta` counts it in or out for the overlay. */
    const onDrag =
      (delta: number) =>
      (event: DragEvent): void => {
        if (!hasFile(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        dragging.value = Math.max(0, dragging.value + delta);
      };
    const onDrop = (event: DragEvent): void => {
      if (!hasFile(event)) return;
      event.preventDefault();
      dragging.value = 0;
      // The page reads the drop's files itself: a DataTransfer an extension built in its isolated world reaches it empty.
      const files = Array.from(event.dataTransfer?.files ?? []);
      const allowed = canUpload.value && model.value.gif === null;
      record('composer-drop', { key: props.composerKey, files: files.length, allowed });
      if (allowed && files.length > 0) addFiles(files);
    };
    /** The root's listeners: the frame root is ChatSpace's drop zone. */
    const dropZone = { onDragenter: onDrag(1), onDragover: onDrag(0), onDragleave: onDrag(-1), onDrop };

    const stopPlaying = (): void => {
      player?.pause();
      player = null;
      playingId.value = null;
    };
    const play = (medium: DraftMedium): void => {
      const again = playingId.value === medium.id;
      stopPlaying();
      if (again || medium.playableContentUrl === undefined) return;
      const audio = new Audio(medium.playableContentUrl);
      audio.onended = stopPlaying;
      player = audio;
      playingId.value = medium.id;
      audio.play().catch(stopPlaying);
    };
    const removeMedium = (id: string): void => {
      if (playingId.value === id) stopPlaying();
      setMedias(medias().filter((medium) => medium.id !== id));
      record('composer-media-removed', { key: props.composerKey, id });
    };
    const cancelUpload = (id: string): void => {
      uploading.value = uploading.value.filter((entry) => entry.id !== id);
      record('composer-upload-canceled', { key: props.composerKey, id });
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
      // Nothing to send, an upload still on its way (ChatSpace's Send waits for it), or the templates open.
      if (current.tiptap === null || (current.getText().trim() === '' && model.value.media === null) || uploading.value.length > 0 || templatesOpen.value) return;
      if (settings.value.enabled && settings.value.autoTranslate && current.getText().trim() !== '') {
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
      const media = model.value.media;
      const entry = toQueue({
        accountId: props.accountId,
        chatId: props.chatId,
        platform: 'onlyfans',
        text: html,
        hasAttachments: media !== null,
        // ChatSpace's metadata of the media: an upload goes by its descriptor, a vault medium by its id.
        platformMetadata: media === null ? {} : { mediaFiles: media.medias.map((medium) => medium.uploadDescriptor ?? (medium.type === 'audio' ? { id: Number(medium.id), thumbId: 0 } : Number(medium.id))) },
        composerContent: { html, media, gif: null, taggedCreators: [] },
        internalTemplateId: null,
        isCopied: lastPaste !== '' && current.getText().trim() === lastPaste.trim(),
      });
      if (entry === null) {
        flash('Queue is full or Mimic runs this chat');
        return;
      }
      stopPlaying();
      current.clear();
      setMedias([]);
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
      stopPlaying();
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

    const audioTile = (medium: DraftMedium): VNode =>
      h('div', { key: medium.id, class: 'composer-audio__tile', 'data-stand-audio': medium.uploadDescriptor?.name ?? medium.id }, [
        h('button', { type: 'button', class: 'composer-audio__play', 'aria-label': playingId.value === medium.id ? 'Pause' : 'Play', onClick: () => play(medium) }, playingId.value === medium.id ? '❚❚' : '▶'),
        h('span', { class: 'composer-audio__wave', 'aria-hidden': 'true' }),
        h('span', { class: 'composer-audio__time' }, clockOf(medium.duration)),
        h('button', { type: 'button', class: 'composer-tile-remove', 'aria-label': 'Remove audio', title: 'Remove audio', onClick: () => removeMedium(medium.id) }, '✕'),
      ]);
    const mediaTile = (medium: DraftMedium): VNode =>
      h('div', { key: medium.id, class: 'composer-media-tile', 'data-stand-media': medium.type }, [
        h('span', { class: 'composer-media-tile__kind' }, medium.type),
        h('button', { type: 'button', class: 'composer-tile-remove', 'aria-label': 'Remove media', title: 'Remove media', onClick: () => removeMedium(medium.id) }, '✕'),
      ]);
    const uploadingTile = (item: UploadingFile): VNode =>
      h('div', { key: item.id, class: 'composer-media-tile composer-media-tile--uploading', 'data-stand-uploading': item.name }, [
        h('span', { class: 'composer-media-tile__kind' }, item.type),
        h('span', { class: 'composer-spinner', role: 'progressbar', 'aria-label': 'Uploading' }),
        h('button', { type: 'button', class: 'composer-tile-remove', 'aria-label': 'Cancel upload', title: 'Cancel upload', onClick: () => cancelUpload(item.id) }, '✕'),
      ]);
    /**
     * ChatSpace's attachments, right in the frame, each section a node of its own (keyed: a done upload REPLACES the
     * zone with the audio's section, as ChatSpace's components do): the audio tiles; the zone of other media and uploads.
     */
    const attachments = (): VNode[] => {
      const audios = medias().filter((medium) => medium.type === 'audio');
      const others = medias().filter((medium) => medium.type !== 'audio');
      return [
        ...(audios.length > 0 ? [h('div', { key: 'audio', class: 'composer-audio' }, audios.map(audioTile))] : []),
        ...(others.length > 0 || uploading.value.length > 0 ? [h('div', { key: 'media', class: 'composer-media-zone' }, [...others.map(mediaTile), ...uploading.value.map(uploadingTile)])] : []),
      ];
    };

    return (): VNode => {
      const frameClass = isBroken('composer-frame') ? 'composer-shell overflow-hidden' : 'composer-frame overflow-hidden';
      const slotProps: Record<string, string> = { 'data-id': isBroken('composer-slot') ? 'browser-composer-tools' : 'browser-composer-translator', class: 'inline-flex shrink-0 items-center' };
      if (nativeTranslatorOwner.value) slotProps['data-native-translator'] = '1';
      const translatorOn = settings.value.enabled;
      return h('div', { ref: root, class: 'relative', 'data-stand-composer': props.composerKey, ...dropZone }, [
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
          ...attachments(),
          h('div', { ref: editorHost, class: 'om-rich-text-editor' }),
          h('div', { class: 'composer-footer' }, [
            h('button', { type: 'button', class: ['chip', translatorOn ? 'chip--on' : ''], title: 'Alt+S', onClick: toggleTranslator }, translatorOn ? `Translate: on${settings.value.autoTranslate ? ' (auto)' : ''}` : 'Translate: off'),
            notice.value !== null ? h('span', { class: 'composer-notice' }, notice.value) : null,
            h('button', { type: 'button', class: 'send-button', 'data-stand-send': '', disabled: uploading.value.length > 0, onClick: () => void submit() }, 'Send'),
          ]),
        ]),
        dragging.value > 0
          ? h('div', { class: 'composer-drop-overlay', 'data-stand-drop-overlay': '' }, [h('strong', 'Drop files here'), h('span', ACCEPTED_EXTENSIONS.map((extension) => extension.slice(1).toUpperCase()).join(', '))])
          : null,
        toast.value !== null ? h('div', { class: 'composer-toast', role: 'status', 'data-stand-toast': '' }, toast.value) : null,
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
