// Our hosts as every site's page gets them (architecture.md §6.3, decision
// X22): a plain `div` with a closed root and neutral attributes, and the
// sweep of the hosts a dead instance of the extension left behind. Where a
// host stands is a site's mount manager's (ChatSpace:
// host-chatspace/src/isolated/mount.dom.test.ts, which also pins what the
// page sees on a host in every mode).

import { afterEach, describe, expect, it } from 'vitest';

import { HOST_ATTRIBUTE, LAYER_ATTRIBUTE, MODE_ATTRIBUTE, OVERLAY_Z, mountClosedHost, removeStaleHosts } from './hosts';
import { createShadowRootRegistry } from './shadow-registry';

afterEach(() => {
  document.body.replaceChildren();
  for (const host of document.querySelectorAll('[data-host]')) host.remove();
});

describe('our hosts in the page (§6.3)', () => {
  it('mountClosedHost and removeStaleHosts', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const host = mountClosedHost(parent, 'overlay', 'last');
    expect(parent.lastChild).toBe(host.host);
    expect(host.host.shadowRoot).toBeNull();
    expect(removeStaleHosts(document)).toBe(1);
    expect(parent.childNodes).toHaveLength(0);
  });

  it('[X22] removeStaleHosts takes only our host shape: a page element with the same neutral attribute stays; a host of a build before X22 goes', () => {
    const theirs = document.createElement('div');
    theirs.setAttribute('data-host', 'dock');
    theirs.append(document.createElement('span'));
    const span = document.createElement('span');
    span.setAttribute('data-host', 'overlay');
    const old = document.createElement('div');
    old.setAttribute('data-cg', 'dock');
    document.body.append(theirs, span, old);
    expect(removeStaleHosts(document)).toBe(1);
    expect([theirs.isConnected, span.isConnected, old.isConnected]).toEqual([true, true, false]);
  });

  it('[X22] a host is a plain div with a closed root: the dock goes first in its parent, an overlay last; a registry learns the root and forgets it with the host', () => {
    const parent = document.createElement('div');
    parent.append(document.createElement('p'));
    document.body.append(parent);
    const registry = createShadowRootRegistry();
    const dock = mountClosedHost(parent, 'dock', 'first', registry);
    const overlay = mountClosedHost(parent, 'overlay', 'last', registry);
    expect([parent.firstChild, parent.lastChild]).toEqual([dock.host, overlay.host]);
    for (const { host, root } of [dock, overlay]) {
      expect([host.tagName, host.shadowRoot, root.mode, host.childNodes.length]).toEqual(['DIV', null, 'closed', 0]);
      expect(registry.rootOf(host)).toBe(root);
    }
    expect([dock.host.getAttribute(HOST_ATTRIBUTE), overlay.host.getAttribute(HOST_ATTRIBUTE)]).toEqual(['dock', 'overlay']);
    dock.remove();
    expect([dock.host.isConnected, registry.rootOf(dock.host), registry.hosts()]).toEqual([false, null, [overlay.host]]);
  });

  it('the names the page sees are neutral, and the layers stand under a site\'s own dialogs', () => {
    expect([HOST_ATTRIBUTE, MODE_ATTRIBUTE, LAYER_ATTRIBUTE]).toEqual(['data-host', 'data-mode', 'data-layer']);
    expect(OVERLAY_Z).toEqual({ panel: 900, modal: 950, toast: 960 });
  });
});
