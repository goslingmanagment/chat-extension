// Opening our own pages in a tab (architecture.md §9.4 «Страница настроек»;
// ST-006 «одна вкладка настроек», ST-007 code → section): the page already
// open is focused (and pointed at the section), otherwise a new tab opens.
// No `tabs` permission is needed: our documents and their tabs come from
// `runtime.getContexts` (Firefox 129+), and `tabs.update` / `tabs.create`
// on our own pages need none. Never throws: a failure is `{ ok: false }`.

import type { ExtensionPage } from '@cg/contracts/tab-protocol';

import { defaultBrowser, type BrowserApi } from './browser-api';

/** Pages that open in a tab (the popup never does). */
export type TabExtensionPage = Exclude<ExtensionPage, 'popup'>;

export type OpenPageResult = { readonly ok: true; readonly reused: boolean } | { readonly ok: false };

export interface ExtensionPagesPort {
  /** Focuses the page if it is open in a tab (one settings tab), else opens it; `section` is the URL hash. */
  open(page: TabExtensionPage, section?: string): Promise<OpenPageResult>;
}

/** The document URL without its hash and query: the page it is, whatever section it shows. */
function pageOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

export function createExtensionPages(api: BrowserApi = defaultBrowser()): ExtensionPagesPort {
  return {
    async open(page, section) {
      const base = api.runtime.getURL(`${page}.html`);
      const hash = section === undefined ? '' : section.replace(/^#/, '');
      const url = hash === '' ? base : `${base}#${encodeURI(hash)}`;
      try {
        const contexts = api.runtime.getContexts ? await api.runtime.getContexts({ contextTypes: ['TAB'] }) : [];
        const open = contexts.find((context) => context.tabId >= 0 && pageOf(context.documentUrl) === base);
        if (open) {
          // A hash change only scrolls the page to its section; it does not reload it.
          await api.tabs.update(open.tabId, hash === '' ? { active: true } : { active: true, url });
          if (open.windowId >= 0) await api.windows.update(open.windowId, { focused: true }).catch(() => undefined);
          return { ok: true, reused: true };
        }
        if (page === 'options' && hash === '' && api.runtime.openOptionsPage) await api.runtime.openOptionsPage();
        else await api.tabs.create({ url, active: true });
        return { ok: true, reused: false };
      } catch {
        return { ok: false };
      }
    },
  };
}
