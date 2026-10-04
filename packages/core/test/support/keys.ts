// Test doubles for the early dispatcher: a `window` that runs its capture
// listeners in registration order and honours stopImmediatePropagation, key
// events with the flags a DOM event has, a focus probe the test sets, and a
// minimal AppClient over a map of views. Only @cg/contracts and core.

import { selectorKey, type ActionReceipt, type AppClient, type UiAction, type ViewOf, type ViewSelector } from '@cg/contracts';
import { type EventSourceLike, type HotkeySink, type KeyEventLike, type KeyOwnership } from '@cg/core/application/hotkeys';
import { type DispatcherCommandId, type FocusKind, type KeyCommand, type KeyRefusal } from '@cg/core/domain/hotkeys';

export class FakeKey implements KeyEventLike {
  defaultPrevented = false;
  stopped = false;
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly isTrusted: boolean;
  readonly keyCode?: number;

  constructor(
    readonly code: string,
    mods: Partial<Pick<KeyEventLike, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing' | 'isTrusted' | 'key' | 'keyCode'>> = {},
  ) {
    this.key = mods.key ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code);
    this.metaKey = mods.metaKey ?? false;
    this.ctrlKey = mods.ctrlKey ?? false;
    this.altKey = mods.altKey ?? false;
    this.shiftKey = mods.shiftKey ?? false;
    this.repeat = mods.repeat ?? false;
    this.isComposing = mods.isComposing ?? false;
    this.isTrusted = mods.isTrusted ?? true;
    if (mods.keyCode !== undefined) this.keyCode = mods.keyCode;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopImmediatePropagation(): void {
    this.stopped = true;
  }
}

type Listener = (event: unknown) => void;

export class FakeWindow implements EventSourceLike {
  private readonly listeners: { type: string; listener: Listener; capture: boolean }[] = [];

  addEventListener(type: string, listener: Listener, options?: boolean | { readonly capture?: boolean }): void {
    this.listeners.push({ type, listener, capture: typeof options === 'boolean' ? options : options?.capture === true });
  }

  removeEventListener(type: string, listener: Listener, options?: boolean | { readonly capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : options?.capture === true;
    const at = this.listeners.findIndex((item) => item.type === type && item.listener === listener && item.capture === capture);
    if (at !== -1) this.listeners.splice(at, 1);
  }

  /** Runs the listeners of `type` in registration order, the way one target does; a stopped event reaches no later one. */
  fire(type: string, event: unknown = {}): void {
    for (const item of [...this.listeners]) {
      if (item.type !== type) continue;
      if (event instanceof FakeKey && event.stopped) return;
      item.listener(event);
    }
  }

  count(type: string): number {
    return this.listeners.filter((item) => item.type === type).length;
  }
}

/** The page as the test arranges it. */
export class FakeOwnership implements KeyOwnership {
  kind: FocusKind = 'page';
  modal = false;
  /** What our UI answers to a delivered key: true — it took it. */
  takes = false;
  readonly delivered: FakeKey[] = [];
  focusReads = 0;
  modalReads = 0;

  focus(): FocusKind {
    this.focusReads += 1;
    return this.kind;
  }

  nativeModalOpen(): boolean {
    this.modalReads += 1;
    return this.modal;
  }

  deliver(event: unknown): boolean {
    this.delivered.push(event as FakeKey);
    return this.takes;
  }
}

export class RecordingSink implements HotkeySink {
  readonly ran: KeyCommand[] = [];
  readonly refused: { command: DispatcherCommandId; refusal: KeyRefusal }[] = [];
  readonly quick: boolean[] = [];
  /** Runs and popup changes in the order they came. */
  readonly order: string[] = [];
  /** HK-025: the dock's first state is there; the test turns it off and calls `settle()` when it arrives. */
  dockReady = true;
  private readonly readyListeners = new Set<() => void>();

  run(command: KeyCommand): void {
    this.ran.push(command);
    this.order.push(`run:${command.id}`);
  }

  ready(command: KeyCommand): boolean {
    return this.dockReady || command.target !== 'dock';
  }

  onReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  /** The first state arrived. */
  settle(): void {
    this.dockReady = true;
    for (const listener of [...this.readyListeners]) listener();
  }

  get readySubscribers(): number {
    return this.readyListeners.size;
  }

  refuse(command: DispatcherCommandId, refusal: KeyRefusal): void {
    this.refused.push({ command, refusal });
  }

  quickJump(open: boolean): void {
    this.quick.push(open);
    this.order.push(open ? 'popup:open' : 'popup:close');
  }

  get ids(): string[] {
    return this.ran.map((command) => (command.slot === null ? `${command.id}@${command.target}` : `${command.id}:${command.slot}@${command.target}`));
  }
}

/** An AppClient over a map of views: what the hotkey runner reads and dispatches into. */
export class StubClient implements AppClient {
  private readonly views = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<(view: unknown) => void>>();
  readonly dispatched: UiAction[] = [];
  /** The receipt of the next dispatches; default — done. */
  answer: (action: UiAction) => ActionReceipt = (action) => ({ ok: true, type: action.type, outcome: 'done' });

  set<S extends ViewSelector>(selector: S, view: ViewOf<S>): void {
    const key = selectorKey(selector);
    this.views.set(key, view);
    for (const listener of this.listeners.get(key) ?? []) listener(view);
  }

  getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>> {
    const view = this.views.get(selectorKey(selector));
    if (view === undefined) throw new Error(`no view for ${selectorKey(selector)}`);
    return view as ViewOf<S>;
  }

  subscribe<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void {
    const key = selectorKey(selector);
    const set = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, set);
    const wrapped = listener as (view: unknown) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  dispatch(action: UiAction): Promise<ActionReceipt> {
    this.dispatched.push(action);
    return Promise.resolve(this.answer(action));
  }
}
