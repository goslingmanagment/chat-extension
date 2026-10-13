// The few Angular mechanics the stand imitates, by hand (no Angular code, no
// Fansly code): elements with emulated-encapsulation attributes, `*ngIf`
// views inserted before their anchor comment (Ivy's order: the live DOM has
// the comments after the views), detached change detectors that touch the DOM
// only where a value changed, and NgModel's model → view write in a microtask.

/**
 * Emulated encapsulation (407 of Fansly's 434 components, fansly-web.md §6): every element of a component's template
 * carries `_ngcontent-ng-c<n>`, its host `_nghost-ng-c<n>`. The number is the build's; here it is new on every load,
 * so nothing that reads the stand can lean on it (fansly.md §4 «Не полагаться на сгенерированные Angular-классы»).
 */
export interface Scope {
  readonly content: string;
  readonly host: string;
}

let scopes = 0;

export function scope(): Scope {
  scopes += 1;
  const id = `ng-c${String(Math.floor(Math.random() * 9e8) + 1e8)}${scopes}`;
  return { content: `_ngcontent-${id}`, host: `_nghost-${id}` };
}

export type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  readonly class?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly style?: string;
}

/** An element of a component's template: its classes, attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(s: Scope, tag: K, options?: ElementOptions, children?: readonly Child[]): HTMLElementTagNameMap[K];
export function el(s: Scope, tag: string, options?: ElementOptions, children?: readonly Child[]): HTMLElement;
export function el(s: Scope, tag: string, options: ElementOptions = {}, children: readonly Child[] = []): HTMLElement {
  const node = document.createElement(tag);
  node.setAttribute(s.content, '');
  if (options.class !== undefined && options.class !== '') node.className = options.class;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  if (options.style !== undefined) node.setAttribute('style', options.style);
  append(node, children);
  return node;
}

/** A component's host element (`app-*`), with its own host attribute. */
export function host(s: Scope, tag: string, options: ElementOptions = {}): HTMLElement {
  const node = el(s, tag, options);
  node.removeAttribute(s.content);
  node.setAttribute(s.host, '');
  return node;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** An `*ngIf` anchor: Angular leaves an empty comment where the template had the directive. */
export const anchor = (): Comment => document.createComment('');

export interface View {
  readonly nodes: readonly Node[];
  destroy?(): void;
}

/**
 * `*ngIf`: the view is created when the condition turns true — new elements every time — and inserted before the
 * anchor; destroyed (its hooks first) when it turns false. Nothing happens while the condition stays the same.
 */
export class NgIf<V extends View> {
  readonly anchor = anchor();
  private current: V | null = null;

  constructor(private readonly create: () => V) {}

  get view(): V | null {
    return this.current;
  }

  update(condition: boolean): V | null {
    if (condition && this.current === null) {
      const view = this.create();
      this.current = view;
      const parent = this.anchor.parentNode;
      if (parent !== null) for (const node of view.nodes) parent.insertBefore(node, this.anchor);
    } else if (!condition && this.current !== null) {
      const view = this.current;
      this.current = null;
      view.destroy?.();
      for (const node of view.nodes) node.parentNode?.removeChild(node);
    }
    return this.current;
  }

  destroy(): void {
    this.update(false);
  }
}

/** `*ngFor` over keyed items: a view per item, kept while its key stays, inserted before the anchor in order. */
export class NgFor<T, V extends View> {
  readonly anchor = anchor();
  private views = new Map<string, V>();

  constructor(
    private readonly key: (item: T) => string,
    private readonly create: (item: T) => V,
  ) {}

  update(items: readonly T[]): void {
    const parent = this.anchor.parentNode;
    const next = new Map<string, V>();
    for (const item of items) {
      const id = this.key(item);
      next.set(id, this.views.get(id) ?? this.create(item));
    }
    for (const [id, view] of this.views) {
      if (next.has(id)) continue;
      view.destroy?.();
      for (const node of view.nodes) node.parentNode?.removeChild(node);
    }
    this.views = next;
    if (parent === null) return;
    // Walk back from the anchor: a node already in place is not moved (no mutation for a view that stayed).
    let before: Node = this.anchor;
    for (const view of [...next.values()].reverse()) {
      for (const node of [...view.nodes].reverse()) {
        if (node.nextSibling !== before || node.parentNode !== parent) parent.insertBefore(node, before);
        before = node;
      }
    }
  }

  get size(): number {
    return this.views.size;
  }

  get(key: string): V | undefined {
    return this.views.get(key);
  }

  destroy(): void {
    this.update([]);
  }
}

// A detached change detector writes only what changed: these keep idle refreshes free of DOM mutations.

export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function setStyle(node: HTMLElement, property: string, value: string): void {
  if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
}

/**
 * NgModel on a field (`[(ngModel)]`), with the DefaultValueAccessor in composition mode (desktop):
 * - view → model: an `input` event outside an IME composition, and `compositionend`, hand the value over;
 * - model → view: a model that differs from what the view last gave is written to the field in a MICROTASK
 *   (`resolvedPromise.then(() => control.setValue(…))`, main:114424-114429) — no event of any kind;
 * - the field's status classes (`ng-pristine`/`ng-dirty`, `ng-untouched`/`ng-touched`, `ng-valid`/`ng-invalid` with
 *   `required`), as NgControlStatus keeps them.
 */
export class NgModelBinding {
  private viewModel: string | undefined = undefined;
  private bound: string | undefined = undefined;
  private composing = false;
  private dirty = false;
  private touched = false;

  constructor(
    readonly field: HTMLTextAreaElement,
    private readonly onViewChange: (value: string) => void,
    wrap: <E extends Event>(handler: (event: E) => void) => (event: E) => void,
  ) {
    field.addEventListener(
      'input',
      wrap(() => {
        if (!this.composing) this.fromView(field.value);
      }),
    );
    field.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    field.addEventListener(
      'compositionend',
      wrap(() => {
        this.composing = false;
        this.fromView(field.value);
      }),
    );
    field.addEventListener('blur', () => {
      this.touched = true;
      this.status();
    });
    this.status();
  }

  /** The component's refresh hands its model to the binding (`[ngModel]="contentInputModel"`). */
  bind(model: string): void {
    if (Object.is(model, this.bound)) return;
    this.bound = model;
    if (Object.is(model, this.viewModel)) return;
    this.viewModel = model;
    void Promise.resolve().then(() => {
      if (this.field.value !== model) this.field.value = model;
      this.status();
    });
  }

  private fromView(value: string): void {
    this.viewModel = value;
    this.dirty = true;
    this.status();
    this.onViewChange(value);
  }

  private status(): void {
    const valid = this.field.value.length > 0;
    setClass(this.field, 'ng-pristine', !this.dirty);
    setClass(this.field, 'ng-dirty', this.dirty);
    setClass(this.field, 'ng-untouched', !this.touched);
    setClass(this.field, 'ng-touched', this.touched);
    setClass(this.field, 'ng-valid', valid);
    setClass(this.field, 'ng-invalid', !valid);
  }
}
