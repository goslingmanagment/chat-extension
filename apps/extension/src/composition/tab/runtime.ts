// The tab's runtime — the part of the early isolated bundle that starts one
// task after document_start (architecture.md §2, §5.4, §11): the `cg-tab`
// port, the tab's registration, presence, the keepalive of the event page
// (BG-003), and the loader of the lazy chunks.
//
// It stays light on purpose (§11: the early bundle ≤ 30 KiB): the request
// registry of the tab protocol alone is 26 KiB, so before the application is
// loaded the port checks only the two answers it needs — `tab.register` (its
// own light schema) and the acknowledgement of `tab.presence`. Everything
// else waits for the lazy chunks, and those load when ChatSpace shows a
// composer — or when a key of ours waits for them (HK-024: ⌘K and ⌘⇧M work
// on the whole of ChatSpace) — and never before either (EX-011).

import { CONTRACTS_VERSION } from '@cg/contracts';
import type { HostAccount } from '@cg/contracts/ids';
import { TabRegisterResponseSchema } from '@cg/contracts/tab-protocol';
import type { HostDiagnostic, MountDiagnostic, StartedChatSpaceHost, TokenRedeemer } from '@cg/host-chatspace/isolated';
import { createTabRpcClient, defaultBrowser, extensionUrl, isExtensionContextAlive, type BrowserApi, type TabPayloadValidator } from '@cg/platform';

import type * as TabAppChunk from '../../../lazy/entries/tab-app';
import type * as TabProtocolChunk from '../../../lazy/entries/tab-protocol';
import type { TabApp } from './app';
import type { DraftStore } from './controllers';
import type { TabKeys } from './keys';
import { importWithRetry, lazyPath } from './lazy';
import type { TabProbe } from './probe';

/** The two chunks the early bundle loads itself; the application loads the rest (tab/app.ts). */
export const LAZY = { protocol: lazyPath('tab-protocol'), app: lazyPath('tab-app') } as const;

/** Presence reports are coalesced: a burst of route, focus and account events is one request. */
const PRESENCE_DELAY_MS = 200;

/**
 * «Пока ChatSpace открыт, вкладка держит фон» (§7, BG-003). Firefox unloads an event page after 30 s
 * without an event delivered to it (`extensions.background.idle.timeout`): an open port does not hold it,
 * nor do the events the background sends to the tab, nor its own fetches — a message arriving from the tab
 * does. So a registered tab repeats its presence report (the real values, nothing reset) this often.
 * A third of the timeout: a background tab's timers are clamped to 1 s and, once its timer budget is
 * spent, delayed by up to 15 s more — the next report still lands inside the 30 s.
 */
export const KEEPALIVE_MS = 10_000;

export interface TabRuntimeEnv {
  readonly win: Window;
  readonly life: AbortSignal;
  readonly abort: (reason: string) => void;
  readonly host: StartedChatSpaceHost;
  /** The early key dispatcher and what it reads (tab/keys.ts). */
  readonly keys: TabKeys;
  readonly lateInjection: boolean;
  readonly staleHosts: number;
  readonly probe: TabProbe | null;
  readonly setNavInsertTimeoutMs: (ms: number) => void;
  /** Hands over what the host reported so far and where the rest goes. */
  readonly takeDiagnostics: (listener: (diagnostic: HostDiagnostic | MountDiagnostic) => void) => (HostDiagnostic | MountDiagnostic)[];
  /** Tests only: the browser API of the tab's context (the real `browser` otherwise). */
  readonly api?: BrowserApi;
  /** Tests only: the keepalive period (KEEPALIVE_MS otherwise). */
  readonly keepaliveMs?: number;
}

export interface TabRuntime {
  redeem: TokenRedeemer;
  /** Loads the application now, composer or not: a key of ours waits for it (HK-024). */
  wake(): void;
}

/** Loads a lazy chunk; one retry under `?retry` (EX-009). */
export function loadLazy<T>(path: string): Promise<T> {
  return importWithRetry<T>(extensionUrl(path), (url) => import(/* @vite-ignore */ url));
}

/** `STORAGE_KEYS.newcomersDrafts`, spelled out: the contracts' settings module is schemas the early bundle must not carry (§11). */
export const NEWCOMER_DRAFTS_KEY = 'newcomers.drafts';

/** What another tab wrote is read again not more often than this, however often the tab is looked at. */
export const DRAFTS_REREAD_MIN_MS = 2_000;

/**
 * The local drafts of previews and «Новые» cards (NF-012, NEW-10) as R12's
 * controller keeps them: one key of storage.local every ChatSpace tab of the
 * browser shares. The lazy chunks have no browser API, so the port is made
 * here. Never ChatSpace's own storage; never a text in a log.
 *
 * A ChatSpace tab reads and writes this one key by its name and listens to
 * NO storage change: the browser hands a `storage.onChanged` listener every
 * change of the area with its old and new values — the sign-in record with
 * the hub token among them, and the hub's cached data — into the page's own
 * process (architecture.md §14: the token is the background's alone; a
 * content script is not where it may travel). What another tab wrote is read
 * when this tab is looked at again — it comes back on screen or takes the
 * focus — which is the first moment its person can see a draft at all.
 * `tools/gates` keeps a storage listener out of the tab's bundles.
 */
export function draftStoreOf(api: BrowserApi = defaultBrowser(), win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'document'> = window): DraftStore {
  const load = async (): Promise<unknown> => (await api.storage.local.get(NEWCOMER_DRAFTS_KEY))[NEWCOMER_DRAFTS_KEY];
  return {
    load,
    save: (value) => api.storage.local.set({ [NEWCOMER_DRAFTS_KEY]: value }),
    onChanged(listener) {
      const doc = win.document;
      let readAt = Number.NEGATIVE_INFINITY;
      const reread = (): void => {
        if (doc.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - readAt < DRAFTS_REREAD_MIN_MS) return;
        readAt = now;
        // A read that failed leaves what the tab holds: its next write merges with the key anyway.
        void load().then(listener, () => undefined);
      };
      doc.addEventListener('visibilitychange', reread);
      win.addEventListener('focus', reread);
      return () => {
        doc.removeEventListener('visibilitychange', reread);
        win.removeEventListener('focus', reread);
      };
    },
  };
}

const isAck = (value: unknown): value is { recorded: boolean } =>
  typeof value === 'object' && value !== null && Object.keys(value).length === 1 && typeof (value as { recorded?: unknown }).recorded === 'boolean';

export function startTabRuntime(env: TabRuntimeEnv): TabRuntime {
  const { win, life, host, probe } = env;
  const doc = win.document;

  // ── the port ───────────────────────────────────────────────────────────────
  let registry: TabPayloadValidator | null = null;
  const validate: TabPayloadValidator = (kind, type, payload) => {
    if (registry !== null) return registry(kind, type, payload);
    // A page command may come before the registry is loaded (the tab shows no chat yet): it is kept as it came
    // and checked against its schema once the application — and the registry with it — is in (below).
    if (kind === 'evt' && type === 'tab.command') return { ok: true, payload };
    if (kind !== 'res') return { ok: false };
    if (type === 'tab.register') {
      const parsed = TabRegisterResponseSchema.safeParse(payload);
      return parsed.success ? { ok: true, payload: parsed.data } : { ok: false };
    }
    return type === 'tab.presence' && isAck(payload) ? { ok: true, payload } : { ok: false };
  };
  const rpc = createTabRpcClient({
    validate,
    register: { host: 'chatspace', lateInjection: env.lateInjection, contractsVersion: CONTRACTS_VERSION },
    ...(env.api === undefined ? {} : { api: env.api }),
  });
  life.addEventListener('abort', () => rpc.close());
  /** How many times the background answered `tab.register`: more than one — it started again under this tab. */
  let registrations = 0;
  rpc.onState((state, tabSessionId) => {
    if (state === 'ready') registrations += 1;
    probe?.set('rpc', { state, registered: tabSessionId !== null, registrations });
    // The extension was reloaded or updated under the tab: this instance is done (UP-009).
    if (state === 'reloaded' || !isExtensionContextAlive(env.api)) probe?.set('runtime', 'reloaded');
    // A new tab session: the background knows nothing of this tab yet — its chat, its focus, its accounts.
    if (state === 'ready') reportPresence(true);
  });

  // ── presence (sound, «AI готово», the accounts this browser saw) ───────────
  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  let sentAccounts = '';
  let withAccounts = true;
  function reportPresence(accountsToo = false): void {
    withAccounts ||= accountsToo;
    if (presenceTimer !== null || life.aborted) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      void host.host.then((port) => {
        if (rpc.state() !== 'ready' || life.aborted) return;
        const snapshot = port.current();
        const accounts: readonly HostAccount[] = snapshot.accounts.slice(0, 200);
        const accountsText = JSON.stringify(accounts);
        const include = withAccounts || accountsText !== sentAccounts;
        withAccounts = false;
        void rpc
          .request('tab.presence', {
            chat: snapshot.route.chat,
            routeEpoch: snapshot.route.epoch,
            visible: doc.visibilityState === 'visible',
            focused: doc.hasFocus(),
            ...(include ? { accounts: [...accounts] } : {}),
          })
          .then((answer) => {
            if (answer.ok && include) sentAccounts = accountsText;
          });
      });
    }, PRESENCE_DELAY_MS);
  }
  const onVisibility = (): void => reportPresence();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', onVisibility);
  win.addEventListener('blur', onVisibility);
  // BG-003: the keepalive. Only a registered tab beats; a lost port reconnects by itself (rpc-tab.ts).
  const keepalive = setInterval(() => {
    if (rpc.state() === 'ready') reportPresence();
  }, env.keepaliveMs ?? KEEPALIVE_MS);
  life.addEventListener('abort', () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('focus', onVisibility);
    win.removeEventListener('blur', onVisibility);
    clearInterval(keepalive);
    if (presenceTimer !== null) clearTimeout(presenceTimer);
  });
  void host.host.then((port) => {
    const off = port.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') reportPresence();
    });
    life.addEventListener('abort', off);
    reportPresence(true);
  });

  // ── the application: lazy, on the first composer ───────────────────────────
  let app: Promise<TabApp> | null = null;
  const ensureApp = (): Promise<TabApp> =>
    (app ??= (async () => {
      const loadStarted = performance.now();
      const [protocol, chunk, port] = await Promise.all([loadLazy<typeof TabProtocolChunk>(LAZY.protocol), loadLazy<typeof TabAppChunk>(LAZY.app), host.host]);
      registry = protocol.parseTabPayload;
      const started = await chunk.startTabApp({
        win,
        life,
        rpc,
        host: port,
        mounts: host.mounts,
        theme: host.theme,
        keys: env.keys,
        lazy: (entry) => loadLazy(lazyPath(entry)),
        drafts: draftStoreOf(env.api, win),
        ownOrigin: extensionUrl('').replace(/\/$/, ''),
        contractsVersion: CONTRACTS_VERSION,
        lateInjection: env.lateInjection,
        staleHosts: env.staleHosts,
        setNavInsertTimeoutMs: env.setNavInsertTimeoutMs,
        takeDiagnostics: env.takeDiagnostics,
        probe,
      });
      probe?.set('app', { loadMs: performance.now() - loadStarted });
      return started;
    })());
  const wake = (): void => {
    if (life.aborted) return;
    ensureApp().catch((error: unknown) => {
      // Nothing reloads by itself (UP-016): the next composer or the next key of ours asks again.
      app = null;
      probe?.set('appError', String(error));
    });
  };
  // A click on the popup or the options page that acts here (`tab.command`, §9.9): the application is loaded for
  // it, composer or not — Spenders, «Новые» and the cheatsheet open on the whole of ChatSpace.
  const offCommand = rpc.onEvent('tab.command', (raw) => {
    if (life.aborted) return;
    ensureApp().then(
      (ready) => {
        const checked = registry?.('evt', 'tab.command', raw) ?? { ok: false as const };
        if (checked.ok) ready.command((checked.payload as typeof raw).command);
      },
      (error: unknown) => {
        app = null;
        probe?.set('appError', String(error));
      },
    );
  });
  life.addEventListener('abort', offCommand);
  const onMounts = (): void => {
    if (host.mounts.points().dock.kind !== 'none') wake();
  };
  const offMounts = host.mounts.onChange(onMounts);
  life.addEventListener('abort', offMounts);
  onMounts();

  return {
    // A token is spent by the application that issued it; without it nothing is written.
    redeem: (request) => (app === null ? Promise.resolve(false) : app.then((ready) => ready.redeem(request)).catch(() => false)),
    wake,
  };
}
