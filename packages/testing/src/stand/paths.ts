// Where the stand's files live. The fixture build goes to a dot-folder of the
// repo root: never into the AMO sources archive (WXT skips dot-folders) and
// never into git (.cache/ is ignored).

import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
/** The M0 spike page and its script (static, no build). */
export const SPIKE_STAND_DIR = fileURLToPath(new URL('../../stand/', import.meta.url));
/** Sources of the ChatSpace-like fixture app. */
export const FIXTURE_SOURCE_DIR = fileURLToPath(new URL('../../fixture-chatspace/', import.meta.url));
/** Built fixture app (`pnpm --filter @cg/testing build:stand`). */
export const FIXTURE_BUILD_DIR = `${REPO_ROOT}.cache/fixture-chatspace/`;
/** Sources of the Fansly-like stand page (R20 P6a). */
export const FANSLY_FIXTURE_SOURCE_DIR = fileURLToPath(new URL('../../fixture-fansly/', import.meta.url));
/** Built Fansly stand (`pnpm --filter @cg/testing build:stand` builds both stands), served on its own loopback name. */
export const FANSLY_FIXTURE_BUILD_DIR = `${REPO_ROOT}.cache/fixture-fansly/`;
/** The FBuddy-like neighbour's one script (R20 P6d, `build:stand` too), served at /neighbor/neighbor.js of the Fansly stand. */
export const FANSLY_NEIGHBOR_BUILD_DIR = `${REPO_ROOT}.cache/fansly-neighbor/`;
/** Sources of the Telegram Web A-like stand page (docs/specs/2026-10-27-telegram-site.md §6.10). */
export const TELEGRAM_FIXTURE_SOURCE_DIR = fileURLToPath(new URL('../../fixture-telegram/', import.meta.url));
/** Built Telegram stand (`build:stand` too), served at `/a/` of its own loopback name, `telegram.localhost`. */
export const TELEGRAM_FIXTURE_BUILD_DIR = `${REPO_ROOT}.cache/fixture-telegram/`;
/** Sources of the ui/kit gallery page (R13). */
export const KIT_GALLERY_SOURCE_DIR = fileURLToPath(new URL('../kit/gallery/', import.meta.url));
/** Built gallery (`pnpm --filter @cg/testing build:gallery`), served at /kit-gallery/. */
export const KIT_GALLERY_BUILD_DIR = `${REPO_ROOT}.cache/kit-gallery/`;
export const KIT_GALLERY_PATH = '/kit-gallery/';
/** Sources of the dock and overlays gallery page (R14). */
export const DOCK_GALLERY_SOURCE_DIR = fileURLToPath(new URL('../dock/gallery/', import.meta.url));
/** Built gallery (`pnpm --filter @cg/testing build:gallery`), served at /dock-gallery/. */
export const DOCK_GALLERY_BUILD_DIR = `${REPO_ROOT}.cache/dock-gallery/`;
export const DOCK_GALLERY_PATH = '/dock-gallery/';
/** Sources of the boards gallery page (R15): Spenders, «Новые», the fan panel, the palette. */
export const BOARDS_GALLERY_SOURCE_DIR = fileURLToPath(new URL('../boards/gallery/', import.meta.url));
/** Built boards gallery (`pnpm --filter @cg/testing build:gallery`), served at /boards-gallery/. */
export const BOARDS_GALLERY_BUILD_DIR = `${REPO_ROOT}.cache/boards-gallery/`;
export const BOARDS_GALLERY_PATH = '/boards-gallery/';
/** Sources of the extension-pages gallery (R16). */
export const PAGES_GALLERY_SOURCE_DIR = fileURLToPath(new URL('../pages/gallery/', import.meta.url));
/** Built pages gallery (`pnpm --filter @cg/testing build:pages`), served at /pages-gallery/. */
export const PAGES_GALLERY_BUILD_DIR = `${REPO_ROOT}.cache/pages-gallery/`;
export const PAGES_GALLERY_PATH = '/pages-gallery/';
/** Gallery pages the stand serves, by their path: built folders of our own UI over synthetic view models. */
export const GALLERIES: Readonly<Record<string, string>> = {
  [KIT_GALLERY_PATH]: KIT_GALLERY_BUILD_DIR,
  [DOCK_GALLERY_PATH]: DOCK_GALLERY_BUILD_DIR,
  [BOARDS_GALLERY_PATH]: BOARDS_GALLERY_BUILD_DIR,
  [PAGES_GALLERY_PATH]: PAGES_GALLERY_BUILD_DIR,
};
/** Screenshots, timings and other e2e evidence. */
export const E2E_EVIDENCE_DIR = `${REPO_ROOT}.cache/e2e/`;
