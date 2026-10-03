// Composition root of the extension pages: popup, options, debug pages
// (architecture.md §9.9, §10). R16 replaces the placeholders with real pages.

import { mountPagePlaceholder } from '@cg/ui';

export type PageName = 'popup' | 'options' | 'debug-prompt' | 'debug-journal';

const TITLES: Record<PageName, string> = {
  popup: 'ChatGoose',
  options: 'Настройки ChatGoose',
  'debug-prompt': 'Отладка: промпт и ответ',
  'debug-journal': 'Отладка: журнал операций',
};

export function composePage(page: PageName, container: HTMLElement | null): void {
  if (!container) return;
  mountPagePlaceholder(container, {
    title: TITLES[page],
    lines: ['Каркас расширения (R00). Здесь появится страница из пакета R16.'],
  });
}
