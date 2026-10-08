// A minimal ChatSpace-shaped page for the package's happy-dom tests: the
// contracts the adapter reads (architecture.md §6.1, §6.3) and nothing else —
// `#app.__vue_app__` with a router and Pinia, a Colada-like `_pc_query`
// store with $onAction, `chatTabEntries` (one tab per composer; the active
// tab is the one shown), v-show composers with `__omComposerBridge` and a
// Tiptap-like editor on `.ProseMirror` (`view.dom.editor`). Test-only: no
// bundle imports this file. The real-browser contract is proven on the R02
// stand (packages/testing/fixture-chatspace) by the e2e.
//
// happy-dom has no layout: visibility and boxes are stubbed per element.

type Listener = (payload: { transaction?: { docChanged?: boolean } }) => void;
type ActionContext = { name: string; args: unknown[]; after: (cb: (result: unknown) => void) => void; onError: (cb: () => void) => void };

/** A Tiptap-like editor: one paragraph per line break run, transactions on every change. */
export class FakeEditor {
  private readonly listeners = new Map<string, Set<Listener>>();
  text = '';
  marks = 0;
  destroyed = false;

  on(event: string, listener: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, docChanged = true): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener({ transaction: { docChanged } });
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  get isEmpty(): boolean {
    return this.text.trim() === '';
  }

  getText(): string {
    return this.text;
  }

  getJSON(): unknown {
    return { type: 'doc', content: [{ type: 'paragraph', content: this.text === '' ? [] : [{ type: 'text', text: this.text, marks: this.marks }] }] };
  }

  readonly commands = {
    focus: (_position?: unknown): boolean => true,
  };

  /** A change of the person (typing): one transaction. */
  type(text: string): void {
    this.text = text;
    this.emit('transaction');
  }

  /** A formatting change: same text, another document. */
  format(): void {
    this.marks += 1;
    this.emit('transaction');
  }

  /** A selection change: a transaction without a document change. */
  select(): void {
    this.emit('transaction', false);
  }
}

export interface FakeComposer {
  readonly key: string;
  readonly acc: string;
  readonly fan: string;
  /** The per-tab wrapper (v-show). */
  readonly tab: HTMLElement;
  /** `div.relative` — the frame root. */
  readonly root: HTMLElement;
  readonly frame: HTMLElement;
  readonly slot: HTMLElement;
  readonly prose: HTMLElement;
  editor: FakeEditor | null;
  readonly calls: string[];
}

export interface FakeStore {
  readonly $id: string;
  $onAction(listener: (context: ActionContext) => void, detached?: boolean): () => void;
  /** State subscribers, called by `$changed()` (Pinia's `flush: 'sync'`: once per state change). */
  $subscribe(listener: () => void, options?: unknown): () => void;
  /** Test side: the store's state changed. */
  $changed(): void;
  [member: string]: unknown;
}

/**
 * A Pinia-like store: methods listed in `actions` notify $onAction
 * subscribers before they run, then `after` with the result (or `onError`
 * when the action throws); `$changed()` plays a state change for
 * `$subscribe` listeners.
 */
export function fakeStore(id: string, members: Record<string, unknown>, actions: readonly string[] = []): FakeStore {
  const listeners = new Set<(context: ActionContext) => void>();
  const subscribers = new Set<() => void>();
  const store: FakeStore = {
    $id: id,
    $onAction(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    $subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    $changed() {
      for (const subscriber of [...subscribers]) subscriber();
    },
    ...members,
  };
  for (const name of actions) {
    const original = members[name] as (...args: unknown[]) => unknown;
    store[name] = (...args: unknown[]) => {
      const afters: Array<(result: unknown) => void> = [];
      const errors: Array<() => void> = [];
      for (const listener of [...listeners]) listener({ name, args, after: (cb) => afters.push(cb), onError: (cb) => errors.push(cb) });
      let result: unknown;
      try {
        result = original(...args);
      } catch (error) {
        for (const onError of errors) onError();
        throw error;
      }
      for (const after of afters) after(result);
      return result;
    };
  }
  return store;
}

export interface FakePageOptions {
  readonly route?: { readonly name: string; readonly accountId?: string; readonly chatId?: string };
  readonly withRouterName?: boolean;
}

/** A Colada-like cache: data by key, entries with state, actions observed through $onAction. */
export function fakeCache() {
  const data = new Map<string, unknown>();
  const active = new Set<string>();
  const hash = (key: readonly unknown[]): string => JSON.stringify(key);
  const entryOf = (key: readonly unknown[]) =>
    data.has(hash(key)) ? { key, state: { value: { data: data.get(hash(key)), status: 'success' } }, asyncStatus: { value: 'idle' }, active: active.has(hash(key)), when: 1 } : undefined;
  const store = fakeStore(
    '_pc_query',
    {
      getQueryData: (key: readonly unknown[]) => data.get(hash(key)),
      get: (key: readonly unknown[]) => entryOf(key),
      getEntries: (filters: { key?: readonly unknown[] } = {}) =>
        [...data.keys()]
          .map((text) => JSON.parse(text) as unknown[])
          .filter((key) => (filters.key ?? []).every((part, index) => key[index] === part))
          .map((key) => entryOf(key)),
      setQueryData: (key: readonly unknown[], value: unknown) => {
        data.set(hash(key), value);
      },
    },
    ['setQueryData', 'getQueryData', 'getEntries'],
  );
  return {
    store,
    set: (key: readonly unknown[], value: unknown, observed = true) => {
      (store['setQueryData'] as (key: readonly unknown[], value: unknown) => void)(key, value);
      if (observed) active.add(hash(key));
    },
    /** Changes data without an action (what a test needs for a silent precondition). */
    silent: (key: readonly unknown[], value: unknown) => {
      data.set(hash(key), value);
      active.add(hash(key));
    },
    delete: (key: readonly unknown[]) => data.delete(hash(key)),
  };
}

export type FakeCache = ReturnType<typeof fakeCache>;

/** Stubs layout: visible while every ancestor is displayed and the element is connected. */
function stubLayout(element: HTMLElement, width = 720, height = 120): void {
  const shown = (): boolean => {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) if (node.style.display === 'none') return false;
    return element.isConnected;
  };
  Object.defineProperty(element, 'checkVisibility', { configurable: true, value: shown });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => (shown() ? { left: 10, top: 500, right: 10 + width, bottom: 500 + height, width, height, x: 10, y: 500 } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
  });
}

export function createFakePage(doc: Document, options: FakePageOptions = {}) {
  doc.body.replaceChildren();
  const app = doc.createElement('div');
  app.id = 'app';
  const composers = doc.createElement('div');
  composers.className = 'shrink-0 composers';
  app.append(composers);
  doc.body.append(app);

  let current = { name: options.route?.name ?? 'chat', params: { accountId: options.route?.accountId ?? '1001', chatId: options.route?.chatId ?? '2002' } as Record<string, string | undefined> };
  const guards = new Set<(to: unknown, from: unknown, failure?: unknown) => void>();
  const pushes: unknown[] = [];
  let pushImpl: ((to: { name: string; params: Record<string, string> }) => Promise<unknown>) | null = null;
  const router = {
    currentRoute: {
      get value() {
        return current;
      },
    },
    afterEach(guard: (to: unknown, from: unknown, failure?: unknown) => void) {
      guards.add(guard);
      return () => guards.delete(guard);
    },
    push(to: { name: string; params: Record<string, string> }) {
      pushes.push(to);
      if (pushImpl) return pushImpl(to);
      go(to.params['accountId'] ?? '', to.params['chatId']);
      return Promise.resolve(undefined);
    },
    hasRoute: (name: string) => (options.withRouterName ?? true) && name === 'chat',
  };
  /** The route moves (its afterEach guards run), then the tabs follow it, as ChatSpace's route watcher does. */
  const go = (accountId: string, chatId?: string, name = 'chat'): void => {
    const from = current;
    current = { name, params: { accountId, chatId } };
    for (const guard of [...guards]) guard(current, from, undefined);
    if (name === 'chat') followRoute(accountId, chatId ?? null);
  };

  const stores = new Map<string, FakeStore>();
  const plugins = new Set<(context: { store: FakeStore }) => void>();
  const pinia = {
    _s: stores,
    use(plugin: (context: { store: FakeStore }) => void) {
      plugins.add(plugin);
    },
  };
  const addStore = (store: FakeStore): void => {
    stores.set(store.$id, store);
    for (const plugin of plugins) plugin({ store });
  };
  const cache = fakeCache();
  addStore(cache.store);

  // `chatTabEntries`: per account `{entries: [{id, chatId}], activeEntryId}`; actions observed through $onAction.
  type TabState = { entries: Array<{ id: string; chatId: string | null }>; activeEntryId: string };
  const stateByAccountId: Record<string, TabState> = {};
  const tabsOf = (accountId: string): TabState => (stateByAccountId[accountId] ??= { entries: [], activeEntryId: '' });
  const tabs = fakeStore(
    'chatTabEntries',
    {
      stateByAccountId,
      setActiveEntry: (accountId: string, entryId: string) => {
        tabsOf(accountId).activeEntryId = entryId;
      },
    },
    ['setActiveEntry'],
  );
  addStore(tabs);
  /** Activates the tab with the chat, else puts the chat into the active tab. */
  function followRoute(accountId: string, chatId: string | null): void {
    const state = tabsOf(accountId);
    const active = state.entries.find((entry) => entry.id === state.activeEntryId);
    if (active?.chatId === chatId) return;
    const other = state.entries.find((entry) => entry.chatId === chatId);
    if (other) state.activeEntryId = other.id;
    else if (active) active.chatId = chatId;
  }

  Object.defineProperty(app, '__vue_app__', { configurable: true, value: { config: { globalProperties: { $router: router, $pinia: pinia } } } });

  const all: FakeComposer[] = [];
  type ComposerOptions = { shown?: boolean; frame?: boolean; bridge?: boolean; editor?: boolean };
  /** Adds a per-tab composer: tab > div.relative (root) > .composer-frame > strip > slot; .ProseMirror in the frame. */
  const addComposer = (acc: string, fan: string, opts: ComposerOptions = {}): FakeComposer => {
    const composer = build(acc, fan, opts);
    composers.append(composer.tab);
    const entry = { id: `tab-${all.length + 1}`, chatId: fan };
    tabsOf(acc).entries.push(entry);
    if (opts.shown ?? true) tabsOf(acc).activeEntryId = entry.id;
    show(composer, opts.shown ?? true);
    all.push(composer);
    return composer;
  };
  /**
   * ChatSpace renders a composer again (a re-mount): new nodes for the same chat tab, no store or cache action. Its
   * old nodes still in the page — swapped in one step; already taken down (a pause) — the new ones come at the end.
   */
  const renderAgain = (old: FakeComposer, opts: ComposerOptions = {}): FakeComposer => {
    const composer = build(old.acc, old.fan, opts);
    show(composer, old.tab.style.display !== 'none');
    if (old.tab.isConnected) old.tab.replaceWith(composer.tab);
    else composers.append(composer.tab);
    all.splice(all.indexOf(old), 1, composer);
    return composer;
  };
  function build(acc: string, fan: string, opts: ComposerOptions): FakeComposer {
    const tab = doc.createElement('div');
    tab.setAttribute('data-tab', `${acc}:${fan}`);
    const root = doc.createElement('div');
    root.className = 'relative';
    const frame = doc.createElement('div');
    frame.className = opts.frame === false ? 'composer-shell overflow-hidden' : 'composer-frame overflow-hidden';
    const strip = doc.createElement('div');
    strip.className = 'h-10';
    const slot = doc.createElement('div');
    slot.setAttribute('data-id', 'browser-composer-translator');
    const prose = doc.createElement('div');
    prose.className = 'ProseMirror';
    strip.append(slot);
    frame.append(strip, prose);
    root.append(frame);
    tab.append(root);
    for (const element of [tab, root, frame, strip, slot, prose]) stubLayout(element);
    const composer: FakeComposer = { key: `${acc}:${fan}`, acc, fan, tab, root, frame, slot, prose, editor: null, calls: [] };
    if (opts.editor !== false) attachEditor(composer);
    if (opts.bridge !== false) {
      Object.defineProperty(slot, '__omComposerBridge', {
        configurable: true,
        value: {
          setText: (text: string) => {
            composer.calls.push('setText');
            if (!composer.editor) return;
            composer.editor.text = '';
            composer.editor.emit('transaction');
            composer.editor.text = text;
            composer.editor.emit('transaction');
          },
          insertText: (text: string) => {
            composer.calls.push('insertText');
            if (!composer.editor) return;
            composer.editor.text += text;
            composer.editor.emit('transaction');
          },
          focus: () => {
            composer.calls.push('focus');
            prose.setAttribute('tabindex', '0');
            prose.focus();
          },
          insertMessage: () => composer.calls.push('insertMessage'),
        },
      });
    }
    return composer;
  }
  function attachEditor(composer: FakeComposer): FakeEditor {
    const editor = new FakeEditor();
    composer.editor = editor;
    Object.defineProperty(composer.prose, 'editor', { configurable: true, value: editor });
    Object.defineProperty(composer.prose, 'innerText', { configurable: true, get: () => editor.text });
    return editor;
  }
  function show(composer: FakeComposer, shown: boolean): void {
    composer.tab.style.display = shown ? '' : 'none';
  }
  /** A click on the chat tab of acc/fan: ChatSpace activates the tab (its composer shows at once); the route follows only with go(). */
  const showOnly = (acc: string, fan: string): void => {
    const entry = tabsOf(acc).entries.find((item) => item.chatId === fan);
    if (entry) (tabs['setActiveEntry'] as (accountId: string, entryId: string) => void)(acc, entry.id);
    for (const composer of all) show(composer, composer.acc === acc && composer.fan === fan);
  };

  return { app, composers, router, pinia, cache, stores, tabs: stateByAccountId, addStore, addComposer, renderAgain, attachEditor, show, showOnly, go, pushes, all, setPush: (impl: typeof pushImpl) => (pushImpl = impl) };
}

export type FakePage = ReturnType<typeof createFakePage>;

/** Accounts, fans and a history page for account 1001 / fans 2002, 2003 — synthetic ids only. */
export function seedCache(cache: FakeCache, acc = '1001'): void {
  cache.set(['accounts'], [{ id: Number(acc), platformAccountId: '3003', platform: 'onlyfans', username: 'model_one', name: 'Model One', customLabel: null }]);
  cache.set(['fansMap', acc], {
    '2002': { id: '2002', name: 'Fan Two', customName: null, username: 'fan_two', isBlocked: false, canReceiveMessages: true, isRestricted: false, lastSeen: '2026-10-03T09:59:00.000Z', about: 'bio' },
    '2003': { id: '2003', name: 'Fan Three', customName: 'Three', username: 'fan_three', isBlocked: false, canReceiveMessages: true, isRestricted: false, lastSeen: null },
  });
  cache.set(['chatMessages', acc, '2002'], {
    pages: [
      {
        items: [
          { id: '4005', text: '<p>newest from me</p>', createdAt: '2026-10-03T10:00:05.000Z', isOutgoing: true, platformMetadata: {} },
          { id: 'q-1', text: 'queued', createdAt: '2026-10-03T10:00:06.000Z', isOutgoing: true, platformMetadata: { isFromQueue: true } },
          { id: '4004', text: 'hey<br>there', createdAt: '2026-10-03T10:00:04.000Z', isOutgoing: false, platformMetadata: {} },
          { id: '4003', text: '', createdAt: '2026-10-03T10:00:03.000Z', isOutgoing: false, platformMetadata: { isFromQueue: true } },
        ],
        hasMore: true,
      },
    ],
    pageParams: [null],
  });
  cache.set(['chatList', acc, 'all'], { pages: [{ items: [{ id: '2002', unreadMessagesCount: 0 }, { id: '2003', unreadMessagesCount: 2 }] }] });
  cache.set(['userPermissions'], ['om_message_translator']);
  cache.set(['mimicSettings'], { isActive: false });
  cache.set(['mimicChats'], []);
}
