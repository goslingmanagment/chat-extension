// The toolbar popup (architecture.md §9.9; ui-design §4.23; PU-001…PU-022):
// what is connected, who is signed in, which chat is open and how much AI
// quota is left — from what the background already knows. Nothing here asks
// ChatSpace anything, and the popup never shows an endless spinner: a
// background that does not answer is CG-RUNTIME-UNREACHABLE (PU-001).

import { type CgErrorView } from '@cg/contracts/errors';
import { type HostCapability } from '@cg/contracts/host';
import { type PopupVM, type ReasonVM, type UiAction, type VmView } from '@cg/contracts/vm';

import { formatMicroUsd } from '../../domain/debug';
import { hotkeyOf } from './hotkeys';
import { QUOTA_LOW, boundPageOf, button, codeError, currentAccountOf, errorOf, msg, openChatOf, personaOfPage, valueOf, type PagesModel } from './model';
import { type PagePorts } from './ports';
import { hostGaps, hostReportOf, hubState } from './view-status';

function hostPill(model: PagesModel): PopupVM['pills']['host'] {
  const host = hostReportOf(model);
  if (host === null) return 'unknown';
  if (host.tabs === 0) return 'closed';
  if (host.report === null) return 'unknown';
  const gaps = hostGaps(host.report);
  if (gaps.anchors.length === 0 && gaps.broken.length === 0) return 'connected';
  return gaps.insert ? 'partial' : 'copy-only';
}

function problemsOf(model: PagesModel, host: PopupVM['pills']['host']): CgErrorView[] {
  const problems: CgErrorView[] = [];
  if (model.hubAccess === false) problems.push(codeError(model, 'CG-HUB-HOST-PERMISSION'));
  if (model.bootstrap.s === 'error') problems.push(errorOf(model, model.bootstrap.error));
  else if (hubState(model) === 'down') problems.push(errorOf(model, valueOf(model.diagnostics)?.hub.lastError ?? { code: 'CG-HUB-UNAVAILABLE' }));
  if (host === 'partial' || host === 'copy-only') problems.push(codeError(model, 'CG-HOST-CONTRACT'));
  // One line per code: the same problem seen twice is one problem.
  return problems.filter((problem, index) => problems.findIndex((other) => other.code === problem.code) === index);
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
  let view: VmView;
  if (model.unreachable) view = { s: 'error', error: codeError(model, 'CG-RUNTIME-UNREACHABLE'), retry: reload };
  else if (model.settings.s === 'error' && !settingsKnown) view = { s: 'error', error: errorOf(model, model.settings.error), retry: reload };
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
  const quota = bound === null ? null : (model.quotas.get(bound.binding.pageId) ?? null);
  const debug = model.effective?.debug.enabled === true;
  const platform = ports.catalog?.platform ?? model.env.hotkeyPlatform;
  // Spenders, «Новые» and the cheatsheet open inside ChatSpace: without a tab there is nowhere to open them.
  const noTab: ReasonVM | null = host === 'closed' || host === 'unknown' ? { id: 'host-degraded', code: 'CG-HOST-NOT-READY', text: msg('popup.needsChatSpace') } : null;
  const surface = (name: 'spenders' | 'newcomers' | 'cheatsheet'): UiAction => ({ type: 'Navigate', to: { kind: 'surface', surface: name, open: true } });
  return {
    view,
    version: model.env.version,
    pills: { host, hub },
    problems,
    persona:
      bound === null || pageName === null || persona === null
        ? { s: 'not-connected' }
        : persona.s === 'set' && persona.label !== null
          ? { s: 'set', label: persona.label, pageName }
          : { s: 'no-persona', pageName },
    account: session === null ? null : { login: session.login, signOut: button('popup.signOut', { type: 'SignOut' }) },
    chat:
      chat === null
        ? null
        : {
            // Pages are told no fan names (§5.4): the id is what the popup knows (PU-008 «имя фана или id»).
            fanName: model.t.text('popup.fanId', { id: chat.platformFanId }),
            fanUsername: null,
            hostAccountLabel: model.t.text('popup.dialogAccount', { id: chat.hostAccountId }),
            copyIds: { hostAccountId: chat.hostAccountId, creatorId: current?.account.hostAccountId === chat.hostAccountId ? (current.account.platformAccountId ?? null) : null },
          },
    quota: bound === null ? null : { remaining: quota?.remainingRequestsToday ?? null, resetsAt: quota?.resetsAt ?? null, low: quota !== null && quota.remainingRequestsToday !== null && quota.remainingRequestsToday <= QUOTA_LOW },
    // Money of AI only in debug (Б4, PU-016); the hub's own number for this person and page.
    aiTodayLine: debug && model.aiTodayMicroUsd !== null ? model.t.text('popup.aiCostToday', { money: formatMicroUsd(model.aiTodayMicroUsd) }) : null,
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
