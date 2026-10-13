// «Статус» of the options page (architecture.md §9.9; ui-design §4.24;
// ST-020…ST-038): the readiness line, one row per thing a shift depends on,
// and the report for the team lead. Every row says what is known and since
// when; an unknown is «неизвестно», never a guess (DB-028). Nothing here
// asks a site anything: the host rows come from what the tabs reported —
// one row per site in use (R20 F7), each read by its site's expected anchors.

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { contractAnchorsOf, contractHostOf, type HostContractReport, type HostContractShape } from '@cg/contracts/host';
import { type HostKind } from '@cg/contracts/hosts';
import { type ClientFeatureFlag } from '@cg/contracts/hub';
import { type SendFuse } from '@cg/contracts/send';
import { type DiagnosticsSnapshot } from '@cg/contracts/tab-messages';
import { SEND_FUSE_UNCERTAIN_RUN, sendFuseHolds, type SendFuseReason } from '@cg/contracts/send-rules';
import { type I18nPlainParams, type I18nTextKey } from '@cg/contracts/i18n/catalog';
import { type I18n, type Msg, type RunningOpVM, type StatusBodyVM, type StatusRowVM, type UiAction } from '@cg/contracts/vm';

import { anchorGap, anchorsNotYet, expectedAnchors, previewSendFused, previewSendWaitsForChat, receiptMatchOf, siteCapabilitiesOf } from '../../domain/host';
import { flagStateOf, somePageFlagState, type FlagState } from '../../domain/ops/flags';
import { flagReasonVm } from '../flag-reason';

import {
  QUOTA_LOW,
  accountKeyOf,
  answered,
  boundPageOf,
  button,
  currentAccountOf,
  errorOf,
  hostOfOrigin,
  msg,
  personaOfPage,
  reasonOf,
  runningOps,
  valueOf,
  type PagesModel,
  type SeenAccount,
} from './model';
import { type PageSite } from './ports';

/** The rows' names; a site's row is named by its site (`PageSite.texts.title`). */
const ROW_TITLE = {
  extension: 'settings.status.row.extension',
  hub: 'settings.status.row.hub',
  account: 'settings.status.row.account',
  binding: 'settings.status.row.binding',
  persona: 'settings.status.row.persona',
  quota: 'settings.status.row.quota',
  running: 'settings.status.row.running',
  'last-error': 'settings.status.row.lastError',
  spenders: 'settings.status.row.spenders',
  sound: 'settings.status.row.sound',
  contract: 'settings.status.row.contract',
  'preview-send': 'settings.status.row.previewSend',
  consent: 'settings.status.row.consent',
  support: 'settings.status.row.support',
} as const satisfies Record<Exclude<StatusRowVM['id'], 'host'>, string>;

function row(id: Exclude<StatusRowVM['id'], 'host'>, level: StatusRowVM['level'], value: string | Msg, note: string | Msg | null = null, action: StatusRowVM['action'] = null): StatusRowVM {
  return { id, level, title: msg(ROW_TITLE[id]), value, note, action };
}

/** A site's row (R20 F7): one per site in use, named by its site. */
function siteRowOf(site: PageSite, level: StatusRowVM['level'], value: string | Msg, note: string | Msg | null = null): StatusRowVM {
  return { id: 'host', host: site.kind, level, title: msg(site.texts.title), value, note, action: null };
}

const goTo = (section: 'account' | 'accounts' | 'personas'): UiAction => ({ type: 'OpenSettings', route: { section } });

export const PLATFORM_NAMES: Readonly<Record<string, string>> = { onlyfans: 'OnlyFans', fansly: 'Fansly' };

export const ROLE_KEYS = {
  owner: 'settings.role.owner',
  team_lead: 'settings.role.teamLead',
  chatter: 'settings.role.chatter',
  unknown: 'settings.role.unknown',
} as const;

export const FEATURE_LABEL_KEYS = {
  reply: 'dock.action.reply',
  fix: 'dock.action.fix',
  hi: 'dock.action.hi',
  ping: 'dock.action.ping',
  review: 'dock.action.review',
  recap: 'dock.action.recap',
  'recap-short': 'dock.action.recap',
  coach: 'dock.action.coach',
} as const satisfies Record<FeatureId, string>;

/**
 * What a host report lacks, read by its site's expected anchors (`shape`, R20 F7; FS-CTR-1: an expected anchor the
 * report does not name is `missing`; null — the site is not known here: the anchors the report names): anchors that
 * are gone or changed (`missing`, `shape`) and capabilities the contract check closed. An anchor of a part the owner
 * switches on separately (ChatSpace: the WebSocket tap, X8's receipt profile) is `missing` while its switch is off
 * (§6.2: nothing of that part is in the page) — the normal state of a shift, not a site that changed; what is wrong
 * with it while the switch is on its capabilities say (`incoming` degraded, the X8 row names a missing profile). An
 * anchor the site has not created yet (`notYet`: ChatSpace's composer translator store before the page's first chat
 * composer) is no gap — the site's row says what it waits for instead.
 *
 * `insert` — whether the dock writes a part into the field, by the dock's own rule (ai/workspace.ts): it is
 * copy-only without the `insert` capability and without the host's identity (the route and the account), and
 * nothing else of the report takes «Вставить» away. «Статус» and the popup say «через „Копировать“» by this
 * one fact, so a lost anchor of something else (the send queue, the chat list) is not called a lost insert.
 */
export function hostGaps(report: HostContractReport, shape: HostContractShape | null): { readonly anchors: string[]; readonly broken: string[]; readonly insert: boolean } {
  const switched = shape?.switchedAnchors ?? [];
  const anchors = expectedAnchors(report, shape)
    .filter(([anchor, state]) => anchorGap(state) && !switched.includes(anchor))
    .map(([anchor]) => anchor);
  const broken = [...Object.entries(report.capabilities), ...Object.entries(siteCapabilitiesOf(report))]
    .filter(([, capability]) => capability.state === 'contractBroken' || capability.state === 'degraded')
    .map(([name]) => name);
  const on = (capability: 'insert' | 'identity' | 'route'): boolean => report.capabilities[capability]?.state === 'on';
  return { anchors, broken, insert: on('insert') && on('identity') && on('route') };
}

type DiagnosticsTab = DiagnosticsSnapshot['tabs'][number];

/** The site of a tab: as it registered; a background before 1.15.0 names none — its report's, else the build's first site. */
function siteOfTab(model: PagesModel, tab: DiagnosticsTab): HostKind | null {
  return tab.site ?? (tab.host === null ? (model.env.sites[0]?.kind ?? null) : contractHostOf(tab.host));
}

/** The site of a report, as this build knows it; null — a site the build does not carry. */
export function siteOfReport(model: PagesModel, report: HostContractReport): PageSite | null {
  const kind = contractHostOf(report);
  return model.env.sites.find((site) => site.kind === kind) ?? null;
}

/**
 * The report of the tab the person most likely looks at — of one site, or of any: the one with an open chat, else
 * the first that reported; and how many tabs (of the site) there are.
 */
export function hostReportOf(model: PagesModel, site?: HostKind): { readonly tabs: number; readonly report: HostContractReport | null } | null {
  const diagnostics = valueOf(model.diagnostics);
  if (diagnostics === null) return null;
  const tabs = site === undefined ? diagnostics.tabs : diagnostics.tabs.filter((tab) => siteOfTab(model, tab) === site);
  const withChat = tabs.find((tab) => tab.chatKey !== null && tab.host !== null);
  const any = tabs.find((tab) => tab.host !== null);
  return { tabs: tabs.length, report: withChat?.host ?? any?.host ?? null };
}

/**
 * The sites «Статус» has a row for (R20 F7): each with an open tab or an account bound to a hub page; none in use —
 * every site of the build (today that is ChatSpace alone, as it always was).
 */
export function statusSites(model: PagesModel): readonly PageSite[] {
  const tabs = valueOf(model.diagnostics)?.tabs ?? [];
  const bound = (valueOf(model.accounts) ?? []).filter((entry) => model.bindings.get(accountKeyOf(entry.account))?.ok === true);
  const used = model.env.sites.filter((site) => tabs.some((tab) => siteOfTab(model, tab) === site.kind) || bound.some((entry) => entry.account.host === site.kind));
  return used.length > 0 ? used : model.env.sites;
}

/** Codes that mean «the hub did not answer», as opposed to «the hub answered with a refusal». */
export const HUB_UNREACHABLE_CODES: readonly CgCode[] = ['CG-HUB-UNAVAILABLE', 'CG-HUB-TIMEOUT', 'CG-NETWORK', 'CG-TIMEOUT', 'CG-LOGIN-UNAVAILABLE', 'CG-LOGIN-TIMEOUT'];

/** `ok` — the hub answered; `down` — it did not; `unknown` — nobody asked yet. */
export function hubState(model: PagesModel): 'ok' | 'down' | 'unknown' {
  // The page's own question first: a refusal «the hub did not answer» is the freshest word there is.
  if (model.bootstrap.s === 'error') return HUB_UNREACHABLE_CODES.includes(model.bootstrap.error.code) ? 'down' : 'ok';
  // Then the background's word about the connection: a bootstrap it still serves may be a cached one.
  const reachable = valueOf(model.diagnostics)?.hub.reachable ?? null;
  if (reachable === false) return 'down';
  if (reachable === true || answered(model.bootstrap)) return 'ok';
  return 'unknown';
}

/** A site's row: closed, being checked, connected, or partly checked — its report read by its own expected anchors. */
function siteRow(model: PagesModel, site: PageSite): StatusRowVM {
  const texts = site.texts;
  const host = hostReportOf(model, site.kind);
  if (host === null) return siteRowOf(site, 'unknown', msg('common.unknown'));
  if (host.tabs === 0) return siteRowOf(site, 'warn', msg(texts.closed), msg(texts.closedNote));
  if (host.report === null) return siteRowOf(site, 'unknown', msg(texts.checking));
  const build = host.report.build ?? '—';
  const gaps = hostGaps(host.report, site.contract);
  const missing = [...gaps.anchors, ...gaps.broken];
  if (missing.length === 0) {
    // Connected. Before the page's first chat ChatSpace has not created what the preview send reads: said as a note.
    const note = previewSendWaitsForChat(host.report) ? msg(texts.notYetNote) : msg(texts.checked, { time: { time: host.report.checkedAt } });
    return siteRowOf(site, 'ok', msg(texts.value, { build }), note);
  }
  // 1.5.0: «Вставка работает через „Копировать“» only when the dock really is copy-only.
  return siteRowOf(site, 'warn', msg(texts.partial, { build }), msg(gaps.insert ? texts.partialNote : texts.copyOnlyNote, { missing: missingAnchors(gaps) }));
}

/** «Не найдено: …» of a partly checked site: the anchors and the closed capabilities, each name once, the first eight. */
export function missingAnchors(gaps: { readonly anchors: readonly string[]; readonly broken: readonly string[] }): string {
  return [...new Set([...gaps.anchors, ...gaps.broken])].slice(0, 8).join(', ');
}

function hubRow(model: PagesModel): StatusRowVM {
  const origin = model.effective?.hub.baseUrl ?? null;
  if (origin === null) return row('hub', 'unknown', msg('common.unknown'));
  const host = hostOfOrigin(origin);
  if (model.hubAccess === false) {
    const error = errorOf(model, { code: 'CG-HUB-HOST-PERMISSION' });
    return row('hub', 'error', msg('settings.status.row.hubNoAccess', { host }), error.body, button('settings.account.grantAccess', { type: 'RequestPermission', kind: 'hub-host' }));
  }
  const state = hubState(model);
  if (state === 'down') {
    const wire = model.bootstrap.s === 'error' ? model.bootstrap.error : (valueOf(model.diagnostics)?.hub.lastError ?? { code: 'CG-HUB-UNAVAILABLE' as const });
    return row('hub', 'error', msg('settings.status.row.hubDown', { host }), errorOf(model, wire).body);
  }
  // The hub answered, but refused what the page needs (an outdated build, no rights): its own words.
  if (model.bootstrap.s === 'error') {
    const view = errorOf(model, model.bootstrap.error);
    return row('hub', 'error', msg('settings.status.row.hubRefused', { host }), `${view.title}. ${view.body}`);
  }
  if (state === 'unknown') return row('hub', 'unknown', msg('settings.status.row.hubUnknown', { host }));
  return row('hub', 'ok', msg('settings.status.row.hubValue', { host }), model.check.latencyMs === null ? null : msg('settings.status.row.hubLatency', { ms: model.check.latencyMs }));
}

function accountRow(model: PagesModel): StatusRowVM {
  const session = valueOf(model.session);
  if (model.session.s === 'idle' || (model.session.s === 'loading' && session === null)) return row('account', 'unknown', msg('common.unknown'));
  if (session === null) return row('account', 'error', msg('settings.status.row.accountNone'), null, button('common.signIn', goTo('account')));
  const pages = valueOf(model.bootstrap)?.pages.length ?? null;
  const role = model.t.text(ROLE_KEYS[session.role]);
  return row(
    'account',
    'ok',
    session.login,
    pages === null ? role : msg('settings.status.row.accountNote', { role, n: pages }),
    button('settings.status.go.account', goTo('account')),
  );
}

function otherBound(model: PagesModel, current: SeenAccount): number {
  return (valueOf(model.accounts) ?? []).filter((entry) => entry !== current && model.bindings.get(accountKeyOf(entry.account))?.ok === true).length;
}

function bindingRow(model: PagesModel): StatusRowVM {
  const action = button('settings.status.go.accounts', goTo('accounts'));
  if (model.accounts.s === 'idle' || (model.accounts.s === 'loading' && valueOf(model.accounts) === null)) return row('binding', 'unknown', msg('common.unknown'));
  const current = currentAccountOf(model);
  if (current === null) return row('binding', 'warn', msg('settings.status.row.bindingNoAccount'), msg('settings.status.row.bindingNoAccountNote'), action);
  const id = current.account.hostAccountId;
  const slot = model.bindings.get(accountKeyOf(current.account));
  if (slot === undefined) return row('binding', 'unknown', msg('settings.status.row.bindingChecking', { id }), null, action);
  if (!slot.ok) return row('binding', 'error', msg('settings.status.row.bindingMissing', { id }), errorOf(model, slot.error).body, action);
  const bound = boundPageOf(model, current.account);
  const page = bound?.page?.title ?? slot.binding.pageLabel;
  const platform = PLATFORM_NAMES[slot.binding.platform] ?? slot.binding.platform;
  const handle = current.account.username === null ? id : `@${current.account.username.replace(/^@/, '')}`;
  const others = otherBound(model, current);
  return row(
    'binding',
    'ok',
    msg('settings.status.row.bindingValue', { id, page }),
    others === 0 ? msg('settings.status.row.bindingOnly', { platform, handle }) : msg('settings.status.row.bindingOthers', { platform, handle, n: others }),
    action,
  );
}

function personaRow(model: PagesModel): StatusRowVM {
  const action = button('settings.status.go.personas', goTo('personas'));
  const current = currentAccountOf(model);
  const bound = current === null ? null : boundPageOf(model, current.account);
  if (bound === null) return row('persona', 'unknown', msg('settings.status.row.personaNoPage'), null, action);
  const page = bound.page?.title ?? bound.binding.pageLabel;
  const persona = personaOfPage(model, bound.binding.pageId);
  switch (persona.s) {
    case 'set':
      return row('persona', 'ok', persona.label ?? '', msg('settings.status.row.personaFor', { page }), action);
    case 'none':
      return row('persona', 'error', msg('settings.status.row.personaNone'), msg('cg.personaUnassigned.page', { page }), action);
    case 'archived':
      return row('persona', 'error', msg('settings.status.row.personaArchived', { persona: persona.label ?? '' }), msg('settings.status.row.personaReplace'), action);
    case 'missing':
      return row('persona', 'error', msg('settings.personas.notFound'), msg('settings.status.row.personaReplace'), action);
  }
}

/** Quotas of the pages the seen accounts are bound to, the worst first (ST-028). */
export function pageQuotas(model: PagesModel): { readonly page: string; readonly remaining: number | null; readonly resetsAt: string | null }[] {
  const out: { page: string; remaining: number | null; resetsAt: string | null }[] = [];
  const seenPages = new Set<number>();
  for (const entry of valueOf(model.accounts) ?? []) {
    const bound = boundPageOf(model, entry.account);
    if (bound === null || seenPages.has(bound.binding.pageId)) continue;
    seenPages.add(bound.binding.pageId);
    const quota = model.quotas.get(bound.binding.pageId) ?? null;
    out.push({ page: bound.page?.title ?? bound.binding.pageLabel, remaining: quota?.remainingRequestsToday ?? null, resetsAt: quota?.resetsAt ?? null });
  }
  const rank = (remaining: number | null): number => (remaining === null ? Number.MAX_SAFE_INTEGER : remaining);
  return out.sort((a, b) => rank(a.remaining) - rank(b.remaining));
}

function quotaRow(model: PagesModel): StatusRowVM {
  const quotas = pageQuotas(model);
  const known = quotas.filter((quota) => quota.remaining !== null);
  const worst = known[0];
  if (worst === undefined || worst.remaining === null) return row('quota', 'unknown', msg('settings.status.row.quotaUnknown'), msg('settings.status.row.quotaUnknownNote'));
  const reset = model.t.text('settings.status.row.quotaReset');
  const note = known.length > 1 ? `${known.map((quota) => `${quota.page}: ${String(quota.remaining)}`).join(', ')}. ${reset}` : msg('settings.status.row.quotaReset');
  return row('quota', worst.remaining <= QUOTA_LOW ? 'warn' : 'ok', msg('settings.status.row.quotaLeft', { n: worst.remaining }), note);
}

function fanOf(model: PagesModel, fanRef: string): string {
  return model.t.text('settings.status.fanId', { id: fanRef });
}

export function runningVms(model: PagesModel): RunningOpVM[] {
  return runningOps(model).map((op) => ({
    opId: op.opId,
    feature: op.feature,
    // The protocol gives pages no fan names: the id is all a page knows.
    fanLabel: null,
    startedAt: op.startedAt,
    inThisTab: false,
    go: { type: 'Navigate', to: { kind: 'account', accountHandle: accountKeyOf(op.target.chat) } },
    cancel: { type: 'CancelGeneration', operationId: op.opId },
  }));
}

function runningRow(model: PagesModel): StatusRowVM {
  if (model.ops.s === 'idle' || (model.ops.s === 'loading' && valueOf(model.ops) === null)) return row('running', 'unknown', msg('common.unknown'));
  const ops = runningOps(model);
  if (ops.length === 0) return row('running', 'ok', msg('settings.status.row.runningNone'));
  const items = ops.map((op) => model.t.text('settings.status.row.runningItem', { feature: model.t.text(FEATURE_LABEL_KEYS[op.feature]), fan: fanOf(model, op.target.fanRef) }));
  return row('running', 'ok', msg('settings.status.row.runningCount', { n: ops.length }), `${items.join(', ')}.`);
}

function lastErrorRow(model: PagesModel): StatusRowVM | null {
  const hub = valueOf(model.diagnostics)?.hub;
  const wire = hub?.lastError ?? null;
  if (hub === undefined || wire === null) return null;
  const view = errorOf(model, wire);
  const value = hub.lastCheckedAt === null ? msg('common.errorSource', { code: view.code }) : msg('settings.status.row.lastErrorValue', { code: view.code, time: { time: hub.lastCheckedAt } });
  return row('last-error', 'warn', value, `${view.title}. ${view.body}`, button('common.copyCode', { type: 'CopyReport', scope: 'error', code: view.code }));
}

function soundRow(model: PagesModel): StatusRowVM {
  const settings = model.effective;
  const sound = valueOf(model.diagnostics)?.sound ?? null;
  if (settings === null || sound === null) return row('sound', 'unknown', msg('common.unknown'));
  if (!settings.sound.messages.on && !settings.sound.subscribers.on) return row('sound', 'ok', msg('settings.status.row.soundOff'));
  const note = sound.lastIncomingAt === null ? msg('settings.status.row.soundNever') : msg('settings.status.row.soundLast', { time: { time: sound.lastIncomingAt } });
  if (sound.listeningTabs === 0) return row('sound', 'ok', msg('settings.status.row.soundNoTabs'), note);
  return row('sound', 'ok', msg('settings.status.row.soundOn', { n: sound.listeningTabs }), note);
}

function contractRow(model: PagesModel): StatusRowVM | null {
  if (model.effective?.debug.enabled !== true) return null;
  const report = hostReportOf(model)?.report ?? null;
  if (report === null) return row('contract', 'unknown', msg('common.unknown'));
  // The tab in front, of whichever site: read by that site's expected anchors.
  const shape = siteOfReport(model, report)?.contract ?? null;
  const gaps = hostGaps(report, shape);
  const value = msg('settings.status.row.contractValue', { adapter: report.adapterVersion, build: report.build ?? '—' });
  const later = anchorsNotYet(report, shape);
  // 1.11.0: the receipt profile that let X8 in, and how — a reviewed build or the hub's «any build» sentinel.
  const match = receiptMatchOf(report);
  const receipt: PlainNote | null = match === null ? null : { key: match.kind === 'anyBuild' ? 'settings.status.row.contractReceiptAnyBuild' : 'settings.status.row.contractReceiptExact', params: { profile: match.profile } };
  const note = (base: PlainNote): string | Msg => notes(model, base, receipt) ?? msg(base.key, base.params);
  if (gaps.anchors.length === 0 && later.length > 0) return row('contract', 'ok', value, note({ key: 'settings.status.row.contractNotYet', params: { anchors: later.join(', ') } }));
  if (gaps.anchors.length === 0) return row('contract', 'ok', value, note({ key: 'settings.status.row.contractOk', params: { n: shape?.anchors.length ?? Object.keys(contractAnchorsOf(report)).length } }));
  return row('contract', 'warn', value, note({ key: 'settings.status.row.contractMissing', params: { missing: gaps.anchors.join(', ') } }));
}

/** A note with plain parameters only (no times, no money): it can be joined with another as text. */
interface PlainNote {
  readonly key: I18nTextKey;
  readonly params?: I18nPlainParams;
}

/** Two notes of one row, the second when there is one; a single note stays a message (null — none). */
function notes(model: PagesModel, first: PlainNote | null, second: PlainNote | null): string | Msg | null {
  if (first === null || second === null) {
    const one = first ?? second;
    return one === null ? null : msg(one.key, one.params);
  }
  return `${model.t.text(first.key, first.params)} ${model.t.text(second.key, second.params)}`;
}

/** The reason of a tripped X8 fuse in plain words (decision X25). */
const FUSE_REASON_KEYS = {
  text: 'settings.status.fuse.reason.text',
  count: 'settings.status.fuse.reason.count',
  target: 'settings.status.fuse.reason.target',
  uncertain: 'settings.status.fuse.reason.uncertain',
} as const satisfies Record<SendFuseReason, string>;

/**
 * The X8 fuse that holds the preview send off for the person (decision X25): the browser's fuse, when it holds the
 * build of the tab in front of them (no tab: whatever it holds), or a trip a tab's host reports before the
 * background has heard of it. `fuse` — what the background keeps (null — it has not heard yet).
 */
export function fusedNow(model: PagesModel): { readonly fuse: SendFuse | null } | null {
  const fuse = valueOf(model.diagnostics)?.sendFuse?.fuse ?? null;
  const report = hostReportOf(model)?.report ?? null;
  if (report !== null && previewSendFused(report)) return { fuse };
  if (fuse !== null && (report === null || sendFuseHolds(fuse, report.build))) return { fuse };
  return null;
}

/**
 * An owner switch as «Статус» reads it (docs/protocols/hub.md «Флаги: решает страница»): the feature of the
 * page the account in front of the person is bound to; with no such page — whether it is usable on at least one
 * granted page. Never the bootstrap's top-level `flags`: they are the owner's `"*"` row alone, and an owner who
 * pilots one page leaves it empty. null — no bootstrap.
 */
export function statusFlag(model: PagesModel, flag: ClientFeatureFlag): FlagState | null {
  const bootstrap = valueOf(model.bootstrap);
  if (bootstrap === null) return null;
  const current = currentAccountOf(model);
  const bound = current === null ? null : boundPageOf(model, current.account);
  return bound === null ? somePageFlagState(bootstrap, flag) : flagStateOf(bootstrap, bound.binding.pageId, flag);
}

/**
 * «Отправка из превью» (X8): off; on — and on what (1.11.0, decision X25): a reviewed ChatSpace build (an exact
 * receipt profile) or a build nobody reviewed (the hub's «any build» sentinel), as the tab in front of the person
 * reports it; or off by the fuse, with why, when, on which build, and «Сбросить предохранитель».
 */
function previewSendRow(model: PagesModel): StatusRowVM | null {
  const bootstrap = valueOf(model.bootstrap);
  const flag = statusFlag(model, 'previewSend');
  if (bootstrap === null || flag === null) return null;
  const on = flag.usable && bootstrap.limits.previewSendReceiptProfiles.length > 0;
  const sends = valueOf(model.diagnostics)?.sends ?? null;
  const counts: PlainNote | null = sends === null ? null : { key: 'settings.status.row.previewSendNote', params: { open: sends.open, uncertain: sends.uncertain } };
  const level = sends !== null && sends.uncertain > 0 ? 'warn' : 'ok';
  if (!on) return row('preview-send', level, msg('settings.status.row.previewSendOff'), notes(model, counts, null));
  const fused = fusedNow(model);
  if (fused !== null) {
    // Why, when and on which build it tripped; null — the tab tripped it and the background has not heard yet.
    const fuse = fused.fuse;
    const why =
      fuse === null
        ? null
        : msg(fuse.build === null ? 'settings.status.row.previewSendFusedEveryNote' : 'settings.status.row.previewSendFusedNote', {
            reason: model.t.text(FUSE_REASON_KEYS[fuse.reason], { n: SEND_FUSE_UNCERTAIN_RUN }),
            time: { time: fuse.trippedAt, style: 'datetime' },
            build: fuse.build ?? '—',
          });
    return row('preview-send', 'warn', msg('settings.status.row.previewSendFused'), why, button('settings.status.fuse.reset', { type: 'ResetSendFuse' }));
  }
  const report = hostReportOf(model)?.report ?? null;
  const match = report === null ? null : receiptMatchOf(report);
  if (match?.kind === 'anyBuild') {
    // A person must see that X8 runs on a build nobody reviewed (decision X25).
    return row('preview-send', level, msg('settings.status.row.previewSendAnyBuild'), notes(model, { key: 'settings.status.row.previewSendAnyBuildNote', params: { profile: match.profile } }, counts));
  }
  if (match?.kind === 'exact') return row('preview-send', level, msg('settings.status.row.previewSendExact', { profile: match.profile }), notes(model, counts, null));
  return row('preview-send', level, msg('settings.status.row.previewSendOn'), notes(model, counts, null));
}

function spendersRow(model: PagesModel): StatusRowVM | null {
  const flag = statusFlag(model, 'spenders');
  if (flag === null) return null;
  if (flag.usable) return row('spenders', 'ok', msg('settings.status.row.spendersOn'));
  // «Выключен владельцем» is the flag itself; any other reason (the page as a whole, the platform, no binding) is said in its own words.
  return row('spenders', 'ok', msg('settings.status.row.spendersOff'), flag.reason === 'flag_off' ? null : flagReasonVm(flag).text);
}

function consentRow(model: PagesModel): StatusRowVM {
  const note = msg('settings.status.consentNote');
  if (model.consent === null) return row('consent', 'unknown', msg('common.unknown'), note);
  if (model.consent) return row('consent', 'ok', msg('settings.status.consentOn'), note);
  return row('consent', 'warn', msg('settings.status.consentOff'), note, button('settings.status.consentAsk', { type: 'RequestPermission', kind: 'data-collection' }));
}

/** Tabs still on the scripts of the version before the update (UP-009); 0 — none or not counted. */
function staleTabsOf(model: PagesModel): number {
  return valueOf(model.diagnostics)?.extension.updated?.staleTabs ?? 0;
}

/** «Версия 0.4.3» and, when the background knows it, when this version came and from which one. */
function extensionRow(model: PagesModel): StatusRowVM {
  const value = msg('settings.status.row.extensionValue', { v: model.env.version });
  const updated = valueOf(model.diagnostics)?.extension.updated;
  if (updated === undefined) return row('extension', 'ok', value);
  const stale = staleTabsOf(model);
  // Tabs on the old scripts matter more than when the update came: the row asks to reload them (UP-009).
  if (stale > 0) return row('extension', 'warn', value, msg('settings.status.row.extensionStaleTabs', { n: stale }));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: model.env.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day.format(new Date(updated.at)) !== day.format(new Date(model.now))) {
    return row('extension', 'ok', value, msg('settings.status.row.extensionUpdatedOn', { date: { time: updated.at, style: 'date' }, from: updated.from }));
  }
  // «Вкладки перезагружены» is said only when the background counted them and found none on the old scripts.
  return row('extension', 'ok', value, msg(updated.staleTabs === 0 ? 'settings.status.row.extensionUpdated' : 'settings.status.row.extensionUpdatedToday', { time: { time: updated.at }, from: updated.from }));
}

export function statusRows(model: PagesModel): StatusRowVM[] {
  const schema = model.effective?.schemaVersion ?? null;
  const rows: (StatusRowVM | null)[] = [
    extensionRow(model),
    ...statusSites(model).map((site) => siteRow(model, site)),
    hubRow(model),
    accountRow(model),
    bindingRow(model),
    personaRow(model),
    quotaRow(model),
    runningRow(model),
    lastErrorRow(model),
    spendersRow(model),
    soundRow(model),
    contractRow(model),
    previewSendRow(model),
    consentRow(model),
    row('support', 'ok', schema === null ? msg('settings.status.row.extensionValue', { v: model.env.version }) : msg('settings.status.row.supportValue', { v: model.env.version, schema }), msg('settings.status.row.supportNote')),
  ];
  return rows.filter((entry): entry is StatusRowVM => entry !== null);
}

/** What a shift cannot start without (ST-021…ST-024): the hub and the sign-in, the site with a bound account, a persona. */
const REQUIRED_ROWS: readonly StatusRowVM['id'][] = ['hub', 'account', 'host', 'binding', 'persona'];

export function readinessOf(model: PagesModel, rows: readonly StatusRowVM[]): StatusBodyVM['readiness'] {
  const required = rows.filter((entry) => REQUIRED_ROWS.includes(entry.id));
  // Not answered yet, or the hub's own state is unknown: no verdict instead of a guess (ST-020).
  if (model.settings.s !== 'ok' || required.some((entry) => entry.level === 'unknown' && entry.id !== 'persona')) return { s: 'unknown' };
  const warnings: Msg[] = [];
  const quota = rows.find((entry) => entry.id === 'quota');
  if (quota?.level === 'warn') warnings.push(msg(pageQuotas(model).some((entry) => entry.remaining === 0) ? 'settings.status.warning.quotaZero' : 'settings.status.warning.quotaLow'));
  const sends = valueOf(model.diagnostics)?.sends ?? null;
  if (sends !== null && sends.uncertain > 0) warnings.push(msg('settings.status.warning.sendUncertain'));
  // The preview send is switched on, but the fuse holds it off (decision X25).
  if (rows.find((entry) => entry.id === 'preview-send')?.action?.action.type === 'ResetSendFuse') warnings.push(msg('settings.status.warning.sendFused'));
  const needed = required.filter((entry) => entry.level === 'error' || entry.level === 'warn');
  // A partly checked site still works through «Копировать»: a warning, not a blocker (one, however many sites).
  const partial = required.filter((entry) => entry.id === 'host' && entry.level === 'warn' && entry.host !== undefined && (hostReportOf(model, entry.host)?.tabs ?? 0) > 0).length;
  if (partial > 0) warnings.push(msg('settings.status.warning.hostPartial'));
  if (staleTabsOf(model) > 0) warnings.push(msg('settings.status.warning.staleTabs'));
  // A site's services in the background did not start (its chunk, R20 F1): its own requests answer «не отвечает».
  if ((valueOf(model.diagnostics)?.hostModules ?? []).some((module) => module.state === 'failed')) warnings.push(msg('settings.status.warning.hostModule'));
  const count = needed.length - partial;
  return count === 0 ? { s: 'ready', warnings } : { s: 'actions-needed', count, warnings };
}

export function statusBody(model: PagesModel): StatusBodyVM {
  const rows = statusRows(model);
  const waitMs = model.check.allowedAt - model.now;
  const busy = model.check.running || waitMs > 0;
  return {
    section: 'status',
    readiness: readinessOf(model, rows),
    lastCheckedAt: model.check.lastAt,
    recheck: button('settings.status.checkAll', { type: 'RecheckStatus' }, { reason: busy ? reasonOf('wait-until', { n: Math.max(1, Math.ceil(waitMs / 1000)) }) : null }),
    copyReport: button('settings.status.copyReport', { type: 'CopyReport', scope: 'status' }),
    rows,
    running: runningVms(model),
    note: msg('settings.status.reportNote'),
  };
}

// ── the report for the team lead (ST-036) ──────────────────────────────────

function readinessText(i18n: I18n, readiness: StatusBodyVM['readiness']): string {
  if (readiness.s === 'unknown') return i18n.t('settings.status.unknown');
  const head = readiness.s === 'ready' ? i18n.t('settings.status.ready') : i18n.plural('settings.status.needActions', readiness.count);
  if (readiness.warnings.length === 0) return head;
  return `${head} · ${warningsText(i18n, readiness.warnings)}`;
}

/** «одно предупреждение: мало квоты AI» (ui-design §4.24); several — counted. */
function warningsText(i18n: I18n, warnings: readonly Msg[]): string {
  const text = warnings.map((warning) => i18n.text(warning)).join(', ');
  return warnings.length === 1 ? i18n.t('settings.status.warningOne', { text }) : i18n.plural('settings.status.warnings', warnings.length, { text });
}

const textOf = (i18n: I18n, value: string | Msg): string => (typeof value === 'string' ? value : i18n.text(value));

/**
 * «Скопировать отчёт для тимлида»: versions, the status rows as the page
 * shows them, error codes and times. No conversation, no fan money, no
 * names of fans — the page never has them.
 */
export function statusReport(model: PagesModel, i18n: I18n): string {
  const body = statusBody(model);
  const diagnostics = valueOf(model.diagnostics);
  const counters = Object.entries(diagnostics?.counters ?? {})
    .filter(([name, count]) => name.startsWith('CG-') && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => `${name} ×${String(count)}`);
  const lines = [
    `ChatGoose ${model.env.version} · ${i18n.formatTime(model.now, 'datetime')}`,
    readinessText(i18n, body.readiness),
    ...body.rows.map((entry) => {
      const note = entry.note === null ? '' : ` — ${textOf(i18n, entry.note)}`;
      return `${i18n.text(entry.title)}: ${textOf(i18n, entry.value)}${note}`;
    }),
    `${i18n.t('settings.diagnostics.counters')}: ${counters.length === 0 ? i18n.t('settings.diagnostics.countersNone') : counters.join(', ')}`,
  ];
  if (diagnostics !== null) lines.push(`Firefox ${diagnostics.browser.major === null ? '?' : String(diagnostics.browser.major)} · ${diagnostics.os} · contracts ${diagnostics.extension.contractsVersion}`);
  return lines.join('\n');
}

/** «Скопировать код» of one error: «CG-…: заголовок» and where it was seen. */
export function errorReport(model: PagesModel, i18n: I18n, code: CgCode): string {
  const view = errorOf(model, valueOf(model.diagnostics)?.hub.lastError?.code === code ? (valueOf(model.diagnostics)?.hub.lastError ?? { code }) : { code });
  const lines = [`${view.code}: ${view.title}`, view.body];
  if (view.detail !== undefined) lines.push(view.detail);
  lines.push(`ChatGoose ${model.env.version} · ${i18n.formatTime(model.now, 'datetime')}`);
  return lines.join('\n');
}
