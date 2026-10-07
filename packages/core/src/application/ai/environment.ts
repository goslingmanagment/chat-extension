// What the tab knows about the background's state (architecture.md §5.4,
// §8.2, §8.3, §9.4): who is signed in, the bootstrap (pages, flags, limits,
// capabilities), the settings with their revision, the persona catalog, the
// page quota, and the binding of each host account to a hub page. Everything
// is read through the tab protocol and kept fresh by its events; nothing is
// guessed: an unread value is `undefined`/`loading`, a failed read keeps its
// CG error. A change of sign-in drops what belonged to the old one.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type Bootstrap, type BootstrapPage, type PersonaCatalog, type PersonaCatalogItem } from '@cg/contracts/hub';
import { type HostAccount, type HubBinding, type SessionIdentity } from '@cg/contracts/ids';
import { type SettingsPatch, type SettingsState } from '@cg/contracts/settings';
import { type AiQuotaSnapshot } from '@cg/contracts/tab-messages';

import { type RpcAnswer, type RpcConnection, type TabRpcPort } from './ports';

export type Loaded<T> =
  | { readonly s: 'idle' }
  | { readonly s: 'loading' }
  | { readonly s: 'ready'; readonly value: T }
  | { readonly s: 'error'; readonly error: CgErrorWire };

const IDLE = { s: 'idle' } as const;
const LOADING = { s: 'loading' } as const;

export type EnvironmentChange = 'session' | 'settings' | 'bootstrap' | 'catalog' | 'quota' | 'binding' | 'connection';

export interface PersonaState {
  /** `unassigned` — nothing chosen for the page; `unavailable` — archived or gone; `none` — the catalog is empty. */
  readonly status: 'ok' | 'unassigned' | 'unavailable' | 'none' | 'loading';
  readonly key: string | null;
  readonly definitionId: string | null;
  /** The persona's display name («Лора · VIP»). */
  readonly label: string | null;
}

export interface EnvironmentListener {
  (change: EnvironmentChange): void;
}

const accountKey = (account: HostAccount): string => `${account.host}:${account.hostAccountId}:${account.platformAccountId ?? ''}`;

export class TabEnvironment {
  private sessionValue: SessionIdentity | null | undefined = undefined;
  private settingsValue: SettingsState | null = null;
  private bootstrapValue: Loaded<Bootstrap> = IDLE;
  private catalogValue: Loaded<PersonaCatalog> = IDLE;
  private readonly quotas = new Map<number, AiQuotaSnapshot>();
  private readonly quotaAsked = new Set<number>();
  private readonly bindings = new Map<string, Loaded<HubBinding>>();
  private connectionValue: RpcConnection;
  /** Grows whenever the sign-in changes: a late answer of an older read is dropped. */
  private generation = 0;
  /** Grows whenever the bindings are dropped (a new sign-in, a new owner config). */
  private bindingEpoch = 0;
  /** The config revision of the last `flags.changed` taken: an older event never undoes a newer one. */
  private starRevision = 0;
  private readonly listeners = new Set<EnvironmentListener>();
  private readonly unsubscribe: (() => void)[] = [];
  private started = false;

  constructor(private readonly rpc: TabRpcPort) {
    this.connectionValue = rpc.state();
  }

  /** Subscribes to the background's events and reads the first state. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const { rpc } = this;
    this.unsubscribe.push(
      rpc.onEvent('session.changed', ({ session }) => this.sessionChanged(session)),
      rpc.onEvent('settings.changed', (state) => {
        this.settingsValue = state;
        this.emit('settings');
      }),
      rpc.onEvent('bootstrap.changed', () => this.loadBootstrap()),
      rpc.onEvent('catalog.changed', () => this.loadCatalog()),
      rpc.onEvent('quota.changed', ({ quota }) => {
        this.quotas.set(quota.pageId, quota);
        this.emit('quota');
      }),
      rpc.onEvent('flags.changed', ({ flags, configRevision }) => {
        const current = this.bootstrapValue;
        if (current.s !== 'ready' || configRevision < Math.max(current.value.configRevision, this.starRevision)) return;
        // These are the owner's `"*"` values (they answer only for an account bound to no page). What a page may do
        // is its own `features`, which come with the bootstrap: `bootstrap.changed` reads it again. The revision
        // of the bootstrap held stays its own, so that read still sees the config change and drops the bindings.
        this.starRevision = configRevision;
        this.bootstrapValue = { s: 'ready', value: { ...current.value, flags: { ...flags } } };
        this.emit('bootstrap');
      }),
      rpc.onState((state) => {
        const before = this.connectionValue;
        this.connectionValue = state;
        // A new port is a new background (or a new tab session): everything is read again — and nothing of the
        // copy held from before the outage is taken for current meanwhile (`resync`).
        const back = state === 'ready' && before !== 'ready' && before !== 'connecting';
        if (back) this.resync();
        this.emit('connection');
      }),
    );
    this.reload();
  }

  dispose(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.listeners.clear();
  }

  subscribe(listener: EnvironmentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  /** undefined — not read yet; null — nobody is signed in. */
  get session(): SessionIdentity | null | undefined {
    return this.sessionValue;
  }

  get settings(): SettingsState | null {
    return this.settingsValue;
  }

  get bootstrap(): Loaded<Bootstrap> {
    return this.bootstrapValue;
  }

  get catalog(): Loaded<PersonaCatalog> {
    return this.catalogValue;
  }

  get connection(): RpcConnection {
    return this.connectionValue;
  }

  /** The extension was reloaded or updated under the tab: only a reload of the tab helps (CG-RUNTIME-RELOADED). */
  get reloadNeeded(): boolean {
    return this.connectionValue === 'reloaded';
  }

  /**
   * The port to the background is lost and its quick reconnects failed, while the extension is the same instance
   * (CG-RUNTIME-UNREACHABLE): the tab keeps asking, and nothing can start until the background answers. Not an
   * update — no reload of the tab is asked for.
   */
  get unreachable(): boolean {
    return this.connectionValue === 'lost';
  }

  page(pageId: number): BootstrapPage | null {
    const bootstrap = this.bootstrapValue;
    return bootstrap.s === 'ready' ? (bootstrap.value.pages.find((page) => page.pageId === pageId) ?? null) : null;
  }

  /** The page's quota as the last generation's `meta` reported it; null — unknown. Asked once per page. */
  quota(pageId: number): AiQuotaSnapshot | null {
    const known = this.quotas.get(pageId);
    if (known === undefined && !this.quotaAsked.has(pageId) && this.sessionValue) {
      this.quotaAsked.add(pageId);
      const generation = this.generation;
      void this.rpc.request('quota.get', { pageId }).then((answer) => {
        if (generation !== this.generation || !answer.ok || answer.payload.quota === null || this.quotas.has(pageId)) return;
        this.quotas.set(pageId, answer.payload.quota);
        this.emit('quota');
      });
    }
    return known ?? null;
  }

  /**
   * The hub page a host account is bound to (§8.3: by `platformAccountId`
   * or the owner's explicit binding, never by name). Resolved by the
   * background; the first call starts the read and answers `loading`.
   */
  binding(account: HostAccount): Loaded<HubBinding> {
    if (!this.sessionValue) return IDLE;
    const key = accountKey(account);
    const known = this.bindings.get(key);
    if (known !== undefined) return known;
    this.bindings.set(key, LOADING);
    const epoch = this.bindingEpoch;
    void this.rpc.request('binding.resolve', { account }).then((answer) => {
      if (epoch !== this.bindingEpoch) return;
      this.bindings.set(key, answer.ok ? { s: 'ready', value: answer.payload.binding } : { s: 'error', error: answer.error });
      this.emit('binding');
    });
    return LOADING;
  }

  /**
   * `binding(account)` once it is read: never `loading`. For a decision that must not be taken on a guess —
   * a navigation into an account asks its page's switch, and opening a chat marks it read. `idle` — nobody is
   * signed in.
   */
  bindingRead(account: HostAccount): Promise<Loaded<HubBinding>> {
    const now = this.binding(account);
    if (now.s !== 'loading') return Promise.resolve(now);
    return new Promise((resolve) => {
      const off = this.subscribe(() => {
        // A new sign-in or owner config drops the read in flight: looking again starts it anew.
        const next = this.binding(account);
        if (next.s === 'loading') return;
        off();
        resolve(next);
      });
    });
  }

  /** The persona definition the settings assign to a page, whatever the catalog says of it; null — none, or the settings are not read yet. */
  assignedDefinition(pageId: number): string | null {
    return this.settingsValue?.settings.personas.byPageId[String(pageId)]?.definitionId ?? null;
  }

  /** The persona assigned to a page (the settings hold a reference, the catalog its name and status). */
  persona(pageId: number): PersonaState {
    const settings = this.settingsValue;
    const catalog = this.catalogValue;
    if (settings === null || catalog.s === 'idle' || catalog.s === 'loading') return { status: 'loading', key: null, definitionId: null, label: null };
    const personas: readonly PersonaCatalogItem[] = catalog.s === 'ready' ? catalog.value.personas : [];
    const assignment = settings.settings.personas.byPageId[String(pageId)];
    if (assignment === undefined) return { status: catalog.s === 'ready' && personas.length === 0 ? 'none' : 'unassigned', key: null, definitionId: null, label: null };
    const item = personas.find((persona) => persona.key === assignment.key);
    if (catalog.s === 'ready' && (item === undefined || item.status !== 'active')) {
      return { status: 'unavailable', key: assignment.key, definitionId: assignment.definitionId, label: item?.displayName ?? null };
    }
    return { status: 'ok', key: assignment.key, definitionId: assignment.definitionId, label: item?.displayName ?? null };
  }

  // ── writes and refreshes ─────────────────────────────────────────────────

  /** A settings write; «Сохранено» only on the answer with its revision (ST-013…ST-015). */
  async patchSettings(patch: SettingsPatch): Promise<RpcAnswer<SettingsState>> {
    const answer = await this.rpc.request('settings.patch', { patch, baseRevision: this.settingsValue?.revision ?? null });
    if (answer.ok) {
      this.settingsValue = answer.payload;
      this.emit('settings');
    }
    return answer;
  }

  /** Reads everything again («Повторить» of the hub-down banner, a reconnect). */
  reload(): void {
    // «Повторить» over a lost port: the background is asked again first. What is read below then fails at once
    // (nothing is sent over a lost port), and everything is read anew when the port answers (`onState`).
    if (this.connectionValue === 'lost') this.rpc.reconnect?.();
    this.generation += 1;
    const generation = this.generation;
    // A read that failed for the hub's or the transport's reasons is made again; «not bound» is an answer, not a failure.
    this.dropFailedBindings();
    void this.rpc.request('settings.get', {}).then((answer) => {
      if (!answer.ok) return;
      // An event may have brought a newer revision meanwhile.
      if (this.settingsValue !== null && this.settingsValue.revision > answer.payload.revision) return;
      this.settingsValue = answer.payload;
      this.emit('settings');
    });
    void this.rpc.request('session.get', {}).then((answer) => {
      if (generation !== this.generation) return;
      if (!answer.ok) {
        // The background did not answer: the sign-in is not known, the hub line says why.
        this.bootstrapValue = { s: 'error', error: answer.error };
        this.emit('bootstrap');
        return;
      }
      this.sessionChanged(answer.payload.session);
    });
  }

  /**
   * The port is back after it was down. Every event of the meantime was lost — a sign-in, a persona, an owner
   * switch, a binding may have changed unheard — so the copy held here is no longer known to be true. It is not
   * kept as `ready` while it is read again: the bootstrap (the page's switches and its binding revision) and the
   * bindings are dropped at once, and the bootstrap is asked for only after the settings are in (the persona of a
   * page comes from them). Until then nothing is there to insert, navigate or generate by; a read that fails
   * leaves the hub line saying why.
   */
  private resync(): void {
    this.generation += 1;
    const generation = this.generation;
    this.dropBindings();
    this.quotaAsked.clear();
    this.bootstrapValue = LOADING;
    this.emit('bootstrap');
    const failed = (error: CgErrorWire): void => {
      this.bootstrapValue = { s: 'error', error };
      this.emit('bootstrap');
    };
    void this.rpc.request('settings.get', {}).then((settings) => {
      if (generation !== this.generation) return;
      if (!settings.ok) return failed(settings.error);
      // An event may have brought a newer revision meanwhile.
      if (this.settingsValue === null || this.settingsValue.revision <= settings.payload.revision) {
        this.settingsValue = settings.payload;
        this.emit('settings');
      }
      void this.rpc.request('session.get', {}).then((answer) => {
        if (generation !== this.generation) return;
        if (!answer.ok) return failed(answer.error);
        // The same sign-in finds no bootstrap here and reads it; another one drops everything as ever.
        this.sessionChanged(answer.payload.session);
      });
    });
  }

  private sessionChanged(session: SessionIdentity | null): void {
    const before = this.sessionValue;
    const same = before !== undefined && before !== null && session !== null && before.epoch === session.epoch && before.userId === session.userId && before.hubOrigin === session.hubOrigin;
    this.sessionValue = session;
    if (!same) {
      this.generation += 1;
      this.dropBindings();
      this.quotas.clear();
      this.quotaAsked.clear();
      this.starRevision = 0;
      this.bootstrapValue = IDLE;
      this.catalogValue = IDLE;
    }
    this.emit('session');
    if (session !== null && (!same || this.bootstrapValue.s !== 'ready')) {
      this.loadBootstrap();
      this.loadCatalog();
    } else if (session !== null && this.catalogValue.s === 'error') this.loadCatalog();
  }

  private loadBootstrap(): void {
    if (!this.sessionValue) return;
    const generation = this.generation;
    if (this.bootstrapValue.s !== 'ready') this.bootstrapValue = LOADING;
    void this.rpc.request('bootstrap.get', {}).then((answer) => {
      if (generation !== this.generation) return;
      const before = this.bootstrapValue;
      this.bootstrapValue = answer.ok ? { s: 'ready', value: answer.payload } : { s: 'error', error: answer.error };
      // A new config may bind accounts differently: the bindings are resolved again.
      if (answer.ok && (before.s !== 'ready' || before.value.configRevision !== answer.payload.configRevision)) this.dropBindings();
      this.emit('bootstrap');
    });
  }

  private dropBindings(): void {
    this.bindingEpoch += 1;
    this.bindings.clear();
  }

  /** Bindings whose read failed (not «missing», «ambiguous» or «not granted») are resolved again on the next look. */
  private dropFailedBindings(): void {
    for (const [key, binding] of this.bindings) if (binding.s === 'error' && !binding.error.code.startsWith('CG-BINDING-')) this.bindings.delete(key);
  }

  private loadCatalog(): void {
    if (!this.sessionValue) return;
    const generation = this.generation;
    if (this.catalogValue.s !== 'ready') this.catalogValue = LOADING;
    void this.rpc.request('catalog.get', {}).then((answer) => {
      if (generation !== this.generation) return;
      this.catalogValue = answer.ok ? { s: 'ready', value: answer.payload } : { s: 'error', error: answer.error };
      this.emit('catalog');
    });
  }

  private emit(change: EnvironmentChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}
