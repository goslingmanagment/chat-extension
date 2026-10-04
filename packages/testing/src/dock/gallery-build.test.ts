import { describe, expect, it } from 'vitest';

import viteConfig, { DOCK_GALLERY_BASE, DOCK_GALLERY_BUILD_DIR as VITE_OUT_DIR, DOCK_GALLERY_SOURCE_DIR as VITE_ROOT } from '../../dock-gallery.vite.config';
import { DOCK_GALLERY_BUILD_DIR, DOCK_GALLERY_PATH, DOCK_GALLERY_SOURCE_DIR, GALLERIES, KIT_GALLERY_BUILD_DIR, KIT_GALLERY_PATH } from '../stand/paths';

describe('the dock gallery build', () => {
  it('builds from src/dock/gallery into .cache/dock-gallery and is served at /dock-gallery/ next to the kit gallery', () => {
    expect(VITE_ROOT).toBe(DOCK_GALLERY_SOURCE_DIR);
    expect(VITE_OUT_DIR).toBe(DOCK_GALLERY_BUILD_DIR);
    expect(DOCK_GALLERY_BUILD_DIR).toMatch(/\/\.cache\/dock-gallery\/$/);
    expect(DOCK_GALLERY_BASE).toBe(DOCK_GALLERY_PATH);
    expect(viteConfig).toMatchObject({ root: DOCK_GALLERY_SOURCE_DIR, base: DOCK_GALLERY_PATH, build: { outDir: DOCK_GALLERY_BUILD_DIR } });
    // The registry is shared: the other surfaces' galleries (boards, pages) register next to these two.
    expect(GALLERIES).toMatchObject({ [KIT_GALLERY_PATH]: KIT_GALLERY_BUILD_DIR, [DOCK_GALLERY_PATH]: DOCK_GALLERY_BUILD_DIR });
  });
});
