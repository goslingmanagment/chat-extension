import { describe, expect, it } from 'vitest';

import viteConfig, { KIT_GALLERY_BASE, KIT_GALLERY_BUILD_DIR as VITE_OUT_DIR, KIT_GALLERY_SOURCE_DIR as VITE_ROOT } from '../../kit-gallery.vite.config';
import { KIT_GALLERY_BUILD_DIR, KIT_GALLERY_PATH, KIT_GALLERY_SOURCE_DIR } from '../stand/paths';

describe('the ui/kit gallery build', () => {
  it('builds from src/kit/gallery into .cache/kit-gallery and is served at /kit-gallery/', () => {
    expect(VITE_ROOT).toBe(KIT_GALLERY_SOURCE_DIR);
    expect(VITE_OUT_DIR).toBe(KIT_GALLERY_BUILD_DIR);
    expect(KIT_GALLERY_BUILD_DIR).toMatch(/\/\.cache\/kit-gallery\/$/);
    expect(KIT_GALLERY_BASE).toBe(KIT_GALLERY_PATH);
    expect(viteConfig).toMatchObject({ root: KIT_GALLERY_SOURCE_DIR, base: KIT_GALLERY_PATH, build: { outDir: KIT_GALLERY_BUILD_DIR } });
  });
});
