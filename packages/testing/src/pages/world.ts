// The world an extension page runs in on the stand and in tests (R16): the
// scripted background, fake browser ports that record what the page asked
// for, the REAL pages controller of core and the REAL I18n port — so the
// view models, the texts and the save rules are the shipped ones. No DOM and
// no test utilities here: the stand's pages gallery uses it too.
// Synthetic data only (the mockup's names, synthetic ids).

import {
  ANCHOR_IDS,
  CONTRACTS_VERSION,
  DEFAULT_SETTINGS,
  HOST_CAPABILITIES,
  type ClipboardResult,
  type ColorScheme,
  type ExtensionPage,
  type HostAccount,
  type HostContractReport,
  type Locale,
  type OpView,
  type PromptSnapshotView,
  type ValueSignal,
} from '@cg/contracts';
import { createPagesClient, type PageEnv, type PagePorts, type PageTimers, type PagesClient } from '@cg/core/application/pages';
import { createI18n, type LiveI18n } from '@cg/core/domain/i18n';
import { type PageDeps } from '@cg/ui/pages';

import { NOW, createFakeCatalog, ctxOf, iso, uuid } from '../scenarios/app-client';
import { FakePageBackground, type BackgroundState, type SeenAccountFixture } from './background';

export const PAGES_NOW = NOW;
export const PAGES_VERSION = '0.4.3';
/** The stand's ChatSpace origin: only a name for the host-access check, nothing is fetched. */
export const PAGES_HOST_ORIGIN = 'https://chatspace.example.test';
const MIN = 60_000;
const HOUR = 60 * MIN;

const PERSONA_DEFINITION = (name: string): string => `persona-definition-${name}-0001`;

function account(id: string, creator: string, username: string, displayName: string): HostAccount {
  return { host: 'chatspace', hostAccountId: id, platform: 'onlyfans', platformAccountId: creator, username, displayName };
}

export function hostReport(now: number, broken: readonly string[] = []): HostContractReport {
  return {
    build: 'index-0000test',
    adapterVersion: '1.0.0',
    checkedAt: now - 5 * MIN,
    anchors: Object.fromEntries(ANCHOR_IDS.map((anchor) => [anchor, broken.includes(anchor) ? 'missing' : 'ok'])) as HostContractReport['anchors'],
    capabilities: Object.fromEntries(
      HOST_CAPABILITIES.map((capability) => [capability, broken.length > 0 && (capability === 'insert' || capability === 'previewSend') ? { state: 'contractBroken', reason: 'anchor missing' } : { state: 'on' }]),
    ) as HostContractReport['capabilities'],
  };
}

function runningOp(n: number, feature: OpView['feature'], fan: string, now: number, seen: SeenAccountFixture): OpView {
  const chat = { host: 'chatspace', hostAccountId: seen.account.hostAccountId, platformFanId: fan } as const;
  return {
    opId: uuid(900 + n),
    feature,
    surface: 'dock',
    target: {
      binding: {
        hubOrigin: DEFAULT_SETTINGS.hub.baseUrl,
        principalId: 7,
        loginEpoch: 3,
        host: 'chatspace',
        hostAccountId: seen.account.hostAccountId,
        platform: 'onlyfans',
        platformAccountId: seen.account.platformAccountId ?? '3003',
        pageId: 11,
        pageLabel: 'loravie-vip',
        bindingRevision: 2,
      },
      chat,
      fanRef: fan,
      conversationRef: fan,
    },
    state: 'streaming',
    phase: { name: 'streaming', since: now - 4_000 },
    startedAt: now - 6_000 * n,
    toneUsed: null,
  };
}

/** A working shift as the mockup draws it (final-20a, final-21a): signed in, ChatSpace open, a persona, low quota. */
export function workingState(now: number = PAGES_NOW): BackgroundState {
  const hub = DEFAULT_SETTINGS.hub.baseUrl;
  const accounts: SeenAccountFixture[] = [
    { account: account('1001', '3003', 'loravie_vip', 'LoraVie VIP'), lastSeenAt: iso(now - MIN), openTabs: 1 },
    { account: account('1002', '3004', 'loravie_free', 'LoraVie Free'), lastSeenAt: iso(now - 3 * HOUR), openTabs: 0 },
    { account: account('1003', '3005', 'lora_reels', 'Lora Reels'), lastSeenAt: iso(now - 26 * HOUR), openTabs: 0 },
    { account: account('1004', '3006', 'anna_m', 'Anna M'), lastSeenAt: iso(now - 50 * HOUR), openTabs: 0 },
  ];
  const first = accounts[0] as SeenAccountFixture;
  const page = (pageId: number, pageLabel: string, title: string, creator: string) => ({ pageId, pageLabel, title, platform: 'onlyfans', platformAccountId: creator, bindingRevision: 2, features: {} });
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      personas: { scope: { hubOrigin: hub, userId: 7 }, byPageId: {
          '11': { key: 'lora-vip', definitionId: PERSONA_DEFINITION('lora-vip') },
          '12': { key: 'lora-free', definitionId: PERSONA_DEFINITION('lora-free') },
          '13': { key: 'lora-free', definitionId: PERSONA_DEFINITION('lora-free') },
          '14': { key: 'lora-vip', definitionId: PERSONA_DEFINITION('lora-vip') },
        },
      },
      onboarding: { checklistDismissed: true, lastSeenVersion: PAGES_VERSION, keysFooter: { shown: 0, dismissed: false } },
    },
    revision: 7,
    readOnly: false,
    session: { hubOrigin: hub, userId: 7, login: 'chatter1', role: 'chatter', epoch: 3 },
    credentials: { chatter1: 'synthetic-pass' },
    bootstrap: {
      protocol: 1,
      issuedAt: iso(now - MIN),
      ttlSec: 300,
      configRevision: 4,
      minVersion: '0.1.0',
      identity: { userId: 7, username: 'chatter1', role: 'chatter', tokenClient: 'chat-extension' },
      pages: [page(11, 'loravie-vip', 'LoraVie VIP', '3003'), page(12, 'loravie-free', 'LoraVie Free', '3004'), page(13, 'lora-reels', 'Lora Reels', '3005'), page(14, 'anna-m', 'Anna M', '3006')],
      bindingsByHost: {},
      flags: { insertion: true, freshText: true, newcomers: true, spenders: true, stats: true, preview: true, previewSend: false, sound: true },
      limits: {
        freshTextMaxItems: 60,
        freshTextMaxChars: 5000,
        feedMax: 100,
        deepMax: 3000,
        audienceWindowHours: 720,
        claimLeaseSec: 120,
        claimRenewSec: 40,
        claimActivityWindowSec: 120,
        previewSendPerMinute: 6,
        navInsertTimeoutSec: 20,
        dispatchTicketSec: 10,
        previewSendReceiptProfiles: [],
      },
      capabilities: ['context-v1', 'audience-new-v1'],
    },
    catalog: {
      personas: [
        { key: 'lora-vip', displayName: 'Лора · VIP', version: 3, definitionId: PERSONA_DEFINITION('lora-vip'), status: 'active' },
        { key: 'lora-free', displayName: 'Лора · Free', version: 2, definitionId: PERSONA_DEFINITION('lora-free'), status: 'active' },
        { key: 'lora-old', displayName: 'Лора · старая', version: 1, definitionId: PERSONA_DEFINITION('lora-old'), status: 'archived' },
      ],
    },
    diagnostics: {
      generatedAt: iso(now),
      extension: { version: PAGES_VERSION, contractsVersion: CONTRACTS_VERSION, testBuild: false, updated: { at: iso(now - 18 * MIN), from: '0.4.2', staleTabs: 0 } },
      browser: { name: 'firefox', major: 157 },
      os: 'macos',
      session: { signedIn: true, hubOrigin: hub, role: 'chatter' },
      hub: {
        reachable: true,
        lastCheckedAt: iso(now - 39 * MIN),
        lastError: { code: 'CG-PROVIDER-RATE-LIMIT', httpStatus: 429 },
        flags: { previewSend: false, wsTap: true },
        sdk: { vendoredHash: 'a'.repeat(64), hubHash: 'a'.repeat(64), compatible: true },
      },
      tabs: [{ tabSessionId: uuid(4), host: hostReport(now), chatKey: 'chatspace:1001:2002' }],
      counters: { 'CG-PROVIDER-RATE-LIMIT': 1 },
      logs: { records: 1200, bytes: 1_310_720, dropped: 0 },
      telemetry: { consent: true, queued: 3, dropped: 0 },
      sound: { listeningTabs: 1, lastIncomingAt: iso(now - 7 * MIN), outcomes: { played: 4, 'chat-open': 9 } },
      ops: { active: 3 },
      sends: { open: 0, uncertain: 0 },
      footprint: { cachesKB: 412, logsKB: 1280 },
    },
    accounts,
    quotas: { 11: { pageId: 11, remainingRequestsToday: 12, remainingMicroUsdToday: null, resetsAt: '2026-10-04T00:00:00Z', observedAt: iso(now - 10 * MIN) } },
    ops: [runningOp(1, 'reply', '2003', now, first), runningOp(2, 'recap', '2004', now, first), runningOp(3, 'hi', '2005', now, first)],
    journals: {
      operations: {
        records: [
          { ts: iso(now - 30_000), seq: 41, level: 'info', scope: 'bg.ops', msg: 'operation done', fields: { feature: 'reply', ms: 3800, parts: 3 }, ctx: { opId: uuid(901) } },
          { ts: iso(now - 10_000), seq: 42, level: 'warn', scope: 'tab.insert', msg: 'insert rejected', code: 'CG-DRAFT-CHANGED', fields: { draftRevision: 5 } },
        ],
        truncated: false,
        runs: null,
      },
      'newcomers-check': { records: [], truncated: false, runs: [{ runId: uuid(30), startedAt: iso(now - 5 * MIN), events: 214 }] },
    },
    prompts: {
      'prompt-token-1': promptOk(now),
      'prompt-no-echo': { state: 'echo-off', fromCache: false, capturedAt: iso(now - MIN), feature: 'reply', manifest: null, blocks: [] },
      'prompt-cached': { state: 'echo-off', fromCache: true, capturedAt: iso(now - MIN), feature: 'recap', manifest: null, blocks: [] },
    },
    usage: null,
    newcomers: 3,
    serverRevoked: true,
    sound: { played: true },
  };
}

function promptOk(now: number): PromptSnapshotView {
  return {
    state: 'ok',
    fromCache: false,
    capturedAt: iso(now - MIN),
    feature: 'reply',
    manifest: '{\n  "blocks": ["system", "persona", "transcript"],\n  "messages": 40\n}',
    blocks: [
      { name: 'system 1 · cache write', text: 'synthetic system block of the stand', truncated: false },
      { name: 'user 1 · cache none', text: 'synthetic user block of the stand\n…[truncated]', truncated: true },
    ],
  };
}

/** The mockup's «проблемы» (final-20b): the hub does not answer and ChatSpace is only partly checked. */
export function troubledState(now: number = PAGES_NOW): BackgroundState {
  const state = workingState(now);
  const first = state.diagnostics.tabs[0];
  return {
    ...state,
    diagnostics: {
      ...state.diagnostics,
      hub: { ...state.diagnostics.hub, reachable: false, lastError: { code: 'CG-HUB-UNAVAILABLE' } },
      tabs: first === undefined ? [] : [{ ...first, host: hostReport(now, ['composerBridge']) }],
    },
  };
}

/** Nobody signed in yet: the first run, with the checklist still on. */
export function signedOutState(now: number = PAGES_NOW): BackgroundState {
  const state = workingState(now);
  return {
    ...state,
    session: null,
    settings: { ...state.settings, personas: { scope: null, byPageId: {} }, onboarding: { checklistDismissed: false, lastSeenVersion: null, keysFooter: { shown: 0, dismissed: false } } },
    diagnostics: { ...state.diagnostics, session: { signedIn: false, hubOrigin: null, role: null }, hub: { ...state.diagnostics.hub, reachable: null, lastCheckedAt: null, lastError: null } },
  };
}

// ── fake browser ports ─────────────────────────────────────────────────────

class Settable<T> implements ValueSignal<T> {
  private readonly listeners = new Set<(value: T) => void>();
  constructor(private current: T) {}
  get value(): T {
    return this.current;
  }
  set(next: T): void {
    if (Object.is(next, this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** What the page did to the browser, for assertions. */
export interface PortsRecord {
  /** `permissions.request` origins, in order. */
  readonly permissionRequests: string[];
  consentRequests: number;
  readonly opened: { page: string; hash: string | undefined }[];
  readonly links: string[];
  readonly downloads: { fileName: string; mime: string; body: string }[];
  readonly clipboard: string[];
  readonly hashes: string[];
  closed: number;
}

export interface FakeBrowser {
  /** Origins with host access. */
  readonly granted: Set<string>;
  /** What the person answers to the browser's permission prompt. */
  grantOnRequest: boolean;
  consent: boolean | null;
  clipboardFails: boolean;
  downloadFails: boolean;
  hash: string;
  readonly record: PortsRecord;
  /** A hash change from outside (the address bar, a link from an error toast). */
  go(hash: string): void;
  focus(): void;
  pageHide(): void;
  setConsent(granted: boolean): void;
  /**
   * `permissions.has` is answered by hand: every call waits for its own
   * function in `releases` (in the order the calls came) and reads what is
   * granted at that moment. `stop` ends it for the calls still to come.
   */
  parkPermissions(): { readonly releases: (() => void)[]; stop(): void };
  /** `permissions.has` throws: the browser could not tell. */
  permissionsFail: boolean;
  /** How many listeners the page still holds on the browser's ports: a disposed page holds none. */
  listenerCount(): number;
}

export interface PagesWorldOptions {
  readonly page?: ExtensionPage;
  readonly language?: Locale;
  readonly platform?: 'mac' | 'win';
  readonly scheme?: ColorScheme;
  readonly hash?: string;
  readonly state?: BackgroundState;
  /** A clock the test moves; default — fixed at PAGES_NOW. */
  readonly now?: () => number;
  /** Timers of the controller; default — the real ones (vi.useFakeTimers drives them). */
  readonly timers?: PageTimers;
  readonly systemLanguages?: readonly string[];
  readonly links?: PageEnv['links'];
}

export interface PagesWorld {
  readonly background: FakePageBackground;
  readonly state: BackgroundState;
  readonly browser: FakeBrowser;
  readonly client: PagesClient;
  readonly i18n: LiveI18n;
  readonly systemScheme: Settable<ColorScheme>;
  readonly env: PageEnv;
  /** What `mountPopup` / `mountOptions` / the debug mounts take. */
  readonly deps: PageDeps;
  readonly now: () => number;
}

export function pagesWorld(options: PagesWorldOptions = {}): PagesWorld {
  const page = options.page ?? 'options';
  const now = options.now ?? (() => PAGES_NOW);
  const state = options.state ?? workingState(now());
  const background = new FakePageBackground(state, page, now);
  const language = options.language ?? 'ru';
  const i18n = createI18n({ language, now, timeZone: 'Europe/Moscow' });
  const systemScheme = new Settable<ColorScheme>(options.scheme ?? 'light');
  const record: PortsRecord = { permissionRequests: [], consentRequests: 0, opened: [], links: [], downloads: [], clipboard: [], hashes: [], closed: 0 };
  const hashListeners = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  const hideListeners = new Set<() => void>();
  const consentListeners = new Set<(granted: boolean) => void>();
  const permissionListeners = new Set<(change: { added: readonly string[]; removed: readonly string[] }) => void>();
  let permissionPark: (() => void)[] | null = null;
  const shell: FakeBrowser = {
    granted: new Set([DEFAULT_SETTINGS.hub.baseUrl, PAGES_HOST_ORIGIN]),
    grantOnRequest: true,
    permissionsFail: false,
    parkPermissions() {
      const releases: (() => void)[] = [];
      permissionPark = releases;
      return {
        releases,
        stop: () => {
          permissionPark = null;
        },
      };
    },
    listenerCount: () => hashListeners.size + focusListeners.size + hideListeners.size + consentListeners.size + permissionListeners.size,
    consent: state.diagnostics.telemetry.consent,
    clipboardFails: false,
    downloadFails: false,
    hash: options.hash ?? '',
    record,
    go(hash) {
      shell.hash = hash;
      for (const listener of [...hashListeners]) listener();
    },
    focus() {
      for (const listener of [...focusListeners]) listener();
    },
    pageHide() {
      for (const listener of [...hideListeners]) listener();
    },
    setConsent(granted) {
      shell.consent = granted;
      for (const listener of [...consentListeners]) listener(granted);
    },
  };
  const subscribe =
    <L>(set: Set<L>) =>
    (listener: L): (() => void) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
  const env: PageEnv = {
    page,
    version: PAGES_VERSION,
    hotkeyPlatform: options.platform ?? 'mac',
    hostOrigin: PAGES_HOST_ORIGIN,
    links: options.links ?? { whatsNew: 'https://ext.example.test/chat-extension/whats-new.html', changelog: 'https://ext.example.test/chat-extension/changelog.html' },
    systemLanguages: () => options.systemLanguages ?? [language],
    timeZone: 'Europe/Moscow',
  };
  const ports: PagePorts = {
    rpc: background,
    clock: { now },
    timers: options.timers ?? { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    permissions: {
      has: async (origin) => {
        // What the browser says is read when it answers, not when it was asked.
        const park = permissionPark;
        if (park !== null) await new Promise<void>((resolve) => park.push(resolve));
        if (shell.permissionsFail) throw new Error('permissions.contains failed');
        return shell.granted.has(origin);
      },
      request: (origin) => {
        record.permissionRequests.push(origin);
        if (shell.grantOnRequest) shell.granted.add(origin);
        return Promise.resolve(shell.grantOnRequest);
      },
      onChange: subscribe(permissionListeners),
    },
    consent: {
      check: () => Promise.resolve(shell.consent),
      request: () => {
        record.consentRequests += 1;
        if (shell.grantOnRequest) shell.consent = true;
        return Promise.resolve(shell.grantOnRequest);
      },
      onChange: subscribe(consentListeners),
    },
    window: {
      hash: () => shell.hash,
      setHash: (hash) => {
        shell.hash = hash;
        record.hashes.push(hash);
      },
      onHashChange: subscribe(hashListeners),
      onFocus: subscribe(focusListeners),
      onPageHide: subscribe(hideListeners),
      close: () => {
        record.closed += 1;
      },
    },
    pages: {
      open: (opened, hash) => {
        record.opened.push({ page: opened, hash });
        return Promise.resolve({ ok: true });
      },
    },
    openLink: (url) => {
      record.links.push(url);
      return true;
    },
    download: (file) => {
      if (shell.downloadFails) return false;
      record.downloads.push({ ...file });
      return true;
    },
    clipboard: {
      writeText: (text): Promise<ClipboardResult> => {
        if (shell.clipboardFails) return Promise.resolve({ ok: false, code: 'CG-CLIPBOARD' });
        record.clipboard.push(text);
        return Promise.resolve({ ok: true });
      },
    },
    systemScheme,
    language: i18n,
  };
  const client = createPagesClient(env, ports);
  const deps: PageDeps = {
    client,
    i18n,
    catalog: createFakeCatalog(ctxOf({ lang: language, platform: env.hotkeyPlatform, now: now() })),
    clipboard: ports.clipboard,
    theme: client.theme,
    systemScheme,
    hints: client.hints,
    now,
  };
  return { background, state, browser: shell, client, i18n, systemScheme, env, deps, now };
}

/**
 * Lets the controller's pending requests and their follow-ups settle: the
 * scripted background answers in microtasks, and one read leads to the next
 * (the session, then the hub's answers, then bindings, then quotas).
 */
export async function settle(rounds = 80): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}
