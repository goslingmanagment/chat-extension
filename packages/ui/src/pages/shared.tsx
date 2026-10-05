// What every extension page shares (architecture.md §9.5, §10.2; ui-design
// §4.22, §6.3): the page's own toasts and confirmation dialog — an extension
// page has no overlay host, so its ToastPort and DialogPort render into the
// page itself — the hook that dispatches an action and says what came of it,
// and a few atoms of the settings shell.

import { signal, type Signal } from '@preact/signals';
import { createContext, type ComponentChildren, type JSX } from 'preact';
import { useCallback, useContext } from 'preact/hooks';

import { type CgErrorView } from '@cg/contracts/errors';
import { type ActionReceipt, type ConfirmDialogRequest, type DialogPort, type I18n, type Msg, type PageTagVM, type ToastPort, type ToastRequest, type ToastVM, type UiAction } from '@cg/contracts/vm';

import { ConfirmDialog, Dot, ToastItem, TOAST_MAX, useAnnounce, useDispatch, useI18n } from '../kit';

/** Toasts live 4.5 s, errors 6.5 s (§9.5); a hovered or focused one waits. */
const TOAST_MS = 4500;
const TOAST_ERROR_MS = 6500;

interface PendingConfirm {
  readonly request: ConfirmDialogRequest;
  readonly resolve: (answer: 'confirm' | 'cancel') => void;
}

/** The page's own ToastPort and DialogPort. One per mounted page. */
export class PageServices implements ToastPort, DialogPort {
  readonly toasts: Signal<readonly ToastVM[]> = signal([]);
  readonly pending: Signal<PendingConfirm | null> = signal(null);
  private seq = 0;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** «code | scope» of each toast on screen: the same pair replaces the earlier one. */
  private readonly keys = new Map<string, string>();

  constructor(
    private readonly i18n: I18n,
    private readonly now: () => number,
  ) {}

  /** ToastPort: a toast a surface raises itself (the error boundary's CG-UI-FAILED). */
  show(toast: ToastRequest): string {
    return this.push({
      kind: toast.kind,
      code: toast.code,
      title: this.i18n.text(toast.title),
      body: toast.body === null ? null : this.i18n.text(toast.body),
      scope: toast.scope,
    });
  }

  /** An error as the controller rendered it: code, title, explanation and the technical line. */
  error(error: CgErrorView, scope = 'page'): string {
    return this.push({ kind: 'error', code: error.code, title: error.title, body: error.body, scope, ...(error.detail === undefined ? {} : { detail: error.detail }), ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }) });
  }

  /** «Скопировано», «Файлы сохранены»: a quiet confirmation. */
  success(text: string, scope = 'page'): string {
    return this.push({ kind: 'success', code: null, title: text, body: null, scope });
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    this.toasts.value = this.toasts.value.filter((toast) => toast.id !== id);
  }

  hold(id: string, held: boolean): void {
    const toast = this.toasts.value.find((entry) => entry.id === id);
    if (toast === undefined) return;
    this.clearTimer(id);
    if (!held) this.arm(id, toast.kind);
    this.toasts.value = this.toasts.value.map((entry) => (entry.id === id ? { ...entry, expiresAt: held ? null : this.now() + this.lifetime(entry.kind) } : entry));
  }

  /** DialogPort: one confirmation at a time; a second one cancels the first. */
  confirm(request: ConfirmDialogRequest): Promise<'confirm' | 'cancel'> {
    this.pending.value?.resolve('cancel');
    return new Promise((resolve) => {
      this.pending.value = { request, resolve };
    });
  }

  answer(answer: 'confirm' | 'cancel'): void {
    const pending = this.pending.value;
    this.pending.value = null;
    pending?.resolve(answer);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.answer('cancel');
  }

  private lifetime(kind: ToastVM['kind']): number {
    return kind === 'error' ? TOAST_ERROR_MS : TOAST_MS;
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }

  private arm(id: string, kind: ToastVM['kind']): void {
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), this.lifetime(kind)),
    );
  }

  private push(toast: Pick<ToastVM, 'kind' | 'code' | 'title' | 'body'> & { readonly scope: string; readonly detail?: string; readonly retryAt?: number }): string {
    this.seq += 1;
    const id = `page-toast-${String(this.seq)}`;
    const { scope, ...rest } = toast;
    // The same code and scope replace each other; newest first, never more than three (§9.5).
    const key = `${toast.code ?? toast.title}|${scope}`;
    const kept = this.toasts.value.filter((entry) => this.keys.get(entry.id) !== key);
    for (const entry of this.toasts.value) if (!kept.includes(entry)) this.clearTimer(entry.id);
    this.keys.set(id, key);
    const next: ToastVM = { id, ...rest, actions: [], copyCode: toast.code !== null, expiresAt: this.now() + this.lifetime(toast.kind) };
    const all = [next, ...kept];
    for (const dropped of all.slice(TOAST_MAX)) this.clearTimer(dropped.id);
    this.toasts.value = all.slice(0, TOAST_MAX);
    this.arm(id, toast.kind);
    return id;
  }

}

const ServicesContext = createContext<PageServices | null>(null);

export function PageServicesProvider({ services, children }: { readonly services: PageServices; readonly children?: ComponentChildren }): JSX.Element {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function usePageServices(): PageServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error('ui/pages: a page component rendered outside its page mount');
  return services;
}

/** The page's toast stack and its confirmation dialog; rendered once per page. */
export function PageLayers(): JSX.Element {
  const services = usePageServices();
  const toasts = services.toasts.value;
  const pending = services.pending.value;
  return (
    <>
      <div class="cg-toasts pg-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => services.dismiss(toast.id)} onHold={(held) => services.hold(toast.id, held)} />
        ))}
      </div>
      <ConfirmDialog request={pending?.request ?? null} onAnswer={(answer) => services.answer(answer)} />
    </>
  );
}

export interface ActOptions {
  /** Said and shown when the action went through. */
  readonly success?: string;
  /** A refusal is shown elsewhere (the save state, an inline card): no toast. */
  readonly quiet?: boolean;
}

/**
 * Dispatches an action and tells the person what came of it: a refusal as a
 * toast with its code (unless `quiet`), a success as the given words.
 */
export function useAct(): (action: UiAction, options?: ActOptions) => Promise<ActionReceipt | null> {
  const dispatch = useDispatch();
  const services = usePageServices();
  const announce = useAnnounce();
  return useCallback(
    async (action: UiAction, options: ActOptions = {}) => {
      const receipt = await dispatch(action);
      if (receipt === null) return null;
      if (!receipt.ok) {
        if (options.quiet !== true) services.error(receipt.error, action.type);
        return receipt;
      }
      if (options.success !== undefined && receipt.outcome !== 'noop') {
        services.success(options.success, action.type);
        announce(options.success);
      }
      return receipt;
    },
    [dispatch, services, announce],
  );
}

/** A string, or our own words with their parameters. */
export function useText(): (value: string | Msg) => string {
  const i18n = useI18n();
  return (value) => (typeof value === 'string' ? value : i18n.text(value));
}

/** ok — an ink dot, a warning — a ring, a failure — the red dot, unknown — a ring (ui-design §4.24). */
export function LevelDot({ level }: { readonly level: 'ok' | 'warn' | 'error' | 'unknown' }): JSX.Element {
  return <Dot kind={level === 'ok' ? 'ink' : level === 'error' ? 'danger' : 'ring'} />;
}

/** One settings row: the name and its hint on the left, the control on the right (§4.24). */
export function Opt({
  label,
  hint,
  anchor,
  center,
  children,
}: {
  readonly label: string;
  readonly hint?: string | null;
  /** The name a deep link's code points at (ST-010): the options shell highlights it. */
  readonly anchor?: string;
  /** A one-line control stands in the middle of its row (the sound rows of final-21b). */
  readonly center?: boolean;
  readonly children?: ComponentChildren;
}): JSX.Element {
  return (
    <div class="pg-opt" {...(anchor === undefined ? {} : { 'data-pg-anchor': anchor })}>
      <div class="pg-opt__k">
        <b>{label}</b>
        {hint === undefined || hint === null ? null : <span>{hint}</span>}
      </div>
      <div class={center === true ? 'pg-opt__v pg-opt__v--center' : 'pg-opt__v'}>{children}</div>
    </div>
  );
}

/** The platforms this build has a word for; a token it does not know is printed as it is (an open token of the hub). */
const PLATFORM_WORDS: Readonly<Record<string, string>> = { onlyfans: 'OnlyFans', fansly: 'Fansly' };

/** «OnlyFans · lora-vip»: what tells a hub page from another of the same title (1.3.0, `PageTagVM`). */
export function pageTagText(tag: PageTagVM): string {
  const platform = Object.prototype.hasOwnProperty.call(PLATFORM_WORDS, tag.platform) ? PLATFORM_WORDS[tag.platform] : tag.platform;
  return `${platform ?? tag.platform} · ${tag.pageLabel}`;
}

/** A page's title with its tag in one string, for a label or a sentence: «Lora Vie (OnlyFans · lora-vip)». */
export function pageNameWithTag(pageName: string, tag: PageTagVM | null | undefined): string {
  return tag === null || tag === undefined ? pageName : `${pageName} (${pageTagText(tag)})`;
}

/** The tag next to a page's title, quiet: the title stays the thing one reads first. Nothing without a tag. */
export function PageTag({ tag }: { readonly tag: PageTagVM | null | undefined }): JSX.Element | null {
  if (tag === null || tag === undefined) return null;
  return (
    <span class="pg-pagetag" data-pg-page-label={tag.pageLabel} data-pg-platform={tag.platform}>
      {pageTagText(tag)}
    </span>
  );
}

/** `{link}` inside a sentence becomes a real link: the text around it stays one translatable string. */
export function withLink(text: string, link: JSX.Element): JSX.Element {
  const [before, after] = text.split('{link}');
  return (
    <>
      {before}
      {after === undefined ? null : link}
      {after}
    </>
  );
}
