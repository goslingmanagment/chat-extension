// The tab's runtime — the part of the early isolated bundle that starts one
// task after document_start (architecture.md §2, §5.4, §11): the `cg-tab`
// port, the tab's registration, presence, and the loader of the lazy chunks.
//
// It stays light on purpose (§11: the early bundle ≤ 30 KiB): the request
// registry of the tab protocol alone is 26 KiB, so before the application is
// loaded the port checks only the two answers it needs — `tab.register` (its
// own light schema) and the acknowledgement of `tab.presence`. Everything
// else waits for the lazy chunks, and those load when ChatSpace shows a
// composer, never outside a chat (EX-011).

import { CONTRACTS_VERSION } from '@cg/contracts';
import type { HostAccount } from '@cg/contracts/ids';
import { TabRegisterResponseSchema } from '@cg/contracts/tab-protocol';
import type { HostDiagnostic, MountDiagnostic, StartedChatSpaceHost, TokenRedeemer } from '@cg/host-chatspace/isolated';
import { createTabRpcClient, extensionUrl, isExtensionContextAlive, type TabPayloadValidator } from '@cg/platform';

import type * as TabAppChunk from '../../../lazy/entries/tab-app';
import type * as TabProtocolChunk from '../../../lazy/entries/tab-protocol';
import type { TabApp } from './app';
import { importWithRetry } from './lazy';
import type { TabProbe } from './probe';

/** Lazy ESM chunks, loaded with import(moz-extension://…) — see lazy/vite.config.ts. */
export const LAZY = {
  protocol: 'lazy/tab-protocol.js',
  app: 'lazy/tab-app.js',
  dock: 'lazy/dock.js',
  i18n: (language: string): string => `lazy/i18n-${language}.js`,
} as const;

/** Presence reports are coalesced: a burst of route, focus and account events is one request. */
const PRESENCE_DELAY_MS = 200;

export interface TabRuntimeEnv {
  readonly win: Window;
  readonly life: AbortSignal;
  readonly abort: (reason: string) => void;
  readonly host: StartedChatSpaceHost;
  readonly lateInjection: boolean;
  readonly staleHosts: number;
  readonly probe: TabProbe | null;
  readonly setNavInsertTimeoutMs: (ms: number) => void;
  /** Hands over what the host reported so far and where the rest goes. */
  readonly takeDiagnostics: (listener: (diagnostic: HostDiagnostic | MountDiagnostic) => void) => (HostDiagnostic | MountDiagnostic)[];
}

export interface TabRuntime {
  redeem: TokenRedeemer;
}

/** Loads a lazy chunk; one retry under `?retry` (EX-009). */
export function loadLazy<T>(path: string): Promise<T> {
  return importWithRetry<T>(extensionUrl(path), (url) => import(/* @vite-ignore */ url));
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
    if (kind !== 'res') return { ok: false };
    if (type === 'tab.register') {
      const parsed = TabRegisterResponseSchema.safeParse(payload);
      return parsed.success ? { ok: true, payload: parsed.data } : { ok: false };
    }
    return type === 'tab.presence' && isAck(payload) ? { ok: true, payload } : { ok: false };
  };
  const rpc = createTabRpcClient({ validate, register: { host: 'chatspace', lateInjection: env.lateInjection, contractsVersion: CONTRACTS_VERSION } });
  life.addEventListener('abort', () => rpc.close());
  rpc.onState((state, tabSessionId) => {
    probe?.set('rpc', { state, registered: tabSessionId !== null });
    // The extension was reloaded or updated under the tab: this instance is done (UP-009).
    if (state === 'reloaded' || !isExtensionContextAlive()) probe?.set('runtime', 'reloaded');
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
  life.addEventListener('abort', () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('focus', onVisibility);
    win.removeEventListener('blur', onVisibility);
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
        lazy: loadLazy,
        chunks: LAZY,
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
  const onMounts = (): void => {
    if (host.mounts.points().dock.kind === 'none' || life.aborted) return;
    ensureApp().catch((error: unknown) => {
      // Nothing reloads by itself (UP-016): the next composer asks again.
      app = null;
      probe?.set('appError', String(error));
    });
  };
  const offMounts = host.mounts.onChange(onMounts);
  life.addEventListener('abort', offMounts);
  onMounts();

  return {
    // A token is spent by the application that issued it; without it nothing is written.
    redeem: (request) => (app === null ? Promise.resolve(false) : app.then((ready) => ready.redeem(request)).catch(() => false)),
  };
}
