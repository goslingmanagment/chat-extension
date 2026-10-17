// The media picker of a preview (decision X53): the strip's toggle, the panel
// with the folders, the grid and the price, the line that says what goes
// while the panel is closed, and «Отправить» that names the media it takes.
// Nothing of the picker sends: its clicks are actions of the picker only.

import { afterEach, describe, expect, it } from 'vitest';

import { type MediaPickerVM, type PreviewVM, type UiAction } from '@cg/contracts';

import { ctxOf, entry, msg, preview, uuid, views, withResult, type AppClientScenario } from '../scenarios/app-client';
import { flush, mountBoardSettled, settle, textOf, type MountedBoard } from './harness';
import { boardScenario, sendResult } from './states';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const OP = uuid(731);

const picker = (patch: Partial<MediaPickerVM> = {}): MediaPickerVM => ({
  open: true,
  folders: {
    items: [
      { id: 'all', name: null, count: null, selected: true },
      { id: '880002', name: 'Stand set', count: 14, selected: false },
    ],
    hasMore: false,
    loading: false,
    error: null,
  },
  grid: {
    items: [
      { id: '11', type: 'photo', duration: 0, thumb: 'https://pw365.ompcdn.com/11.jpg', ready: true, order: 2, free: false, fan: 'paid' },
      { id: '12', type: 'video', duration: 75, thumb: 'https://pw365.ompcdn.com/12.jpg', ready: true, order: 1, free: true, fan: null },
      { id: '13', type: 'photo', duration: 0, thumb: null, ready: false, order: null, free: false, fan: 'unpaid' },
    ],
    hasMore: false,
    loading: false,
    error: null,
  },
  picks: 2,
  price: { text: '25', problem: null },
  priced: true,
  summary: msg('preview.media.summaryPaidPreviews', { media: '2 медиа', previews: '1 бесплатное превью', price: '$25' }),
  attached: { count: 2, priceCents: 2500 },
  blocked: null,
  allFree: false,
  tags: 'ok',
  ...patch,
});

function scenario(media: MediaPickerVM | null): AppClientScenario {
  const base = boardScenario('11a');
  const vm: PreviewVM = { ...withResult(preview(ctx, 'spenders', views.ready()), sendResult(ctx, OP, 'reply', ['first part'], [{ s: 'available' }], [])), media };
  return { ...base, views: [...base.views.filter((view) => view.selector.of !== 'preview'), entry({ of: 'preview', from: 'spenders' }, vm)] };
}

/** The panel is a chunk of its own: mounted, it shows once the chunk is here. */
async function panelShown(): Promise<void> {
  for (let i = 0; i < 50 && ui?.$('.cg-pvm') === null; i++) await settle();
  expect(ui?.$('.cg-pvm')).not.toBeNull();
}

const media = (): UiAction[] => (ui?.actions() ?? []).filter((action) => /Media/.test(action.type));

describe('[X53] the media picker of a preview', () => {
  it('no picker where the page does not send from previews: no toggle, no panel', async () => {
    ui = await mountBoardSettled('spenders', scenario(null));
    expect(ui.$('[data-cg-strip="media"]')).toBeNull();
    expect(ui.$('.cg-pvm')).toBeNull();
    expect(textOf(ui.$('.cg-pvs__send'))).toBe('Отправить');
  });

  it('the strip’s toggle shows the number of picks and opens or closes the panel', async () => {
    ui = await mountBoardSettled('spenders', scenario(picker({ open: false })));
    const toggle = ui.$('[data-cg-strip="media"] > button') as HTMLElement;
    expect(textOf(toggle)).toContain('Медиа');
    expect(textOf(toggle.querySelector('.cg-pvm__count'))).toBe('2');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await flush(() => toggle.click());
    expect(media().at(-1)).toMatchObject({ type: 'SetMediaOpen', open: true });
  });

  it('closed with picks: one line says what goes with the next part sent', async () => {
    ui = await mountBoardSettled('spenders', scenario(picker({ open: false })));
    expect(ui.$('[data-cg-media-panel="open"]')).toBeNull();
    expect(textOf(ui.$('[data-cg-media-panel="closed"] .cg-pvm__sum'))).toBe('2 медиа · 1 бесплатное превью · $25 · Уйдёт с частью, которую отправите');
  });

  it('open: the folders, the cells with their order, the fan’s marks and the free-preview switch; clicks are the picker’s actions', async () => {
    ui = await mountBoardSettled('spenders', scenario(picker()));
    await panelShown();
    expect(ui.$$('.cg-pvm__folder').map((button) => [textOf(button), button.getAttribute('aria-selected')])).toEqual([
      ['Все медиа', 'true'],
      ['Stand set', 'false'],
    ]);
    expect(ui.$$('.cg-pvm__cell').map((cell) => [cell.getAttribute('data-cg-media'), textOf(cell.querySelector('.cg-pvm__order')), textOf(cell.querySelector('.cg-pvm__fan'))])).toEqual([
      ['11', '2', 'куплено'],
      ['12', '1', ''],
      ['13', '', 'не куплено'],
    ]);
    expect((ui.$('[data-cg-media="12"] .cg-pvm__pick') as HTMLElement).getAttribute('aria-label')).toBe('Видео 1:15, выбрано, 1-е по порядку');
    // A medium the platform has not finished is shown, never picked.
    const waiting = ui.$('[data-cg-media="13"] .cg-pvm__pick') as HTMLElement;
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
    await flush(() => waiting.click());
    expect(media()).toEqual([]);
    await flush(() => (ui?.$('[data-cg-media="11"] .cg-pvm__pick') as HTMLElement).click());
    await flush(() => (ui?.$('[data-cg-media="12"] .cg-pvm__free') as HTMLElement).click());
    await flush(() => (ui?.$$('.cg-pvm__folder')[1] as HTMLElement).click());
    expect(media().map((action) => action.type)).toEqual(['PickMedia', 'ToggleMediaFree', 'ChooseMediaFolder']);
    expect(media()[0]).toMatchObject({ mediaId: '11' });
    expect(media()[2]).toMatchObject({ folder: '880002' });
  });

  it('the price field says what is wrong; a free message has no free-preview switches', async () => {
    ui = await mountBoardSettled('spenders', scenario(picker({ price: { text: '2', problem: msg('preview.media.price.min') }, priced: false, attached: null, blocked: msg('preview.media.blocked.price') })));
    await panelShown();
    expect(textOf(ui.$('.cg-pvm__notes'))).toBe('Минимальная цена PPV — $3 (или 0 = бесплатно)');
    expect(ui.$('.cg-pvm__free')).toBeNull();
  });

  it('«Отправить» names what it takes along: the media and the price', async () => {
    ui = await mountBoardSettled('spenders', scenario(picker()));
    expect(textOf(ui.$('.cg-pvs__send'))).toBe('Отправить + 2 медиа за $25');
  });

  it('free media: «Отправить + 2 медиа»', async () => {
    ui = await mountBoardSettled('spenders', scenario(picker({ attached: { count: 2, priceCents: 0 }, priced: false })));
    expect(textOf(ui.$('.cg-pvs__send'))).toBe('Отправить + 2 медиа');
  });
});
