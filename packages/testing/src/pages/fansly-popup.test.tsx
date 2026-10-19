import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Unmount } from '@cg/contracts';
import { mountPopup } from '@cg/ui/pages';

import { FANSLY_PAGE_SITES, fanslyPageState } from './fansly';
import { fanslyOffFixture, fanslyOnFixture } from './fansly-settings';
import { PAGES_NOW, pagesWorld, settle, signedOutState, type PagesWorld } from './world';

let unmount: Unmount | undefined;
let world: PagesWorld | undefined;
beforeEach(() => vi.useFakeTimers({ now: PAGES_NOW }));
afterEach(() => {
  unmount?.();
  world?.client.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function popupWith(fixture: ReturnType<typeof fanslyOnFixture>): Promise<{ readonly root: HTMLElement; readonly world: PagesWorld }> {
  const w = pagesWorld({ page: 'popup', state: fanslyPageState('fansly'), sites: FANSLY_PAGE_SITES, fansly: fixture });
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
  return { root, world: w };
}

it.each([
  [0, null, null],
  [1, '1 вкладка открыта раньше, чем ChatGoose там заработал.', 'Перезагрузить вкладку'],
  [2, '2 вкладки открыты раньше, чем ChatGoose там заработал.', 'Перезагрузить вкладки'],
  [5, '5 вкладок открыты раньше, чем ChatGoose там заработал.', 'Перезагрузить вкладки'],
  [11, '11 вкладок открыты раньше, чем ChatGoose там заработал.', 'Перезагрузить вкладки'],
  [21, '21 вкладка открыта раньше, чем ChatGoose там заработал.', 'Перезагрузить вкладки'],
] as const)('[FS-IDN-4] [PU-005] Fansly’s tabs that wait for a reload are a problem on the stage, its words in plural forms: %s', async (count, expected, press) => {
  const fixture = fanslyOnFixture(PAGES_NOW);
  fixture.access = fixture.access === null ? null : { ...fixture.access, waitingReload: count };
  const { root } = await popupWith(fixture);
  const alert = [...root.querySelectorAll('.pg-popup__stage [data-cg-code="CG-RUNTIME-RELOADED"]')].find((node) => node.textContent?.includes('Fansly'));
  expect(alert?.querySelector('p')?.textContent ?? null).toBe(expected);
  expect(alert?.querySelector('.pg-primary')?.textContent ?? null).toBe(press);
  if (count > 0) expect(alert?.querySelector('.pg-popup__alert-t')?.textContent).toBe(count === 1 ? 'Перезагрузите вкладку Fansly' : 'Перезагрузите вкладки Fansly');
});

it('[FS-IDN-4] «Перезагрузить вкладку» reloads them through `site.access`, the problem goes and a toast says how many', async () => {
  const fixture = fanslyOnFixture(PAGES_NOW);
  const { root, world: w } = await popupWith(fixture);
  const press = [...root.querySelectorAll<HTMLElement>('.pg-popup__stage button')].find((node) => node.textContent === 'Перезагрузить вкладку');
  expect(press).toBeDefined();
  await act(async () => {
    press?.click();
    await settle();
  });
  for (let round = 0; round < 3; round++) await act(async () => { await settle(); });
  expect(w.fanslyBackground?.calls.map((call) => call.payload)).toContainEqual({ host: 'fansly-web', reload: true });
  expect(root.querySelector('.pg-popup__stage [data-cg-code="CG-RUNTIME-RELOADED"]')).toBeNull();
  expect(root.querySelector('.cg-toast')?.textContent).toContain('Перезагружено вкладок: 1');
});

it('[P9a] the switch is a quiet word in the foot’s one line, never above the persona: «Включить Fansly»', async () => {
  const { root } = await popupWith(fanslyOffFixture());
  const foot = root.querySelector('.pg-popup__foot');
  expect([...(foot?.querySelectorAll('button') ?? [])].map((node) => node.textContent)).toEqual(['Что нового', 'Включить Fansly', 'Обновить статус']);
  // The P3b hook: the signed builds' spec presses `.pg-site-access button`.
  expect(root.querySelector('.pg-site-access button')?.textContent).toBe('Включить Fansly');
  const order = [...(root.querySelector('.pg-popup')?.children ?? [])].map((node) => node.className.split(' ')[0]);
  expect(order.indexOf('pg-popup__foot')).toBeGreaterThan(order.indexOf('pg-popup__sec'));
});

it('[FS-IDN-4] [P3b] signed out, Fansly’s tabs that wait for a reload are still said, with «Перезагрузить вкладку» under «Нужно войти»', async () => {
  const fixture = fanslyOnFixture(PAGES_NOW);
  const w = pagesWorld({ page: 'popup', state: signedOutState(PAGES_NOW), sites: FANSLY_PAGE_SITES, fansly: fixture });
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
  expect(root.querySelector('[data-cg-code="CG-AUTH-REQUIRED"]')).not.toBeNull();
  expect(root.querySelector('.pg-popup__stage .pg-popup__alert-t')?.textContent).toBe('Перезагрузите вкладку Fansly');
  expect([...root.querySelectorAll('.pg-popup__stage button')].map((node) => node.textContent)).toEqual(['Перезагрузить вкладку']);
});
