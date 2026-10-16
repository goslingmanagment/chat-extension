import { describe, expect, it, vi } from 'vitest';
import { noticeReason, showReloadNotice } from './notice';

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

  it('[FS-IDN-4] [UP-009] says why (R20 P14c): switched on — reload to switch it on; a copy of ours ran here — the extension was updated; the old extension — switch it off first', () => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-fx-instance');
    const texts = (): string[] => {
      const attach = vi.spyOn(Element.prototype, 'attachShadow');
      showReloadNotice(document);
      const root = attach.mock.results[0]?.value as ShadowRoot;
      vi.restoreAllMocks();
      return [noticeReason(document), root.querySelector('span')?.textContent ?? ''];
    };
    expect(texts()).toEqual(['message', 'ChatGoose: перезагрузите вкладку, чтобы включить расширение на Fansly.']);
    document.documentElement.setAttribute('data-fx-instance', '1');
    expect(texts()).toEqual(['update', 'ChatGoose обновлён: перезагрузите вкладку, чтобы продолжить работу на Fansly.']);
    document.body.innerHTML = '<div id="chatgoose-root"></div>';
    expect(texts()).toEqual(['legacy', 'ChatGoose: выключите старое расширение ChatGoose для Fansly и перезагрузите вкладку.']);
    document.documentElement.removeAttribute('data-fx-instance');
    document.body.innerHTML = '';
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
