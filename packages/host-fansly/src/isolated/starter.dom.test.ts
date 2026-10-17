// The start of the Fansly host in the isolated world (R20 P7a0, P7c; docs/project-unite/
// architecture.md §1.3, §7.1): what it does at document_start without MAIN —
// our hosts of a dead instance go, the dock host with its closed root exists
// and stands nowhere, the overlays come in <html> on first use, the bridge
// gives up after its timeout and says so, and Fansly's host port comes all the
// same, saying the host is not ready. The handshake itself: bridge.test.ts;
// the port: host-port.dom.test.ts; in Firefox, on the stand:
// suite-fansly-site.e2e.ts and suite-fansly-tap.e2e.ts.

import { afterEach, describe, expect, it } from 'vitest';

import { createKeyboardProbe } from './keyboard';
import { routeOfLocation } from './route';
import { startFanslyTab, type FanslyDiagnostic } from './starter';
import { loadValidation } from './validation';

afterEach(() => {
  document.documentElement.removeAttribute('data-fx-instance');
  document.documentElement.removeAttribute('data-fx-reload');
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
});

describe('the Fansly start without MAIN', () => {
  it('takes our hosts of a dead instance out, makes the dock host with a closed root that stands nowhere, and overlays in <html> on first use', async () => {
    document.body.innerHTML = '<div data-host="dock"></div><div data-host="overlay"></div><div data-host="dock"><span>not ours</span></div>';
    const started = startFanslyTab({ win: window, validation: loadValidation, redeem: () => Promise.resolve(false), handshakeTimeoutMs: 20 });
    expect(started.staleHosts).toBe(2);
    // The one whose light DOM has content is no host of ours.
    expect(document.querySelectorAll('[data-host]')).toHaveLength(2);
    expect(started.activation.stopped.aborted).toBe(true);
    const { dock } = started.mounts;
    expect(dock.host.isConnected).toBe(false);
    expect(dock.host.getAttribute('data-host')).toBe('dock');
    expect(started.mounts.registry.rootOf(dock.host)).toBe(dock.root);
    expect(started.mounts.points()).toEqual({ dock: { kind: 'none', composerInstanceId: null, width: null }, overlay: { ready: true, container: null } });
    const modal = started.mounts.overlay('modal');
    expect(started.mounts.overlay('modal')).toBe(modal);
    expect(modal.host.parentElement).toBe(document.documentElement);
    expect([modal.host.getAttribute('data-host'), modal.host.getAttribute('data-layer'), modal.host.style.getPropertyValue('z-index')]).toEqual(['overlay', 'modal', '1950']);
    expect(started.mounts.registry.hosts()).toEqual([dock.host, modal.host]);
    // Fansly's theme is the page's own (P7d): dark without `bright-theme` on <html>.
    expect(started.theme.current()).toEqual({ scheme: 'dark', tokens: {}, fixedWidth: false });
    started.mounts.dispose();
    expect(modal.host.isConnected).toBe(false);
    expect(started.mounts.registry.hosts()).toEqual([]);
    // The handshake gives up within the test, never after its window is gone.
    (await started.host).dispose();
  });

  it('[ER-048] without MAIN the bridge is null after its timeout and the tab hears «not ready»; Fansly’s host port comes all the same and says so', async () => {
    const diagnostics: FanslyDiagnostic[] = [];
    const started = startFanslyTab({ win: window, validation: loadValidation, redeem: () => Promise.resolve(false), handshakeTimeoutMs: 20, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    expect(await started.bridge).toBeNull();
    expect(diagnostics).toEqual([{ event: 'main-missing', code: 'CG-HOST-NOT-READY' }]);
    const port = await started.host;
    expect([port.kind, port.platform]).toEqual(['fansly-web', 'fansly']);
    expect(port.probe().capabilities.identity).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(port.current()).toMatchObject({ identity: null, accounts: [], composer: null, mounts: { dock: { kind: 'none' } } });
    port.dispose();
  });

  it('the keys: a conversation’s address is a chat (P7c); its field under the route is Fansly’s message field, one elsewhere is not, and its modal is a window of its own (P7i)', async () => {
    expect(routeOfLocation({ pathname: '/messages/123456789012345678' })).toEqual({ kind: 'chat', epoch: '/messages/123456789012345678' });
    const started = startFanslyTab({ win: window, validation: loadValidation, redeem: () => Promise.resolve(false), handshakeTimeoutMs: 20 });
    const probe = createKeyboardProbe(document, started.mounts.registry);
    document.body.innerHTML = '<app-group-message-input><textarea class="message-input"></textarea></app-group-message-input>';
    const field = document.querySelector('textarea');
    field?.focus();
    expect(probe.focus(new KeyboardEvent('keydown', { key: 'k' }))).toBe('field');
    document.body.innerHTML = '<app-messages-conversation-route><app-group-message-container><app-group-message-input><textarea class="message-input"></textarea></app-group-message-input></app-group-message-container></app-messages-conversation-route>';
    document.querySelector('textarea')?.focus();
    expect(probe.focus(new KeyboardEvent('keydown', { key: 'k' }))).toBe('composer');
    expect(probe.nativeModalOpen()).toBe(false);
    document.body.classList.add('modal-opened');
    expect(probe.nativeModalOpen()).toBe(true);
    document.body.classList.remove('modal-opened');
    started.mounts.dispose();
    (await started.host).dispose();
  });
});
