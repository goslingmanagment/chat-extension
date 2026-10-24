// Who sent each message (decision X48, composition/background/attribution.ts): whether the background owes the hub a
// send at all, and for which page and client — over the pilot's pages and the sites' slices of the manifest; and
// (Chat Memory week 1) how the text of a send was written.

import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { type Bootstrap } from '@cg/contracts/hub';
import { type HostKind } from '@cg/contracts/ids';
import { featureSlice } from '@cg/core/domain/features';
import { composedWithOf, composedWithOfFeature } from '@cg/core/domain/send';
import { BOOTSTRAP_PILOT_PAGES, WORLD, pageFeaturesOff } from '@cg/testing/hub';
import { describe, expect, it } from 'vitest';

import { COMPOSED_WAIT_MS, ComposedWithMemory, attributionTarget } from '../src/composition/background/attribution.ts';
import { CHATSPACE_FEATURE_SLICE } from '../src/composition/features/chatspace.ts';

const FANSLY_SLICE = featureSlice(FEATURES_COMMON, FANSLY_FEATURES);
const slices = (host: HostKind): FeatureSlice | null => (host === 'chatspace' ? CHATSPACE_FEATURE_SLICE : FANSLY_SLICE);
const withCapability = (bootstrap: Bootstrap, on: boolean): Bootstrap => ({
  ...bootstrap,
  capabilities: on ? [...new Set([...bootstrap.capabilities, 'send-attribution-v1'])] : bootstrap.capabilities.filter((capability) => capability !== 'send-attribution-v1'),
});
const PILOT = withCapability(BOOTSTRAP_PILOT_PAGES, true);
const ONE = WORLD.pages.one;

describe('[X48] what the background owes the hub of a send', () => {
  it('a ChatSpace send of a granted page that has the feature: its page label and the extension as the observer', () => {
    expect(attributionTarget('chatspace', ONE.pageId, PILOT, slices)).toEqual({ ok: true, pageLabel: ONE.pageLabel, source: 'chatspace-extension' });
  });

  it('nothing to owe: nobody signed in, a page this bootstrap does not grant or cannot tell, a hub that does not record it, a page without its tap', () => {
    expect(attributionTarget('chatspace', ONE.pageId, null, slices)).toEqual({ ok: false, reason: 'signed_out' });
    expect(attributionTarget('chatspace', null, PILOT, slices)).toEqual({ ok: false, reason: 'unbound' });
    expect(attributionTarget('chatspace', 404, PILOT, slices)).toEqual({ ok: false, reason: 'unbound' });
    expect(attributionTarget('chatspace', ONE.pageId, withCapability(BOOTSTRAP_PILOT_PAGES, false), slices)).toEqual({ ok: false, reason: 'not_admitted' });
    // The receipt pairs with the tap's echo: the PAGE's own `wsTap` decides, never another page's.
    const tapOff = pageFeaturesOff(PILOT, ['wsTap'], { pageIds: [ONE.pageId] });
    expect(attributionTarget('chatspace', ONE.pageId, tapOff, slices)).toEqual({ ok: false, reason: 'not_admitted' });
    expect(attributionTarget('chatspace', WORLD.pages.vip.pageId, tapOff, slices)).toMatchObject({ ok: true, pageLabel: WORLD.pages.vip.pageLabel });
  });

  it('Chat Memory week 1: a Fansly send of a granted page — the extension on fansly.com as the observer, no switch of the page', () => {
    expect(attributionTarget('fansly-web', WORLD.pages.fansly.pageId, PILOT, slices)).toEqual({ ok: true, pageLabel: WORLD.pages.fansly.pageLabel, source: 'fansly-extension' });
    expect(attributionTarget('fansly-web', WORLD.pages.fansly.pageId, withCapability(BOOTSTRAP_PILOT_PAGES, false), slices)).toEqual({ ok: false, reason: 'not_admitted' });
  });
});

describe('Chat Memory week 1: the button behind a message', () => {
  const clock = () => {
    let now = 0;
    const timers: Array<{ at: number; fn: () => void; id: number }> = [];
    let next = 0;
    return {
      setTimer: (ms: number, fn: () => void) => {
        next += 1;
        timers.push({ at: now + ms, fn, id: next });
        return next as never;
      },
      clearTimer: (handle: unknown) => {
        const index = timers.findIndex((timer) => timer.id === handle);
        if (index >= 0) timers.splice(index, 1);
      },
      advance(ms: number) {
        now += ms;
        for (const timer of timers.filter((item) => item.at <= now)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.fn();
        }
      },
    };
  };

  it('a draft of ours names its button whichever of the two reports came first; none within the wait — not known', async () => {
    const time = clock();
    const memory = new ComposedWithMemory(time);
    // `op.reportSent` first: at once.
    memory.learn('101', { composedWith: 'reply', edited: false });
    await expect(memory.wait('101')).resolves.toEqual({ composedWith: 'reply', edited: false });
    // The fact first: it waits for the report of the same message.
    const waiting = memory.wait('102');
    memory.learn('103', { composedWith: 'fix', edited: true });
    memory.learn('102', { composedWith: 'fix', edited: true });
    await expect(waiting).resolves.toEqual({ composedWith: 'fix', edited: true });
    // Nobody says it: null after the wait, never a guess.
    const lost = memory.wait('104');
    time.advance(COMPOSED_WAIT_MS);
    await expect(lost).resolves.toBeNull();
  });

  it('how the text was written: the person’s own — by hand; ours — the learned button, else not known', () => {
    expect(composedWithOf('hand', null)).toBe('hand');
    expect(composedWithOf('ours', 'coach')).toBe('coach');
    expect(composedWithOf('ours', null)).toBe('unknown');
    expect(composedWithOf('unknown', 'reply')).toBe('unknown');
    expect(composedWithOf(undefined, null)).toBe('unknown');
    expect(composedWithOfFeature('ping')).toBe('ping');
    expect(composedWithOfFeature('recap')).toBe('unknown');
  });
});
