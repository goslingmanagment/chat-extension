// What the page controllers know (architecture.md §9.9): one plain snapshot
// of everything read from the background and the browser, from which the
// view models are built by pure functions. `null` is «неизвестно», never 0;
// a failed read keeps its error instead of posing as an empty answer.

import { type AccountAdvanced, type LocalSpendReport } from '@cg/contracts/diagnostics';
import { type CgCode, type CgErrorView, type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { HOST_KINDS, HOST_PLATFORM, type HostKind } from '@cg/contracts/hosts';
import { type Bootstrap, type BootstrapPage, type PersonaCatalog, type PersonaCatalogItem } from '@cg/contracts/hub';
import { type Locale } from '@cg/contracts/i18n/keys';
import { type HostAccount, type HubBinding, type SessionIdentity } from '@cg/contracts/ids';
import { type LogRecord } from '@cg/contracts/logs';
import { type OpView } from '@cg/contracts/ops';
import { hostAccountKeyOf, type HostAccountKey, type SettingsState, type SettingsV1 } from '@cg/contracts/settings';
import { type AiLimitSnapshot, type AiQuotaSnapshot, type DiagnosticsSnapshot, type PromptSnapshotView } from '@cg/contracts/tab-messages';
import {
  UNAVAILABLE_REASONS,
  type ActionButtonVM,
  type ColorScheme,
  type HotkeyLabel,
  type I18nParams,
  type JournalKind,
  type Msg,
  type PageTagVM,
  type ReasonVM,
  type UiAction,
  type UnavailableReasonId,
  type VmView,
} from '@cg/contracts/vm';

import { errorView } from '../../domain/errors';
import { defaultPersonaOf } from '../../domain/personas';
import { type Translator } from '../../domain/i18n';
import { type OptionsLocation, type PageEnv, type SiteAccountsFacts } from './ports';
import { type SaveStatus } from './settings-writer';

/** One read: nothing asked yet, asked, answered, or refused with its error. */
export type Slot<T> =
  | { readonly s: 'idle' }
  | { readonly s: 'loading'; readonly since: number; readonly last: T | null }
  | { readonly s: 'ok'; readonly value: T; readonly at: number }
  | { readonly s: 'error'; readonly error: CgErrorWire; readonly at: number; readonly last: T | null };

export const IDLE: Slot<never> = { s: 'idle' };

/** The read was answered at least once (a refresh in flight still shows the last answer). */
export function answered<T>(slot: Slot<T>): boolean {
  return slot.s === 'ok' || (slot.s === 'loading' && slot.last !== null);
}

/** The value a slot holds or last held. */
export function valueOf<T>(slot: Slot<T>): T | null {
  if (slot.s === 'ok') return slot.value;
  if (slot.s === 'loading' || slot.s === 'error') return slot.last;
  return null;
}

/** The error of a sign-in state that could not be read and was never known — neither signed in nor signed out; null otherwise. */
export function sessionUnknownError(model: Pick<PagesModel, 'session' | 'sessionKnown'>): CgErrorWire | null {
  return model.session.s === 'error' && !model.sessionKnown ? model.session.error : null;
}

/** Nobody is signed in, as the background said: not an unread or failed read. */
export function signedOutOf(model: Pick<PagesModel, 'session' | 'sessionKnown'>): boolean {
  return model.sessionKnown && valueOf(model.session) === null;
}

export interface SeenAccount {
  readonly account: HostAccount;
  readonly lastSeenAt: string;
  /** Tabs whose ChatSpace has it loaded (one tab loads every account of the person). */
  readonly openTabs: number;
  /** Tabs whose route is on it now; absent — a background before contracts 1.8.0 did not count them. */
  readonly routeTabs?: number | undefined;
}

export type BindingSlot = { readonly ok: true; readonly binding: HubBinding } | { readonly ok: false; readonly error: CgErrorWire };

/** Why the last sign-in ended, for the banner of the sign-in screen (AU-015). */
export type SessionEnd = 'revoked' | 'expired' | 'signed-out' | 'sign-out-unconfirmed' | null;

export interface JournalData {
  readonly records: readonly LogRecord[];
  readonly truncated: boolean;
  readonly runs: readonly { readonly runId: string; readonly startedAt: string; readonly events: number }[] | null;
}

export interface PagesModel {
  readonly env: PageEnv;
  readonly now: number;
  readonly locale: Locale;
  readonly t: Translator;
  /** The background answered nothing at all: CG-RUNTIME-UNREACHABLE (PU-001), never an endless spinner. */
  readonly unreachable: boolean;
  readonly settings: Slot<SettingsState>;
  /** The confirmed settings with the changes still being saved on top. */
  readonly effective: SettingsV1 | null;
  readonly save: SaveStatus;
  readonly session: Slot<SessionIdentity | null>;
  /**
   * The sign-in state was read at least once. Until then a failed read is
   * «unknown», never «nobody is signed in» (PU-002): `valueOf(session)` is
   * null in both cases, this flag tells them apart.
   */
  readonly sessionKnown: boolean;
  readonly sessionEnd: SessionEnd;
  readonly signIn: { readonly busy: boolean; readonly login: string; readonly error: CgErrorWire | null };
  readonly bootstrap: Slot<Bootstrap>;
  readonly catalog: Slot<PersonaCatalog>;
  readonly diagnostics: Slot<DiagnosticsSnapshot>;
  readonly accounts: Slot<readonly SeenAccount[]>;
  /** R20 P14b1: what each site's background told «Аккаунты» (`PagePorts.siteAccounts`); absent — no such site, or not read. */
  readonly siteAccounts: ReadonlyMap<HostKind, Slot<SiteAccountsFacts | null>>;
  readonly bindings: ReadonlyMap<HostAccountKey, BindingSlot>;
  /** Per hub page; null — the background has seen no generation on it yet. */
  readonly quotas: ReadonlyMap<number, AiQuotaSnapshot | null>;
  /** `ai-limit-v1`: the person's own daily AI limit; absent or null — none, or not known yet. */
  readonly aiLimit?: AiLimitSnapshot | null;
  readonly ops: Slot<readonly OpView[]>;
  /** `technicalAndInteraction`: null — the browser could not tell. */
  readonly consent: boolean | null;
  /** Host access to the hub address on screen; null — not answered for this address (yet), never a guess. */
  readonly hubAccess: boolean | null;
  /** Host access to ChatSpace; null — the browser has not answered. */
  readonly hostAccess: boolean | null;
  readonly check: {
    readonly running: boolean;
    readonly lastAt: number | null;
    /** «Проверить всё» not more often than every 10 s (ST-033). */
    readonly allowedAt: number;
    /** The round trip of the last forced bootstrap read. */
    readonly latencyMs: number | null;
  };
  readonly sound: { readonly tested: boolean; readonly error: CgErrorWire | null };
  /** The deep window the controller had to cut to the hub's limit, once the background confirmed that write: the «сохранено как N» chip. */
  readonly deepSavedAs: number | null;
  readonly location: OptionsLocation;
  readonly systemScheme: ColorScheme;
  /** Popup: new subscribers of the open page in the default window; null — unknown. */
  readonly newcomers: number | null;
  /** Popup (X61): «Перезагрузить вкладку» is running — the background reloads the old build's tabs, the popup waits for them. */
  readonly reloadingHost: boolean;
  /**
   * 1.20.0 (decision X47): the fans' names the tabs already told the background (`fans.labels`), by chat key — the
   * popup and «Идут сейчас» name the fan by them; empty — none known (the id stands in).
   */
  readonly fanLabels: ReadonlyMap<string, string>;
  /** 2026-10-22: the @handles of those fans an open chat's tab knows (without «@»), by chat key. */
  readonly fanUsernames: ReadonlyMap<string, string>;
  /** 1.20.0 (DB-022): this browser's AI spend by feature, today and 7 days; debug only, options page. null — not read. */
  readonly localSpend: { readonly today: LocalSpendReport; readonly week: LocalSpendReport } | null;
  /** 1.20.0 (DB-027): «Аккаунт → Дополнительно»; debug only, options page. null — not read or off. */
  readonly advanced: AccountAdvanced | null;
  readonly prompts: ReadonlyMap<string, Slot<PromptSnapshotView>>;
  readonly journals: ReadonlyMap<JournalKind, Slot<JournalData>>;
}

// ── small builders every view shares ───────────────────────────────────────

export const msg = (key: I18nKey, params?: I18nParams): Msg => (params === undefined ? { key } : { key, params });

export function errorOf(model: Pick<PagesModel, 't'>, wire: CgErrorWire): CgErrorView {
  return errorView(wire, model.t);
}

export function codeError(model: Pick<PagesModel, 't'>, code: CgCode, detail?: string): CgErrorView {
  return errorView(detail === undefined ? { code } : { code, detail }, model.t);
}

export function reasonOf(id: UnavailableReasonId, params?: I18nParams): ReasonVM {
  const entry = UNAVAILABLE_REASONS[id];
  return { id, code: entry.code, text: msg(entry.key, params) };
}

export function button(label: I18nKey | Msg, action: UiAction, extra: { readonly reason?: ReasonVM | null; readonly hotkey?: HotkeyLabel | null } = {}): ActionButtonVM {
  const reason = extra.reason ?? null;
  return { label: typeof label === 'string' ? msg(label) : label, action, enabled: reason === null, reason, hotkey: extra.hotkey ?? null };
}

export const READY: VmView = { s: 'ready' };

// ── reading the model ──────────────────────────────────────────────────────

export function accountKeyOf(account: Pick<HostAccount, 'host' | 'hostAccountId'>): HostAccountKey {
  return hostAccountKeyOf(account.host, account.hostAccountId);
}

export interface OpenChat {
  readonly conversationRef?: string;
  readonly host: HostAccount['host'];
  readonly hostAccountId: string;
  readonly platformFanId: string;
}

/** A site of the extension (`HOST_KINDS`): a key or a handle read back names no other. */
export const isHostKind = (value: string | undefined): value is HostKind => (HOST_KINDS as readonly (string | undefined)[]).includes(value);

/** `<host>:<account>:<fan>` → its parts; null for anything else. */
export function parseChatKey(key: string | null): OpenChat | null {
  if (key === null) return null;
  const parts = key.split(':');
  const [host, hostAccountId, platformFanId] = parts;
  if (parts.length !== 3 || !isHostKind(host) || hostAccountId === undefined || platformFanId === undefined) return null;
  return { host, hostAccountId, platformFanId };
}

/** The first ChatSpace tab with an open chat, as the background lists them. */
export function openChatOf(model: PagesModel): OpenChat | null {
  for (const tab of valueOf(model.diagnostics)?.tabs ?? []) {
    const chat = parseChatKey(tab.chatKey);
    if (chat !== null) return tab.conversationRef === undefined ? chat : { ...chat, conversationRef: tab.conversationRef };
  }
  return null;
}

/**
 * The account the person works under now: the open chat's; else the one a tab's route is on (`/accounts/<id>/…`
 * with no chat open — ChatSpace loads every account of the person, so being loaded in a tab does not say which
 * one is in front of them, AU-034); else the first one loaded in a tab; else the last seen.
 */
export function currentAccountOf(model: PagesModel): SeenAccount | null {
  const seen = valueOf(model.accounts) ?? [];
  const chat = openChatOf(model);
  if (chat !== null) {
    const match = seen.find((entry) => entry.account.host === chat.host && entry.account.hostAccountId === chat.hostAccountId);
    if (match !== undefined) return match;
  }
  const routed = seen.find((entry) => (entry.routeTabs ?? 0) > 0);
  if (routed !== undefined) return routed;
  const open = seen.find((entry) => entry.openTabs > 0);
  if (open !== undefined) return open;
  return [...seen].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))[0] ?? null;
}

/** A site's facts for «Аккаунты» as last read; null — none (no such site, the site is off, not read yet). */
export function siteFactsOf(model: Pick<PagesModel, 'siteAccounts'>, host: HostKind): SiteAccountsFacts | null {
  const slot = model.siteAccounts.get(host);
  return slot === undefined ? null : valueOf(slot);
}

/**
 * The other ids of a host account (ST-079): the legacy ids its site's sessions name for it. A label and a model's sound
 * set under one of them belong to the account; a change writes the account's own id and clears them.
 */
export function aliasesOf(model: Pick<PagesModel, 'siteAccounts'>, host: HostKind, hostAccountId: string): readonly string[] {
  const facts = siteFactsOf(model, host);
  if (facts === null) return [];
  return [...new Set(facts.sessions.filter((session) => session.id === hostAccountId).flatMap((session) => session.aliases))].filter((alias) => alias !== hostAccountId);
}

/**
 * Every account «Аккаунты» lists (R20 P14b1; ST-067, AU-035): the ones the tabs reported, then the live sessions of a
 * site none of them names — by its id or an alias. A session of a reported account adds its open tabs: the account is
 * at work in a tab that never registered (opened before the site was switched on).
 */
export function knownAccounts(model: Pick<PagesModel, 'accounts' | 'siteAccounts'>): readonly SeenAccount[] {
  const out: SeenAccount[] = [...(valueOf(model.accounts) ?? [])];
  for (const [host, slot] of model.siteAccounts) {
    const facts = valueOf(slot);
    if (facts === null) continue;
    for (const session of facts.sessions) {
      const ids = [session.id, ...session.aliases];
      const seenAt = new Date(session.observedAt).toISOString();
      const index = out.findIndex((entry) => entry.account.host === host && ids.includes(entry.account.hostAccountId));
      const known = out[index];
      if (known !== undefined) {
        out[index] = { ...known, openTabs: Math.max(known.openTabs, session.tabs), lastSeenAt: known.lastSeenAt < seenAt ? seenAt : known.lastSeenAt };
        continue;
      }
      const account: HostAccount = { host, hostAccountId: session.id, platform: HOST_PLATFORM[host], platformAccountId: session.platformAccountId, username: null, displayName: null };
      out.push({ account, lastSeenAt: seenAt, openTabs: session.tabs, routeTabs: 0 });
    }
  }
  return out;
}

export function pageById(model: PagesModel, pageId: number): BootstrapPage | null {
  return valueOf(model.bootstrap)?.pages.find((page) => page.pageId === pageId) ?? null;
}

export interface PagePersona {
  /** `set` — an active persona; `archived` and `missing` ask for a replacement; `none` — nothing chosen. */
  readonly s: 'set' | 'archived' | 'missing' | 'none';
  readonly key: string | null;
  readonly label: string | null;
  readonly item: PersonaCatalogItem | null;
}

/** The persona the person chose for a hub page, read against the catalog (ST-073, ST-074). */
export function personaOfPage(model: PagesModel, pageId: number): PagePersona {
  const chosen = model.effective?.personas.byPageId[String(pageId)];
  if (chosen === undefined) {
    // Telegram spec §5.5: a page the person assigned nothing to works with the persona the hub means it for.
    const meant = defaultPersonaOf(pageById(model, pageId), valueOf(model.catalog)?.personas ?? []);
    return meant === null ? { s: 'none', key: null, label: null, item: null } : { s: 'set', key: meant.key, label: meant.displayName, item: meant };
  }
  const item = valueOf(model.catalog)?.personas.find((persona) => persona.key === chosen.key) ?? null;
  // Without the catalog the choice is neither confirmed nor refuted: shown by its key, not called missing.
  if (item === null) return answered(model.catalog) ? { s: 'missing', key: chosen.key, label: null, item: null } : { s: 'set', key: chosen.key, label: chosen.key, item: null };
  return { s: item.status === 'archived' ? 'archived' : 'set', key: item.key, label: item.displayName, item };
}

/** The hub page a seen account is bound to, when `binding.resolve` said so. */
export function boundPageOf(model: PagesModel, account: HostAccount): { readonly binding: HubBinding; readonly page: BootstrapPage | null } | null {
  const slot = model.bindings.get(accountKeyOf(account));
  if (slot === undefined || !slot.ok) return null;
  return { binding: slot.binding, page: pageById(model, slot.binding.pageId) };
}

/**
 * A hub page's platform as people name it (R20 F9b): the phrase of the site that serves it, in the page's language;
 * null — no site of the pages serves the platform (an open token of the hub: it is printed as it is).
 */
export function platformNameOf(model: Pick<PagesModel, 'env' | 'locale'>, platform: string): string | null {
  return model.env.platformPhrases(platform)?.[model.locale].sitePlatform ?? null;
}

/**
 * What tells a hub page from another of the same title (1.3.0, `PageTagVM`): its platform token, as people name it
 * (1.15.0), and the hub's page label. An owner may have «Lora Vie» on one platform twice and on another once.
 * Display only (AU-023).
 */
export function pageTagOf(model: Pick<PagesModel, 'env' | 'locale'>, page: Pick<BootstrapPage, 'platform' | 'pageLabel'>): PageTagVM {
  const platformName = platformNameOf(model, page.platform);
  return { platform: page.platform, pageLabel: page.pageLabel, ...(platformName === null ? {} : { platformName }) };
}

/** The tag of the page a host account is bound to: the bootstrap's page, or — when it no longer lists it — the binding's own. */
export function boundPageTagOf(model: Pick<PagesModel, 'env' | 'locale'>, bound: { readonly binding: HubBinding; readonly page: BootstrapPage | null }): PageTagVM {
  return pageTagOf(model, bound.page ?? bound.binding);
}

export const OP_RUNNING_STATES: readonly OpView['state'][] = ['admitted', 'requesting', 'streaming'];

export function runningOps(model: PagesModel): readonly OpView[] {
  return (valueOf(model.ops) ?? []).filter((op) => OP_RUNNING_STATES.includes(op.state));
}

/** `https://gosling-agency.ru` → `gosling-agency.ru`; the string as it is when it is no URL. */
export function hostOfOrigin(origin: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(origin);
  return match?.[1] ?? origin;
}

/** Quota at or under this is «мало» (PU-009). */
export const QUOTA_LOW = 20;
