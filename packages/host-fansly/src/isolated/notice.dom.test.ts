import { describe, expect, it } from 'vitest';
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
