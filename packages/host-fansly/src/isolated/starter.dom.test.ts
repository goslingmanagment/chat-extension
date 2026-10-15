// The start of the Fansly host in the isolated world (R20 P7a0; docs/project-unite/
// architecture.md §1.3, §7.1): what it does at document_start without MAIN —
// our hosts of a dead instance go, the dock host with its closed root exists
// and stands nowhere, the overlays come in <html> on first use, the bridge
// gives up after its timeout and says so, and no host port of Fansly's comes
// before P7c. The handshake itself: bridge.test.ts; in Firefox, on the stand:
// suite-fansly-site.e2e.ts.

import { afterEach, describe, expect, it } from 'vitest';

import { createKeyboardProbe, routeOfLocation } from './keyboard';
import { startFanslyTab, type FanslyDiagnostic } from './starter';
import { loadValidation } from './validation';

afterEach(() => {
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
});

describe('the Fansly start without MAIN', () => {
  it('takes our hosts of a dead instance out, makes the dock host with a closed root that stands nowhere, and overlays in <html> on first use', async () => {
    document.body.innerHTML = '<div data-host="dock"></div><div data-host="overlay"></div><div data-host="dock"><span>not ours</span></div>';
    const started = startFanslyTab({ win: window, validation: loadValidation, handshakeTimeoutMs: 20 });
    expect(started.staleHosts).toBe(2);
    // The one whose light DOM has content is no host of ours.
    expect(document.querySelectorAll('[data-host]')).toHaveLength(1);
    const { dock } = started.mounts;
    expect(dock.host.isConnected).toBe(false);
    expect(dock.host.getAttribute('data-host')).toBe('dock');
    expect(started.mounts.registry.rootOf(dock.host)).toBe(dock.root);
    expect(started.mounts.points()).toEqual({ dock: { kind: 'none', composerInstanceId: null, width: null }, overlay: { ready: true, container: null } });
    const modal = started.mounts.overlay('modal');
    expect(started.mounts.overlay('modal')).toBe(modal);
    expect(modal.host.parentElement).toBe(document.documentElement);
    expect([modal.host.getAttribute('data-host'), modal.host.getAttribute('data-layer'), modal.host.style.getPropertyValue('z-index')]).toEqual(['overlay', 'modal', '950']);
    expect(started.mounts.registry.hosts()).toEqual([dock.host, modal.host]);
    expect(started.theme.current()).toEqual({ scheme: 'light', tokens: {}, fixedWidth: false });
    started.mounts.dispose();
    expect(modal.host.isConnected).toBe(false);
    expect(started.mounts.registry.hosts()).toEqual([]);
    // The handshake's timer ends inside the test, not after the environment is gone.
    expect(await started.bridge).toBeNull();
  });

  it('without MAIN the bridge is null after its timeout and the tab hears «not ready»; Fansly’s host port never comes before P7c', async () => {
    const diagnostics: FanslyDiagnostic[] = [];
    const started = startFanslyTab({ win: window, validation: loadValidation, handshakeTimeoutMs: 20, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    expect(await started.bridge).toBeNull();
    expect(diagnostics).toEqual([{ event: 'main-missing', code: 'CG-HOST-NOT-READY' }]);
    const never = Symbol('never');
    expect(await Promise.race([started.host, new Promise((resolve) => setTimeout(() => resolve(never), 30))])).toBe(never);
    started.mounts.dispose();
  });

  it('the keys: no route of the address is a chat yet (P7c), no field is Fansly’s message field and no window of its own is open (P7i)', async () => {
    expect(routeOfLocation({ pathname: '/messages/123456789012345678' })).toEqual({ kind: 'other', epoch: '/messages/123456789012345678' });
    const started = startFanslyTab({ win: window, validation: loadValidation, handshakeTimeoutMs: 20 });
    const probe = createKeyboardProbe(document, started.mounts.registry);
    document.body.innerHTML = '<app-group-message-input><textarea class="message-input"></textarea></app-group-message-input>';
    const field = document.querySelector('textarea');
    field?.focus();
    expect(probe.focus(new KeyboardEvent('keydown', { key: 'k' }))).toBe('field');
    document.body.classList.add('modal-opened');
    expect(probe.nativeModalOpen()).toBe(false);
    started.mounts.dispose();
    expect(await started.bridge).toBeNull();
  });
});
