import type { CgErrorWire } from '@cg/contracts/errors';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { FanMarks, FanMarksQuery } from '@cg/contracts/hub';
import { parseFanslyTabPayload } from '@cg/contracts/tab-messages-fansly';
import { featureSlice } from '@cg/core/domain/features';
import { describe, expect, it, vi } from 'vitest';

import { FAN_MARKS_CACHE, createFanMarksReader } from '../bg/fansly/fan-marks';
import type { BackgroundKit, HostSiteSender } from '../src/composition/background/host-module';

const CREATOR = '700000000000000017';
const PAGE_ID = 13;
const PAGE_LABEL = 'model-two-fansly';
const FAN = '920000000000000003';
const T0 = Date.UTC(2026, 9, 27, 10);
const sender: HostSiteSender = { kind: 'tab', host: 'fansly-web', tabId: 1, tabSessionId: 'tab', url: 'https://fansly.com/messages/1' };
const request = { pageId: PAGE_ID, hostAccountId: CREATOR, fanRef: FAN, username: 'stand_fan_1' };
const SLICE = featureSlice(FEATURES_COMMON, FANSLY_FEATURES);

const answer = (link = 'https://t.me/c/1716498488/48211'): FanMarks => ({
  pageLabel: PAGE_LABEL,
  fanRef: FAN,
  lists: [
    { pageLabel: 'lora-fansly', modelName: 'Lora', granted: false, label: '💩 Бомж', since: '2026-10-01T00:00:00Z' },
    { pageLabel: PAGE_LABEL, modelName: null, granted: true, label: ' 💩 Бомж ', since: null },
  ],
  blocklist: [{ postedAt: '2026-10-24T08:00:00Z', text: 'x'.repeat(700), author: null, link, handle: '@stand_fan_1' }],
  listsReadAt: null,
  blocklistReadAt: null,
});

function world() {
  let now = T0;
  let capabilities = ['fan-marks-v1'];
  const fanMarks = vi.fn((_query: FanMarksQuery) => Promise.resolve(answer()));
  const kit = {
    hub: {
      page: (pageId: number) => Promise.resolve(pageId === PAGE_ID ? { ok: true, page: { pageId, pageLabel: PAGE_LABEL, platform: 'fansly' } } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
      bootstrap: () => ({ capabilities, pages: [{ pageId: PAGE_ID, pageLabel: PAGE_LABEL, platform: 'fansly', platformAccountId: CREATOR, features: {} }] }),
      session: () => ({ hubOrigin: 'https://hub.test', userId: 2 }),
      facade: { fanMarks },
      errorWire: (error: unknown): CgErrorWire => (error as { wire?: CgErrorWire }).wire ?? { code: 'CG-HUB-UNKNOWN' },
    },
    clock: { now: () => now },
    networkSession: { aliases: () => [] },
    log: { service: vi.fn() },
  } as unknown as BackgroundKit;
  return {
    reader: createFanMarksReader(kit, SLICE),
    fanMarks,
    advance: (ms: number) => {
      now += ms;
    },
    withoutCapability: () => {
      capabilities = [];
    },
  };
}

describe('[host:fansly] the fan marks of the chat header (`fansly.marks.read`)', () => {
  it("one hub read per page and fan for ten minutes: a read in flight is joined, a chat opened again is answered from it", async () => {
    const w = world();
    const [first, joined] = await Promise.all([w.reader.read(request, sender), w.reader.read(request, { ...sender, tabId: 2, tabSessionId: 'tab-2' })]);
    expect(w.fanMarks.mock.calls).toEqual([[{ pageLabel: PAGE_LABEL, fanRef: FAN, username: 'stand_fan_1' }]]);
    expect(joined).toBe(first);
    w.advance(FAN_MARKS_CACHE.ttlMs - 1);
    expect(await w.reader.read(request, sender)).toBe(first);
    expect(w.fanMarks).toHaveBeenCalledTimes(1);
    w.advance(1);
    await w.reader.read(request, sender);
    expect(w.fanMarks).toHaveBeenCalledTimes(2);
    // Another fan is its own read.
    await w.reader.read({ ...request, fanRef: '920000000000000032' }, sender);
    expect(w.fanMarks).toHaveBeenCalledTimes(3);
  });

  it('the answer a tab takes: bounded, this page marked, a model without a name by its page; a link off Telegram dropped', async () => {
    const w = world();
    const read = await w.reader.read(request, sender);
    expect(read.ok && read.marks.lists).toEqual([
      { here: false, name: 'Lora', label: '💩 Бомж', since: '2026-10-01T00:00:00.000Z' },
      { here: true, name: PAGE_LABEL, label: '💩 Бомж', since: null },
    ]);
    expect(read.ok && read.marks.blocklist.map((post) => [post.text.length, post.handle, post.link])).toEqual([[600, 'stand_fan_1', 'https://t.me/c/1716498488/48211']]);
    expect(parseFanslyTabPayload('res', 'fansly.marks.read', read).ok).toBe(true);
    w.fanMarks.mockImplementationOnce(() => Promise.resolve(answer('javascript:alert(1)')));
    const other = await w.reader.read({ ...request, fanRef: '920000000000000032' }, sender);
    expect(other.ok && other.marks.blocklist[0]?.link).toBeNull();
  });

  it('a failed read is answered as its failure and not kept: the next opening asks again', async () => {
    const w = world();
    w.fanMarks.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('down'), { wire: { code: 'CG-HUB-UNAVAILABLE' } })));
    expect(await w.reader.read(request, sender)).toEqual({ ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } });
    expect((await w.reader.read(request, sender)).ok).toBe(true);
    expect(w.fanMarks).toHaveBeenCalledTimes(2);
  });

  it('a hub without `fan-marks-v1`, another page or the settings page is never asked', async () => {
    const w = world();
    expect((await w.reader.read({ ...request, pageId: 99 }, sender)).ok).toBe(false);
    expect((await w.reader.read(request, { kind: 'page' } as unknown as HostSiteSender)).ok).toBe(false);
    w.withoutCapability();
    expect(await w.reader.read(request, sender)).toMatchObject({ ok: false });
    expect(w.fanMarks).not.toHaveBeenCalled();
  });
});
