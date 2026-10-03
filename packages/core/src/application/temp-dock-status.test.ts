// The TEMPORARY dock status controller of the M1 integration (goes with R11).

import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { ANCHOR_IDS, HOST_CAPABILITIES, HostContractReportSchema, type AnchorId, type CapabilityState, type HostCapability, type HostContractReport, type RouteState } from '@cg/contracts/host';
import { type HubBinding, type SessionIdentity } from '@cg/contracts/ids';
import { DOCK_ACTION_IDS, type DockVM } from '@cg/contracts/vm';
import { describe, expect, it } from 'vitest';

import { createTempDockStatus, type TempDockFacts } from './temp-dock-status';

const errorOf = (code: CgCode): CgErrorView => (code === 'CG-AUTH-REQUIRED' ? { code, title: 'T', body: 'B', settings: { section: 'account' } } : { code, title: 'T', body: 'B' });

const session: SessionIdentity = { hubOrigin: 'https://hub.example', userId: 7, login: 'masha', role: 'chatter', epoch: 3 };
const binding: HubBinding = {
  hubOrigin: session.hubOrigin,
  principalId: session.userId,
  loginEpoch: session.epoch,
  host: 'chatspace',
  hostAccountId: '4100',
  platform: 'onlyfans',
  platformAccountId: '900100',
  pageId: 12,
  pageLabel: 'synthetic-vip-of',
  bindingRevision: 1,
};
const chat = { host: 'chatspace', hostAccountId: '4100', platformFanId: '74001001' } as const;
const route: RouteState = {
  epoch: 1,
  name: 'chat',
  account: { host: 'chatspace', hostAccountId: '4100', platform: 'onlyfans', platformAccountId: '900100', username: null, displayName: null },
  chat,
};

function report(overrides: Partial<Record<HostCapability, CapabilityState>> = {}, anchors: Partial<Record<AnchorId, 'missing' | 'shape'>> = {}): HostContractReport {
  // Part B is off until it lands: X8, the WS tap and the receipt observer.
  const partB = { previewSend: { state: 'off' }, incoming: { state: 'off' }, receipt: { state: 'off' }, sendObserve: { state: 'off' } } as const;
  return HostContractReportSchema.parse({
    build: 'index-Synthetic1',
    adapterVersion: '0.1.0',
    checkedAt: 1_700_000_000_000,
    anchors: { ...Object.fromEntries(ANCHOR_IDS.map((id) => [id, 'ok'])), wsFrames: 'missing', receiptProfile: 'missing', ...anchors },
    capabilities: { ...Object.fromEntries(HOST_CAPABILITIES.map((name) => [name, { state: 'on' }])), ...partB, ...overrides },
  });
}

const READY: Partial<TempDockFacts> = {
  runtime: 'ready',
  session,
  hub: { state: 'ok' },
  route,
  binding: { state: 'bound', binding, pageTitle: 'Synthetic VIP' },
  contract: report(),
  composer: { ready: true, hidden: false },
};

const dockOf = (controller: ReturnType<typeof createTempDockStatus>): DockVM => controller.getSnapshot({ of: 'dock' });

describe('temp dock status (M1, replaced by R11)', () => {
  it('serves a whole dock view model with every AI action off', () => {
    const controller = createTempDockStatus({ errorOf });
    const dock = dockOf(controller);
    expect(controller.kinds).toEqual(['dock']);
    expect(Object.keys(dock.actions)).toEqual([...DOCK_ACTION_IDS]);
    expect(Object.values(dock.actions).every((action) => !action.enabled && !action.busy)).toBe(true);
    expect(dock).toMatchObject({ visible: false, status: 'loading-chat', statusError: null, targetHandle: null, result: null, mark: 'faint' });
    expect(controller.dispatch({ type: 'CancelGeneration', operationId: '00000000-0000-4000-8000-000000000001' })).toBeNull();
  });

  it('[AU-001] not signed in: the banner is CG-AUTH-REQUIRED with the way to the account section', () => {
    const controller = createTempDockStatus({ errorOf });
    controller.update({ ...READY, session: null, binding: { state: 'none' } });
    const dock = dockOf(controller);
    expect(dock.status).toBe('not-signed-in');
    expect(dock.statusError?.code).toBe('CG-AUTH-REQUIRED');
    expect(dock.view).toEqual({ s: 'forbidden', error: dock.statusError, remedy: { type: 'OpenSettings', route: { section: 'account' } } });
    expect(controller.smoke()).toMatchObject({ login: null, sessionKnown: true, page: null, code: 'CG-AUTH-REQUIRED' });
  });

  it('signed in with a bound page: ready, and the smoke lines name the login and the page label', () => {
    const controller = createTempDockStatus({ errorOf });
    controller.update(READY);
    expect(dockOf(controller)).toMatchObject({ status: 'ready', statusError: null, visible: true, mode: 'insert', mark: 'normal', view: { s: 'ready' } });
    expect(controller.smoke()).toEqual({
      status: 'ready',
      code: null,
      login: 'masha',
      sessionKnown: true,
      page: { label: 'synthetic-vip-of', title: 'Synthetic VIP' },
      bindingCode: null,
      contract: { state: 'ok', build: 'index-Synthetic1', anchors: ['receiptProfile', 'wsFrames'] },
      reload: false,
    });
  });

  it('[AU-023] a refused binding shows its own code: CG-BINDING-MISSING, CG-BINDING-AMBIGUOUS', () => {
    const controller = createTempDockStatus({ errorOf });
    for (const code of ['CG-BINDING-MISSING', 'CG-BINDING-AMBIGUOUS'] as const) {
      controller.update({ ...READY, binding: { state: 'refused', code } });
      expect(dockOf(controller)).toMatchObject({ status: 'no-binding', statusError: { code } });
      expect(controller.smoke()).toMatchObject({ page: null, bindingCode: code });
    }
  });

  it('the host contract: a broken vital anchor stops the dock, a broken composer bridge leaves copy only', () => {
    const controller = createTempDockStatus({ errorOf });
    controller.update({ ...READY, contract: report({ accounts: { state: 'contractBroken', code: 'CG-HOST-CONTRACT' } }, { accounts: 'shape' }) });
    expect(dockOf(controller)).toMatchObject({ status: 'host-degraded', statusError: { code: 'CG-HOST-CONTRACT' }, mode: 'copy-only' });
    expect(controller.smoke().contract).toEqual({ state: 'broken', build: 'index-Synthetic1', anchors: ['accounts', 'receiptProfile', 'wsFrames'] });

    controller.update({ contract: report({ insert: { state: 'off', code: 'CG-HOST-COMPOSER-MISSING' } }, { composerBridge: 'missing' }) });
    const dock = dockOf(controller);
    expect(dock).toMatchObject({ status: 'host-degraded', statusError: { code: 'CG-HOST-COMPOSER-MISSING' }, mode: 'copy-only' });
    expect(dock.view).toEqual({ s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: ['insert'] }] });
    expect(controller.smoke().contract.state).toBe('degraded');
  });

  it('[UP-009] reload needed wins over everything: the extension was reloaded under the tab, or the tab predates it', () => {
    const controller = createTempDockStatus({ errorOf });
    controller.update({ ...READY, runtime: 'reloaded' });
    expect(dockOf(controller)).toMatchObject({ status: 'reload-needed', statusError: { code: 'CG-RUNTIME-RELOADED' } });
    controller.update({ runtime: 'ready', needsReload: true, session: null });
    expect(dockOf(controller).status).toBe('reload-needed');
    expect(controller.smoke().reload).toBe(true);
  });

  it('a blocked fan is copy only; a hub that did not answer shows its code; no background is CG-RUNTIME-UNREACHABLE', () => {
    const controller = createTempDockStatus({ errorOf });
    controller.update({ ...READY, composer: { ready: true, hidden: true } });
    expect(dockOf(controller)).toMatchObject({ status: 'blocked-fan', statusError: { code: 'CG-GATE-FAN-BLOCKED' }, mode: 'copy-only' });
    controller.update({ composer: { ready: true, hidden: false }, hub: { state: 'failed', code: 'CG-HUB-UNAVAILABLE' }, binding: { state: 'none' } });
    expect(dockOf(controller)).toMatchObject({ status: 'hub-down', statusError: { code: 'CG-HUB-UNAVAILABLE' }, view: { s: 'offline' } });
    controller.update({ runtime: 'unreachable' });
    expect(dockOf(controller)).toMatchObject({ status: 'hub-down', statusError: { code: 'CG-RUNTIME-UNREACHABLE' } });
  });

  it('tells its subscribers only when something changed', () => {
    const controller = createTempDockStatus({ errorOf });
    const views: string[] = [];
    const smokes: string[] = [];
    controller.subscribe({ of: 'dock' }, (dock) => views.push(dock.status));
    const off = controller.onSmoke((smoke) => smokes.push(smoke.status));
    controller.update(READY);
    controller.update({ composer: { ready: true, hidden: false } });
    controller.update({ session: null });
    expect(views).toEqual(['ready', 'not-signed-in']);
    expect(smokes).toEqual(['ready', 'not-signed-in']);
    controller.retranslate();
    expect(views).toHaveLength(3);
    off();
    controller.update({ session });
    expect(smokes).toHaveLength(3);
  });
});
