// The gallery of the dock and the overlays (architecture.md §10.2 п. 8,
// ui-design §11 п. 1): it holds every state of the binding mockup (1…10, 12,
// 16…19), and every state is a valid set of view models the real surfaces
// render without a failure in both languages. The pictures themselves are
// taken by e2e/specs/dock-gallery-*.e2e.ts; the build is pinned by
// gallery-build.test.ts.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LOCALES } from '@cg/contracts';
import { FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';
import { DEFAULT_PARTS, dockSurface, preloadPart } from '@cg/ui/dock';
import { lazyOverlays, toastsSurface } from '@cg/ui/overlays';

import { FANSLY_SITE_TEXTS } from '../kit/profiles';
import { GALLERY_STATES, STATE_GROUPS, galleryState, scenarioOfState } from './gallery/states';
import { type MountedKit, mountSurface, settle } from './harness';

/** Every picture of the dock and the overlays in the binding mockup (`final-<id>-*.png`). */
const MOCKUP_PICTURES = [
  ...['1a', '1b', '1c', '1d', '2', '2b', '3a', '3b', '3c', '3d', '3e', '3f', '3g', '4', '5a', '5b', '5c', '6', '6b'],
  ...['7a', '7b', '7c', '7d', '8', '9a', '9b', '9c', '9d', '9e', '9f', '9g', '9h', '10', '12', '12b', '16', '17a', '17b', '18a', '18b', '18c', '19'],
].map((id) => `final-${id}`);

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
});
beforeAll(async () => {
  await Promise.all([preloadPart(DEFAULT_PARTS.analysis), preloadPart(DEFAULT_PARTS.debug)]);
});

describe('the dock gallery states', () => {
  it('hold every state of the binding mockup — 1…10, 12, 16…19 — once each', () => {
    const ids = GALLERY_STATES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pictures = GALLERY_STATES.flatMap((item) => (item.mockup === null ? [] : [item.mockup]));
    expect([...pictures].sort()).toEqual([...MOCKUP_PICTURES].sort());
    // States of ui-design §10 without a picture are named x-…; nothing else is.
    for (const item of GALLERY_STATES) expect(item.mockup === null, item.id).toBe(item.id.startsWith('x-'));
    expect([...new Set(GALLERY_STATES.map((item) => item.group))]).toEqual(STATE_GROUPS.filter((group) => GALLERY_STATES.some((item) => item.group === group)));
    expect(galleryState('3a')?.title).toBe('Split: готово, подвал клавиш');
    expect(galleryState('nope')).toBeNull();
    // What only one site gives: Fansly's window-check marks (R20 P8b2), drawn in its gallery alone.
    expect(GALLERY_STATES.filter((item) => item.sites !== undefined).map((item) => [item.id, item.sites])).toEqual([
      ['x-stale-unverified', ['fansly']],
      ['x-stale-window-miss', ['fansly']],
      ['x-stale-deleted-served', ['fansly']],
    ]);
  });

  for (const language of LOCALES) {
    it(`every state is a valid set of view models and renders without a failure · ${language}`, async () => {
      for (const item of GALLERY_STATES) {
        // A state only Fansly gives speaks as Fansly's tab does: its phrases, its own catalog entries (R20 P8b2).
        const site = item.sites?.includes('chatspace') === false ? { phrases: FANSLY_PHRASES, texts: FANSLY_SITE_TEXTS } : undefined;
        // FakeAppClient refuses a view model that breaks the contract.
        const scenario = scenarioOfState(item, language, 'light', 'mac', site?.phrases, site?.texts);
        const surface = item.surface === 'dock' ? dockSurface : item.surface === 'toasts' ? toastsSurface : await lazyOverlays[item.surface]();
        kit = mountSurface(surface.view, scenario, item.surface, surface.styles ?? [], { language, ...(site === undefined ? {} : { site }) });
        await settle(2);
        // A state that shows a failed surface reports exactly that failure; every other state reports none.
        expect(kit.failures, item.id).toEqual(item.broken === true ? [{ kind: 'render', surface: item.surface, code: 'CG-UI-FAILED', name: 'TypeError' }] : []);
        expect(kit.root.querySelector('.cg-root')?.childElementCount, item.id).toBeGreaterThan(0);
        // No key leaks into the picture: every string came from the catalog.
        expect(kit.root.textContent, item.id).not.toMatch(/\b(?:dock|result|recap|review|coach|common|cg|part|fix|confirm|toast|cheatsheet|debug)\.[a-z][A-Za-z]+(?:\.[A-Za-z]+)*\b/);
        kit.unmount();
        kit = null;
      }
    });
  }
});
