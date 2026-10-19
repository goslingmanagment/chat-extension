// A gallery page that plays fansly.com around our surfaces (`?host=fansly`; Project Unite architecture §1.5, R20 P8d):
// Fansly's colour variables as its `styles.css` defines them (2026-10-12, S2 Q9; dark on `:root`, light on
// `html.bright-theme`) — those the palette of Fansly's profile reads (host-fansly isolated/theme.ts) and those the
// page around wears —, its theme class on <html> as its theme controller sets it, its font (Roboto 16 px on <html>,
// locally installed only) and its backgrounds. None of ChatSpace's `--color-om-*` triplets: Fansly has none, so our
// roots get the palette their profile reads off this page. Nothing here is Fansly's code or CSS.

import { type ColorScheme } from '@cg/contracts';
import { SITE_BLUE_FALLBACK } from '@cg/ui/kit';

/** The ChatSpace blue the galleries' own sheets put on <html>, taken away while the page plays Fansly. */
const CHATSPACE_STEPS = [...Object.keys(SITE_BLUE_FALLBACK), 'brand-50', 'brand-300'];

export const FANSLY_PAGE_CSS = `
:root {
  --dark-1: #111215; --dark-2: #191e26; --dark-3: #1a1e26; --modal-bg: #16161a;
  --font-1: #d6dce8; --font-tint-1: #d6dce8; --font-tint-2: #bbc1cb; --font-tint-3: #9da2ad; --font-tint-6: #637395; --font-tint-7: #B0B8D8;
  --dark-blue-1: #637395; --dark-blue-1-outline: #343d53; --seperator: #323844; --dropdown-bg-color-hover: #2a3142;
  --border-color: rgba(255, 255, 255, 0.06); --pure-white: #fff; --blue-1: #2699f7;
  --v2-btn-grey-hover: #343c49; --v2-btn-grey-active: #3d4655; --v2-blue-1-hover: #1588e0; --v2-blue-1-alpha-2: rgba(38, 153, 247, 0.16);
}
html.bright-theme {
  --dark-1: #ffffff; --dark-2: #f5f5f5; --dark-3: #f0f2f4; --modal-bg: #ffffff;
  --font-1: rgb(20, 30, 40); --font-tint-1: #000; --font-tint-2: rgb(125, 125, 125); --font-tint-3: rgb(85, 90, 100); --font-tint-6: rgb(157, 162, 173); --font-tint-7: rgba(20, 30, 40, 0.801);
  --dark-blue-1: rgba(86, 102, 120, 1); --dark-blue-1-outline: rgba(0, 0, 0, 0.05); --seperator: #b0b0b098; --dropdown-bg-color-hover: #f5f5f5;
  --border-color: rgba(0, 0, 0, 0.05); --pure-white: #fff; --blue-1: #2699f7;
  --v2-btn-grey-hover: #e1e7e9; --v2-btn-grey-active: #d5dcdf; --v2-blue-1-hover: #0d8ae8; --v2-blue-1-alpha-2: rgba(38, 153, 247, 0.16);
}
:root[data-gal-host="fansly"] {
  ${CHATSPACE_STEPS.map((step) => `--color-om-${step}: initial;`).join(' ')}
  --gal-bg: var(--dark-1); --gal-ink: var(--dark-blue-1); --gal-card: var(--dark-3); --gal-line: var(--border-color);
  --bg-page: var(--dark-1); --bg-main: var(--dark-1); --bg-line: var(--border-color);
  font-family: "Roboto", sans-serif; font-size: 16px; color: var(--font-1); color-scheme: dark;
}
:root[data-gal-host="fansly"].bright-theme { color-scheme: light; }
:root[data-gal-host="fansly"] body { font-family: inherit; }
:root[data-gal-host="fansly"]:not(.bright-theme) body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
:root[data-gal-host="fansly"] .gal-bubble { color: var(--font-1); }
${/* Fansly's composer under the dock: a hairline over the row, 0.25em from the column's edges, its message pill. */ ''}
:root[data-gal-host="fansly"] .gal-composer { height: auto; padding: 0.5em 0.25em; border: 0; border-top: 1px solid var(--border-color); border-radius: 0; background: none; }
:root[data-gal-host="fansly"] .gal-pill { display: flex; align-items: center; height: 44px; box-sizing: border-box; padding: 0 1em; border-radius: 1.25em; background: var(--dark-3); color: var(--dark-blue-1); font-size: 0.875em; }
`;

/** Puts Fansly's theme on <html> as its theme controller does: `bright-theme` or `dark-theme`, never both. */
export function setFanslyTheme(doc: Document, scheme: ColorScheme): void {
  const html = doc.documentElement;
  html.classList.toggle('bright-theme', scheme === 'light');
  html.classList.toggle('dark-theme', scheme === 'dark');
}

/** The page plays fansly.com in `scheme`: its variables, its theme class, its font. */
export function playFanslyPage(doc: Document, scheme: ColorScheme): void {
  const html = doc.documentElement;
  if (doc.querySelector('style[data-gal-fansly]') === null) {
    const style = doc.createElement('style');
    style.setAttribute('data-gal-fansly', '');
    style.textContent = FANSLY_PAGE_CSS;
    doc.head.append(style);
  }
  html.setAttribute('data-gal-host', 'fansly');
  setFanslyTheme(doc, scheme);
}
