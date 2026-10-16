import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Unmount } from '@cg/contracts';
import { mountPopup } from '@cg/ui/pages';

import { FANSLY_PAGE_SITES, fanslyPageState } from './fansly';
import { PAGES_NOW, pagesWorld, settle, type PagesWorld } from './world';

let unmount: Unmount | undefined;
let world: PagesWorld | undefined;
beforeEach(() => vi.useFakeTimers({ now: PAGES_NOW }));
afterEach(() => {
  unmount?.();
  world?.client.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

it.each([
  [0, null],
  [1, '1 вкладка ждёт перезагрузки'],
  [2, '2 вкладки ждут перезагрузки'],
  [5, '5 вкладок ждут перезагрузки'],
  [11, '11 вкладок ждут перезагрузки'],
  [21, '21 вкладка ждёт перезагрузки'],
] as const)('[PU-005] the rendered reload count uses plural forms: %s', async (count, expected) => {
  const state = fanslyPageState('fansly');
  state.diagnostics = { ...state.diagnostics, siteAccess: [{ host: 'fansly-web', enabled: true, granted: true, registered: true, waitingReload: count }] };
  const w = pagesWorld({ page: 'popup', state, sites: FANSLY_PAGE_SITES });
  world = w;
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    w.client.start();
    await settle();
    unmount = mountPopup(root, w.deps);
    await settle();
  });
  for (let round = 0; round < 3; round++) await act(async () => { await settle(); });
  expect(root.querySelector('[data-pg-site="fansly-web"] small')?.textContent ?? null).toBe(expected);
});
