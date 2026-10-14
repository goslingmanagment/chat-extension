// How FBuddy puts its UI on the page (S5 §2.5, §6.2 E; WXT shadow-root UI,
// `content-scripts/main.js:50230-50344`): each widget is a custom element
// `fb-<feature>-ui` with an OPEN shadow root, `:host{all:initial}` and its big
// shared sheet; registry attributes `data-fbuddy-managed-*` go on the host AND
// on the Fansly node it belongs to; hosts carry `dark`/`bright`. The `<body>`
// layer is one more host, first child of `<body>`: a container at z 1 000 000
// with the toast stack bottom-right at z 999 999 999 (Alt+T focuses it).
// FBuddy builds these from its isolated world; here the page world does —
// their effect on the DOM is the same (S5 §6 «Principle»).

import { HOST_RESET, widgetSheetText } from './styles';
import { digest, freshId } from './util';

export const MANAGED = {
  ownerId: 'data-fbuddy-managed-owner-id',
  ownerRef: 'data-fbuddy-managed-owner-ref',
  feature: 'data-fbuddy-managed-feature',
  key: 'data-fbuddy-managed-key',
} as const;

export const BODY_LAYER_TAG = 'fb-body-shadow-root-ui';
export const BODY_LAYER_Z = 1_000_000;
export const TOAST_Z = 999_999_999;
const TOAST_MS = 4000;
const SHEET_CACHE = 16;

export interface HostSpec {
  /** `fb-<name>-ui`. */
  readonly tag: string;
  readonly feature: string;
  readonly key: string;
  /** The Fansly node it belongs to. */
  readonly owner: Element;
  /** Inline style of the host (the composer widgets are inline-flex). */
  readonly style?: string;
  /** Fills the shadow root. */
  readonly content?: (root: ShadowRoot) => void;
}

type View = Window & typeof globalThis;

export class NeighborUi {
  mounts = 0;
  readonly toastTexts: string[] = [];
  private readonly sheets = new Map<string, CSSStyleSheet>();
  private reset: CSSStyleSheet | null = null;
  private layer: { readonly host: HTMLElement; readonly stack: HTMLElement } | null = null;

  constructor(private readonly win: View) {}

  private get doc(): Document {
    return this.win.document;
  }

  theme(): 'dark' | 'bright' {
    return this.doc.documentElement.classList.contains('dark-theme') ? 'dark' : 'bright';
  }

  /** The shared sheet, as FBuddy gets it on every mount: the whole text read and keyed, then the cache. */
  private sheet(): CSSStyleSheet | null {
    if (typeof this.win.CSSStyleSheet !== 'function') return null;
    const text = widgetSheetText();
    const key = digest(text);
    let sheet = this.sheets.get(key);
    if (sheet === undefined) {
      sheet = new this.win.CSSStyleSheet();
      sheet.replaceSync(text);
      if (this.sheets.size >= SHEET_CACHE) this.sheets.delete(this.sheets.keys().next().value as string);
      this.sheets.set(key, sheet);
    }
    return sheet;
  }

  private dress(root: ShadowRoot): void {
    const sheet = this.sheet();
    if (sheet !== null && 'adoptedStyleSheets' in root) {
      if (this.reset === null) {
        this.reset = new this.win.CSSStyleSheet();
        this.reset.replaceSync(HOST_RESET);
      }
      root.adoptedStyleSheets = [this.reset, sheet];
      return;
    }
    const style = this.doc.createElement('style');
    style.textContent = `${HOST_RESET}\n${widgetSheetText()}`;
    root.append(style);
  }

  /** A new host for `spec` (not inserted: the feature decides where). */
  host(spec: HostSpec): HTMLElement {
    const registry = this.win.customElements;
    if (registry.get(spec.tag) === undefined) registry.define(spec.tag, class extends this.win.HTMLElement {});
    const element = this.doc.createElement(spec.tag);
    if (spec.style !== undefined) element.setAttribute('style', spec.style);
    element.classList.add(this.theme());
    const root = element.attachShadow({ mode: 'open' });
    this.dress(root);
    spec.content?.(root);
    const ownerId = spec.owner.getAttribute(MANAGED.ownerId) ?? freshId('fb-owner');
    const marks: ReadonlyArray<readonly [string, string]> = [
      [MANAGED.ownerId, ownerId],
      [MANAGED.ownerRef, spec.owner.localName],
      [MANAGED.feature, spec.feature],
      [MANAGED.key, spec.key],
    ];
    for (const [name, value] of marks) {
      element.setAttribute(name, value);
      if (spec.owner.getAttribute(name) !== value) spec.owner.setAttribute(name, value);
    }
    this.mounts += 1;
    return element;
  }

  /** Every `fb-*-ui` host in the document. */
  hosts(): Element[] {
    return [...this.doc.querySelectorAll('*')].filter((element) => /^fb-[a-z-]+-ui$/.test(element.localName));
  }

  /** Re-dresses every host after a theme change (FBuddy rescans `querySelectorAll("*")`, S5 §2.5). */
  retheme(): void {
    const theme = this.theme();
    for (const host of this.hosts()) {
      host.classList.toggle('dark', theme === 'dark');
      host.classList.toggle('bright', theme === 'bright');
    }
  }

  /** `fb-body-shadow-root-ui`, prepended to `<body>` (again if something took it away). */
  bodyLayer(): HTMLElement | null {
    const body = this.doc.body;
    if (body === null) return null;
    if (this.layer?.host.isConnected === true) return this.layer.host;
    const host = this.host({
      tag: BODY_LAYER_TAG,
      feature: 'body-shadow-root',
      key: 'body',
      owner: body,
      content: (root) => {
        const container = this.doc.createElement('div');
        container.className = 'fb-body-layer';
        container.setAttribute('style', `position:relative;isolation:isolate;z-index:${BODY_LAYER_Z}`);
        const stack = this.doc.createElement('section');
        stack.className = 'fb-toasts';
        stack.tabIndex = -1;
        stack.setAttribute('aria-label', 'Notifications alt+T');
        stack.setAttribute('style', `position:fixed;right:16px;bottom:16px;z-index:${TOAST_Z};display:flex;flex-direction:column;gap:8px;width:356px`);
        container.append(stack);
        root.append(container);
      },
    });
    body.prepend(host);
    const stack = host.shadowRoot?.querySelector<HTMLElement>('section.fb-toasts');
    if (stack !== null && stack !== undefined) this.layer = { host, stack };
    return host;
  }

  /** A toast at the bottom right (svelte-sonner's place), gone after a few seconds. */
  toast(text: string): void {
    this.toastTexts.push(text);
    this.bodyLayer();
    const stack = this.layer?.stack;
    if (stack === undefined) return;
    const item = this.doc.createElement('div');
    item.className = 'fb-toast';
    item.setAttribute('role', 'status');
    item.setAttribute('style', 'padding:12px 16px;border-radius:8px;background:#222;color:#fff;font:13px sans-serif');
    item.textContent = text;
    stack.append(item);
    this.win.setTimeout(() => item.remove(), TOAST_MS);
  }

  focusToasts(): void {
    this.layer?.stack.focus();
  }
}
