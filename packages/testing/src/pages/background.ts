// A scripted background for the extension pages (architecture.md §5.4, §9.9;
// R16): the page side of the tab protocol answered in memory, so the page
// controllers and the pages themselves run for real — in unit tests and in
// the stand's pages gallery. Every request and every answer goes through the
// contract's own schemas (`parseTabPayload`): a page that sends something the
// protocol does not have fails here, before any real background sees it.
// Test-only: nothing that ships imports this. All ids are synthetic.

import {
  TAB_REQUESTS,
  hostBindingKey,
  mayRequest,
  parseTabPayload,
  type AiQuotaSnapshot,
  type AudienceNewItem,
  type AiUsageReport,
  type Bootstrap,
  type ChatKey,
  type CgCode,
  type CgErrorWire,
  type DiagnosticsSnapshot,
  type ExtensionPage,
  type HostAccount,
  type HubBinding,
  type JournalKind,
  type LogRecord,
  type OpView,
  type PersonaCatalog,
  type PromptSnapshotView,
  type SessionIdentity,
  type SettingsPatch,
  type SettingsState,
  type SettingsV1,
  type TabEventPayload,
  type TabEventType,
  type TabRequestPayload,
  type TabRequestType,
  type TabResponsePayload,
} from '@cg/contracts';
import { type AccountAdvanced, type LocalSpendReport } from '@cg/contracts/diagnostics';
import { type PageAnswer, type PageRequestType, type PageRpc } from '@cg/core/application/pages';
import { applySettingsPatch } from '@cg/core/domain';

export interface SeenAccountFixture {
  readonly account: HostAccount;
  readonly lastSeenAt: string;
  /** Tabs that have it loaded. */
  readonly openTabs: number;
  /** Tabs whose route is on it (1.8.0); absent — not counted, as a background before 1.8.0 answers. */
  readonly routeTabs?: number;
}

export interface JournalFixture {
  readonly records: readonly LogRecord[];
  readonly truncated: boolean;
  readonly runs: readonly { readonly runId: string; readonly startedAt: string; readonly events: number }[] | null;
}

/** Everything the scripted background knows; a test changes it and the next request sees the change. */
export interface BackgroundState {
  settings: SettingsV1;
  revision: number;
  readOnly: boolean;
  session: SessionIdentity | null;
  /** login → password the scripted hub accepts. */
  credentials: Record<string, string>;
  bootstrap: Bootstrap;
  catalog: PersonaCatalog;
  diagnostics: DiagnosticsSnapshot;
  accounts: SeenAccountFixture[];
  quotas: Record<number, AiQuotaSnapshot | null>;
  ops: OpView[];
  journals: Partial<Record<JournalKind, JournalFixture>>;
  prompts: Record<string, PromptSnapshotView>;
  usage: AiUsageReport | null;
  /** 1.20.0: `usage.local` — this browser's spend journal, answered while debug is on. */
  localSpend?: LocalSpendReport | null;
  /** 1.20.0: `account.advanced`, answered while debug is on and somebody is signed in. */
  advanced?: AccountAdvanced | null;
  /** 1.20.0: `fans.labels` — the names the tabs told the background. */
  fanLabels?: { chatKey: ChatKey; label: string }[];
  newcomers: number;
  /** What `session.signOut` reports about the hub's revoke. */
  serverRevoked: boolean | null;
  /** `sound.preview` answer. */
  sound: { played: boolean; code?: CgCode };
}

export interface RecordedCall {
  readonly type: PageRequestType;
  readonly payload: unknown;
}

type Listener = (payload: unknown) => void;

/** A request refused by the scripted background: the code, as the real one answers `ok: false`. */
const refuse = (code: CgCode, detail?: string): { ok: false; error: CgErrorWire } => ({ ok: false, error: detail === undefined ? { code } : { code, detail } });

export class ContractBreach extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractBreach';
  }
}

export class FakePageBackground implements PageRpc {
  /** Every request a page sent, in order (passwords replaced by their length). */
  readonly calls: RecordedCall[] = [];
  /** Nothing answers at all: every request ends as CG-RUNTIME-UNREACHABLE. */
  unreachable = false;
  /** X61: the tabs the build's own site has once «Перезагрузить вкладку» reloaded the old build's ones; null — as before. */
  tabsAfterReload: DiagnosticsSnapshot['tabs'] | null = null;
  /** How long the scripted background takes to answer a request type, ms (the stand: a hub that takes its time). */
  readonly delays = new Map<PageRequestType, number>();
  private readonly failures = new Map<PageRequestType, CgErrorWire[]>();
  private readonly gates = new Map<PageRequestType, { promise: Promise<void>; open: () => void }>();
  private readonly parks = new Map<PageRequestType, (() => void)[]>();
  private readonly listeners = new Map<TabEventType, Set<Listener>>();

  constructor(
    readonly state: BackgroundState,
    /** Which page sends: the protocol allows some requests only from some pages. */
    readonly page: ExtensionPage,
    private readonly now: () => number = Date.now,
  ) {}

  /** The next `times` requests of this type are refused with this error. */
  failNext(type: PageRequestType, error: CgErrorWire, times = 1): void {
    this.failures.set(type, [...(this.failures.get(type) ?? []), ...Array.from({ length: times }, () => error)]);
  }

  /** Requests of this type wait until the returned function is called. */
  hold(type: PageRequestType): () => void {
    let open: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    this.gates.set(type, { promise, open });
    return () => {
      this.gates.delete(type);
      open();
    };
  }

  /**
   * Requests of this type are answered by hand, one by one: each gets the
   * answer the background had at the moment it came, and that answer arrives
   * when its own function in `releases` is called — in any order. A late
   * answer of an earlier request is how a race is staged. `stop` ends the
   * parking for requests still to come.
   */
  park(type: PageRequestType): { readonly releases: (() => void)[]; stop(): void } {
    const releases: (() => void)[] = [];
    this.parks.set(type, releases);
    return { releases, stop: () => void this.parks.delete(type) };
  }

  requests(type: PageRequestType): unknown[] {
    return this.calls.filter((call) => call.type === type).map((call) => call.payload);
  }

  /** How many event listeners pages still hold: a disposed page holds none. */
  listenerCount(): number {
    let count = this.eventsStateListeners.size;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  emit<T extends TabEventType>(type: T, payload: TabEventPayload<T>): void {
    const checked = parseTabPayload('evt', type, payload);
    if (!checked.ok) throw new ContractBreach(`the scripted background emitted an invalid «${type}»`);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(checked.payload);
  }

  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    const wrapped: Listener = (payload) => listener(payload as TabEventPayload<T>);
    set.add(wrapped);
    this.listeners.set(type, set);
    return () => set.delete(wrapped);
  }

  private readonly eventsStateListeners = new Set<(state: string) => void>();

  /** The page's own event channel as the platform client reports it (`parked` while the background sleeps). */
  onEventsState(listener: (state: string) => void): () => void {
    this.eventsStateListeners.add(listener);
    return () => this.eventsStateListeners.delete(listener);
  }

  /** The event channel changes its state: the background slept (`parked`), the channel is there again (`open`). */
  eventsState(state: 'open' | 'parked' | 'reconnecting' | 'lost'): void {
    for (const listener of [...this.eventsStateListeners]) listener(state);
  }

  /**
   * What happened elsewhere while this page's event channel was parked: the
   * state changes, and nobody tells the page (no event reaches a parked port).
   */
  changeUnheard(change: { readonly session?: SessionIdentity | null; readonly settings?: SettingsPatch }): void {
    if (change.session !== undefined) {
      this.state.session = change.session;
      this.state.diagnostics = { ...this.state.diagnostics, session: { signedIn: change.session !== null, hubOrigin: change.session?.hubOrigin ?? null, role: change.session?.role ?? null } };
    }
    if (change.settings !== undefined) {
      const outcome = applySettingsPatch(this.state.settings, change.settings, { restricted: true });
      if (!outcome.ok) throw new ContractBreach('the scripted settings change is not a valid settings patch');
      this.state.settings = outcome.settings;
      this.state.revision += 1;
    }
  }

  /** Signs a person in or out from elsewhere (another page, the hub revoking the device). */
  setSession(session: SessionIdentity | null, reason: TabEventPayload<'session.changed'>['reason']): void {
    this.state.session = session;
    this.state.diagnostics = { ...this.state.diagnostics, session: { signedIn: session !== null, hubOrigin: session?.hubOrigin ?? null, role: session?.role ?? null } };
    this.emit('session.changed', { session, reason });
  }

  /** A settings change from elsewhere (another tab, the popup): bumps the revision and broadcasts it. */
  changeSettings(patch: SettingsPatch): SettingsState {
    const outcome = applySettingsPatch(this.state.settings, patch, { restricted: true });
    if (!outcome.ok) throw new ContractBreach('the scripted settings change is not a valid settings patch');
    this.state.settings = outcome.settings;
    this.state.revision += 1;
    const state = this.settingsState();
    this.emit('settings.changed', state);
    return state;
  }

  settingsState(): SettingsState {
    return { settings: structuredClone(this.state.settings), revision: this.state.revision, readOnly: this.state.readOnly };
  }

  async request<T extends PageRequestType>(type: T, payload: TabRequestPayload<T>): Promise<PageAnswer<TabResponsePayload<T>>> {
    // The same checks the real background runs before a handler sees anything (§5.4).
    if (!mayRequest(type, 'page', this.page)) throw new ContractBreach(`«${type}» may not be sent from the ${this.page} page`);
    const request = parseTabPayload('req', type, payload);
    if (!request.ok) throw new ContractBreach(`«${type}» was sent with a payload its schema refuses`);
    this.calls.push({ type, payload: type === 'session.signIn' ? { ...(payload as { login: string; password: string }), password: `[${(payload as { password: string }).password.length}]` } : payload });
    const parked = this.parks.get(type);
    if (parked !== undefined) {
      // Answered now, delivered when the test says so.
      const early = this.respond(type, request.payload as TabRequestPayload<TabRequestType>);
      await new Promise<void>((resolve) => parked.push(resolve));
      return early as PageAnswer<TabResponsePayload<T>>;
    }
    const gate = this.gates.get(type);
    if (gate !== undefined) await gate.promise;
    const delay = this.delays.get(type);
    if (delay !== undefined) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    return this.respond(type, request.payload as TabRequestPayload<TabRequestType>) as PageAnswer<TabResponsePayload<T>>;
  }

  private respond(type: PageRequestType, payload: TabRequestPayload<TabRequestType>): PageAnswer<unknown> {
    if (this.unreachable) return refuse('CG-RUNTIME-UNREACHABLE', `${type} not delivered`);
    const planned = this.failures.get(type);
    const failure = planned?.shift();
    if (failure !== undefined) return { ok: false, error: failure };
    const answer = this.answer(type, payload);
    if (answer.ok) {
      const checked = parseTabPayload('res', type, answer.payload);
      if (!checked.ok) throw new ContractBreach(`the scripted background answered «${type}» with a payload its schema refuses`);
      // A parked answer is what the background knew then: later changes of the scripted state do not reach it.
      return { ok: true, payload: structuredClone(answer.payload) };
    }
    return answer;
  }

  private bindingOf(account: HostAccount): HubBinding | CgCode {
    const { session, bootstrap } = this.state;
    if (session === null) return 'CG-AUTH-REQUIRED';
    const explicit = bootstrap.bindingsByHost[hostBindingKey(account.host, account.hostAccountId)];
    // As the real rule (hub bootstrap-rules `resolveBinding`): without an explicit binding the creator id decides, and
    // until ChatSpace has loaded it the answer is «not ready», not «not bound».
    if (explicit === undefined && account.platformAccountId === null) return 'CG-DATA-NOT-READY';
    const pages = explicit === undefined ? bootstrap.pages.filter((page) => page.platformAccountId !== null && page.platformAccountId === account.platformAccountId) : bootstrap.pages.filter((page) => page.pageId === explicit);
    if (pages.length > 1) return 'CG-BINDING-AMBIGUOUS';
    const page = pages[0];
    if (page === undefined || page.platformAccountId === null) return 'CG-BINDING-MISSING';
    return {
      hubOrigin: session.hubOrigin,
      principalId: session.userId,
      loginEpoch: session.epoch,
      host: account.host,
      hostAccountId: account.hostAccountId,
      platform: account.platform,
      platformAccountId: page.platformAccountId,
      pageId: page.pageId,
      pageLabel: page.pageLabel,
      bindingRevision: page.bindingRevision,
    };
  }

  private patch(patch: SettingsPatch, restricted: boolean): PageAnswer<SettingsState> {
    if (this.state.readOnly) return refuse('CG-STORAGE-VERSION');
    const outcome = applySettingsPatch(this.state.settings, patch, { restricted });
    if (!outcome.ok) return refuse('CG-UNKNOWN', outcome.reason === 'restricted' ? 'restricted section' : 'invalid settings');
    if (outcome.changed) {
      this.state.settings = outcome.settings;
      this.state.revision += 1;
      this.emit('settings.changed', this.settingsState());
    }
    return { ok: true, payload: this.settingsState() };
  }

  private answer(type: PageRequestType, payload: TabRequestPayload<TabRequestType>): PageAnswer<unknown> {
    const { state } = this;
    const needsSession = (): PageAnswer<never> | null => (state.session === null ? refuse('CG-AUTH-REQUIRED') : null);
    switch (type) {
      case 'site.access': {
        // X61: the build's own site has no switch; the popup's «Перезагрузить вкладку» reloads its old build's tabs.
        const request = payload as TabRequestPayload<'site.access'>;
        if (request.host !== 'chatspace' || request.enabled !== undefined) return refuse('CG-RUNTIME-UNREACHABLE');
        const updated = state.diagnostics.extension.updated;
        const stale = updated?.staleTabs ?? 0;
        if (request.reload === true && updated !== undefined) {
          state.diagnostics = { ...state.diagnostics, extension: { ...state.diagnostics.extension, updated: { ...updated, staleTabs: 0 } }, tabs: this.tabsAfterReload ?? state.diagnostics.tabs };
        }
        return { ok: true, payload: { host: request.host, enabled: true, granted: true, registered: true, waitingReload: request.reload === true ? 0 : stale, ...(request.reload === true ? { reloaded: stale } : {}) } };
      }
      case 'settings.get':
        return { ok: true, payload: this.settingsState() };
      case 'settings.patch':
        return this.patch((payload as TabRequestPayload<'settings.patch'>).patch, false);
      case 'settings.patchRestricted':
        return this.patch((payload as TabRequestPayload<'settings.patchRestricted'>).patch, true);
      case 'session.get':
        return { ok: true, payload: { session: state.session } };
      case 'session.signIn': {
        const { login, password } = payload as TabRequestPayload<'session.signIn'>;
        if (state.credentials[login] !== password) return refuse('CG-LOGIN-CREDENTIALS', 'HTTP 401');
        const session: SessionIdentity = { hubOrigin: state.settings.hub.baseUrl, userId: state.bootstrap.identity.userId, login, role: 'chatter', epoch: (state.session?.epoch ?? 0) + 1 };
        this.setSession(session, 'sign-in');
        return { ok: true, payload: { session } };
      }
      case 'session.signOut':
        this.setSession(null, 'sign-out');
        return { ok: true, payload: { serverRevoked: state.serverRevoked } };
      case 'bootstrap.get':
        return needsSession() ?? { ok: true, payload: state.bootstrap };
      case 'catalog.get':
        return needsSession() ?? { ok: true, payload: state.catalog };
      case 'binding.resolve': {
        const binding = this.bindingOf((payload as TabRequestPayload<'binding.resolve'>).account);
        return typeof binding === 'string' ? refuse(binding) : { ok: true, payload: { binding } };
      }
      case 'quota.get':
        return { ok: true, payload: { quota: state.quotas[(payload as TabRequestPayload<'quota.get'>).pageId] ?? null } };
      case 'accounts.seen':
        return { ok: true, payload: { accounts: state.accounts } };
      case 'op.list':
        return { ok: true, payload: { ops: state.ops, truncated: false } };
      case 'op.cancel': {
        const { opId } = payload as TabRequestPayload<'op.cancel'>;
        state.ops = state.ops.map((op) => (op.opId === opId ? { ...op, state: 'canceled' } : op));
        return { ok: true, payload: { state: 'canceled' } };
      }
      case 'diagnostics.get':
        return { ok: true, payload: { ...state.diagnostics, generatedAt: new Date(this.now()).toISOString() } };
      case 'diagnostics.export': {
        const { format } = payload as TabRequestPayload<'diagnostics.export'>;
        return {
          ok: true,
          payload:
            format === 'json'
              ? { fileName: 'chatgoose-diagnostics-20261003-062000.json', mime: 'application/json', body: JSON.stringify({ kind: 'chatgoose-diagnostics', v: 1 }) }
              : { fileName: 'chatgoose-diagnostics-20261003-062000.txt', mime: 'text/plain', body: 'ChatGoose diagnostics' },
        };
      }
      case 'data.clear':
        state.diagnostics = { ...state.diagnostics, logs: { records: 0, bytes: 0, dropped: 0 }, footprint: { cachesKB: 0, logsKB: 0 } };
        return { ok: true, payload: { cleared: true } };
      case 'tab.command':
        return { ok: true, payload: { delivered: state.diagnostics.tabs.length > 0 } };
      // 1.11.0: the X8 fuse as «Статус» shows it, and its reset (decision X25).
      case 'send.fuseState':
        return { ok: true, payload: state.diagnostics.sendFuse ?? { fuse: null, resetAt: null } };
      case 'send.fuseReset': {
        const reset = { fuse: null, resetAt: this.now() };
        state.diagnostics = { ...state.diagnostics, sendFuse: reset };
        this.emit('send.fuse', reset);
        return { ok: true, payload: reset };
      }
      case 'journal.read': {
        if (!state.settings.debug.enabled) return refuse('CG-FEATURE-DISABLED', 'debug_off');
        const journal = state.journals[(payload as TabRequestPayload<'journal.read'>).journal];
        return { ok: true, payload: journal ?? { records: [], truncated: false, runs: null } };
      }
      case 'debug.prompt': {
        const { token } = payload as TabRequestPayload<'debug.prompt'>;
        const off: PromptSnapshotView = { state: 'debug-off', fromCache: false, capturedAt: null, feature: null, manifest: null, blocks: [] };
        if (!state.settings.debug.enabled) return { ok: true, payload: off };
        return { ok: true, payload: state.prompts[token] ?? { ...off, state: 'expired' } };
      }
      case 'usage.get':
        return { ok: true, payload: { report: state.settings.debug.enabled ? state.usage : null } };
      case 'usage.local':
        return { ok: true, payload: { report: state.settings.debug.enabled ? (state.localSpend ?? null) : null } };
      case 'account.advanced':
        return { ok: true, payload: { info: state.settings.debug.enabled && state.session !== null ? (state.advanced ?? null) : null } };
      case 'fans.labels':
        return { ok: true, payload: { fans: state.session === null ? [] : (state.fanLabels ?? []) } };
      case 'newcomers.list': {
        const blocked = needsSession();
        if (blocked !== null) return blocked;
        const { pageId, windowHours } = payload as TabRequestPayload<'newcomers.list'>;
        const page = state.bootstrap.pages.find((entry) => entry.pageId === pageId);
        if (page === undefined) return refuse('CG-BINDING-NOT-GRANTED');
        const at = new Date(this.now()).toISOString();
        return {
          ok: true,
          payload: {
            pageLabel: page.pageLabel,
            window: { hours: windowHours, from: new Date(this.now() - windowHours * 3_600_000).toISOString(), to: at, snapshotAt: at },
            serverNow: at,
            coverage: { state: 'complete', deliveryFrontier: at, lastAudienceSweepAt: at, reasons: [] },
            unknownCount: 0,
            welcomeTemplate: null,
            items: Array.from({ length: state.newcomers }, (_, index) => newcomerItem(index, at)),
            nextCursor: null,
          },
        };
      }
      case 'sound.preview':
        return { ok: true, payload: state.sound.code === undefined ? { played: state.sound.played } : { played: state.sound.played, code: state.sound.code } };
      case 'log.write':
        return { ok: true, payload: { accepted: (payload as TabRequestPayload<'log.write'>).records.length, dropped: 0 } };
      case 'persona.set':
        return { ok: true, payload: { revision: state.revision } };
      // What the pages of R16 never ask: requests of the ChatSpace tab, the boards and (1.47.0) a chat tab's voice studio
      // (the sender check refuses most before this).
      case 'fan.card':
      case 'fan.dossier':
      case 'feed.read':
      case 'health.report':
      case 'newcomers.claim':
      case 'op.reportCopy':
      case 'op.reportInsert':
      case 'op.reportSent':
      case 'op.reportShown':
      case 'op.start':
      case 'recap.read':
      case 'recap.save':
      case 'recap.status':
      case 'send.begin':
      case 'send.fuse':
      case 'send.list':
      case 'send.report':
      case 'send.status':
      case 'settings.open':
      case 'debug.open':
      case 'sound.event':
      case 'attribution.report':
      case 'spenders.board':
      case 'spenders.queue':
      case 'spenders.stats':
      case 'tab.presence':
      case 'talk.read':
      case 'fan.memory':
      case 'fan.memory.link':
      case 'fan.memory.fact':
      case 'fan.memory.custom':
      case 'queue.winback':
      case 'queue.winback.pick':
      case 'queue.handoff':
      case 'token.issue':
      case 'token.redeem':
      case 'voice.read':
      case 'voice.allowance':
      case 'voice.script':
      case 'voice.edit':
      case 'voice.take':
      case 'voice.check':
      case 'voice.audio':
      case 'voice.attached':
      case 'voice.discard':
        return refuse('CG-UNKNOWN', `${type} is not scripted`);
    }
  }
}

/** One row of `client/audience-new`: the popup reads only how many there are. */
function newcomerItem(index: number, at: string): AudienceNewItem {
  return {
    eventRef: `evt-${String(index + 1).padStart(4, '0')}`,
    fanRef: String(5000 + index),
    username: null,
    displayName: null,
    kind: 'new',
    trial: false,
    subscribedAt: at,
    subscribedAtSource: 'notification',
    status: { isSubscriber: true, subscriptionStatus: 'active', endsAt: null, asOf: at, source: 'webhook' },
    thread: null,
    lastPersonalSendAt: null,
    claim: { greeting: 'none', lease: 'none', heldBy: null, custody: null },
  };
}

/** Which requests a page of this name may send at all (for tests of the sender rules). */
export function pageMaySend(page: ExtensionPage): PageRequestType[] {
  return (Object.keys(TAB_REQUESTS) as TabRequestType[]).filter((type): type is PageRequestType => type !== 'tab.register' && mayRequest(type, 'page', page));
}
