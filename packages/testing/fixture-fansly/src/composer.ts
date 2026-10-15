// `app-group-message-input` — Fansly's composer (class `Qd`, main:55791-56265),
// as far as the extension meets it:
// - a plain `textarea.message-input` under NgModel: an `input` updates the MODEL, the draft cache and (at most every
//   3 s) the typing announcement (main:55943-55948); a send sends the model, never the field's text (main:56177);
// - a new composer restores the group's cached draft with no event: the field is empty for one microtask, then shows
//   it (main:55931, :114424-114429); after a send the field is cleared the same way (main:56187);
// - Enter sends unless the component's own Shift flag is up — set by a Shift keydown on the field, cleared by its
//   keyup; no `shiftKey`, no `isComposing` (main:56025-56035);
// - without media pending, `POST /message` is created and sent synchronously inside the Enter keydown or the Send
//   click (main:56169-56199); with templates it waits for `POST /account/media` (main:56099-56101);
// - the Send button keeps the focus (mousedown → preventDefault), is disabled while the model is empty;
// - branches without an address change: `div.no-dm-allowed` appears and `div.message-composer` gets `hidden` while
//   the DM rules are not met; the voice button turns into «Stop recording» while recording (template main:56271,
//   main:55759-55790);
// - files handed to the hidden `input[type=file]` (or pasted images, or dropped files) open the upload modal; the
//   attachment appears only after «Upload» (modal.ts);
// - its own ResizeObserver on `div.message-composer` (width only → a frame → a refresh, main:55792-55802), and a
//   detached change detector: the DOM changes only on its own refreshes.

import type { MessageAttachment } from './data';
import { handler } from './events';
import { record } from './journal';
import { UploadModal, type CreateTemplate, type ModalService } from './modal';
import { NgFor, NgIf, NgModelBinding, anchor, el, host, scope, setAttr, setClass, setText, type Scope, type View } from './ng';
import type { ComposerPlace, ComposerView } from './protocol';
import type { Group, GroupService } from './store';

export const FILE_ACCEPT = 'image/png, image/jpeg, image/webp, image/gif, video/*, audio/mp4, audio/m4a, audio/x-m4a, audio/mp3, audio/*';
const TYPING_ANNOUNCE_MS = 3000;
/** Composer mode 1: a DM (mode 3 is the mass-message modal, which the stand does not have). */
const DM_MODE = 1;

/** Every composer alive on the page (the control reads them). */
export const liveComposers = new Set<Composer>();
let instances = 0;

interface FieldView extends View {
  readonly composer: HTMLDivElement;
  readonly textarea: HTMLTextAreaElement;
  readonly model: NgModelBinding;
  readonly sendButton: HTMLButtonElement;
  readonly showActions: HTMLButtonElement;
  readonly actions: HTMLDivElement;
  readonly fileInput: HTMLInputElement;
  readonly recordIf: NgIf<View>;
  readonly stopIf: NgIf<View & { readonly time: HTMLElement }>;
  readonly partnerLabelIf: NgIf<View & { readonly label: HTMLElement }>;
  readonly typeLabelIf: NgIf<View>;
  readonly sendIcon: HTMLElement;
}

interface TemplateView extends View {
  refresh(): void;
}

export class Composer implements View {
  readonly instance: number;
  readonly host: HTMLElement;
  readonly nodes: readonly Node[];
  model = '';
  shiftDown = false;
  sendingMessage = false;
  templates: CreateTemplate[] = [];
  private readonly s: Scope = scope();
  private readonly mode = DM_MODE;
  private fieldShown = true;
  private showMediaButtons = true;
  private lastTypingAnnounce = 0;
  private recorder: { readonly startedAt: number } | null = null;
  private recordingTimer: ReturnType<typeof setInterval> | null = null;
  private uploadModal: UploadModal | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private layoutFrame: number | null = null;
  private readonly noDmIf: NgIf<View>;
  private readonly fieldIf: NgIf<FieldView>;
  private readonly templateFor: NgFor<CreateTemplate, TemplateView>;
  private readonly unsubscribe: Array<() => void> = [];
  private initialized = false;
  private destroyed = false;

  constructor(
    readonly place: ComposerPlace,
    readonly group: Group,
    private readonly store: GroupService,
    private readonly modals: ModalService,
  ) {
    instances += 1;
    this.instance = instances;
    const s = this.s;
    this.host = host(s, 'app-group-message-input');
    this.nodes = [this.host];
    this.noDmIf = new NgIf(() => ({ nodes: [el(s, 'div', { class: 'no-dm-allowed dark-blue-1 flex-col' }, [el(s, 'app-dm-permission-flags-display', {}, ['This creator only accepts messages from subscribers.'])])] }));
    this.fieldIf = new NgIf(() => this.createField());
    this.templateFor = new NgFor(
      (template) => String(template.id),
      (template) => this.createTemplateView(template),
    );
    // The template's order: four alert branches, the attachments, the story/tip/balance/input branches, «no-dm-allowed»,
    // the input footer and toolbars, the composer, the error line (main:56271). Views go before their anchors.
    this.host.append(
      anchor(),
      anchor(),
      anchor(),
      anchor(),
      el(s, 'div', { class: 'message-attachments' }, [anchor(), this.templateFor.anchor, el(s, 'div', { class: 'attachment' }), el(s, 'div', { class: 'attachment' }), el(s, 'div', { class: 'attachment' })]),
      anchor(),
      anchor(),
      anchor(),
      anchor(),
      anchor(),
      anchor(),
      this.noDmIf.anchor,
      anchor(),
      anchor(),
      this.fieldIf.anchor,
      el(s, 'div', { class: 'error-container flex-row flex-justify-end margin-top-text' }, [anchor()]),
    );
    liveComposers.add(this);
    this.unsubscribe.push(this.store.on(group.id, (event) => event === 'change' && this.refreshUi()));
    this.refreshUi();
    record('composer-created', { place, instance: this.instance, groupId: group.id });
  }

  /**
   * ngOnInit — after the composer's elements are in the document (Angular runs a child's init hooks in the change
   * detection that follows the view's insertion): the automated texts, then the cached draft, which NgModel writes to
   * the field a microtask later. So whatever reacts to the new composer (a MutationObserver's callback included)
   * finds its field empty.
   */
  ngOnInit(): void {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.store.automatedMessages();
    this.model = this.store.getCachedDmContent(this.group.id);
    this.onAfterContentInputChange();
    this.refreshUi();
    record('composer-init', { place: this.place, instance: this.instance, groupId: this.group.id, cached: this.model });
  }

  /** `div.message-composer` and its textarea, created anew whenever the branch turns on. */
  private createField(): FieldView {
    const s = this.s;
    const fileInput = el(s, 'input', { attrs: { multiple: '', type: 'file', accept: FILE_ACCEPT }, style: 'display: none;' });
    fileInput.addEventListener(
      'change',
      handler(() => {
        const files = [...(fileInput.files ?? [])];
        if (files.length > 0) this.handleFileUploads(files);
        fileInput.value = '';
      }),
    );
    const showActions = el(s, 'button', { class: 'show-actions', attrs: { type: 'button', title: 'Show actions', 'aria-label': 'Show actions' } }, [icon(s, 'fa-chevron-right fa-fw fasl')]);
    showActions.addEventListener(
      'click',
      handler(() => {
        this.showMediaButtons = !this.showMediaButtons;
        this.refreshUi();
      }),
    );
    const uploadNew = el(s, 'div', { class: 'dropdown-item', attrs: { 'data-menu-item': 'upload-new' } }, [el(s, 'i', { class: 'fa-fw fal fa-upload' }), el(s, 'xd-localization-string', {}, [' Upload New '])]);
    uploadNew.addEventListener('click', handler(() => fileInput.click()));
    const recordIf = new NgIf<View>(() => {
      const button = el(s, 'button', { class: 'input-addon margin-right-3', attrs: { type: 'button', title: 'Record voice message', 'aria-label': 'Record voice message' } }, [icon(s, 'fa-fw fa-microphone fasl')]);
      button.addEventListener('click', handler(() => this.startRecording()));
      return { nodes: [button] };
    });
    const stopIf = new NgIf(() => {
      const time = el(s, 'span', { class: 'recording-time' });
      const button = el(s, 'button', { class: 'input-addon margin-right-3 recording-action', attrs: { type: 'button', title: 'Stop recording', 'aria-label': 'Stop recording' } }, [
        icon(s, 'fa-fw fa-microphone fasl'),
        el(s, 'span', { class: 'recording' }, ['Rec ', time]),
      ]);
      button.addEventListener('click', handler(() => this.stopRecording()));
      return { nodes: [button], time };
    });
    const actions = el(s, 'div', { class: 'actions' }, [
      el(s, 'div', { class: 'input-addon transparent-dropdown margin-right-2', attrs: { appxddropdown: '' } }, [
        el(s, 'button', { class: 'dropdown-title', attrs: { type: 'button', title: 'Add media', 'aria-label': 'Add media' } }, [icon(s, 'fa-fw fa-image fasl')]),
        el(s, 'div', { class: 'dropdown-list top left' }, [uploadNew, el(s, 'div', { class: 'dropdown-item' }, [el(s, 'i', { class: 'fa-fw fal fa-photo-film' }), el(s, 'xd-localization-string', {}, [' From Vault '])])]),
      ]),
      el(s, 'div', { class: 'input-addon transparent-dropdown margin-right-3', attrs: { appxddropdown: '' } }, [
        el(s, 'button', { class: 'dropdown-title', attrs: { type: 'button', title: 'GIF', 'aria-label': 'GIF' } }, [icon(s, 'fa-fw fa-gif fasl')]),
        el(s, 'div', { class: 'dropdown-list gif-provider-browser top left' }),
      ]),
      el(s, 'button', { class: 'icon-stack input-addon margin-right-3 flex-align-self-center', attrs: { type: 'button', title: 'Paid text', 'aria-label': 'Paid text' } }, [icon(s, 'fa-align-justify fa-fw fasl')]),
      el(s, 'button', { class: 'input-addon margin-right-3', attrs: { type: 'button', title: 'Formatting', 'aria-label': 'Formatting', 'aria-expanded': 'false' } }, [icon(s, 'fa-text fa-fw fasl')]),
      recordIf.anchor,
      stopIf.anchor,
      anchor(),
      anchor(),
      anchor(),
    ]);
    const textarea = el(s, 'textarea', { class: 'message-input', attrs: { 'aria-label': 'Message', rows: '1', required: '' } });
    textarea.addEventListener('keydown', handler((event: KeyboardEvent) => this.onTextareaKeydown(event)));
    textarea.addEventListener('keyup', handler((event: KeyboardEvent) => this.onTextareaKeyup(event)));
    textarea.addEventListener('paste', handler((event: ClipboardEvent) => this.onPaste(event)));
    textarea.addEventListener('drop', handler((event: DragEvent) => this.onDrop(event)));
    const model = new NgModelBinding(textarea, (value) => this.onContentInputChange(value), handler);
    const partnerLabelIf = new NgIf(() => {
      const label = el(s, 'div', { class: 'label' });
      return { nodes: [label], label };
    });
    const typeLabelIf = new NgIf<View>(() => ({ nodes: [el(s, 'div', { class: 'label' }, ['Type a message'])] }));
    const sendIcon = icon(s, 'fa-fw fa-paper-plane-top fass');
    const sendButton = el(s, 'button', { class: 'send-button', attrs: { type: 'button', title: 'Send message', 'aria-label': 'Send message' } }, [sendIcon]);
    sendButton.addEventListener('mousedown', handler((event: MouseEvent) => event.preventDefault()));
    sendButton.addEventListener('click', handler(() => this.sendMessage()));
    const composer = el(s, 'div', { class: 'message-composer flex-row flex-align-center' }, [
      el(s, 'div', { class: 'collapsable-actions' }, [fileInput, showActions, actions]),
      el(s, 'div', { class: 'message-entry' }, [el(s, 'div', { class: 'message-input-container' }, [anchor(), textarea, partnerLabelIf.anchor, typeLabelIf.anchor]), sendButton]),
    ]);
    // The ResizeObserver of the composer: a new width → one frame → a refresh (main:55792-55802).
    let width = 0;
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const next = entries[0]?.contentRect.width ?? 0;
        if (next === 0 || Math.abs(next - width) < 0.5) return;
        width = next;
        if (this.layoutFrame !== null) cancelAnimationFrame(this.layoutFrame);
        this.layoutFrame = requestAnimationFrame(() => {
          this.layoutFrame = null;
          this.refreshUi();
        });
      });
      this.resizeObserver.observe(composer);
    }
    return {
      nodes: [composer],
      composer,
      textarea,
      model,
      sendButton,
      showActions,
      actions,
      fileInput,
      recordIf,
      stopIf,
      partnerLabelIf,
      typeLabelIf,
      sendIcon,
      destroy: () => {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
      },
    };
  }

  private createTemplateView(template: CreateTemplate): TemplateView {
    const s = scope();
    const element = host(s, 'app-account-media-create-template', { class: 'attachment' });
    const percent = el(s, 'div', { class: 'progress-percent' });
    const bar = el(s, 'div', { class: 'progress-bar-progress' });
    const progress = el(s, 'div', { class: 'upload-progress' }, [percent, el(s, 'div', { class: 'progress-bar' }, [bar])]);
    const name = el(s, 'div', { class: 'media-template-name' });
    element.append(el(s, 'div', { class: 'media-template' }, [name, progress]));
    // The component refreshes its progress every 500 ms while it uploads (main:6552-6556).
    const timer = setInterval(() => view.refresh(), 500);
    const view: TemplateView = {
      // `ng-container` around it in the composer's template: its comment stays with the element.
      nodes: [element, anchor()],
      refresh: () => {
        setText(name, template.files.map((file) => file.name).join(', '));
        setText(percent, `${template.progress}%`);
        bar.style.width = `${template.progress}%`;
        if (template.isUploaded()) {
          progress.remove();
          clearInterval(timer);
        }
      },
      destroy: () => clearInterval(timer),
    };
    view.refresh();
    return view;
  }

  get field(): HTMLTextAreaElement | null {
    return this.fieldIf.view?.textarea ?? null;
  }

  private partner(): string | null {
    return this.group.partners[0]?.username ?? null;
  }

  canSendMessage(): boolean {
    if (this.model.length <= 0 && this.templates.length === 0) return false;
    return this.templates.every((template) => template.isUploaded());
  }

  /** The detached change detector's pass: only changed values reach the DOM. */
  refreshUi(): void {
    if (this.destroyed) return;
    const dmUnmet = this.mode === DM_MODE && this.group.dmRulesUnmet;
    this.noDmIf.update(dmUnmet);
    const field = this.fieldIf.update(this.mode === DM_MODE && this.fieldShown);
    this.templateFor.update(this.templates);
    if (field === null) return;
    setClass(field.composer, 'hidden', dmUnmet);
    setAttr(field.showActions, 'hidden', this.showMediaButtons ? '' : null);
    setClass(field.actions, 'actions-collapsed', !this.showMediaButtons);
    const recording = this.recorder !== null;
    field.recordIf.update(!(dmUnmet || recording));
    const stop = field.stopIf.update(!dmUnmet && recording);
    if (stop !== null && this.recorder !== null) setText(stop.time, `${Math.floor((performance.now() - this.recorder.startedAt) / 1000)}s`);
    const partner = this.partner();
    const label = field.partnerLabelIf.update(partner !== null && this.model === '');
    if (label !== null && partner !== null) setText(label.label, ` Message @${partner.slice(0, 12)} `);
    field.typeLabelIf.update(partner === null && this.model === '');
    const canSend = this.canSendMessage();
    setClass(field.sendButton, 'can-send', canSend);
    setAttr(field.sendButton, 'disabled', !canSend || this.sendingMessage ? '' : null);
    setClass(field.sendIcon, 'fa-spin', this.sendingMessage);
    field.model.bind(this.model);
  }

  // ── typing ──

  private onContentInputChange(value: string): void {
    this.model = value;
    // Every value the model takes from the field, by the group this composer serves: where a write landed (R20 P7e).
    record('composer-model', { place: this.place, instance: this.instance, groupId: this.group.id, value });
    this.onAfterContentInputChange();
    this.store.cacheDmContent(this.group.id, this.model);
    if (this.model.length > 0) {
      const now = Date.now();
      if (now - this.lastTypingAnnounce > TYPING_ANNOUNCE_MS) {
        this.lastTypingAnnounce = now;
        this.store.announceTyping(this.group.id);
      }
    }
    this.refreshUi();
  }

  /** The field's height follows its text a task later; the media buttons fold while there is text (main:55914-55927). */
  private onAfterContentInputChange(): void {
    const field = this.field;
    if (field !== null) {
      setTimeout(() => {
        field.style.height = 'auto';
        field.style.height = `${field.scrollHeight}px`;
      }, 0);
    }
    if (this.model.length > 0 && this.showMediaButtons) {
      this.showMediaButtons = false;
      this.refreshUi();
    } else if (this.model === '' && !this.showMediaButtons) {
      this.showMediaButtons = true;
      this.refreshUi();
    }
  }

  private onTextareaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      if (!this.shiftDown) this.shiftDown = true;
    } else if (event.key === 'Enter') {
      if (this.shiftDown) return;
      event.preventDefault();
      this.sendMessage();
    }
  }

  private onTextareaKeyup(event: KeyboardEvent): void {
    if (event.key === 'Shift' && this.shiftDown) this.shiftDown = false;
  }

  // ── send ──

  sendMessage(): void {
    if (!this.canSendMessage() || this.sendingMessage) return;
    this.sendingMessage = true;
    const content = this.model;
    const fieldValue = this.field?.value ?? null;
    const createdAt = Math.floor(Date.now() / 1000);
    this.processTemplates((attachments) => {
      record('composer-send', { place: this.place, instance: this.instance, groupId: this.group.id, content, fieldValue, attachments: attachments.length });
      this.store.sendMessageToGroup({ groupId: this.group.id, content, attachments, createdAt });
      this.model = '';
      this.store.cacheDmContent(this.group.id, '');
      this.templates = [];
      this.sendingMessage = false;
      this.refreshUi();
    });
    this.refreshUi();
  }

  /** No templates: the callback runs now, in the caller's handler. Templates: after `POST /account/media`. */
  private processTemplates(done: (attachments: readonly MessageAttachment[]) => void): void {
    if (this.templates.length === 0) {
      done([]);
      return;
    }
    this.store.createMedia(
      this.templates.flatMap((template) => template.files),
      (attachments) => done(attachments),
    );
  }

  // ── files and voice ──

  private onPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.items ?? [])].filter((item) => item.type.includes('image')).flatMap((item) => item.getAsFile() ?? []);
    if (files.length > 0) this.handleFileUploads(files);
    this.refreshUi();
  }

  private onDrop(event: DragEvent): void {
    const files = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file').flatMap((item) => item.getAsFile() ?? []);
    if (files.length > 0) this.handleFileUploads(files);
    event.preventDefault();
    this.refreshUi();
  }

  private handleFileUploads(files: readonly File[]): void {
    if (this.uploadModal === null) this.openUploadModal();
    this.uploadModal?.processFiles(files);
    this.refreshUi();
  }

  private openUploadModal(): void {
    const modal = new UploadModal(
      this.modals,
      (template) => {
        if (!this.templates.includes(template)) {
          this.templates = [...this.templates, template];
          template.onUpload(() => this.refreshUi());
        }
        this.refreshUi();
        template.upload();
      },
      () => {
        this.uploadModal = null;
      },
    );
    this.uploadModal = modal;
    modal.show();
  }

  /** The stand's recorder records nothing: no microphone; Stop hands a small audio file to the upload path. */
  private startRecording(): void {
    if (this.recorder !== null) return;
    this.recorder = { startedAt: performance.now() };
    this.recordingTimer = setInterval(() => this.refreshUi(), 1000);
    record('recording-start', { instance: this.instance, groupId: this.group.id });
    this.refreshUi();
  }

  private stopRecording(): void {
    if (this.recorder === null) return;
    if (this.recordingTimer !== null) clearInterval(this.recordingTimer);
    this.recordingTimer = null;
    this.recorder = null;
    record('recording-stop', { instance: this.instance, groupId: this.group.id });
    this.handleFileUploads([new File([new Uint8Array(64)], 'fansly-audio-recording', { type: 'audio/webm' })]);
    this.refreshUi();
  }

  /** The control's stand-only re-creation of the field branch (protocol.ts `recreateField`). */
  recreateField(): void {
    this.fieldShown = false;
    this.refreshUi();
    this.fieldShown = true;
    this.refreshUi();
    record('composer-field-recreated', { instance: this.instance, groupId: this.group.id });
  }

  view(): ComposerView {
    const field = this.field;
    return {
      place: this.place,
      instance: this.instance,
      groupId: this.group.id,
      connected: this.host.isConnected,
      value: field?.value ?? null,
      model: this.model,
      cached: this.store.getCachedDmContent(this.group.id),
      shiftDown: this.shiftDown,
      canSend: this.canSendMessage(),
      sending: this.sendingMessage,
      hidden: this.fieldIf.view?.composer.classList.contains('hidden') ?? false,
      noDmAllowed: this.noDmIf.view !== null,
      recording: this.recorder !== null,
      attachments: this.templates.flatMap((template) => template.files.map((file) => ({ name: file.name, type: file.type, progress: template.progress, uploaded: template.isUploaded() }))),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    record('composer-destroyed', { place: this.place, instance: this.instance, groupId: this.group.id });
    for (const stop of this.unsubscribe) stop();
    if (this.recordingTimer !== null) clearInterval(this.recordingTimer);
    if (this.layoutFrame !== null) cancelAnimationFrame(this.layoutFrame);
    this.templateFor.destroy();
    this.fieldIf.destroy();
    this.noDmIf.destroy();
    this.destroyed = true;
    liveComposers.delete(this);
  }
}

function icon(s: Scope, classes: string): HTMLElement {
  return el(s, 'app-icon', {}, [el(s, 'i', { class: classes })]);
}
