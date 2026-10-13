// Fansly's modals and the upload path of the composer:
// - the modal service: `div.modal-wrapper > div.xdModal[xdmodal]` in app-root; a modal component is inserted after
//   `div.xdModal` (its view container); while any is open `div.xdModal` has `back-drop` and `body` has
//   `modal-opened` with an inline width (main:24505-24507, :54064-54074, :61745);
// - the upload modal `app-account-media-upload` (mode 3, for the composer): files handed to the composer's file input
//   are only listed here — they become an attachment when a person clicks «Upload» (main:55951-55975,
//   :42635-42646);
// - the create template: what «Upload» hands the composer; it uploads at once and shows its progress in
//   `app-account-media-create-template.attachment` (main:55186-55203, :6552-6556).

import type { UploadFile } from './backend';
import { handler } from './events';
import { record } from './journal';
import { el, host, scope, setClass, setText, type Scope } from './ng';

export interface ModalRef {
  readonly element: HTMLElement;
  close(): void;
}

export class ModalService {
  readonly wrapper: HTMLDivElement;
  readonly xd: HTMLDivElement;
  private readonly open_: Array<{ readonly element: HTMLElement; readonly onClose: () => void }> = [];

  constructor() {
    const s = scope();
    this.xd = el(s, 'div', { class: 'xdModal', attrs: { xdmodal: '' } });
    this.wrapper = el(s, 'div', { class: 'modal-wrapper' }, [this.xd]);
    // A click on the backdrop closes the most recent modal.
    this.xd.addEventListener('click', (event) => {
      if (event.target === this.xd) this.open_.at(-1)?.onClose();
    });
  }

  get tags(): string[] {
    return this.open_.map((entry) => entry.element.localName);
  }

  open(element: HTMLElement, onClose: () => void): ModalRef {
    const last = this.open_.at(-1)?.element ?? this.xd;
    last.after(element);
    const entry = { element, onClose };
    this.open_.push(entry);
    this.activeChange();
    record('modal-open', { modal: element.localName });
    return {
      element,
      close: () => {
        const index = this.open_.indexOf(entry);
        if (index < 0) return;
        this.open_.splice(index, 1);
        element.remove();
        this.activeChange();
        record('modal-close', { modal: element.localName });
      },
    };
  }

  private activeChange(): void {
    const body = document.body;
    if (this.open_.length > 0) {
      const width = body.clientWidth;
      setClass(this.xd, 'back-drop', true);
      setClass(body, 'modal-opened', true);
      body.style.width = `${width}px`;
      this.open_.forEach((entry, index) => {
        const active = index === this.open_.length - 1;
        setClass(entry.element, 'active-modal', active);
        setClass(entry.element, 'inactive-modal', !active);
      });
    } else {
      setClass(this.xd, 'back-drop', false);
      setClass(body, 'modal-opened', false);
      body.style.removeProperty('width');
      if (body.getAttribute('style') === '') body.removeAttribute('style');
    }
  }
}

/** How long a template takes to upload on the stand (the component refreshes its progress every 500 ms). */
export const TEMPLATE_UPLOAD_MS = 1200;
const PROCESS_MS = 80;

let templates = 0;

export class CreateTemplate {
  readonly id: number;
  readonly files: UploadFile[] = [];
  processing = 0;
  progress = 0;
  uploading = false;
  private done = false;
  private readonly uploadListeners = new Set<() => void>();

  constructor() {
    templates += 1;
    this.id = templates;
  }

  isUploaded(): boolean {
    return this.done;
  }

  onUpload(listener: () => void): () => void {
    this.uploadListeners.add(listener);
    return () => this.uploadListeners.delete(listener);
  }

  /** Starts the upload (`uploadAccountMediaTemplates`): done after TEMPLATE_UPLOAD_MS. */
  upload(): void {
    if (this.uploading || this.done) return;
    this.uploading = true;
    const started = performance.now();
    const tick = (): void => {
      this.progress = Math.min(100, Math.round(((performance.now() - started) / TEMPLATE_UPLOAD_MS) * 100));
      if (this.progress >= 100) {
        this.uploading = false;
        this.done = true;
        record('template-uploaded', { template: this.id, files: this.files.map((file) => file.name) });
        for (const listener of [...this.uploadListeners]) listener();
        return;
      }
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  }
}

/** `app-account-media-upload` in its composer mode: lists the files; «Upload» hands them to the composer. */
export class UploadModal {
  readonly host: HTMLElement;
  private readonly s: Scope = scope();
  private readonly list: HTMLElement;
  private readonly processingLine: HTMLElement;
  private readonly uploadButton: HTMLElement;
  private readonly error: HTMLElement;
  private readonly template = new CreateTemplate();
  private ref: ModalRef | null = null;

  constructor(
    private readonly modals: ModalService,
    private readonly onTemplate: (template: CreateTemplate) => void,
    private readonly onClose: () => void,
  ) {
    const s = this.s;
    this.host = host(s, 'app-account-media-upload');
    const close = el(s, 'i', { class: 'fa-fw fa fa-xmark pointer blue-1-hover-only hover-effect' });
    close.addEventListener('click', handler(() => this.close()));
    this.list = el(s, 'div', { class: 'media-wrapper', attrs: { xddragsortablecontainer: '' } });
    this.processingLine = el(s, 'div', { class: 'proccessing-templates bold' }, ['Processing media…']);
    this.error = el(s, 'div', { class: 'red-1 margin-right-4 margin-bottom-2' });
    this.uploadButton = el(s, 'div', { class: 'btn solid-blue large' }, [el(s, 'xd-localization-string', {}, ['Upload'])]);
    this.uploadButton.addEventListener('click', handler(() => this.uploadClick()));
    this.host.append(
      el(s, 'div', { class: 'modal' }, [
        el(s, 'div', { class: 'modal-header' }, [el(s, 'div', { class: 'title' }, [el(s, 'xd-localization-string', {}, ['Upload Media'])]), el(s, 'div', { class: 'actions' }, [close])]),
        el(s, 'div', { class: 'modal-content' }, [el(s, 'div', { class: 'media-wrapper-container' }, [this.list])]),
        el(s, 'div', { class: 'modal-footer flex-col' }, [el(s, 'div', { class: 'flex-row' }, [el(s, 'div', { class: 'flex-1' }), this.uploadButton])]),
      ]),
    );
    this.refresh();
  }

  show(): void {
    this.ref = this.modals.open(this.host, () => this.close());
  }

  /** `processFiles`: each file becomes an entry of the modal after a short processing (audio skips the image work). */
  processFiles(files: readonly File[]): void {
    for (const file of files) {
      const entry = { name: file.name, type: file.type, size: file.size };
      this.template.processing += 1;
      setTimeout(
        () => {
          this.template.processing -= 1;
          this.template.files.push(entry);
          this.refresh();
        },
        file.type.startsWith('audio/') ? 0 : PROCESS_MS,
      );
    }
    record('upload-modal-files', { files: files.map((file) => ({ name: file.name, type: file.type })) });
    this.refresh();
  }

  /** «Upload» (main:42635-42646): only a person's click hands the template over. */
  private uploadClick(): void {
    if (this.template.processing > 0) return;
    if (this.template.files.length === 0) {
      setText(this.error, 'no content selected');
      if (this.error.parentNode === null) this.uploadButton.before(this.error);
      return;
    }
    record('upload-click', { files: this.template.files.map((file) => file.name) });
    this.onTemplate(this.template);
    this.close();
  }

  close(): void {
    if (this.ref === null) return;
    const ref = this.ref;
    this.ref = null;
    ref.close();
    this.onClose();
  }

  private refresh(): void {
    const s = this.s;
    const names = this.template.files.map((file) => file.name);
    if (this.list.childElementCount !== names.length) {
      this.list.replaceChildren(...this.template.files.map((file) => el(s, 'div', { class: 'media-container-wrapper' }, [el(s, 'div', { class: 'media-container' }, [`${file.name} (${file.type || 'unknown'})`])])));
    }
    const processing = this.template.processing > 0;
    if (processing && this.processingLine.parentNode === null) this.list.before(this.processingLine);
    if (!processing) this.processingLine.remove();
    setClass(this.uploadButton, 'disabled', processing || names.length === 0);
  }
}
