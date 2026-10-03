// TEMPORARY (integration step M1; R16 builds the pages' controllers and view
// models): what the minimal options page and the status popup need, over the
// page side of the protocol (architecture.md §5.4: requests through
// `runtime.sendMessage`, events through a `cg-page` port). No hub, no storage,
// no network here — a page only asks the background.

import type { CgCode, CgErrorView, CgErrorWire } from '@cg/contracts/errors';
import type { HostContractReport } from '@cg/contracts/host';
import type { UiLocale, UiTheme } from '@cg/contracts/settings';
import { parseTabPayload } from '@cg/contracts/tab-messages';
import type { ColorScheme, MountDeps, SurfaceGeometry } from '@cg/contracts/vm';
import { createAppRouter, createUnboundCatalog } from '@cg/core/application';
import { errorView } from '@cg/core/domain/errors';
import { createI18n, createTranslator, resolveLocale } from '@cg/core/domain/i18n';
import { createExtensionPages, createHostPermissions, createPageRpcClient, writeClipboardText } from '@cg/platform';
import type { TempPagePort, TempPageStatus } from '@cg/ui';
import { SettableSignal, mediaSchemeSignal, resolvedSchemeSignal } from '@cg/ui/kit';

/** Bindings shown on the temporary status (the real «Аккаунты» section is R16's). */
const BINDINGS_SHOWN = 12;
/** A status read is not repeated more often than this (events may come in a burst). */
const REFRESH_GAP_MS = 300;

export interface TempPage {
  readonly port: TempPagePort;
  readonly deps: MountDeps;
  dispose(): void;
}

type ContractState = TempPageStatus['contracts'][number]['state'];

/** Capabilities part B of the host adapter turns on later (X8, the WS tap): off by design for now. */
const PART_B = ['previewSend', 'incoming', 'receipt', 'sendObserve'];
/** Without these nothing of ours works in the tab. */
const VITAL = ['identity', 'route', 'accounts'];

function contractState(report: HostContractReport | null): ContractState {
  if (report === null) return 'unknown';
  const states = Object.entries(report.capabilities).filter(([name]) => !PART_B.includes(name));
  if (states.some(([name, value]) => value.state === 'contractBroken' || (VITAL.includes(name) && value.state === 'off'))) return 'broken';
  return states.some(([, value]) => value.state !== 'on') ? 'degraded' : 'ok';
}

export function createTempPage(win: Window): TempPage {
  const rpc = createPageRpcClient({ validate: parseTabPayload });
  const permissions = createHostPermissions();
  const pages = createExtensionPages();

  // texts and the scheme of the page (an extension page: both catalogs, `host` means `system`)
  const theme = new SettableSignal<UiTheme>('host');
  let locale: UiLocale = 'system';
  const i18n = createI18n({ language: resolveLocale(locale, win.navigator.languages) });
  const viewOf = (wire: CgErrorWire): CgErrorView => errorView(wire, createTranslator(i18n.language));
  const system = mediaSchemeSignal(win.matchMedia('(prefers-color-scheme: dark)'));
  const scheme = resolvedSchemeSignal(theme, null, system);
  const geometry = new SettableSignal<SurfaceGeometry>({ width: win.innerWidth, feedHeight: null, viewportHeight: win.innerHeight, container: null });

  const status = new SettableSignal<TempPageStatus | null>(null);

  async function read(): Promise<TempPageStatus> {
    const [session, settings, diagnostics] = await Promise.all([rpc.request('session.get', {}), rpc.request('settings.get', {}), rpc.request('diagnostics.get', {})]);
    if (settings.ok) {
      theme.set(settings.payload.settings.ui.theme);
      if (settings.payload.settings.ui.locale !== locale) {
        locale = settings.payload.settings.ui.locale;
        i18n.setLanguage(resolveLocale(locale, win.navigator.languages));
      }
    }
    const version = diagnostics.ok ? diagnostics.payload.extension.version : '';
    const testBuild = diagnostics.ok && diagnostics.payload.extension.testBuild;
    const hubUrl = settings.ok ? settings.payload.settings.hub.baseUrl : '';
    if (!session.ok) {
      return { version, testBuild, reachable: false, error: viewOf(session.error), session: null, hubUrl, hub: null, bootstrap: null, bindings: [], contracts: [] };
    }
    const signedIn = session.payload.session;
    const hub: TempPageStatus['hub'] =
      !diagnostics.ok || diagnostics.payload.hub.reachable === null
        ? null
        : { ok: diagnostics.payload.hub.reachable, error: diagnostics.payload.hub.lastError === null ? null : viewOf(diagnostics.payload.hub.lastError) };
    const contracts = diagnostics.ok ? diagnostics.payload.tabs.map((tab) => ({ build: tab.host?.build ?? null, state: contractState(tab.host) })) : [];

    let bootstrap: TempPageStatus['bootstrap'] = null;
    const bindings: { account: string; page: string | null; code: CgCode | null; openTabs: number }[] = [];
    if (signedIn !== null) {
      const [boot, seen] = await Promise.all([rpc.request('bootstrap.get', {}), rpc.request('accounts.seen', {})]);
      bootstrap = boot.ok
        ? { ok: true, pages: boot.payload.pages.map((page) => page.pageLabel), configRevision: boot.payload.configRevision, error: null }
        : { ok: false, pages: [], configRevision: null, error: viewOf(boot.error) };
      for (const item of seen.ok ? seen.payload.accounts.slice(0, BINDINGS_SHOWN) : []) {
        const bound = await rpc.request('binding.resolve', { account: item.account });
        bindings.push({ account: item.account.hostAccountId, page: bound.ok ? bound.payload.binding.pageLabel : null, code: bound.ok ? null : bound.error.code, openTabs: item.openTabs });
      }
    }
    return {
      version,
      testBuild,
      reachable: true,
      error: null,
      session: signedIn === null ? null : { login: signedIn.login, role: signedIn.role },
      hubUrl,
      hub,
      bootstrap,
      bindings,
      contracts,
    };
  }

  let reading = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function refresh(): void {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    void read()
      .then((next) => status.set(next))
      .finally(() => {
        reading = false;
        if (!again) return;
        again = false;
        if (timer === null) {
          timer = setTimeout(() => {
            timer = null;
            refresh();
          }, REFRESH_GAP_MS);
        }
      });
  }

  const offs = [
    rpc.onEvent('session.changed', refresh),
    rpc.onEvent('bootstrap.changed', refresh),
    rpc.onEvent('settings.changed', refresh),
    rpc.onEvent('flags.changed', refresh),
  ];
  refresh();

  const port: TempPagePort = {
    status,
    refresh,
    async signIn(login, password) {
      const answer = await rpc.request('session.signIn', { login, password });
      refresh();
      return answer.ok ? null : viewOf(answer.error);
    },
    async signOut() {
      const answer = await rpc.request('session.signOut', {});
      refresh();
      return answer.ok ? null : viewOf(answer.error);
    },
    async saveHubUrl(url) {
      // Asked first and synchronously in the click: the browser shows its prompt only inside a user gesture (§3).
      const granted = await permissions.request(url);
      if (!granted) return viewOf({ code: /^https?:\/\/[^/]+$/.test(url) ? 'CG-HUB-HOST-PERMISSION' : 'CG-HUB-URL' });
      const answer = await rpc.request('settings.patchRestricted', { patch: { hub: { baseUrl: url } }, baseRevision: null });
      refresh();
      return answer.ok ? null : viewOf(answer.error);
    },
    openOptions() {
      void pages.open('options');
    },
  };

  const deps: MountDeps = {
    // The pages' controllers are R16's: nothing is served through AppClient yet.
    client: createAppRouter({ errorOf: (code) => viewOf({ code }) }),
    i18n,
    catalog: createUnboundCatalog(/mac/i.test(win.navigator.platform) ? 'mac' : 'win'),
    toasts: { show: () => '', dismiss: () => undefined },
    dialogs: { confirm: () => Promise.resolve('cancel') },
    clipboard: { writeText: async (text) => ((await writeClipboardText(text)).ok ? { ok: true } : { ok: false, code: 'CG-CLIPBOARD' }) },
    scheme: scheme satisfies { readonly value: ColorScheme },
    geometry,
    focus: { token: null, restore: () => false },
    marks: { resultShown: () => undefined, painted: () => undefined },
  };

  return {
    port,
    deps,
    dispose() {
      for (const off of offs) off();
      if (timer !== null) clearTimeout(timer);
      scheme.dispose();
      system.dispose();
      rpc.close();
    },
  };
}
