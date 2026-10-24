import { describe, expect, it } from 'vitest';

import { type ChatRef } from '@cg/contracts/ids';
import { type MediaPort } from '@cg/contracts/media';

import { createI18n } from '../../domain/i18n';
import { type Attachment } from '../../domain/media/attachment';
import { MediaDesk } from './media';

// «Рассылка» on OnlyFans: the vault media one whale's card picked go to every fan of the outreach — who gets what.

const ACCOUNT = '1001';
const chat = (fan: string): ChatRef => ({ host: 'chatspace', hostAccountId: ACCOUNT, platformFanId: fan });
const pick = (id: string, free = false) => ({ id, type: 'video' as const, duration: 356, thumb: null, free });

function world() {
  const timers = new Map<number, () => void>();
  let next = 1;
  const tagsAsked: string[][] = [];
  const port: MediaPort = {
    folders: () => Promise.resolve({ ok: true, value: { items: [], hasMore: false } }),
    items: () => Promise.resolve({ ok: true, value: { items: [], hasMore: false } }),
    fanStates: () => Promise.resolve({ ok: true, value: [] }),
    tags: (_account, ids) => {
      tagsAsked.push([...ids]);
      return Promise.resolve({ ok: true, value: { users: [], guests: [] } });
    },
  };
  const desk = new MediaDesk({
    port,
    i18n: createI18n({ language: 'ru', now: () => 0, timeZone: 'Europe/Moscow' }),
    clock: {
      setTimer(_ms, fn) {
        timers.set(next, fn);
        return next++;
      },
      clearTimer: (handle) => void timers.delete(handle),
    },
    changed: () => undefined,
    shown: () => true,
  });
  /** The release forms are read after their pause: every timer fires, then their answers land. */
  const settle = async (): Promise<void> => {
    for (const [handle, fn] of [...timers]) {
      timers.delete(handle);
      fn();
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  return { desk, settle, tagsAsked };
}

describe('«Рассылка» on OnlyFans: the outreach media', () => {
  it('a whale’s valid picks go to each fan of the outreach, a fan’s own picks stay, new outreach media replace only what it gave', async () => {
    const w = world();
    const dragon: Attachment = { picks: [pick('501'), pick('502', true)], price: '25' };
    // The whale's card where the person picked the video and its free preview, at $25.
    w.desk.adopt(chat('1'), dragon);
    const outreach = w.desk.copyOf(chat('1'));
    expect(outreach).toBe(dragon);

    // A fan of the batch with no picks takes them; a fan the person picked something else for keeps that.
    const own: Attachment = { picks: [pick('900')], price: '' };
    w.desk.adopt(chat('3'), own);
    expect(w.desk.adopt(chat('2'), dragon)).toBe(true);
    expect(w.desk.adopt(chat('3'), dragon)).toBe(false);
    await w.settle();
    expect(w.desk.attachment(chat('2'))).toEqual({ kind: 'media', media: { items: [pick('501'), pick('502', true)], priceCents: 2500, tags: { users: [], guests: [] } } });
    expect(w.desk.attachment(chat('3'))).toEqual({ kind: 'media', media: { items: [pick('900')], priceCents: 0, tags: { users: [], guests: [] } } });

    // The outreach's media change: the fan it gave the old ones takes the new; the fan's own stay.
    const cheaper: Attachment = { picks: [pick('501'), pick('502', true)], price: '15' };
    expect(w.desk.adopt(chat('2'), cheaper, dragon)).toBe(true);
    expect(w.desk.adopt(chat('3'), cheaper, null)).toBe(false);
    await w.settle();
    const fan2 = w.desk.attachment(chat('2'));
    expect(fan2.kind === 'media' ? fan2.media.priceCents : null).toBe(1500);

    // Picks that cannot go (no valid price, every pick a free preview) never become the outreach's.
    w.desk.adopt(chat('4'), { picks: [pick('503', true)], price: '20' });
    expect(w.desk.copyOf(chat('4'))).toBeNull();
    expect(w.desk.copyOf(chat('5'))).toBeNull();
  });
});
