// The fan's warning marks in Fansly's header (./fan-marks.ts): which marks show of an answer, and when the header asks —
// once per opened chat, nothing while loading or after a failure, a late answer never painting another chat.

import { describe, expect, it } from 'vitest';

import type { FanslyFanMarks } from '@cg/contracts/tab-messages-fansly';

import { FAN_MARKS_NONE, createFanMarks, fanMarksView, type FanMarksAnswer, type FanMarksTarget } from './fan-marks';

const T = '2026-10-20T12:00:00.000Z';
const post = (postedAt: string, handle = 'stand_fan_1', link: string | null = 'https://t.me/c/1716498488/1'): FanslyFanMarks['blocklist'][number] => ({ postedAt, text: ` https://fansly.com/${handle}\nDNP + TM `, author: ' agency ', link, handle });
const MARKS: FanslyFanMarks = {
  lists: [
    { here: false, name: 'Lora', label: '💩 Бомж', since: null },
    { here: true, name: 'Model Two', label: ' 💩 Бомж ', since: T },
    { here: false, name: 'Lora', label: '💩 Бомж', since: null },
    { here: false, name: 'Ari', label: '💩бомж', since: null },
  ],
  blocklist: [post('2026-09-01T10:00:00.000Z', 'old_name'), post(T)],
};

describe('[host:fansly] the fan marks of an answer', () => {
  it('the lists by label, this page first and named once; each model once; the posts newest first, a renamed one said', () => {
    expect(fanMarksView(MARKS, 'Stand_Fan_1')).toEqual({
      lists: {
        label: '💩 Бомж',
        groups: [
          { label: '💩 Бомж', here: true, names: ['Lora'] },
          { label: '💩бомж', here: false, names: ['Ari'] },
        ],
      },
      posts: [
        { postedAt: Date.parse(T), text: 'https://fansly.com/stand_fan_1\nDNP + TM', author: 'agency', link: 'https://t.me/c/1716498488/1', handle: 'stand_fan_1', renamed: false },
        { postedAt: Date.parse('2026-09-01T10:00:00.000Z'), text: 'https://fansly.com/old_name\nDNP + TM', author: 'agency', link: 'https://t.me/c/1716498488/1', handle: 'old_name', renamed: true },
      ],
    });
  });

  it('a list named with the team note after a dash is the short name, one group with the same list elsewhere', () => {
    const lists: FanslyFanMarks['lists'] = [
      { here: false, name: 'Lilly', label: ' 💩 Бомж - денег нет и не собирается тратить ', since: null },
      { here: true, name: 'Lora', label: ' 💩 Бомж ', since: T },
    ];
    expect(fanMarksView({ lists, blocklist: [] }, 'x').lists).toEqual({ label: '💩 Бомж', groups: [{ label: '💩 Бомж', here: true, names: ['Lilly'] }] });
    expect(fanMarksView({ lists: [{ here: false, name: 'Ari', label: 'Бомж-список', since: null }], blocklist: [] }, 'x').lists?.label).toBe('Бомж-список');
  });

  it('no list and no post is no mark; a list only elsewhere still marks; an unknown username says no post is renamed', () => {
    expect(fanMarksView({ lists: [], blocklist: [] }, 'x')).toBe(FAN_MARKS_NONE);
    expect(fanMarksView({ lists: [{ here: false, name: 'Ari', label: '  ', since: null }], blocklist: [] }, 'x')).toBe(FAN_MARKS_NONE);
    expect(fanMarksView({ lists: [{ here: false, name: 'Ari', label: '💩 Бомж', since: null }], blocklist: [] }, 'x').lists).toEqual({ label: '💩 Бомж', groups: [{ label: '💩 Бомж', here: false, names: ['Ari'] }] });
    expect(fanMarksView({ lists: [], blocklist: [post(T, 'old_name')] }, null).posts[0]?.renamed).toBe(false);
  });
});

describe('[host:fansly] the header asks once per opened chat', () => {
  function world() {
    let session: string | null = 'creator|1|0';
    let target: FanMarksTarget | null = { pageId: 13, accountId: '700000000000000017', fanId: '920000000000000003', username: 'stand_fan_1' };
    const reads: Array<{ readonly target: FanMarksTarget; readonly settle: (answer: FanMarksAnswer) => void }> = [];
    const client = createFanMarks({
      session: () => session,
      target: () => target,
      read: (asked) => new Promise((settle) => reads.push({ target: asked, settle })),
    });
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    return {
      client,
      reads,
      flush,
      open: (fanId: string | null, username = 'stand_fan_1') => {
        target = fanId === null ? null : { pageId: 13, accountId: '700000000000000017', fanId, username };
        client.sync();
      },
      signIn: (next: string | null) => {
        session = next;
        client.sync();
      },
    };
  }
  const FAN_A = '920000000000000003';
  const FAN_B = '920000000000000032';

  it('nothing while loading; the marks once answered; a sync while the chat stays open asks nothing', async () => {
    const w = world();
    w.client.sync();
    w.client.sync();
    expect(w.reads).toHaveLength(1);
    expect(w.client.view()).toBe(FAN_MARKS_NONE);
    w.reads[0]?.settle({ ok: true, marks: MARKS });
    await w.flush();
    expect(w.client.view().lists?.label).toBe('💩 Бомж');
    w.client.sync();
    expect(w.reads).toHaveLength(1);
  });

  it('a failed read shows nothing and keeps nothing; the next opening asks again', async () => {
    const w = world();
    w.client.sync();
    w.reads[0]?.settle({ ok: false });
    await w.flush();
    expect(w.client.view()).toBe(FAN_MARKS_NONE);
    w.open(null);
    w.open(FAN_A);
    expect(w.reads).toHaveLength(2);
  });

  it('a chat opened again shows its kept marks at once and asks again; a late answer never paints another chat', async () => {
    const w = world();
    w.client.sync();
    w.reads[0]?.settle({ ok: true, marks: MARKS });
    await w.flush();
    w.open(FAN_B);
    expect(w.client.view()).toBe(FAN_MARKS_NONE);
    w.open(FAN_A);
    expect(w.client.view().posts).toHaveLength(2);
    expect(w.reads.map((read) => read.target.fanId)).toEqual([FAN_A, FAN_B, FAN_A]);
    // B's answer comes while A is open: kept for B, not shown on A.
    w.reads[1]?.settle({ ok: true, marks: { lists: [], blocklist: [post(T)] } });
    await w.flush();
    expect(w.client.view().lists?.label).toBe('💩 Бомж');
    w.reads[2]?.settle({ ok: true, marks: { lists: [], blocklist: [] } });
    await w.flush();
    expect(w.client.view()).toBe(FAN_MARKS_NONE);
    w.open(FAN_B);
    expect(w.client.view().posts).toHaveLength(1);
  });

  it('another sign-in forgets what was kept, and an answer read under the old one is dropped', async () => {
    const w = world();
    w.client.sync();
    w.signIn('creator|2|0');
    expect(w.reads).toHaveLength(2);
    w.reads[0]?.settle({ ok: true, marks: MARKS });
    await w.flush();
    expect(w.client.view()).toBe(FAN_MARKS_NONE);
    w.signIn(null);
    expect(w.client.view()).toBe(FAN_MARKS_NONE);
    expect(w.reads).toHaveLength(2);
  });
});
