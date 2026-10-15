// The sites' profiles the stand's galleries and the tests draw in (Project Unite architecture §1.5; R20 F5, P8d):
// `?host=chatspace` — ChatSpace's own profile, as its tab mounts every surface (the default); `?host=fansly` —
// Fansly's, as its tab mounts them: the palette read off the page by Fansly's own reader at its theme's word, the variant
// `fansly` with its sheet, its phrases — the page plays fansly.com around them (kit/fansly-page.ts); `?host=test` —
// a second site that exists only here, with a palette and a variant sheet of its own, to show that a profile
// reaches every surface and changes nothing of ChatSpace.

import { type ColorScheme, type HostPalette, type HostUiProfile, type ValueSignal } from '@cg/contracts';
import { FANSLY_CG_EN, FANSLY_CG_RU, FANSLY_PHRASES, FANSLY_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import { CHATSPACE_UI } from '@cg/host-chatspace/isolated/profile';
import { fanslyPaletteSignal, type FanslyThemeSource } from '@cg/host-fansly/isolated/palette';
import { createFanslyTheme } from '@cg/host-fansly/isolated/theme';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';

import { type SiteTexts } from '../scenarios/app-client';
import { playFanslyPage } from './fansly-page';

/** A palette that does not change (the gallery's): `set` for a test that changes it. */
export class PaletteSignal implements ValueSignal<HostPalette> {
  private readonly listeners = new Set<(value: HostPalette) => void>();
  constructor(private current: HostPalette) {}
  get value(): HostPalette {
    return this.current;
  }
  set(next: HostPalette): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
  subscribe(listener: (value: HostPalette) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * The test site's scale: cool neutrals and a teal in place of ChatSpace's warm greys and blue — far enough from
 * both real sites that a picture of it is never taken for either. Only the steps the kit reads (ui/kit/tokens.ts).
 */
export const TEST_SITE_PALETTE: HostPalette = {
  '--color-om-neutral-0': '255 255 255',
  '--color-om-neutral-50': '244 246 248',
  '--color-om-neutral-75': '237 240 243',
  '--color-om-neutral-100': '228 232 236',
  '--color-om-neutral-200': '214 220 226',
  '--color-om-neutral-300': '190 198 206',
  '--color-om-neutral-400': '150 160 171',
  '--color-om-neutral-500': '100 110 122',
  '--color-om-neutral-600': '72 81 92',
  '--color-om-neutral-700': '52 60 70',
  '--color-om-neutral-750': '43 50 59',
  '--color-om-neutral-800': '34 40 48',
  '--color-om-neutral-850': '27 32 39',
  '--color-om-neutral-900': '20 24 30',
  '--color-om-neutral-950': '13 16 20',
  '--color-om-white': '255 255 255',
  '--color-om-brand-50': '230 248 246',
  '--color-om-brand-75': '196 238 232',
  '--color-om-brand-300': '64 190 172',
  '--color-om-brand-400': '20 160 142',
  '--color-om-brand-500': '10 128 114',
  '--color-om-brand-600': '6 96 86',
  '--color-om-brand-800': '2 44 40',
};

/** The test site's variant rules: square corners on its pills, so a picture shows the sheet took. */
export const TEST_SITE_SHEET = { id: 'cg-test-site-variant', css: ':host([data-dock-variant="fansly"]) .cg-root { --cg-r-pill: 4px; }' } as const;

/** A second site's profile for the galleries and the tests: a palette, the other variant with its sheet, its phrases. */
export function testSiteProfile(palette: ValueSignal<HostPalette> = new PaletteSignal(TEST_SITE_PALETTE)): HostUiProfile {
  return {
    palette,
    dock: { variant: 'fansly' },
    sheet: TEST_SITE_SHEET,
    phrases: {
      ru: { site: 'Тестовый сайт', onSite: 'на тестовом сайте', siteAccount: 'Тестовый сайт', sitePlatform: 'Тестовая платформа' },
      en: { site: 'Test site', onSite: 'on the test site', siteAccount: 'Test site', sitePlatform: 'Test platform' },
    },
  };
}

/**
 * Fansly's profile as the application's half of its adapter builds it from the page's theme (composition/tab/hosts/
 * fansly/app.ts `fanslyUi`; apps/extension/test/fansly-site.test.ts holds the two to the same parts).
 */
export function fanslyProfile(theme: FanslyThemeSource, page: () => Document = () => document): HostUiProfile {
  return { palette: fanslyPaletteSignal(theme, page), dock: { variant: 'fansly' }, sheet: FANSLY_DOCK_SHEET, phrases: FANSLY_PHRASES };
}

export const GALLERY_HOSTS = ['chatspace', 'fansly', 'test'] as const;
export type GalleryHost = (typeof GALLERY_HOSTS)[number];

/** What Fansly's tab lays over the shared catalog (apps/extension lazy/fansly/i18n-*.ts): its codes' texts, its own wording. */
export const FANSLY_SITE_TEXTS: SiteTexts = { ru: { ...FANSLY_CG_RU, ...FANSLY_TEXTS.ru }, en: { ...FANSLY_CG_EN, ...FANSLY_TEXTS.en } };

export interface GallerySite {
  readonly host: GalleryHost;
  readonly profile: HostUiProfile;
  /** The site's own catalog entries over the shared catalog; absent — the shared catalog alone (ChatSpace). */
  readonly texts?: SiteTexts;
  /** The page plays the site in `scheme` (Fansly: its variables and its theme class); call it before the first mount. */
  readonly play: (scheme: ColorScheme) => void;
}

const nothingToPlay = (): void => undefined;

/** `?host=` of a gallery page: ChatSpace's profile unless Fansly or the test site is asked for. */
export function galleryHostOf(params: URLSearchParams): GallerySite {
  const host = params.get('host');
  if (host === 'test') return { host: 'test', profile: testSiteProfile(), play: nothingToPlay };
  // The palette is read off the page when the first surface mounts, after `play` has put Fansly's theme on it.
  if (host === 'fansly') return { host: 'fansly', profile: fanslyProfile(createFanslyTheme(document)), texts: FANSLY_SITE_TEXTS, play: (scheme) => playFanslyPage(document, scheme) };
  return { host: 'chatspace', profile: CHATSPACE_UI, play: nothingToPlay };
}
