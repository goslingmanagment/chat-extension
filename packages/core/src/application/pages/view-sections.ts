// The sections of the options page besides «Статус» (architecture.md §9.9;
// ui-design §4.24, §7; ST-040…ST-136): what the hub and the browser said,
// shaped for the page. The catalog of personas is read-only; the hub address
// is shown here and changed only while signed out (ST-042); money of AI is
// nowhere outside debug.

import { type LocalSpendReport } from '@cg/contracts/diagnostics';
import { isCgCode, type CgCode, type I18nKey } from '@cg/contracts/errors';
import { HOST_KINDS, HOST_PLATFORM, type HostKind } from '@cg/contracts/hosts';
import { SOUND_TONE_IDS, hostAccountKeyOf } from '@cg/contracts/settings';
import {
  JOURNAL_KINDS,
  type AccountAdvancedVM,
  type AccountBodyVM,
  type AiSpendRowVM,
  type AiSpendVM,
  type AccountsBodyVM,
  type AppearanceBodyVM,
  type DiagnosticsBodyVM,
  type GenerationBodyVM,
  type HostPhrases,
  type HotkeysBodyVM,
  type Msg,
  type PersonasBodyVM,
  type ReasonVM,
  type SignInVM,
} from '@cg/contracts/vm';

import { coachWindowOf } from '../../domain/coach/depth';
import { formatMicroUsd } from '../../domain/debug';
import { recapByDefault } from '../../domain/settings';
import { hotkeyRows } from './hotkeys';
import { accountKeyOf, aliasesOf, boundPageOf, boundPageTagOf, button, errorOf, knownAccounts, msg, pageTagOf, personaOfPage, platformNameOf, valueOf, type PagesModel } from './model';
import { type PagePorts } from './ports';
import { siteLabel } from './site-details';
import { FEATURE_LABEL_KEYS, hubState } from './view-status';

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
      platform: platformNameOf(model, page.platform) ?? page.platform,
      persona: personaOfPage(model, page.pageId).label,
      // 1.3.0: the hub's own key of the page — what tells «Lora Vie» VIP from «Lora Vie» free.
      pageLabel: page.pageLabel,
    })),
    sdk: { contractHash: diagnostics?.hub.sdk.vendoredHash ?? null, compatible: diagnostics?.hub.sdk.compatible ?? null },
    hubErrorsToday: todayCounters(model, HUB_ERROR_PREFIXES),
    lastDossierSave: null,
    signOut: session === null ? null : button('settings.account.signOut', { type: 'SignOut' }),
    signInAgain: session === null ? null : button('settings.account.signInAgain', { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } }),
    advanced: session === null ? null : advancedVm(model),
  };
}

/** «Аккаунт → Дополнительно» (DB-027, 1.20.0): debug only, from the background's `account.advanced`. */
function advancedVm(model: PagesModel): AccountAdvancedVM | null {
  if (model.effective?.debug.enabled !== true || model.advanced === null) return null;
  const info = model.advanced;
  return {
    signIn: info.signIn,
    hosts: info.hosts.map((entry) => ({ label: siteLabel(model, entry.host), build: entry.build, contract: entry.contractOk === null ? 'unknown' : entry.contractOk ? 'ok' : 'broken' })),
    app: info.app,
  };
}

const SPEND_FEATURE_KEYS: Readonly<Record<string, I18nKey>> = FEATURE_LABEL_KEYS;

/** One row of «Расходы AI»: the numbers as a person reads them; the cost in the debug notation. */
function spendRow(model: PagesModel, feature: Msg | string, totals: LocalSpendReport['total']): AiSpendRowVM {
  const number = new Intl.NumberFormat(model.locale, { maximumFractionDigits: 0 });
  return {
    feature,
    runs: totals.runs,
    inserts: totals.inserts,
    tokens: `${number.format(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)} / ${number.format(totals.outputTokens)}`,
    cache: totals.cacheShare === null ? null : `${Math.round(totals.cacheShare * 100)} %`,
    cost: `${totals.approximate ? '≈' : ''}${formatMicroUsd(totals.costMicroUsd)}`,
  };
}

/** «Расходы AI по функциям» (DB-022, 1.20.0): this browser's journal, today and 7 days; debug only. */
function aiSpendVm(model: PagesModel): AiSpendVM | null {
  if (model.effective?.debug.enabled !== true || model.localSpend === null) return null;
  const period = (label: Msg, report: LocalSpendReport): AiSpendVM['periods'][number] => ({
    label,
    rows: report.byFeature.map((entry) => {
      const key = SPEND_FEATURE_KEYS[entry.feature];
      return spendRow(model, key === undefined ? entry.feature : msg(key), entry);
    }),
    total: spendRow(model, msg('settings.diagnostics.aiSpend.total'), report.total),
  });
  return { periods: [period(msg('settings.diagnostics.aiSpend.today'), model.localSpend.today), period(msg('settings.diagnostics.aiSpend.week'), model.localSpend.week)] };
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
        page: pageTagOf(model, page),
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

/**
 * A host account's number as a heading (ST-069): an id of up to 12 digits as it is (OnlyMonster's); a longer one — a
 * Fansly id has 18–19 — by its first and last four digits. «Скопировать номер» copies it whole.
 */
export function shortAccountId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/** What a text says for a host's name: the phrases of the site itself (R20 F9b), not the page's — a row of Fansly says «Fansly». */
function phrasesOfHost(model: PagesModel, host: HostKind): Partial<HostPhrases> {
  return model.env.platformPhrases(HOST_PLATFORM[host])?.[model.locale] ?? {};
}

export function accountsBody(model: PagesModel): AccountsBodyVM {
  // The account a tab's route is on comes first — the one «Статус» names (currentAccountOf) — then the rest at
  // work in a tab (loaded there), then the newest seen. R20 P14b1: with the live sessions a site's background
  // knows and no tab of ours reported (ST-067, AU-035).
  const seen = [...knownAccounts(model)].sort(
    (a, b) =>
      Number((b.routeTabs ?? 0) > 0) - Number((a.routeTabs ?? 0) > 0) || Number(b.openTabs > 0) - Number(a.openTabs > 0) || (a.lastSeenAt < b.lastSeenAt ? 1 : -1),
  );
  const reason = noTabReason(model);
  const labels = model.effective?.accounts.labels ?? {};
  const muted = model.effective?.sound.mutedAccounts ?? [];
  const boundPages = new Set<number>();
  const rows: AccountsBodyVM['rows'][number][] = seen.map((entry) => {
    const { host, hostAccountId } = entry.account;
    const key = accountKeyOf(entry.account);
    const bound = boundPageOf(model, entry.account);
    if (bound !== null) boundPages.add(bound.binding.pageId);
    const phrases = phrasesOfHost(model, host);
    // ST-079: the account's other ids carry what was set under them, until a change writes its own id.
    const aliases = aliasesOf(model, host, hostAccountId);
    const aliasKeys = aliases.map((alias) => hostAccountKeyOf(host, alias));
    // A site that goes to its tab its own way (R20 P14b1, ST-076) can only when a tab of it has the account.
    const own = model.siteAccounts.has(host);
    const rowReason = !own ? reason : entry.openTabs > 0 ? null : { id: 'host-degraded' as const, code: 'CG-HOST-NOT-READY' as const, text: msg('settings.accounts.toTabUnavailable', phrases) };
    return {
      accountHandle: key,
      title: entry.account.displayName ?? (entry.account.username === null ? model.t.text('popup.dialogAccount', { ...phrases, id: shortAccountId(hostAccountId) }) : `@${entry.account.username.replace(/^@/, '')}`),
      username: entry.account.username,
      localLabel: labels[key] ?? aliasKeys.map((alias) => labels[alias]).find((label) => label !== undefined) ?? null,
      status: entry.openTabs > 0 ? 'working' : 'seen',
      pageName: bound === null ? null : (bound.page?.title ?? bound.binding.pageLabel),
      page: bound === null ? null : boundPageTagOf(model, bound),
      persona: bound === null ? null : personaOfPage(model, bound.binding.pageId).label,
      muted: muted.includes(key) || aliasKeys.some((alias) => muted.includes(alias)),
      goTo: button('settings.accounts.toTab', { type: 'Navigate', to: { kind: 'account', accountHandle: key } }, { reason: rowReason }),
      ...(aliases.length === 0 ? {} : { aliases }),
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
      page: pageTagOf(model, page),
      persona: personaOfPage(model, page.pageId).label,
      muted: false,
      goTo: button('settings.accounts.toTab', { type: 'Navigate', to: { kind: 'account', accountHandle: handle } }, { reason: { id: 'host-degraded', code: 'CG-HOST-NOT-READY', text: msg('settings.accounts.noSessionsHint') } }),
    });
  }
  return { section: 'accounts', rows, ...listPhrases(model, seen.map((entry) => entry.account.host)) };
}

/**
 * What the lead and the hint of «Аккаунты» say for the sites (R20 P14b1): the list holds accounts of more than one site
 * or of another than the page's own — «Аккаунты OnlyMonster и Fansly…», «…во вкладке ChatSpace или Fansly». One site of
 * the page's own, or none: nothing — the page's phrases, as before.
 */
function listPhrases(model: PagesModel, hosts: readonly HostKind[]): Pick<AccountsBodyVM, 'phrases'> {
  const present = HOST_KINDS.filter((host) => hosts.includes(host)).map((host) => phrasesOfHost(model, host));
  const own = model.env.phrases[model.locale];
  if (present.length === 0 || (present.length === 1 && present[0]?.site === own.site)) return {};
  const join = (words: readonly (string | undefined)[], type: 'conjunction' | 'disjunction'): string =>
    new Intl.ListFormat(model.locale, { type }).format(words.filter((word): word is string => word !== undefined));
  return { phrases: { siteAccount: join(present.map((phrases) => phrases.siteAccount), 'conjunction'), site: join(present.map((phrases) => phrases.site), 'disjunction') } };
}

export function generationBody(model: PagesModel): GenerationBodyVM | null {
  const settings = model.effective;
  if (settings === null) return null;
  return {
    section: 'generation',
    windows: { ...settings.generation.windows, deepMax: valueOf(model.bootstrap)?.limits.deepMax ?? null, savedAs: model.deepSavedAs },
    split: settings.generation.split,
    // «Помнить тон в чате» (X45): absent in a store from before 1.18.0 — on.
    rememberTone: settings.generation.rememberTone !== false,
    // «Учитывать Recap» per feature (1.52.0): absent — the shared one of 1.50.0, then on.
    recapBy: { reply: recapByDefault(settings, 'reply'), fix: recapByDefault(settings, 'fix'), ping: recapByDefault(settings, 'ping'), coach: recapByDefault(settings, 'coach') },
    // 2026-10-27: Coach's own depth — absent in a store from before it: 300.
    coach: { ...settings.generation.coach, window: coachWindowOf(settings) },
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
    textSize: settings.ui.textSize ?? 'normal',
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
    aiSpend: aiSpendVm(model),
  };
}
