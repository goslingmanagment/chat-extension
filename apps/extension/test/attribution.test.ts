// Who sent each message (decision X48, composition/background/attribution.ts): whether the background owes the hub a
// send at all, and for which page and client — over the pilot's pages and the sites' slices of the manifest.

import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { type Bootstrap } from '@cg/contracts/hub';
import { type HostKind } from '@cg/contracts/ids';
import { featureSlice } from '@cg/core/domain/features';
import { BOOTSTRAP_PILOT_PAGES, WORLD, pageFeaturesOff } from '@cg/testing/hub';
import { describe, expect, it } from 'vitest';

import { attributionTarget } from '../src/composition/background/attribution.ts';
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

  it('Fansly reports no sends yet: a later task gives it its observer name and the hub its admission', () => {
    expect(attributionTarget('fansly-web', WORLD.pages.fansly.pageId, PILOT, slices)).toEqual({ ok: false, reason: 'site' });
  });
});
