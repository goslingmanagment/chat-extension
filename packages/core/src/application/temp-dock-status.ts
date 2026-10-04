// TEMPORARY (integration step M1, removed by R11 + R14): the dock's status
// controller. It serves the real `dock` view model with every AI button off
// — only what M1's live smoke needs is real: the dock's status and its
// banner (sign-in, hub, binding, host contract, blocked fan, «перезагрузите
// вкладку»). R11's dock controller replaces it without touching the router,
// the tab composition root or the view model.
//
// Next to the view model it keeps a small «smoke» model (who is signed in,
// which page the open account is bound to, the host contract) that the
// temporary status view prints: DockVM has no place for those lines, and the
// real dock never shows them.

import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { TONES } from '@cg/contracts/features';
import { type HostCapability, type HostContractReport, type RouteState } from '@cg/contracts/host';
import { type HubBinding, type SessionIdentity } from '@cg/contracts/ids';
import { DOCK_ACTION_IDS, type ActionReceipt, type DockActionVM, type DockStatus, type DockVM, type UiAction, type ViewOf, type ViewSelector, type VmView } from '@cg/contracts/vm';

import { ViewListeners, type SurfaceController } from './router';

/** What the tab knows right now; the composition root feeds it (`update`). */
export interface TempDockFacts {
  /** The port to the background: `reloaded` — the extension was updated under the tab. */
  readonly runtime: 'connecting' | 'ready' | 'unreachable' | 'reloaded';
  /** The tab predates this extension instance or speaks another contracts version (UP-009). */
  readonly needsReload: boolean;
  /** undefined — the background has not answered yet; null — not signed in. */
  readonly session: SessionIdentity | null | undefined;
  /** The bootstrap read: `failed` carries the code the hub layer gave. */
  readonly hub: { readonly state: 'unknown' | 'ok' } | { readonly state: 'failed'; readonly code: CgCode };
  readonly route: RouteState | null;
  readonly binding:
    | { readonly state: 'none' | 'loading' }
    | { readonly state: 'bound'; readonly binding: HubBinding; readonly pageTitle: string | null }
    | { readonly state: 'refused'; readonly code: CgCode };
  /** null — MAIN has not reported yet. */
  readonly contract: HostContractReport | null;
  /** The open chat's composer: `hidden` — the fan is blocked. */
  readonly composer: { readonly ready: boolean; readonly hidden: boolean } | null;
}

export const TEMP_DOCK_INITIAL: TempDockFacts = {
  runtime: 'connecting',
  needsReload: false,
  session: undefined,
  hub: { state: 'unknown' },
  route: null,
  binding: { state: 'none' },
  contract: null,
  composer: null,
};

/** The lines of the temporary status view (not a contract: it goes with the view). */
export interface TempDockSmoke {
  readonly status: DockStatus;
  /** The code of the status banner; null — nothing is wrong. */
  readonly code: CgCode | null;
  /** «signed in as»: the hub login; null — not signed in or not known yet. */
  readonly login: string | null;
  readonly sessionKnown: boolean;
  /** The hub page the open account is bound to. */
  readonly page: { readonly label: string; readonly title: string | null } | null;
  readonly bindingCode: CgCode | null;
  readonly contract: {
    readonly state: 'unknown' | 'ok' | 'degraded' | 'broken';
    readonly build: string | null;
    /** Anchors that are not `ok`, by id (machine names, never page data). */
    readonly anchors: readonly string[];
  };
  readonly reload: boolean;
}

export interface TempDockStatusDeps {
  /** The error card of a code in the current language. */
  readonly errorOf: (code: CgCode) => CgErrorView;
}

export interface TempDockStatusController extends SurfaceController {
  update(patch: Partial<TempDockFacts>): void;
  facts(): TempDockFacts;
  smoke(): TempDockSmoke;
  onSmoke(listener: (smoke: TempDockSmoke) => void): () => void;
  /** The language changed: the same facts, new texts. */
  retranslate(): void;
}

/** Capabilities without which nothing of ours works in the tab. */
const VITAL: readonly HostCapability[] = ['identity', 'route', 'accounts'];

const OFF_ACTION: DockActionVM = { enabled: false, busy: false, active: false, reason: null, hotkey: null, badge: null };

/** Capabilities that are not fully on, for the `partial` gap (part B's — X8 and the WS tap — are off by design until it lands). */
const PART_B: readonly HostCapability[] = ['previewSend', 'incoming', 'receipt', 'sendObserve'];

function degraded(report: HostContractReport | null): HostCapability[] {
  if (report === null) return [];
  return (Object.entries(report.capabilities) as [HostCapability, { readonly state: string }][])
    .filter(([name, value]) => value.state !== 'on' && !PART_B.includes(name))
    .map(([name]) => name);
}

function viewState(status: DockStatus, error: CgErrorView | null, report: HostContractReport | null): VmView {
  switch (status) {
    case 'ready':
    case 'blocked-fan':
    case 'no-persona':
      return { s: 'ready' };
    case 'loading-chat':
      return { s: 'loading', since: null, stage: null };
    case 'host-degraded':
      return { s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: degraded(report) }] };
    case 'not-signed-in':
    case 'no-binding':
      return error === null ? { s: 'loading', since: null, stage: null } : { s: 'forbidden', error, remedy: error.settings === undefined ? null : { type: 'OpenSettings', route: error.settings } };
    case 'hub-down':
      return error === null ? { s: 'loading', since: null, stage: null } : { s: 'offline', error, retry: null, lastGoodAt: null };
    case 'reload-needed':
      return error === null ? { s: 'loading', since: null, stage: null } : { s: 'error', error, retry: null };
  }
}

function contractSummary(report: HostContractReport | null): TempDockSmoke['contract'] {
  if (report === null) return { state: 'unknown', build: null, anchors: [] };
  const anchors = Object.entries(report.anchors)
    .filter(([, state]) => state !== 'ok')
    .map(([anchor]) => anchor)
    .sort();
  const states = (Object.entries(report.capabilities) as [HostCapability, { readonly state: string }][]).filter(([name]) => !PART_B.includes(name));
  const vitalBroken = states.some(([name, value]) => VITAL.includes(name) && value.state !== 'on' && value.state !== 'degraded');
  const anyBroken = states.some(([, value]) => value.state === 'contractBroken');
  const anyDegraded = states.some(([, value]) => value.state !== 'on');
  return { state: vitalBroken || anyBroken ? 'broken' : anyDegraded ? 'degraded' : 'ok', build: report.build, anchors };
}

/** The first thing that stops the dock, most fundamental first (ui-design §4.10 order). */
function statusOf(facts: TempDockFacts): { readonly status: DockStatus; readonly code: CgCode | null } {
  if (facts.runtime === 'reloaded' || facts.needsReload) return { status: 'reload-needed', code: 'CG-RUNTIME-RELOADED' };
  if (facts.runtime === 'unreachable') return { status: 'hub-down', code: 'CG-RUNTIME-UNREACHABLE' };
  const report = facts.contract;
  if (report !== null) {
    const vital = VITAL.map((name) => report.capabilities[name]).find((value) => value !== undefined && value.state !== 'on' && value.state !== 'degraded');
    if (vital !== undefined) return { status: 'host-degraded', code: vital.code ?? 'CG-HOST-CONTRACT' };
  }
  if (facts.session === undefined || facts.runtime === 'connecting') return { status: 'loading-chat', code: null };
  if (facts.session === null) return { status: 'not-signed-in', code: 'CG-AUTH-REQUIRED' };
  if (facts.hub.state === 'failed') return { status: 'hub-down', code: facts.hub.code };
  if (facts.binding.state === 'refused') return { status: 'no-binding', code: facts.binding.code };
  if (facts.composer?.hidden === true) return { status: 'blocked-fan', code: 'CG-GATE-FAN-BLOCKED' };
  const insert = report?.capabilities.insert;
  if (insert !== undefined && insert.state !== 'on') return { status: 'host-degraded', code: insert.code ?? 'CG-HOST-COMPOSER-MISSING' };
  if (report === null || facts.binding.state !== 'bound' || facts.hub.state === 'unknown') return { status: 'loading-chat', code: null };
  return { status: 'ready', code: null };
}

export function createTempDockStatus(deps: TempDockStatusDeps): TempDockStatusController {
  let facts: TempDockFacts = TEMP_DOCK_INITIAL;
  const views = new ViewListeners();
  const smokeListeners = new Set<(smoke: TempDockSmoke) => void>();
  const DOCK: ViewSelector & { readonly of: 'dock' } = { of: 'dock' };

  const smoke = (): TempDockSmoke => {
    const { status, code } = statusOf(facts);
    return {
      status,
      code,
      login: facts.session?.login ?? null,
      sessionKnown: facts.session !== undefined,
      page: facts.binding.state === 'bound' ? { label: facts.binding.binding.pageLabel, title: facts.binding.pageTitle } : null,
      bindingCode: facts.binding.state === 'refused' ? facts.binding.code : null,
      contract: contractSummary(facts.contract),
      reload: status === 'reload-needed',
    };
  };

  const view = (): DockVM => {
    const { status, code } = statusOf(facts);
    const error = code === null ? null : deps.errorOf(code);
    const state: VmView = viewState(status, error, facts.contract);
    const copyOnly = status === 'host-degraded' || status === 'blocked-fan';
    return {
      view: state,
      visible: facts.route?.name === 'chat' && facts.route.chat !== null,
      mode: copyOnly ? 'copy-only' : 'insert',
      status,
      statusError: error,
      // Target handles come with R11's dock controller: nothing can be generated from this dock.
      targetHandle: null,
      persona: null,
      mark: status === 'ready' ? 'normal' : 'faint',
      quota: null,
      options: { tone: null, tones: [...TONES], split: false, locked: false, toneReason: null, splitReason: null, toneHotkey: null, splitHotkey: null },
      actions: Object.fromEntries(DOCK_ACTION_IDS.map((id) => [id, OFF_ACTION])) as DockVM['actions'],
      result: null,
      analysis: null,
      refusal: null,
      runningElsewhere: [],
      statusWords: status === 'loading-chat',
      hints: true,
      keysFooter: false,
      resultStyle: 'bare',
      paletteHotkey: null,
      debug: null,
    };
  };

  const publish = (): void => {
    views.notify(DOCK, view());
    const next = smoke();
    for (const listener of [...smokeListeners]) {
      try {
        listener(next);
      } catch {
        // A view's bug is not the controller's.
      }
    }
  };

  return {
    kinds: ['dock'],
    getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>> {
      if (selector.of !== 'dock') throw new Error(`temp dock status: not my view «${selector.of}»`);
      // The selector is `dock`: its view model is DockVM (ViewOf cannot narrow a generic S here).
      return view() as unknown as Readonly<ViewOf<S>>;
    },
    subscribe<S extends ViewSelector>(selector: S, listener: (next: Readonly<ViewOf<S>>) => void): () => void {
      return views.add(selector, listener);
    },
    // Every dock action belongs to R11's controller; this one takes none.
    dispatch(_action: UiAction): Promise<ActionReceipt> | null {
      return null;
    },
    update(patch) {
      const next = { ...facts, ...patch };
      // Nothing changed: no re-render (MAIN repeats a composer state per keystroke).
      if ((Object.keys(patch) as (keyof TempDockFacts)[]).every((key) => JSON.stringify(facts[key]) === JSON.stringify(next[key]))) return;
      facts = next;
      publish();
    },
    facts: () => facts,
    smoke,
    onSmoke(listener) {
      smokeListeners.add(listener);
      return () => smokeListeners.delete(listener);
    },
    retranslate: publish,
  };
}
