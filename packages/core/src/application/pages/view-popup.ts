import { HOST_PLATFORM, type HostKind } from '@cg/contracts/hosts';
import { chatKeyOf } from '@cg/contracts/ids';
import { siteLabel } from './site-details';
// The toolbar popup (architecture.md §9.9; ui-design §4.23; PU-001…PU-022):
// what is connected, who is signed in, which chat is open and how much AI
// quota is left — from what the background already knows. Nothing here asks
// a site anything, and the popup never shows an endless spinner: a
// background that does not answer is CG-RUNTIME-UNREACHABLE (PU-001). The
// report of the tab in front is read by its site's expected anchors (R20 F7).

import { type CgErrorView } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type HostCapability } from '@cg/contracts/host';
import { type ActionButtonVM, type PopupAlertVM, type PopupVerdictVM, type PopupVM, type ReasonVM, type UiAction, type VmView } from '@cg/contracts/vm';

import { aiLimitVm, aiSpentWithoutLimit } from '../../domain/ai-limit';
import { errorTone } from '../../domain/errors';
import { hotkeyOf } from './hotkeys';
import { QUOTA_LOW, accountKeyOf, boundPageOf, boundPageTagOf, button, codeError, currentAccountOf, errorOf, msg, openChatOf, personaOfPage, sessionUnknownError, valueOf, type PagesModel } from './model';
import { type PagePorts } from './ports';
import { hostGaps, hostReportOf, hubState, missingAnchors, siteOfReport, statusSites } from './view-status';

function hostPill(model: PagesModel, site?: HostKind): PopupVM['pills']['host'] {
  const host = hostReportOf(model, site);
  if (host === null) return 'unknown';
  if (host.tabs === 0) return 'closed';
  if (host.report === null) return 'unknown';
  const gaps = hostGaps(host.report, siteOfReport(model, host.report)?.contract ?? null);
  if (gaps.anchors.length === 0 && gaps.broken.length === 0) return 'connected';
  return gaps.insert ? 'partial' : 'copy-only';
}

/** ChatSpace tabs still running the build this one replaced: their old script talks to nobody until they are reloaded. */
function staleTabsOf(model: PagesModel): number {
  return valueOf(model.diagnostics)?.extension.updated?.staleTabs ?? 0;
}

function problemsOf(model: PagesModel, host: PopupVM['pills']['host']): CgErrorView[] {
  const problems: CgErrorView[] = [];
  // After an update a tab opened before it is still there and looks fine, but nothing of ours runs in it: say so first.
  // The popup draws a problem as its code and one line: the title goes into that line, so it reads «Расширение обновилось. …».
  if (staleTabsOf(model) > 0) {
    const reloaded = codeError(model, 'CG-RUNTIME-RELOADED');
    problems.push({ ...reloaded, body: `${reloaded.title}. ${reloaded.body}` });
  }
  if (model.hubAccess === false) problems.push(codeError(model, 'CG-HUB-HOST-PERMISSION'));
  if (model.bootstrap.s === 'error') problems.push(errorOf(model, model.bootstrap.error));
  else if (hubState(model) === 'down') problems.push(errorOf(model, valueOf(model.diagnostics)?.hub.lastError ?? { code: 'CG-HUB-UNAVAILABLE' }));
  if (host === 'copy-only') problems.push(codeError(model, 'CG-HOST-CONTRACT'));
  else if (host === 'partial') {
    // The code's own text ends in «Вставка работает через „Копировать“»: not so here — the insert works, so the line
    // names what was not found, in the words of the «Статус» row.
    const report = hostReportOf(model)?.report ?? null;
    const site = report === null ? null : siteOfReport(model, report);
    const body = report === null || site === null ? null : model.t.text(site.texts.partialNote, { missing: missingAnchors(hostGaps(report, site.contract)) });
    problems.push(body === null ? codeError(model, 'CG-HOST-CONTRACT') : { ...codeError(model, 'CG-HOST-CONTRACT'), body });
  }
  // One line per code: the same problem seen twice is one problem.
  return problems.filter((problem, index) => problems.findIndex((other) => other.code === problem.code) === index);
}

/** The one remedy the popup offers for a problem by itself, by the registry's recovery; null — nothing to press here. */
function fixOf(problem: CgErrorView): ActionButtonVM | null {
  const entry = CG_REGISTRY[problem.code];
  if (entry.recovery === 'retry') return button('popup.alert.recheck', { type: 'RecheckStatus' });
  if (entry.recovery === 'open-settings' || entry.recovery === 'sign-in') return button('popup.openSettings', { type: 'OpenSettings', route: entry.settings ?? { section: 'status', code: problem.code } });
  return null;
}

function alertOf(problem: CgErrorView, fix: ActionButtonVM | null = fixOf(problem)): PopupAlertVM {
  return { code: problem.code, tone: problem.tone ?? errorTone(problem.code), title: problem.title, body: problem.body === '' ? null : problem.body, fix };
}

const WORKING: ReadonlySet<PopupVM['pills']['host']> = new Set(['connected', 'partial', 'copy-only']);

/**
 * The stage under the persona (1.35.0, X61), the three of «Статус»: what to fix, in the order to fix it — the tab
 * left from the old build, no tab at all, the hub, the site's contract, the page's binding, its persona — each with
 * the one remedy the popup can offer itself; nothing to fix and a site with the hub answering — ready; a tab's report,
 * the hub's health or the page's binding not in yet — checking.
 */
function verdictOf(model: PagesModel, problems: readonly CgErrorView[], sites: NonNullable<PopupVM['sites']>, hub: PopupVM['pills']['hub'], persona: PopupVM['persona']): PopupVerdictVM {
  const alerts: PopupAlertVM[] = [];
  const stale = staleTabsOf(model);
  if (stale > 0 || model.reloadingHost) {
    // While the background reloads them the count is gone: the card stays, its button busy, until the tab is back.
    const n = Math.max(stale, 1);
    alerts.push({
      code: 'CG-RUNTIME-RELOADED',
      tone: 'state',
      title: model.t.text(n === 1 ? 'popup.alert.reloadTitleOne' : 'popup.alert.reloadTitleMany'),
      body: model.t.text('popup.alert.reloadBody'),
      fix: button(n === 1 ? 'popup.alert.reloadOne' : 'popup.alert.reloadMany', { type: 'ReloadTab' }),
      ...(model.reloadingHost ? { busy: true } : {}),
    });
  }
  const working = sites.some((site) => WORKING.has(site.state));
  const checking = hub === 'unknown' || sites.some((site) => site.state === 'unknown');
  if (alerts.length === 0 && !working && !checking) {
    // No tab where ChatGoose runs: open one. The popup opens only the build's own site, and only when it is the one in use.
    const own = model.env.sites[0]?.kind;
    const list = new Intl.ListFormat(model.locale, { type: 'disjunction' }).format(sites.map((site) => site.label));
    alerts.push({
      code: 'CG-HOST-NOT-READY',
      tone: 'state',
      title: model.t.text('popup.alert.openTitle', { sites: list }),
      body: model.t.text('popup.alert.openBody'),
      fix: sites.length === 1 && sites[0]?.host === own ? button('popup.alert.openFix', { type: 'Navigate', to: { kind: 'site-home' } }) : null,
    });
  }
  for (const problem of problems) if (problem.code !== 'CG-RUNTIME-RELOADED') alerts.push(alertOf(problem));
  // The page of the open account: not bound on the hub (the team lead's to fix), or bound without a persona (the chatter's).
  const current = currentAccountOf(model);
  const binding = current === null ? undefined : model.bindings.get(accountKeyOf(current.account));
  if (binding !== undefined && !binding.ok && binding.error.code.startsWith('CG-BINDING-')) alerts.push(alertOf(errorOf(model, binding.error)));
  if (persona.s === 'no-persona') alerts.push(alertOf(codeError(model, 'CG-PERSONA-UNASSIGNED'), button('popup.alert.personaFix', { type: 'OpenSettings', route: { section: 'personas', code: 'CG-PERSONA-UNASSIGNED' } })));
  if (alerts.length > 0) return { s: 'attention', line: null, alerts };
  if (checking || persona.s === 'not-connected') return { s: 'checking', line: model.t.text('popup.verdict.checking'), alerts: [] };
  // «ChatSpace, Fansly и хаб на связи»: the sites by a comma, the hub after the one «и» of the text.
  const connected = sites.filter((site) => WORKING.has(site.state)).map((site) => site.label).join(', ');
  return { s: 'ready', line: model.t.text('popup.verdict.readyLine', { sites: connected }), alerts: [] };
}

function degraded(model: PagesModel): HostCapability[] {
  const report = hostReportOf(model)?.report ?? null;
  if (report === null) return [];
  return (Object.entries(report.capabilities) as [HostCapability, { state: string }][]).filter(([, capability]) => capability.state === 'contractBroken' || capability.state === 'degraded').map(([name]) => name);
}

export function popupView(model: PagesModel, ports: Pick<PagePorts, 'catalog'>): PopupVM {
  const reload: UiAction = { type: 'ReloadView', selector: { of: 'popup' } };
  const session = valueOf(model.session);
  const host = hostPill(model);
  const hub = hubState(model);
  const settingsKnown = valueOf(model.settings) !== null;
  const problems = session === null ? [] : problemsOf(model, host);
  const unknown = sessionUnknownError(model);
  let view: VmView;
  if (model.unreachable) view = { s: 'error', error: codeError(model, 'CG-RUNTIME-UNREACHABLE'), retry: reload };
  else if (model.settings.s === 'error' && !settingsKnown) view = { s: 'error', error: errorOf(model, model.settings.error), retry: reload };
  // PU-002 «сбой связи не считается выходом»: the sign-in state could not be read — its error with «Повторить», not «Войдите».
  else if (unknown !== null) view = { s: 'error', error: errorOf(model, unknown), retry: reload };
  else if (!settingsKnown || model.session.s === 'idle' || (model.session.s === 'loading' && model.session.last === null && session === null)) view = { s: 'loading', since: null, stage: null };
  else if (session === null) view = { s: 'forbidden', error: codeError(model, model.sessionEnd === 'revoked' ? 'CG-AUTH-REVOKED' : model.sessionEnd === 'expired' ? 'CG-AUTH-EXPIRED' : 'CG-AUTH-REQUIRED'), remedy: { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } } };
  else if (hub === 'down') view = { s: 'offline', error: problems.find((problem) => problem.code !== 'CG-HOST-CONTRACT') ?? codeError(model, 'CG-HUB-UNAVAILABLE'), retry: { type: 'RecheckStatus' }, lastGoodAt: null };
  else if (host === 'partial' || host === 'copy-only') view = { s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: degraded(model) }] };
  else view = { s: 'ready' };

  const current = session === null ? null : currentAccountOf(model);
  const bound = current === null ? null : boundPageOf(model, current.account);
  const pageName = bound === null ? null : (bound.page?.title ?? bound.binding.pageLabel);
  const persona = bound === null ? null : personaOfPage(model, bound.binding.pageId);
  const chat = session === null ? null : openChatOf(model);
  // PU-008 «имя фана или id»: the name a tab already knows (1.20.0, X47); the id stays one click away.
  const fanLabel = chat === null ? undefined : model.fanLabels.get(chatKeyOf(chat));
  const quota = bound === null ? null : (model.quotas.get(bound.binding.pageId) ?? null);
  const platform = ports.catalog?.platform ?? model.env.hotkeyPlatform;
  // Spenders, «Новые» and the cheatsheet open inside ChatSpace: without a connected tab there is nowhere to open them.
  // A tab left from the build before the update is there but not connected: its reason is the reload, not «open ChatSpace».
  const stale = host === 'closed' && staleTabsOf(model) > 0;
  const noTab: ReasonVM | null =
    host === 'closed' || host === 'unknown'
      ? stale
        ? { id: 'host-degraded', code: 'CG-RUNTIME-RELOADED', text: msg('dock.reason.reloadNeeded') }
        : { id: 'host-degraded', code: 'CG-HOST-NOT-READY', text: msg('popup.needsChatSpace') }
      : null;
  const surface = (name: 'spenders' | 'newcomers' | 'cheatsheet'): UiAction => ({ type: 'Navigate', to: { kind: 'surface', surface: name, open: true } });
  // `ai-limit-v1`: the snapshot the background holds (the hub's answer, a generation's meta), until 00:00 МСК.
  const aiLimit = session === null || model.aiLimit === undefined || model.aiLimit === null || model.now >= Date.parse(model.aiLimit.resetsAt) ? null : model.aiLimit;
  const sites = statusSites(model).map((site) => ({ host: site.kind, label: siteLabel(model, site.kind), state: hostPill(model, site.kind), waitingReload: valueOf(model.diagnostics)?.siteAccess?.find((entry) => entry.host === site.kind)?.waitingReload ?? (site.kind === model.env.sites[0]?.kind ? staleTabsOf(model) : 0) }));
  const personaVm: PopupVM['persona'] =
    bound === null || pageName === null || persona === null
      ? { s: 'not-connected' }
      : persona.s === 'set' && persona.label !== null
        ? { s: 'set', label: persona.label, pageName, page: boundPageTagOf(model, bound) }
        : { s: 'no-persona', pageName, page: boundPageTagOf(model, bound) };
  return {
    view,
    ...(session === null ? {} : { verdict: verdictOf(model, problems, sites, hub, personaVm) }),
    version: model.env.version,
    pills: { host, hub },
    sites,
    problems,
    persona: personaVm,
    account: session === null ? null : { login: session.login, signOut: button('popup.signOut', { type: 'SignOut' }) },
    chat:
      chat === null
        ? null
        : {
            fanName: fanLabel ?? model.t.text('popup.fanId', { id: chat.platformFanId }),
            fanUsername: model.fanUsernames.get(chatKeyOf(chat)) ?? null,
            hostAccountLabel: model.t.text('popup.dialogAccount', { ...model.env.platformPhrases(HOST_PLATFORM[chat.host])?.[model.locale], id: chat.hostAccountId }),
            // 2026-10-22 (the old popup): the name and the @handle on the line; the ids in its tooltip, a click copies the chat's.
            copyIds: { ...(chat.conversationRef === undefined ? {} : { conversationRef: chat.conversationRef }), fanId: chat.platformFanId, hostAccountId: chat.hostAccountId, creatorId: current?.account.hostAccountId === chat.hostAccountId ? (current.account.platformAccountId ?? null) : null },
          },
    quota: bound === null ? null : { remaining: quota?.remainingRequestsToday ?? null, resetsAt: quota?.resetsAt ?? null, low: quota !== null && quota.remainingRequestsToday !== null && quota.remainingRequestsToday <= QUOTA_LOW },
    // `ai-limit-v1` (the owner, 2026-10-31): the person sees their own daily AI limit and what they spent of it;
    // one without a limit sees what AI cost them today.
    aiLimit: aiLimitVm(aiLimit),
    aiTodayNoLimit: aiSpentWithoutLimit(aiLimit),
    newcomersCount: model.newcomers,
    buttons: [
      button('popup.btn.spenders', surface('spenders'), { reason: noTab, hotkey: hotkeyOf('spenders', platform, ports.catalog) }),
      button('popup.btn.newcomers', surface('newcomers'), { reason: noTab }),
      button('popup.btn.keys', surface('cheatsheet'), { reason: noTab, hotkey: hotkeyOf('cheatsheet', platform, ports.catalog) }),
      button('popup.btn.settings', { type: 'OpenSettings', route: { section: 'status' } }),
    ],
    links: { whatsNew: { type: 'Navigate', to: { kind: 'page', page: 'whats-new' } }, changelog: { type: 'Navigate', to: { kind: 'page', page: 'changelog' } } },
    refresh: button('popup.refreshStatus', { type: 'RecheckStatus' }),
    refreshing: model.check.running,
  };
}
