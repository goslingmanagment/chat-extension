// The sections of the options page besides «Статус» (architecture.md §9.9;
// ui-design §4.24, §7; ST-040…ST-136): what the hub and the browser said,
// shaped for the page. The catalog of personas is read-only; the hub address
// is shown here and changed only while signed out (ST-042); money of AI is
// nowhere outside debug.

import { isCgCode, type CgCode } from '@cg/contracts/errors';
import { SOUND_TONE_IDS } from '@cg/contracts/settings';
import {
  JOURNAL_KINDS,
  type AccountBodyVM,
  type AccountsBodyVM,
  type AppearanceBodyVM,
  type DiagnosticsBodyVM,
  type GenerationBodyVM,
  type HotkeysBodyVM,
  type PersonasBodyVM,
  type ReasonVM,
  type SignInVM,
} from '@cg/contracts/vm';

import { hotkeyRows } from './hotkeys';
import { accountKeyOf, boundPageOf, boundPageTagOf, button, errorOf, msg, pageTagOf, personaOfPage, valueOf, type PagesModel } from './model';
import { type PagePorts } from './ports';
import { PLATFORM_NAMES, hubState } from './view-status';

/** Opaque handles: a hub page and a host account, as the controller reads them back. */
export const pageHandleOf = (pageId: number): string => `page-${String(pageId)}`;

export function pageIdOfHandle(handle: string): number | null {
  const match = /^page-([1-9]\d{0,15})$/.exec(handle);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Errors of the hub and of the sign-in, counted today (ST-056). */
const HUB_ERROR_PREFIXES = ['CG-HUB-', 'CG-AUTH-', 'CG-LOGIN-'] as const;

function todayCounters(model: PagesModel, prefixes: readonly string[] | null): { code: CgCode; count: number }[] {
  return Object.entries(valueOf(model.diagnostics)?.counters ?? {})
    .filter((entry): entry is [CgCode, number] => isCgCode(entry[0]) && entry[1] > 0 && (prefixes === null || prefixes.some((prefix) => entry[0].startsWith(prefix))))
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
}

export function accountBody(model: PagesModel): AccountBodyVM {
  const session = valueOf(model.session);
  const diagnostics = valueOf(model.diagnostics);
  const bootstrap = valueOf(model.bootstrap);
  return {
    section: 'account',
    hub: {
      origin: model.effective?.hub.baseUrl ?? '',
      // What the browser said about the address on screen; no answer yet is «неизвестно», never a guess (ST-043, DB-028).
      hostPermission: model.hubAccess === null ? 'unknown' : model.hubAccess ? 'granted' : 'missing',
      // Asking is safe either way: the browser answers at once when the access is there.
      requestPermission: model.hubAccess === true ? null : button('settings.account.grantAccess', { type: 'RequestPermission', kind: 'hub-host' }),
    },
    connection: {
      s: hubState(model),
      latencyMs: model.check.latencyMs,
      checkedAt: model.check.lastAt ?? (diagnostics?.hub.lastCheckedAt === null || diagnostics === null ? null : Date.parse(diagnostics.hub.lastCheckedAt)),
    },
    // When the device signed in is known only to the background's sign-in record, which pages do not see.
    user: session === null ? null : { login: session.login, role: session.role, deviceSince: null },
    pages: (bootstrap?.pages ?? []).map((page) => ({
      pageName: page.title,
      platform: PLATFORM_NAMES[page.platform] ?? page.platform,
      persona: personaOfPage(model, page.pageId).label,
      // 1.3.0: the hub's own key of the page — what tells «Lora Vie» VIP from «Lora Vie» free.
      pageLabel: page.pageLabel,
    })),
    sdk: { contractHash: diagnostics?.hub.sdk.vendoredHash ?? null, compatible: diagnostics?.hub.sdk.compatible ?? null },
    hubErrorsToday: todayCounters(model, HUB_ERROR_PREFIXES),
    lastDossierSave: null,
    signOut: session === null ? null : button('settings.account.signOut', { type: 'SignOut' }),
    signInAgain: session === null ? null : button('settings.account.signInAgain', { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } }),
  };
}

export function signInVm(model: PagesModel): SignInVM {
  return {
    hubOrigin: model.effective?.hub.baseUrl ?? '',
    login: model.signIn.login,
    busy: model.signIn.busy,
    error: model.signIn.error === null ? null : errorOf(model, model.signIn.error),
  };
}

export function personasBody(model: PagesModel): PersonasBodyVM {
  const catalog = valueOf(model.catalog)?.personas ?? [];
  const pages = valueOf(model.bootstrap)?.pages ?? [];
  const chosenKeys = new Set(pages.map((page) => personaOfPage(model, page.pageId).key).filter((key): key is string => key !== null));
  const active = catalog.filter((persona) => persona.status === 'active');
  return {
    section: 'personas',
    // An archived persona nobody uses is not shown (ST-060); one a page still uses asks for a replacement (ST-061).
    catalog: catalog
      .filter((persona) => persona.status === 'active' || chosenKeys.has(persona.key))
      .map((persona) => ({ key: persona.key, label: persona.displayName, archived: persona.status === 'archived' })),
    pages: pages.map((page) => {
      const persona = personaOfPage(model, page.pageId);
      const pageHandle = pageHandleOf(page.pageId);
      return {
        pageHandle,
        pageName: page.title,
        // 1.3.0: pages of one title are told apart by their platform and the hub's page label.
        page: pageTagOf(page),
        persona: persona.label,
        replacementNeeded: persona.s === 'archived' || persona.s === 'missing',
        choices: active.map((choice) => ({ key: choice.key, label: choice.displayName, choose: { type: 'ChoosePersona', pageHandle, personaKey: choice.key } })),
      };
    }),
    syncedAt: model.catalog.s === 'ok' ? new Date(model.catalog.at).toISOString() : null,
  };
}

/** «к вкладке» needs a ChatSpace tab to act in (Б13): without one the button says why. */
function noTabReason(model: PagesModel): ReasonVM | null {
  const tabs = valueOf(model.diagnostics)?.tabs.length ?? 0;
  return tabs > 0 ? null : { id: 'host-degraded', code: 'CG-HOST-NOT-READY', text: msg('settings.accounts.toTabUnavailable') };
}

export function accountsBody(model: PagesModel): AccountsBodyVM {
  const seen = [...(valueOf(model.accounts) ?? [])].sort((a, b) => Number(b.openTabs > 0) - Number(a.openTabs > 0) || (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
  const reason = noTabReason(model);
  const boundPages = new Set<number>();
  const rows: AccountsBodyVM['rows'][number][] = seen.map((entry) => {
    const key = accountKeyOf(entry.account);
    const bound = boundPageOf(model, entry.account);
    if (bound !== null) boundPages.add(bound.binding.pageId);
    return {
      accountHandle: key,
      title: entry.account.displayName ?? (entry.account.username === null ? model.t.text('popup.dialogAccount', { id: entry.account.hostAccountId }) : `@${entry.account.username.replace(/^@/, '')}`),
      username: entry.account.username,
      localLabel: model.effective?.accounts.labels[key] ?? null,
      status: entry.openTabs > 0 ? 'working' : 'seen',
      pageName: bound === null ? null : (bound.page?.title ?? bound.binding.pageLabel),
      page: bound === null ? null : boundPageTagOf(bound),
      persona: bound === null ? null : personaOfPage(model, bound.binding.pageId).label,
      muted: model.effective?.sound.mutedAccounts.includes(key) ?? false,
      goTo: button('settings.accounts.toTab', { type: 'Navigate', to: { kind: 'account', accountHandle: key } }, { reason }),
    };
  });
  // Hub pages this browser has never opened an account for: «нет сессий» (ST-067).
  const seenCreators = new Set(seen.map((entry) => entry.account.platformAccountId).filter((id): id is string => id !== null));
  for (const page of valueOf(model.bootstrap)?.pages ?? []) {
    if (boundPages.has(page.pageId) || (page.platformAccountId !== null && seenCreators.has(page.platformAccountId))) continue;
    const handle = pageHandleOf(page.pageId);
    rows.push({
      accountHandle: handle,
      title: page.title,
      username: null,
      localLabel: null,
      status: 'no-sessions',
      pageName: page.title,
      page: pageTagOf(page),
      persona: personaOfPage(model, page.pageId).label,
      muted: false,
      goTo: button('settings.accounts.toTab', { type: 'Navigate', to: { kind: 'account', accountHandle: handle } }, { reason: { id: 'host-degraded', code: 'CG-HOST-NOT-READY', text: msg('settings.accounts.noSessionsHint') } }),
    });
  }
  return { section: 'accounts', rows };
}

export function generationBody(model: PagesModel): GenerationBodyVM | null {
  const settings = model.effective;
  if (settings === null) return null;
  return {
    section: 'generation',
    windows: { ...settings.generation.windows, deepMax: valueOf(model.bootstrap)?.limits.deepMax ?? null, savedAs: model.deepSavedAs },
    split: settings.generation.split,
    coach: { ...settings.generation.coach },
    debug: { ...settings.debug },
  };
}

export function hotkeysBody(model: PagesModel, ports: Pick<PagePorts, 'catalog'>): HotkeysBodyVM {
  const platform = ports.catalog?.platform ?? model.env.hotkeyPlatform;
  return { section: 'hotkeys', platform, rows: hotkeyRows(platform, ports.catalog) };
}

export function appearanceBody(model: PagesModel): AppearanceBodyVM | null {
  const settings = model.effective;
  if (settings === null) return null;
  const sound = valueOf(model.diagnostics)?.sound ?? null;
  return {
    section: 'appearance',
    theme: settings.ui.theme,
    systemScheme: model.systemScheme,
    locale: settings.ui.locale,
    hints: settings.ui.hints,
    resultStyle: settings.ui.resultStyle,
    sound: {
      messages: { ...settings.sound.messages },
      subscribers: { ...settings.sound.subscribers },
      volume: settings.sound.volume,
      tones: SOUND_TONE_IDS,
      test: {
        messages: button('settings.appearance.testSound', { type: 'TestSound', which: 'messages' }),
        subscribers: button('settings.appearance.testSound', { type: 'TestSound', which: 'subscribers' }),
      },
      status: {
        listeningTabs: sound?.listeningTabs ?? null,
        lastIncomingAt: sound === null || sound.lastIncomingAt === null ? null : Date.parse(sound.lastIncomingAt),
        outcomes: sound?.outcomes ?? {},
        error: model.sound.error === null ? null : errorOf(model, model.sound.error),
      },
    },
  };
}

export function diagnosticsBody(model: PagesModel): DiagnosticsBodyVM {
  const diagnostics = valueOf(model.diagnostics);
  const footprint = diagnostics?.footprint ?? null;
  return {
    section: 'diagnostics',
    cachesKB: footprint?.cachesKB ?? null,
    logsKB: footprint?.logsKB ?? (diagnostics === null ? null : Math.round(diagnostics.logs.bytes / 1024)),
    export: button('settings.diagnostics.export', { type: 'ExportDiagnostics' }),
    clear: button('settings.diagnostics.clear', { type: 'ClearLocalData', confirmed: true }),
    counters: todayCounters(model, null),
    journals: model.effective?.debug.enabled === true ? JOURNAL_KINDS.map((journal) => ({ journal, open: { type: 'Navigate', to: { kind: 'journal', journal } } })) : null,
  };
}
