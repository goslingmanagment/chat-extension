// The media picker of a preview (decision X53): «Отправить» names the media
// and the PPV price it takes along, as the person reads it before the click.

import { afterEach, describe, expect, it } from 'vitest';

import { type MediaPickerVM, type PreviewVM } from '@cg/contracts';

import { ctxOf, entry, msg, preview, uuid, views, withResult, type AppClientScenario } from '../scenarios/app-client';
import { mountBoardSettled, textOf, type MountedBoard } from './harness';
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

describe('[X53] the media picker of a preview', () => {
  it('«Отправить» names what it takes along: the media and the price', async () => {
    ui = await mountBoardSettled('spenders', scenario(picker()));
    expect(textOf(ui.$('.cg-pvs__send'))).toBe('Отправить + 2 медиа за $25');
  });
});
