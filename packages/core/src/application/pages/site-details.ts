// Per-site local facts for status. No site literals and no transport calls.
import { HOST_PLATFORM, type HostKind } from '@cg/contracts/hosts';
import { type I18nTextKey } from '@cg/contracts/i18n/catalog';
import { type StatusRowVM } from '@cg/contracts/vm';
import { expectedAnchors } from '../../domain/host';
import { accountKeyOf, valueOf, type PagesModel } from './model';
import { type PageSite } from './ports';

type Detail = NonNullable<StatusRowVM['details']>[number];
export function siteLabel(model: PagesModel, host: HostKind): string {
  return model.env.platformPhrases(HOST_PLATFORM[host])?.[model.locale].site ?? host;
}

export function siteDetails(model: PagesModel, site: PageSite): readonly Detail[] | undefined {
  const diagnostic = valueOf(model.diagnostics);
  const access = diagnostic?.siteAccess?.find((entry) => entry.host === site.kind);
  const tabs = diagnostic?.tabs.filter((tab) => tab.site === site.kind || tab.host?.host === site.kind) ?? [];
  // The original site's page keeps its exact layout. Extra observations or access control opt a site in.
  if (access === undefined && tabs.every((tab) => tab.page === undefined)) return undefined;
  const noData = model.t.text('status.details.noData');
  const yesNo = (value: boolean | undefined): string => value === undefined ? noData : model.t.text(value ? 'status.details.yes' : 'status.details.no');
  const rows: Detail[] = [];
  const add = (key: I18nTextKey, value: string): void => { rows.push({ label: model.t.text(key), value }); };
  add('status.details.access', access === undefined ? noData : model.t.text('status.details.accessValue', { enabled: yesNo(access.enabled), granted: yesNo(access.granted), registered: yesNo(access.registered) }));
  if ((access?.waitingReload ?? 0) > 0) add('siteAccess.reload', model.t.plural('popup.waitingReload', access?.waitingReload ?? 0));
  add('settings.status.row.sound', model.t.text('status.details.tabs', { n: tabs.filter((tab) => tab.host?.capabilities.incoming?.state === 'on').length, m: tabs.length + (access?.waitingReload ?? 0), unknown: tabs.filter((tab) => tab.host?.capabilities.identity?.state !== 'on').length }));
  const mode = diagnostic?.requestModes?.find((entry) => entry.host === site.kind)?.mode;
  add('status.details.mode', mode === undefined ? noData : model.t.text(mode === 'relay' ? 'status.details.relay' : 'status.details.background'));
  add('status.details.pacer', model.t.text('status.details.pacerPending'));
  const accounts = (valueOf(model.accounts) ?? []).filter((entry) => entry.account.host === site.kind && entry.openTabs > 0);
  add('settings.section.accounts', accounts.length === 0 ? noData : accounts.map((entry) => `${entry.account.platformAccountId ?? entry.account.hostAccountId}${entry.account.username === null ? '' : ` @${entry.account.username.replace(/^@/, '')}`} · ${model.t.text('status.details.accountTabs', { n: entry.openTabs })} · ${model.t.text('settings.status.row.binding')}: ${model.bindings.get(accountKeyOf(entry.account))?.ok === true ? yesNo(true) : noData}`).join('\n'));
  for (const [index, tab] of tabs.entries()) {
    const prefix = tabs.length > 1 ? `#${index + 1} · ` : '';
    const detail = (key: I18nTextKey, value: string): void => { rows.push({ label: prefix + model.t.text(key), value }); };
    const page = tab.page;
    const buddy = page?.companion;
    detail('status.details.build', tab.host?.build ?? noData);
    detail('status.details.anchors', tab.host === null ? noData : expectedAnchors(tab.host, site.contract).map(([key, value]) => `${key}: ${value}`).join(' · '));
    detail('status.details.companion', (buddy === null || buddy === undefined) ? noData : model.t.text('status.details.companionValue', { bridge: yesNo(buddy.windowBridge), network: yesNo(buddy.networkHook), styles: yesNo(buddy.styleFixes) }));
    detail('status.details.wordFilter', yesNo(buddy?.wordFilter));
    const session = tab.networkSession;
    detail('status.details.session', session === undefined ? noData : model.t.text('status.details.sessionValue', { present: yesNo(session.present), account: session.accountId ?? noData, age: session.ageMs === null ? noData : String(Math.floor(session.ageMs / 1000)) }));
    if (model.effective?.debug.enabled === true) detail('status.details.headerNames', session === undefined ? noData : session.headerNames.join(', ') || '—');
    detail('status.details.health', page === undefined ? noData : `${model.t.text('status.details.observed', { time: new Date(page.observedAt).toLocaleString(model.locale, { timeZone: model.env.timeZone }) })}\n${Object.entries(page.counters).map(([key, value]) => `${key}: ${value}`).join(' · ')}`);
  }
  const day = diagnostic?.freshness;
  const groups = day?.rows.filter((row) => row.host === site.kind) ?? [];
  add('status.details.freshness', day === undefined ? noData : model.t.text('status.details.freshnessScope', { since: new Date(day.since).toLocaleString(model.locale, { timeZone: model.env.timeZone }), until: new Date(day.until).toLocaleString(model.locale, { timeZone: model.env.timeZone }), storage: model.t.text(day.persisted ? 'status.details.persisted' : 'status.details.memory'), dropped: day.dropped }));
  if (groups.length === 0) add('status.details.freshness', noData);
  for (const group of groups) {
    const c = group.counts;
    add('status.details.freshness', model.t.text('status.details.freshnessValue', { feature: group.feature, build: group.build ?? noData, n: c.generations, marked: c.marked, unknown: c.unknown, rejected: c.rejectedTail, truncated: c.truncated, other: c.nonLiveUnion }));
  }
  return rows;
}
