import { describe, expect, it } from 'vitest';

import viteConfig, { PAGES_GALLERY_BASE, PAGES_GALLERY_BUILD_DIR as VITE_OUT_DIR, PAGES_GALLERY_SOURCE_DIR as VITE_ROOT } from '../../pages-gallery.vite.config';
import { PAGES_GALLERY_BUILD_DIR, PAGES_GALLERY_PATH, PAGES_GALLERY_SOURCE_DIR } from '../stand/paths';

describe('the extension-pages gallery build', () => {
  it('builds from src/pages/gallery into .cache/pages-gallery and is served at /pages-gallery/', () => {
    expect(VITE_ROOT).toBe(PAGES_GALLERY_SOURCE_DIR);
    expect(VITE_OUT_DIR).toBe(PAGES_GALLERY_BUILD_DIR);
    expect(PAGES_GALLERY_BUILD_DIR).toMatch(/\/\.cache\/pages-gallery\/$/);
    expect(PAGES_GALLERY_BASE).toBe(PAGES_GALLERY_PATH);
    expect(viteConfig).toMatchObject({ root: PAGES_GALLERY_SOURCE_DIR, base: PAGES_GALLERY_PATH, build: { outDir: PAGES_GALLERY_BUILD_DIR } });
  });
});
