import { describe, expect, it, vi } from 'vitest';
import { showReloadNotice } from './notice';

describe('FS-IDN-4 reload notice', () => {
  it('cleans only recognised empty orphan hosts and preserves foreign/unrecognised nodes; repeated injection adds one banner', () => {
    document.body.innerHTML = '<div data-host="dock"></div><div data-host="overlay"></div><div data-host="foreign"></div><div data-host="dock"><span>foreign content</span></div><fb-extension-panel>neighbour</fb-extension-panel>';
    showReloadNotice(document); showReloadNotice(document);
    expect(document.querySelectorAll('div[data-host="reload-notice"]')).toHaveLength(1);
    expect(document.querySelectorAll('div[data-host="dock"]')).toHaveLength(1);
    expect(document.querySelector('div[data-host="overlay"]')).toBeNull();
    expect(document.querySelector('div[data-host="foreign"]')).not.toBeNull();
    expect(document.querySelector('fb-extension-panel')?.textContent).toBe('neighbour');
  });
});

  it('replaces the inert closed-root notice of an unloaded extension with a working button', () => {
    document.querySelectorAll('[data-host="reload-notice"]').forEach((node) => node.remove());
    const stale = document.createElement('div'); stale.dataset['host'] = 'reload-notice';
    stale.attachShadow({ mode: 'closed' }).append(document.createElement('button'));
    document.documentElement.append(stale);
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
    const attach = vi.spyOn(Element.prototype, 'attachShadow');
    showReloadNotice(document);
    expect(stale.isConnected).toBe(false);
    const root = attach.mock.results[0]?.value as ShadowRoot;
    root.querySelector('button')?.click();
    expect(reload).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
