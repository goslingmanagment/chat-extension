// A fake of the WebExtension API slice in browser-api.ts, for the platform's
// own tests (not exported by the package). It models what the platform
// relies on: contexts (the background event page, tab content scripts,
// extension pages) with their own listeners, ports delivered asynchronously
// with structured clones, the event page being unloaded and woken again by a
// port or a message, the extension being reloaded under an open tab,
// storage.local/session with change events across contexts and injected
// failures, permissions with Firefox's data_collection, alarms, dynamic
// content scripts, and the lifecycle events of the event page (installed,
// browser start, suspend).
//
// The fake's async API methods are `async` for the shape, not because they await.
/* eslint-disable @typescript-eslint/require-await */

import type {
  ExtensionContextApi,
  InstalledDetailsApi,
  TabApi,
  AlarmApi,
  AlarmCreateInfoApi,
  BrowserApi,
  EventApi,
  MessageSenderApi,
  PermissionsSetApi,
  PortApi,
  RegisteredContentScriptApi,
  RuntimeMessageListener,
  StorageAreaApi,
  StorageChangeApi,
} from '../browser-api';

type Listener = (...args: never[]) => unknown;

export class FakeEvent<L extends Listener> implements EventApi<L> {
  private readonly listeners: L[] = [];
  addListener(listener: L): void {
    this.listeners.push(listener);
  }
  removeListener(listener: L): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }
  get size(): number {
    return this.listeners.length;
  }
  emit(...args: Parameters<L>): unknown[] {
    return [...this.listeners].map((listener) => listener(...args));
  }
  clear(): void {
    this.listeners.length = 0;
  }
}

export class FakePort implements PortApi {
  readonly onMessage = new FakeEvent<(message: unknown, port: PortApi) => void>();
  readonly onDisconnect = new FakeEvent<(port: PortApi) => void>();
  connected = true;
  peer: FakePort | null = null;
  error: { message?: string } | null = null;
  readonly posted: unknown[] = [];

  constructor(
    readonly name: string,
    readonly sender: MessageSenderApi | undefined,
  ) {}

  postMessage(message: unknown): void {
    if (!this.connected) throw new Error('Attempt to postMessage on disconnected port');
    const copy = structuredClone(message);
    this.posted.push(copy);
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer?.connected) peer.onMessage.emit(copy, peer);
    });
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    const peer = this.peer;
    if (peer?.connected) {
      peer.connected = false;
      queueMicrotask(() => peer.onDisconnect.emit(peer));
    }
  }
}

export interface FakeContext {
  readonly api: BrowserApi;
  readonly sender: MessageSenderApi | undefined;
  readonly ports: Set<FakePort>;
  alive: boolean;
  readonly events: {
    readonly onConnect: FakeEvent<(port: PortApi) => void>;
    readonly onMessage: FakeEvent<RuntimeMessageListener>;
    readonly storageChanged: FakeEvent<(changes: Record<string, StorageChangeApi>, area: string) => void>;
    readonly onAlarm: FakeEvent<(alarm: AlarmApi) => void>;
    readonly onInstalled: FakeEvent<(details: InstalledDetailsApi) => void>;
    readonly onStartup: FakeEvent<() => void>;
    readonly onSuspend: FakeEvent<() => void | Promise<void>>;
    readonly onSuspendCanceled: FakeEvent<() => void>;
    readonly permissionsAdded: FakeEvent<(permissions: PermissionsSetApi) => void>;
    readonly permissionsRemoved: FakeEvent<(permissions: PermissionsSetApi) => void>;
  };
}

type AreaName = 'local' | 'session';
type Op = 'get' | 'set' | 'remove' | 'getKeys';

export interface FakeBrowser {
  readonly runtimeId: string;
  readonly base: string;
  readonly areas: Record<AreaName, Map<string, unknown>>;
  readonly permissions: { origins: Set<string>; permissions: Set<string>; data_collection: Set<string> };
  readonly alarms: Map<string, AlarmApi>;
  readonly scripts: Map<string, RegisteredContentScriptApi>;
  /** Quota of an area in JSON bytes (Firefox session: 10 MiB). */
  readonly quota: Partial<Record<AreaName, number>>;
  /** tabs.create / tabs.update / windows.update / runtime.openOptionsPage calls, in order. */
  readonly tabCalls: string[];
  /** Tabs the person closed: `tabs.update` of one rejects, as the browser's does. */
  readonly closedTabs: Set<number>;
  /** Whether permissions.request grants (the person clicks «Allow»). */
  grantRequests: boolean;
  /** Storage answers after this many ms (a real timer), or never ('hang'); default: next microtask. */
  latency: ((area: AreaName, op: Op) => number | 'hang') | null;
  /** The current background context (null while unloaded). */
  background(): FakeContext | null;
  /** Starts a background context; `onWake` runs its top-level code. */
  startBackground(): FakeContext;
  /** The event page goes away: its ports disconnect, its listeners are gone. */
  unloadBackground(): void;
  /** The browser suspends an idle event page: `runtime.onSuspend` first, then it goes away. */
  suspendBackground(): void;
  /** `runtime.onInstalled` / `runtime.onStartup` of the running background (delivered after its first run). */
  fireInstalled(details: InstalledDetailsApi): void;
  fireStartup(): void;
  /** Called when a port, message or alarm needs a background that is not running. */
  onWake(start: (context: FakeContext) => void): void;
  /** A content script of a tab, or an extension page. */
  context(sender: MessageSenderApi): FakeContext;
  /** The extension is reloaded under open tabs: runtime gone, ports dead. */
  reloadExtension(): void;
  failNext(area: AreaName, op: Op, error?: Error): void;
  fireAlarm(name: string): void;
  /** The person changes permissions in the browser UI. */
  revokeFromBrowserUi(permissions: PermissionsSetApi): void;
}

const quotaError = (): Error => Object.assign(new Error('QuotaExceededError: storage quota exceeded'), { name: 'QuotaExceededError' });

export function createFakeBrowser(options: { runtimeId?: string; base?: string } = {}): FakeBrowser {
  const runtimeId = options.runtimeId ?? 'chat-extension-test@gosling.agency';
  const base = options.base ?? 'moz-extension://0f1e2d3c-test/';
  const areas: Record<AreaName, Map<string, unknown>> = { local: new Map(), session: new Map() };
  const failures: { area: AreaName; op: Op; error: Error }[] = [];
  const contexts = new Set<FakeContext>();
  const permissions = { origins: new Set<string>(), permissions: new Set<string>(), data_collection: new Set<string>() };
  const alarms = new Map<string, AlarmApi>();
  const scripts = new Map<string, RegisteredContentScriptApi>();
  const quota: Partial<Record<AreaName, number>> = {};
  const tabCalls: string[] = [];
  const closedTabs = new Set<number>();
  let nextTabId = 100;
  let backgroundContext: FakeContext | null = null;
  let wake: ((context: FakeContext) => void) | null = null;
  let extensionAlive = true;

  const live = (): FakeContext[] => [...contexts].filter((context) => context.alive);

  const takeFailure = (area: AreaName, op: Op): Error | undefined => {
    const index = failures.findIndex((failure) => failure.area === area && failure.op === op);
    if (index < 0) return undefined;
    return failures.splice(index, 1)[0]?.error;
  };

  const emitChanges = (area: AreaName, changes: Record<string, StorageChangeApi>): void => {
    if (Object.keys(changes).length === 0) return;
    queueMicrotask(() => {
      for (const context of live()) context.events.storageChanged.emit(structuredClone(changes), area);
    });
  };

  /** The browser's latency: the call's effect happens after it, as a real storage call's does. */
  const pause = async (area: AreaName, op: Op): Promise<void> => {
    const ms = fake.latency?.(area, op) ?? 0;
    if (ms === 'hang') await new Promise<never>(() => undefined);
    else if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  };

  const areaApi = (area: AreaName, context: () => FakeContext): StorageAreaApi => ({
    async get(keys) {
      await pause(area, 'get');
      if (!context().alive) throw new Error('context invalidated');
      const failure = takeFailure(area, 'get');
      if (failure !== undefined) throw failure;
      const map = areas[area];
      const wanted = keys === null ? [...map.keys()] : typeof keys === 'string' ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const key of wanted) if (map.has(key)) out[key] = structuredClone(map.get(key));
      return out;
    },
    async getKeys() {
      await pause(area, 'getKeys');
      if (!context().alive) throw new Error('context invalidated');
      const failure = takeFailure(area, 'getKeys');
      if (failure !== undefined) throw failure;
      return [...areas[area].keys()];
    },
    async set(items) {
      await pause(area, 'set');
      if (!context().alive) throw new Error('context invalidated');
      const failure = takeFailure(area, 'set');
      if (failure !== undefined) throw failure;
      const map = areas[area];
      const limit = quota[area];
      if (limit !== undefined) {
        const next = new Map(map);
        for (const [key, value] of Object.entries(items)) next.set(key, value);
        const size = [...next.entries()].reduce((sum, [key, value]) => sum + key.length + JSON.stringify(value).length, 0);
        if (size > limit) throw quotaError();
      }
      const changes: Record<string, StorageChangeApi> = {};
      for (const [key, value] of Object.entries(items)) {
        const copy = structuredClone(value);
        changes[key] = map.has(key) ? { oldValue: map.get(key), newValue: copy } : { newValue: copy };
        map.set(key, copy);
      }
      emitChanges(area, changes);
    },
    async remove(keys) {
      await pause(area, 'remove');
      if (!context().alive) throw new Error('context invalidated');
      const failure = takeFailure(area, 'remove');
      if (failure !== undefined) throw failure;
      const map = areas[area];
      const changes: Record<string, StorageChangeApi> = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (!map.has(key)) continue;
        changes[key] = { oldValue: map.get(key) };
        map.delete(key);
      }
      emitChanges(area, changes);
    },
  });

  const ensureBackground = (): FakeContext | null => {
    if (backgroundContext?.alive) return backgroundContext;
    if (!wake || !extensionAlive) return null;
    const context = startBackground();
    wake(context);
    return context;
  };

  function makeContext(sender: MessageSenderApi | undefined, isBackground: boolean): FakeContext {
    const events = {
      onConnect: new FakeEvent<(port: PortApi) => void>(),
      onMessage: new FakeEvent<RuntimeMessageListener>(),
      storageChanged: new FakeEvent<(changes: Record<string, StorageChangeApi>, area: string) => void>(),
      onAlarm: new FakeEvent<(alarm: AlarmApi) => void>(),
      onInstalled: new FakeEvent<(details: InstalledDetailsApi) => void>(),
      onStartup: new FakeEvent<() => void>(),
      onSuspend: new FakeEvent<() => void | Promise<void>>(),
      onSuspendCanceled: new FakeEvent<() => void>(),
      permissionsAdded: new FakeEvent<(permissions: PermissionsSetApi) => void>(),
      permissionsRemoved: new FakeEvent<(permissions: PermissionsSetApi) => void>(),
    };
    // eslint-disable-next-line prefer-const -- assigned once below, referenced by closures above it
    let self: FakeContext;
    const runtime = {
      get id(): string {
        if (!extensionAlive || !self.alive) throw new Error('Extension context invalidated.');
        return runtimeId;
      },
      getURL: (path: string) => `${base}${path.replace(/^\//, '')}`,
      getManifest: () => ({ version: '1.2.3' }),
      getBrowserInfo: async () => ({ name: 'Firefox', version: '157.0.1' }),
      getPlatformInfo: async () => ({ os: 'mac', arch: 'aarch64' }),
      connect(info: { name: string }): PortApi {
        if (!extensionAlive || !self.alive) throw new Error('Extension context invalidated.');
        const client = new FakePort(info.name, undefined);
        const server = new FakePort(info.name, sender);
        client.peer = server;
        server.peer = client;
        self.ports.add(client);
        const target = isBackground ? null : ensureBackground();
        if (!target || target.events.onConnect.size === 0) {
          client.error = { message: 'Could not establish connection. Receiving end does not exist.' };
          server.connected = false;
          client.connected = false;
          queueMicrotask(() => client.onDisconnect.emit(client));
          return client;
        }
        target.ports.add(server);
        queueMicrotask(() => {
          if (server.connected) target.events.onConnect.emit(server);
        });
        return client;
      },
      async sendMessage(message: unknown): Promise<unknown> {
        if (!extensionAlive || !self.alive) throw new Error('Extension context invalidated.');
        const target = isBackground ? null : ensureBackground();
        if (!target || target.events.onMessage.size === 0) throw new Error('Could not establish connection. Receiving end does not exist.');
        const copy = structuredClone(message);
        await Promise.resolve();
        let response: unknown;
        let responded = false;
        const results = target.events.onMessage.emit(copy, sender ?? {}, (value: unknown) => {
          responded = true;
          response = value;
        });
        const promise = results.find((result): result is Promise<unknown> => result instanceof Promise);
        if (promise) return structuredClone(await promise);
        return responded ? structuredClone(response) : undefined;
      },
      onConnect: events.onConnect,
      onMessage: events.onMessage,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onSuspend: events.onSuspend,
      onSuspendCanceled: events.onSuspendCanceled,
      async getContexts(filter: { contextTypes?: string[] }): Promise<ExtensionContextApi[]> {
        if (filter.contextTypes && !filter.contextTypes.includes('TAB')) return [];
        return live()
          .filter((context) => typeof context.sender?.tab?.id === 'number' && context.sender.url?.startsWith(base) === true)
          .map((context) => ({ contextType: 'TAB', documentUrl: context.sender?.url ?? '', tabId: context.sender?.tab?.id ?? -1, windowId: 1 }));
      },
      async openOptionsPage(): Promise<void> {
        tabCalls.push('openOptionsPage');
      },
    };
    const api: BrowserApi = {
      runtime,
      tabs: {
        query: async () => [],
        reload: async (tabId) => { tabCalls.push(`reload ${tabId}`); },
        onRemoved: new FakeEvent<(tabId: number) => void>(),
        async create(properties: { url: string; active?: boolean }): Promise<TabApi> {
          tabCalls.push(`create ${properties.url}`);
          return { id: nextTabId++, url: properties.url };
        },
        async update(tabId: number, properties: { url?: string; active?: boolean }): Promise<TabApi> {
          tabCalls.push(`update ${tabId}${properties.url === undefined ? '' : ` ${properties.url}`}`);
          if (fake.closedTabs.has(tabId)) throw new Error(`Invalid tab ID: ${tabId}`);
          return properties.url === undefined ? { id: tabId, windowId: 1 } : { id: tabId, url: properties.url, windowId: 1 };
        },
      },
      windows: {
        async update(windowId: number): Promise<unknown> {
          tabCalls.push(`focus window ${windowId}`);
          return {};
        },
      },
      storage: { local: areaApi('local', () => self), session: areaApi('session', () => self), onChanged: events.storageChanged },
      alarms: {
        create(name: string, info: AlarmCreateInfoApi) {
          const scheduledTime = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000;
          alarms.set(name, info.periodInMinutes === undefined ? { name, scheduledTime } : { name, scheduledTime, periodInMinutes: info.periodInMinutes });
        },
        clear: async (name: string) => alarms.delete(name),
        get: async (name: string) => alarms.get(name),
        onAlarm: events.onAlarm,
      },
      permissions: {
        contains: async (p) =>
          (p.origins ?? []).every((origin) => permissions.origins.has(origin)) &&
          (p.permissions ?? []).every((name) => permissions.permissions.has(name)) &&
          (p.data_collection ?? []).every((name) => permissions.data_collection.has(name)),
        getAll: async () => ({ origins: [...permissions.origins], permissions: [...permissions.permissions], data_collection: [...permissions.data_collection] }),
        async request(p) {
          if (!fake.grantRequests) return false;
          for (const origin of p.origins ?? []) permissions.origins.add(origin);
          for (const name of p.permissions ?? []) permissions.permissions.add(name);
          for (const name of p.data_collection ?? []) permissions.data_collection.add(name);
          queueMicrotask(() => {
            for (const context of live()) context.events.permissionsAdded.emit(structuredClone(p));
          });
          return true;
        },
        async remove(p) {
          revoke(p);
          return true;
        },
        onAdded: events.permissionsAdded,
        onRemoved: events.permissionsRemoved,
      },
      scripting: {
        executeScript: async () => [],
        getRegisteredContentScripts: async (filter) =>
          [...scripts.values()].filter((script) => !filter?.ids || filter.ids.includes(script.id)).map((script) => structuredClone(script)),
        async registerContentScripts(list) {
          for (const script of list) {
            if (scripts.has(script.id)) throw new Error(`Content script with id "${script.id}" is already registered.`);
            scripts.set(script.id, structuredClone(script));
          }
        },
        async unregisterContentScripts(filter) {
          for (const id of filter?.ids ?? [...scripts.keys()]) scripts.delete(id);
        },
      },
    };
    self = { api, sender, ports: new Set(), alive: true, events };
    contexts.add(self);
    return self;
  }

  function revoke(p: PermissionsSetApi): void {
    for (const origin of p.origins ?? []) permissions.origins.delete(origin);
    for (const name of p.permissions ?? []) permissions.permissions.delete(name);
    for (const name of p.data_collection ?? []) permissions.data_collection.delete(name);
    queueMicrotask(() => {
      for (const context of live()) context.events.permissionsRemoved.emit(structuredClone(p));
    });
  }

  function kill(context: FakeContext): void {
    context.alive = false;
    for (const port of context.ports) port.disconnect();
    context.ports.clear();
    for (const event of Object.values(context.events)) event.clear();
    contexts.delete(context);
  }

  function startBackground(): FakeContext {
    if (backgroundContext) kill(backgroundContext);
    backgroundContext = makeContext(undefined, true);
    return backgroundContext;
  }

  const fake: FakeBrowser = {
    runtimeId,
    base,
    areas,
    permissions,
    alarms,
    scripts,
    quota,
    tabCalls,
    closedTabs,
    grantRequests: true,
    latency: null,
    background: () => (backgroundContext?.alive ? backgroundContext : null),
    startBackground,
    unloadBackground() {
      if (backgroundContext) kill(backgroundContext);
      backgroundContext = null;
    },
    suspendBackground() {
      if (!backgroundContext) return;
      backgroundContext.events.onSuspend.emit();
      kill(backgroundContext);
      backgroundContext = null;
    },
    fireInstalled(details) {
      backgroundContext?.events.onInstalled.emit(structuredClone(details));
    },
    fireStartup() {
      backgroundContext?.events.onStartup.emit();
    },
    onWake(start) {
      wake = start;
    },
    context: (sender) => makeContext(sender, false),
    reloadExtension() {
      extensionAlive = false;
      // The background goes first: its end of every port disconnects, so the
      // old content scripts (still running) see their port die.
      if (backgroundContext) kill(backgroundContext);
      backgroundContext = null;
      for (const context of [...contexts]) {
        context.alive = false;
        for (const event of Object.values(context.events)) event.clear();
        contexts.delete(context);
      }
    },
    failNext(area, op, error) {
      failures.push({ area, op, error: error ?? new Error(`${area}.${op} failed`) });
    },
    fireAlarm(name) {
      const alarm = alarms.get(name);
      if (!alarm) return;
      const target = ensureBackground();
      target?.events.onAlarm.emit(structuredClone(alarm));
    },
    revokeFromBrowserUi: revoke,
  };
  return fake;
}

/** A ChatSpace-like tab sender (synthetic origin; the real one is named only in the host registry, apps/extension/src/hosts). */
export const TAB_ORIGIN = 'https://chat.example.test';
export const TAB_MATCHES = [`${TAB_ORIGIN}/*`] as const;
/** A Fansly-like origin (synthetic). */
export const FANSLY_ORIGIN = 'https://fansly.example.test';
export const TAB_HOSTS = { chatspace: TAB_MATCHES, 'fansly-web': [`${FANSLY_ORIGIN}/*`] } as const;

export function tabSender(fake: FakeBrowser, overrides: Partial<MessageSenderApi> = {}): MessageSenderApi {
  return { id: fake.runtimeId, url: `${TAB_ORIGIN}/chat/1001/2002`, origin: TAB_ORIGIN, frameId: 0, tab: { id: 7, url: `${TAB_ORIGIN}/chat/1001/2002` }, ...overrides };
}

export function pageSender(fake: FakeBrowser, page: string, overrides: Partial<MessageSenderApi> = {}): MessageSenderApi {
  return { id: fake.runtimeId, url: `${fake.base}${page}.html`, ...overrides };
}

/** Lets queued microtasks and promise chains settle. */
export async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}
