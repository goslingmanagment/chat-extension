// What the page controllers know (architecture.md §9.9): one plain snapshot
// of everything read from the background and the browser, from which the
// view models are built by pure functions. `null` is «неизвестно», never 0;
// a failed read keeps its error instead of posing as an empty answer.

import { type CgCode, type CgErrorView, type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { type Bootstrap, type BootstrapPage, type PersonaCatalog, type PersonaCatalogItem } from '@cg/contracts/hub';
import { type Locale } from '@cg/contracts/i18n/keys';
import { type HostAccount, type HubBinding, type SessionIdentity } from '@cg/contracts/ids';
import { type LogRecord } from '@cg/contracts/logs';
import { type OpView } from '@cg/contracts/ops';
import { hostAccountKeyOf, type HostAccountKey, type SettingsState, type SettingsV1 } from '@cg/contracts/settings';
import { type AiQuotaSnapshot, type DiagnosticsSnapshot, type PromptSnapshotView } from '@cg/contracts/tab-messages';
import {
  UNAVAILABLE_REASONS,
  type ActionButtonVM,
  type ColorScheme,
  type HotkeyLabel,
  type I18nParams,
  type JournalKind,
  type Msg,
  type ReasonVM,
  type UiAction,
  type UnavailableReasonId,
  type VmView,
} from '@cg/contracts/vm';

import { errorView } from '../../domain/errors';
import { type Translator } from '../../domain/i18n';
import { type OptionsLocation, type PageEnv } from './ports';
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

export interface SeenAccount {
  readonly account: HostAccount;
  readonly lastSeenAt: string;
  readonly openTabs: number;
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
  readonly sessionEnd: SessionEnd;
  readonly signIn: { readonly busy: boolean; readonly login: string; readonly error: CgErrorWire | null };
  readonly bootstrap: Slot<Bootstrap>;
  readonly catalog: Slot<PersonaCatalog>;
  readonly diagnostics: Slot<DiagnosticsSnapshot>;
  readonly accounts: Slot<readonly SeenAccount[]>;
  readonly bindings: ReadonlyMap<HostAccountKey, BindingSlot>;
  /** Per hub page; null — the background has seen no generation on it yet. */
  readonly quotas: ReadonlyMap<number, AiQuotaSnapshot | null>;
  readonly ops: Slot<readonly OpView[]>;
  /** `technicalAndInteraction`: null — the browser could not tell. */
  readonly consent: boolean | null;
  /** Host access to the hub address in the settings. */
  readonly hubAccess: boolean | null;
  /** Host access to ChatSpace. */
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
  /** The deep window the controller had to cut to the hub's limit: the «сохранено как N» chip. */
  readonly deepSavedAs: number | null;
  readonly location: OptionsLocation;
  readonly systemScheme: ColorScheme;
  /** Popup: new subscribers of the open page in the default window; null — unknown. */
  readonly newcomers: number | null;
  /** Popup, debug only: today's own AI spend from the hub, micro-USD. */
  readonly aiTodayMicroUsd: number | null;
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
  readonly host: HostAccount['host'];
  readonly hostAccountId: string;
  readonly platformFanId: string;
}

/** `chatspace:<account>:<fan>` → its parts; null for anything else. */
export function parseChatKey(key: string | null): OpenChat | null {
  if (key === null) return null;
  const parts = key.split(':');
  const [host, hostAccountId, platformFanId] = parts;
  if (parts.length !== 3 || (host !== 'chatspace' && host !== 'fansly-web') || hostAccountId === undefined || platformFanId === undefined) return null;
  return { host, hostAccountId, platformFanId };
}

/** The first ChatSpace tab with an open chat, as the background lists them. */
export function openChatOf(model: PagesModel): OpenChat | null {
  for (const tab of valueOf(model.diagnostics)?.tabs ?? []) {
    const chat = parseChatKey(tab.chatKey);
    if (chat !== null) return chat;
  }
  return null;
}

/** The account the person works under now: the open chat's, else the first one open in a tab, else the last seen. */
export function currentAccountOf(model: PagesModel): SeenAccount | null {
  const seen = valueOf(model.accounts) ?? [];
  const chat = openChatOf(model);
  if (chat !== null) {
    const match = seen.find((entry) => entry.account.host === chat.host && entry.account.hostAccountId === chat.hostAccountId);
    if (match !== undefined) return match;
  }
  const open = seen.find((entry) => entry.openTabs > 0);
  if (open !== undefined) return open;
  return [...seen].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))[0] ?? null;
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
  if (chosen === undefined) return { s: 'none', key: null, label: null, item: null };
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
