// Composition root of the extension pages: popup, options, debug pages
// (architecture.md §9.9, §10).
//
// TEMPORARY (integration step M1): the options page is a minimal sign-in and
// status page, the popup shows the same status; R16 replaces both with the
// real pages. The debug pages are still placeholders.

import { mountPagePlaceholder, mountTempPage } from '@cg/ui';

import { createTempPage } from './pages/port';

export type PageName = 'popup' | 'options' | 'debug-prompt' | 'debug-journal';

const TITLES: Record<Exclude<PageName, 'popup' | 'options'>, string> = {
  'debug-prompt': 'Отладка: промпт и ответ',
  'debug-journal': 'Отладка: журнал операций',
};

export function composePage(page: PageName, container: HTMLElement | null): void {
  if (!container) return;
  if (page === 'popup' || page === 'options') {
    const temp = createTempPage(window);
    const mounted = mountTempPage(page, container, temp.deps, temp.port);
    window.addEventListener('pagehide', () => {
      mounted.unmount();
      temp.dispose();
    });
    return;
  }
  mountPagePlaceholder(container, {
    title: TITLES[page],
    lines: ['Каркас расширения (R00). Здесь появится страница из пакета R16.'],
  });
}
