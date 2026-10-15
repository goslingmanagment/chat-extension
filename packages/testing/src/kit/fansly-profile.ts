// The real palette reader and variant sheet over the stand's page variables.
import type { HostUiProfile } from '@cg/contracts';
import { FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';
import { createFanslyTheme, fanslyPalette, type FanslyTheme } from '@cg/host-fansly/isolated/theme';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';
import variables from './fansly-palette.css?inline';

export function fanslyGalleryProfile(params: URLSearchParams): { readonly host: 'fansly'; readonly profile: HostUiProfile; readonly theme: FanslyTheme } {
  const html = document.documentElement;
  html.dataset.galleryHost = 'fansly';
  html.classList.toggle('bright-theme', params.get('theme') !== 'dark');
  html.classList.toggle('dark-theme', params.get('theme') === 'dark');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(variables + `
    html[data-gallery-host="fansly"] {
      font-family: Roboto, Arial, sans-serif;
      --gal-bg: var(--dark-1); --gal-card: var(--dark-2);
      --gal-ink: var(--dark-blue-1); --gal-line: var(--border-color);
    }
    html[data-gallery-host="fansly"] .gal-bubble { color: var(--font-1); }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const theme = createFanslyTheme(document);
  window.addEventListener('pagehide', () => theme.dispose(), { once: true });
  return { host: 'fansly', theme, profile: { dock: { variant: 'fansly' }, phrases: FANSLY_PHRASES, sheet: FANSLY_DOCK_SHEET, palette: fanslyPalette(theme) } };
}
