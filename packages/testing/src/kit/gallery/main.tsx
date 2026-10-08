// The gallery page: `?theme=light|dark&lang=ru|en&col=320&section=parts-sheet`.
// It plays the host side — a closed shadow root on a host element — and
// mounts the gallery through the kit's own mount helper, the way a surface
// of the extension is mounted. `window.__gallery` gives the e2e what a closed
// root hides: the rendered rows of the virtual list, horizontal overflow and
// the failures the kit reported.

import { type ColorScheme, type Locale } from '@cg/contracts';
import { mountKitSurface, type KitFailure } from '@cg/ui/kit';

import { kitWorld } from '../world';
import { GALLERY_CSS, GALLERY_SECTIONS, Gallery } from './Gallery';

export interface GalleryProbe {
  readonly failures: readonly KitFailure[];
  /** Rows of the 1000-row list in the DOM. */
  listRows(): number;
  /** Elements inside our root that stick out of the gallery column (horizontal overflow). */
  overflow(): readonly string[];
  /** The kit's adoption mode and how many sheets the root holds. */
  readonly styles: { readonly mode: string; readonly sheets: number };
}

declare global {
  interface Window {
    __gallery?: GalleryProbe;
  }
}

const params = new URLSearchParams(location.search);
const scheme: ColorScheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const language: Locale = params.get('lang') === 'en' ? 'en' : 'ru';
const column = Number(params.get('col') ?? '0');
const sectionParam = params.get('section');
const section = GALLERY_SECTIONS.find((id) => id === sectionParam) ?? null;

const html = document.documentElement;
html.classList.toggle('dark', scheme === 'dark');
html.classList.toggle('light', scheme === 'light');
html.lang = language;
if (column > 0) {
  html.setAttribute('data-gal-col', String(column));
  html.style.setProperty('--gal-col', `${column}px`);
}
const config = document.querySelector('[data-gal-config]');
if (config !== null) config.textContent = `${scheme} · ${language}${column > 0 ? ` · ${column} px` : ''}${section === null ? '' : ` · ${section}`}`;

const world = kitWorld('gallery-ready', language);
world.deps.scheme.set(scheme);
const host = document.createElement('div');
host.setAttribute('data-host', 'gallery');
document.getElementById('gallery')?.append(host);
const root = host.attachShadow({ mode: 'closed' });
const failures: KitFailure[] = [];
const mount = mountKitSurface(
  'dock',
  root,
  world.deps,
  { view: () => <Gallery ctx={world.ctx} only={section} />, styles: [{ id: 'kit-gallery', css: GALLERY_CSS }] },
  { now: () => world.client.now(), report: (failure) => failures.push(failure) },
);

window.__gallery = {
  failures,
  listRows: () => root.querySelectorAll('[data-gal="list"] [data-cg-row]').length,
  overflow: () => {
    // Nothing of ours past the gallery column (the 320 px column, or the page).
    const column = document.getElementById('gallery')?.getBoundingClientRect().right ?? document.documentElement.clientWidth;
    const limit = Math.min(column, document.documentElement.clientWidth);
    return [...root.querySelectorAll<HTMLElement>('*')]
      .filter((element) => element.getBoundingClientRect().right > limit + 0.5 && element.closest('.cg-vlist__inner') === null)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className.toString().split(' ').join('.')}`)
      .slice(0, 20);
  },
  styles: { mode: mount.styleMode, sheets: root.adoptedStyleSheets.length },
};

// Ready after the first effects ran and two frames painted.
requestAnimationFrame(() => requestAnimationFrame(() => html.setAttribute('data-gal-ready', '1')));
