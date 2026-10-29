import { describe, expect, it } from 'vitest';

import { DRAFT_MEDIA_CAPABILITY, LIVE_IMAGES_CAPABILITY, LIVE_PPV_CAPABILITY, chatKeyOf, type AiStartFields, type DraftMedia, type UserOptions } from '@cg/contracts';
import { CHATSPACE_AI } from '@cg/core/application/hosts/chatspace/ai';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, openChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { OTHER_TAB } from './support/ai-background';
import { readyHarness, type Harness, type HarnessOptions } from './support/ai-harness';
import { NOW_MS } from './support/world';

const CAPTURED = new Date(NOW_MS).toISOString();
const LATER = new Date(NOW_MS + 10_000).toISOString();
const MEDIA: DraftMedia = {
  capturedAt: CAPTURED,
  priceUsd: 25,
  items: [
    { type: 'photo', free: true, image: { mediaType: 'image/jpeg', data: 'AAAA' } },
    { type: 'video', durationSec: 60, free: false },
  ],
};
const PPV = { capturedAt: CAPTURED, items: [{ platformMessageId: '900', priceUsd: 25, purchased: false }] };
const IMAGES = [{ platformMessageId: '901', mediaId: '902', sentAt: CAPTURED, mediaType: 'image/jpeg' as const, data: 'AAAA' }];

interface Sources {
  media: DraftMedia | null;
  fields: AiStartFields;
}

async function harness(sources: Sources, shared?: HarnessOptions['shared']): Promise<Harness> {
  const baseHost = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  const bootstrap = { ...BOOTSTRAP_PILOT_PAGES, capabilities: [...BOOTSTRAP_PILOT_PAGES.capabilities, DRAFT_MEDIA_CAPABILITY, LIVE_PPV_CAPABILITY.onlyfans!, LIVE_IMAGES_CAPABILITY] };
  const h = await readyHarness({
    baseHost,
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap,
    resolve: resolveHubErrorReference,
    meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  }, { policy: { ...CHATSPACE_AI, fields: () => sources.fields }, ...(shared === undefined ? {} : { shared }) });
  Object.assign(h.host, { readDraftMedia: () => Promise.resolve(sources.media) });
  return h;
}

async function reply(h: Harness, options: UserOptions = {}): Promise<string> {
  h.script(h.streamOf('fast-reply', ['a reply for this context']));
  const receipt = await h.generate('reply', options);
  if (!receipt.ok || receipt.opId === undefined) throw new Error(`not started: ${JSON.stringify(receipt)}`);
  await h.finish();
  expect(h.dock().result?.state).toBe('done');
  return receipt.opId;
}

describe('AI result cache: the media and PPV context of the click', () => {
  it.each<{ change: string; before: DraftMedia | null; after: DraftMedia | null }>([
    { change: 'attach media', before: null, after: MEDIA },
    { change: 'remove all media', before: MEDIA, after: null },
    { change: 'replace a photo', before: MEDIA, after: { ...MEDIA, items: [{ type: 'photo', free: true, image: { mediaType: 'image/jpeg', data: 'BBBB' } }, MEDIA.items[1]!] } },
    { change: 'remove one attachment', before: MEDIA, after: { ...MEDIA, items: [MEDIA.items[0]!] } },
    { change: 'reorder attachments', before: MEDIA, after: { ...MEDIA, items: [...MEDIA.items].reverse() } },
    { change: 'change the media kind', before: MEDIA, after: { ...MEDIA, items: [MEDIA.items[0]!, { type: 'audio', durationSec: 60, free: false }] } },
    { change: 'change the duration', before: MEDIA, after: { ...MEDIA, items: [MEDIA.items[0]!, { type: 'video', durationSec: 120, free: false }] } },
    { change: 'change the free preview', before: MEDIA, after: { ...MEDIA, items: [MEDIA.items[0]!, { type: 'video', durationSec: 60, free: true }] } },
    { change: 'change the price', before: MEDIA, after: { ...MEDIA, priceUsd: 30 } },
    { change: 'remove the price', before: MEDIA, after: { ...MEDIA, priceUsd: null } },
  ])('$change: unchanged media reopens; changed media needs a clicked request', async ({ before, after }) => {
    const sources: Sources = { media: before, fields: {} };
    const h = await harness(sources);
    const first = await reply(h);
    if (sources.media !== null) sources.media = { ...sources.media, capturedAt: LATER };
    expect(await h.generate('reply')).toMatchObject({ ok: true, opId: first });
    expect(h.bg.hub.streams).toHaveLength(1);

    await h.dispatch({ type: 'HideResult', operationId: first });
    sources.media = after;
    await h.settle();
    expect(h.bg.hub.streams).toHaveLength(1);
    const second = await reply(h);
    expect(second).not.toBe(first);
    expect(h.bg.hub.streams).toHaveLength(2);
    expect(h.bg.hub.streams[1]?.body.draftMedia ?? null).toEqual(after);
    expect(await h.generate('reply')).toMatchObject({ ok: true, opId: second });
    expect(h.bg.hub.streams).toHaveLength(2);
  });

  it.each<{ change: string; before: AiStartFields; after: AiStartFields }>([
    { change: 'PPV purchase', before: { livePpv: PPV }, after: { livePpv: { ...PPV, items: [{ ...PPV.items[0]!, purchased: true }] } } },
    { change: 'PPV price', before: { livePpv: PPV }, after: { livePpv: { ...PPV, items: [{ ...PPV.items[0]!, priceUsd: 30 }] } } },
    { change: 'PPV state becomes available', before: {}, after: { livePpv: PPV } },
    { change: 'PPV state disappears', before: { livePpv: PPV }, after: {} },
    { change: 'fan photo becomes available', before: {}, after: { liveImages: IMAGES } },
    { change: 'fan photo changes', before: { liveImages: IMAGES }, after: { liveImages: [{ ...IMAGES[0]!, data: 'BBBB' }] } },
  ])('$change: the same chat messages do not hide new context', async ({ before, after }) => {
    const sources: Sources = { media: null, fields: before };
    const h = await harness(sources);
    const first = await reply(h);
    if (sources.fields.livePpv !== undefined) sources.fields = { ...sources.fields, livePpv: { ...sources.fields.livePpv, capturedAt: LATER } };
    expect(await h.generate('reply')).toMatchObject({ ok: true, opId: first });
    expect(h.bg.hub.streams).toHaveLength(1);

    sources.fields = after;
    await h.settle();
    expect(h.bg.hub.streams).toHaveLength(1);
    const second = await reply(h);
    expect(second).not.toBe(first);
    expect(h.bg.hub.streams).toHaveLength(2);
    expect(h.bg.hub.streams[1]?.body.livePpvContext).toEqual(after.livePpv);
    expect(h.bg.hub.streams[1]?.body.liveImages).toEqual(after.liveImages);
    expect(await h.generate('reply')).toMatchObject({ ok: true, opId: second });
    expect(h.bg.hub.streams).toHaveLength(2);
  });
});

describe('spent answers belong to their own request cache entry', () => {
  it('an unused replacement from another tab owns the cache slot over this tab\'s spent answer', async () => {
    const sources: Sources = { media: MEDIA, fields: {} };
    const h = await harness(sources);
    const first = await reply(h);
    expect(await h.dispatch({ type: 'InsertPart', operationId: first, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    h.host.type('');

    const other = await harness(sources, { bg: h.bg, clock: h.clock, tab: OTHER_TAB });
    expect(await other.generate('reply')).toMatchObject({ ok: true, opId: first });
    other.script(other.streamOf('fast-reply', ['an unused replacement']));
    const generated = await other.dispatch({ type: 'Regenerate', operationId: first });
    expect(generated).toMatchObject({ ok: true, outcome: 'started' });
    await other.finish();
    const second = other.dock().result?.opId;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    await h.ai.workspace.ops.syncChat(chatKeyOf(openChat));
    expect(h.ai.workspace.ops.get(second!)?.memo.personaDefinitionId).toBeNull();
    expect(await h.generate('reply')).toMatchObject({ ok: true, opId: second });
    expect(h.bg.hub.streams).toHaveLength(2);
  });

  it.each(['tone', 'split', 'media', 'ppv'] as const)('returning to earlier %s: only that answer decides whether the click reuses it', async (parameter) => {
    for (const used of ['first', 'second'] as const) {
      const sources: Sources = { media: null, fields: {} };
      const h = await harness(sources);
      const options = (second: boolean): UserOptions => {
        sources.media = parameter === 'media' && second ? MEDIA : null;
        sources.fields = parameter === 'ppv' && second ? { livePpv: PPV } : {};
        return parameter === 'tone' ? { tone: second ? 'flirty' : 'casual' } : parameter === 'split' ? { split: second } : {};
      };
      const insert = async (opId: string): Promise<void> => {
        expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
        h.host.type('');
        await h.settle();
      };

      const first = await reply(h, options(false));
      if (used === 'first') await insert(first);
      const second = await reply(h, options(true));
      expect(second).not.toBe(first);
      if (used === 'second') await insert(second);

      const same = options(false);
      if (used === 'first') {
        const next = await reply(h, same);
        expect(next).not.toBe(first);
        expect(h.bg.hub.streams).toHaveLength(3);
        expect(await h.generate('reply', same)).toMatchObject({ ok: true, opId: next });
        expect(h.bg.hub.streams).toHaveLength(3);
      } else {
        expect(await h.generate('reply', same)).toMatchObject({ ok: true, opId: first });
        expect(h.bg.hub.streams).toHaveLength(2);
      }
      expect((h.bg.callsOf('op.start') as { force?: boolean }[]).slice(0, 3).map((call) => call.force === true)).toEqual([false, false, used === 'first']);
    }
  });
});
