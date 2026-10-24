import { describe, expect, it } from 'vitest';

import { asBundles, COPIED_MEDIA_KEY, readCopiedMedia } from './copied-media';

const BUNDLE = '727365896632279040';
const BUNDLE_2 = '727271511890599938';
const MEDIA = '748380812893757440';

const page = (stored: unknown): Window => ({ localStorage: { getItem: (key: string) => (key === COPIED_MEDIA_KEY ? JSON.stringify(stored) : null) } }) as unknown as Window;

describe('[host:fansly] Fansly’s «Copied …» list', () => {
  it('after a reload Fansly files the bundles as media: the ids Fansly names bundles go as bundles, each once', () => {
    // As the test model's tab left it on 2026-10-24: both bundles moved to the media list, the bundle list emptied.
    const stored = readCopiedMedia(page({ copiedAccountMediaIds: [BUNDLE, MEDIA, BUNDLE_2], copiedAccountMediaBundleIds: [] }));
    expect(stored).toEqual([{ contentType: 1, contentId: BUNDLE }, { contentType: 1, contentId: MEDIA }, { contentType: 1, contentId: BUNDLE_2 }]);
    expect(asBundles(stored, [BUNDLE, BUNDLE_2])).toEqual([{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: BUNDLE_2 }, { contentType: 1, contentId: MEDIA }]);
    // Another tab wrote its own memory over it: the same bundle in both lists is one item.
    const both = readCopiedMedia(page({ copiedAccountMediaIds: [BUNDLE], copiedAccountMediaBundleIds: [BUNDLE] }));
    expect(asBundles(both, [BUNDLE])).toEqual([{ contentType: 2, contentId: BUNDLE }]);
  });
});
