// core/domain/media: the media a preview part takes along (decision X53) —
// picks in order, free previews, the typed price, and the SendMedia a send
// carries only when every rule of SendMediaSchema holds.

import { describe, expect, it } from 'vitest';

import { MEDIA_LIMITS, SendMediaSchema, type MediaItem } from '@cg/contracts';

import { EMPTY_ATTACHMENT, attachmentProblem, attachmentSummary, parsePrice, sendMediaOf, togglePick } from '../src/domain/media/attachment';

const item = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, type: 'photo', duration: 0, ready: true, thumb: null, createdAt: null, ...extra });
const NO_TAGS = { users: [], guests: [] };

describe('parsePrice', () => {
  it('reads empty, 0 and «free» as free media', () => {
    for (const typed of ['', ' ', '0', '0.00', '$0', 'free', 'FREE']) expect(parsePrice(typed)).toEqual({ ok: true, cents: 0 });
  });
  it('turns dollars into cents without floating point', () => {
    expect(parsePrice('3')).toEqual({ ok: true, cents: 300 });
    expect(parsePrice('$ 24.99')).toEqual({ ok: true, cents: 2499 });
    expect(parsePrice('19,9')).toEqual({ ok: true, cents: 1990 });
    expect(parsePrice('200')).toEqual({ ok: true, cents: 20_000 });
    expect(parsePrice('4.10')).toEqual({ ok: true, cents: 410 });
  });
  it('says what is wrong', () => {
    expect(parsePrice('abc')).toEqual({ ok: false, problem: 'format' });
    expect(parsePrice('-5')).toEqual({ ok: false, problem: 'format' });
    expect(parsePrice('5.999')).toEqual({ ok: false, problem: 'decimals' });
    expect(parsePrice('2.99')).toEqual({ ok: false, problem: 'min' });
    expect(parsePrice('200.01')).toEqual({ ok: false, problem: 'max' });
  });
});

describe('picks', () => {
  it('puts the previews first and the paid media after them, each in the order of the clicks', () => {
    let a = togglePick(EMPTY_ATTACHMENT, item('3'));
    a = togglePick(a, item('1'));
    a = togglePick(a, item('5'), true);
    a = togglePick(a, item('2'));
    a = togglePick(a, item('4'), true);
    expect(a.picks.map((pick) => [pick.id, pick.free])).toEqual([
      ['5', true],
      ['4', true],
      ['3', false],
      ['1', false],
      ['2', false],
    ]);
  });
  it('drops a pick clicked again as the same, turns it when clicked as the other', () => {
    let a = togglePick(togglePick(togglePick(EMPTY_ATTACHMENT, item('3')), item('1')), item('2'));
    // A paid pick clicked at «Превью» becomes the preview, first in the message.
    a = togglePick(a, item('1'), true);
    expect(a.picks.map((pick) => [pick.id, pick.free])).toEqual([
      ['1', true],
      ['3', false],
      ['2', false],
    ]);
    // Back at «Платное» it goes behind the price, at the end.
    a = togglePick(a, item('1'));
    expect(a.picks.map((pick) => [pick.id, pick.free])).toEqual([
      ['3', false],
      ['2', false],
      ['1', false],
    ]);
    a = togglePick(a, item('3'));
    expect(a.picks.map((pick) => pick.id)).toEqual(['2', '1']);
    a = togglePick(togglePick(a, item('6'), true), item('6'), true);
    expect(a.picks.map((pick) => pick.id)).toEqual(['2', '1']);
  });
  it('never picks a medium that is not ready, nor more than one message takes', () => {
    expect(togglePick(EMPTY_ATTACHMENT, item('1', { ready: false })).picks).toEqual([]);
    let a = EMPTY_ATTACHMENT;
    for (let i = 1; i <= MEDIA_LIMITS.maxMedia + 3; i++) a = togglePick(a, item(String(i)));
    expect(a.picks).toHaveLength(MEDIA_LIMITS.maxMedia);
  });
});

describe('sendMediaOf', () => {
  it('is null while empty or not valid', () => {
    expect(sendMediaOf(EMPTY_ATTACHMENT, NO_TAGS)).toBeNull();
    const a = { ...togglePick(EMPTY_ATTACHMENT, item('1')), price: '2' };
    expect(attachmentProblem(a)).toEqual({ kind: 'price', problem: 'min' });
    expect(sendMediaOf(a, NO_TAGS)).toBeNull();
  });
  it('refuses a priced message whose every medium is a free preview', () => {
    const a = { ...togglePick(EMPTY_ATTACHMENT, item('1'), true), price: '10' };
    expect(attachmentProblem(a)).toEqual({ kind: 'all-free' });
    expect(sendMediaOf(a, NO_TAGS)).toBeNull();
  });
  it('drops the preview marks of a free message, keeps them in a priced one', () => {
    const picked = togglePick(togglePick(EMPTY_ATTACHMENT, item('2', { type: 'video', duration: 75 })), item('1'), true);
    const free = sendMediaOf(picked, NO_TAGS);
    expect(free?.priceCents).toBe(0);
    expect(free?.items.every((media) => !media.free)).toBe(true);
    expect(attachmentSummary(picked)).toEqual({ count: 2, previews: 0, priceCents: 0 });
    const priced = sendMediaOf({ ...picked, price: '25' }, { users: ['77'], guests: [] });
    expect(priced).toEqual({
      items: [
        { id: '1', type: 'photo', duration: 0, thumb: null, free: true },
        { id: '2', type: 'video', duration: 75, thumb: null, free: false },
      ],
      priceCents: 2500,
      tags: { users: ['77'], guests: [] },
    });
    expect(SendMediaSchema.safeParse(priced).success).toBe(true);
    expect(attachmentSummary({ ...picked, price: '25' })).toEqual({ count: 2, previews: 1, priceCents: 2500 });
  });
});
