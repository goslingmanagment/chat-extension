// Fansly's palette for our interface (docs/project-unite/architecture.md §1.5, §7.8, §7.17; R20 P8d; FS-PLC-7,
// FS-DOCK-1): the page's own colour variables, in the theme its page shows, translated into the kit's
// `--color-om-*` triplets — the palette of Fansly's profile, which the mount puts on every host of ours as one
// shared `:host` sheet. Only the application draws with it, so it is the application half's (§1.5): Fansly's
// `tab-app` chunk and the galleries import this module, the early bundle never does (its theme reader,
// ./theme.ts, says the scheme). Read when a surface mounts and anew whenever the theme reader says the page's theme
// moved (a switch, or Fansly's theme class arriving), never on a timer.
//
// The correspondence table: docs/ui-design.md §2.1 «Fansly». ChatSpace's scale keeps one triplet per step in both
// themes, the dark scheme taking other steps; Fansly instead redefines its variables per theme (`:root` is dark,
// `html.bright-theme` light), and only the variables of the theme on screen can be read. So each theme has its own
// row for a step: the variable of the role the kit gives that step in that scheme (the raised card is Fansly's
// `--modal-bg`, the ink its `--font-1`, the muted ink its `--dark-blue-1` or `--font-tint-3`…), or, for a step that
// scheme never reads, a value for the scheme forced against the page's (`ui.theme`): Fansly's value of the other
// theme, or a tone that keeps the kit's contrast where that one would not (testing kit/fansly-profile.test.tsx holds
// all four: either page, either scheme). A variable the page does not have (a new build of Fansly) stands in with its
// value on fansly.com of 2026-10-12; a translucent one is laid over the theme's card (`--modal-bg`). Blue is
// Fansly's `--blue-1`, and only for what reaches the fan (send, the sent bubble); green and red are not translated:
// Fansly's are bright tones for badges (its light green #27d644 is 1.95 : 1 on white), so money and the error dot
// keep the kit's own.

import type { HostTheme } from '@cg/contracts/host';
import type { HostPalette, ValueSignal } from '@cg/contracts/vm';

type Scheme = HostTheme['scheme'];

/** Where a step comes from in one of Fansly's themes: the page's variable (null — not in this theme) and its value on fansly.com (2026-10-12). */
type Source = readonly [variable: string | null, value: string];

/**
 * The kit's steps (ui/kit tokens.ts reads exactly these) by Fansly's theme. The roles a step plays — light / dark —
 * are the kit's (ui-design §2.2); the variables are fansly.com's `styles.css` (S2 Q9), effective values.
 */
export const FANSLY_SCALE: Readonly<Record<string, { readonly light: Source; readonly dark: Source }>> = {
  // surface, raised card / —
  'neutral-0': { light: ['--modal-bg', '#ffffff'], dark: [null, '#ffffff'] },
  // chip, sunk / —
  'neutral-50': { light: ['--dark-2', '#f5f5f5'], dark: [null, '#f5f5f5'] },
  // hover, the segment's pick / —
  'neutral-75': { light: ['--dark-3', '#f0f2f4'], dark: [null, '#f0f2f4'] },
  // rule, press, the groove / —
  'neutral-100': { light: ['--v2-btn-grey-hover', '#e1e7e9'], dark: [null, '#e1e7e9'] },
  // the card's and the chip's outline / ink
  'neutral-200': { light: ['--v2-btn-grey-active', '#d5dcdf'], dark: ['--font-1', '#d6dce8'] },
  // seams, key caps / secondary ink
  'neutral-300': { light: ['--seperator', '#b0b0b098'], dark: ['--font-tint-2', '#bbc1cb'] },
  // faint ink / muted ink
  'neutral-400': { light: ['--font-tint-6', 'rgb(157, 162, 173)'], dark: ['--font-tint-3', '#9da2ad'] },
  // muted ink / — (a light scheme forced on the dark page reads it on a draft card: the light theme's, 4.5 : 1 there)
  'neutral-500': { light: ['--dark-blue-1', 'rgba(86, 102, 120, 1)'], dark: [null, '#566678'] },
  // strong bars / faint ink
  'neutral-600': { light: ['--font-tint-3', 'rgb(85, 90, 100)'], dark: ['--dark-blue-1', '#637395'] },
  // secondary ink / seams, key caps
  'neutral-700': { light: ['--font-tint-7', 'rgba(20, 30, 40, 0.801)'], dark: ['--dark-blue-1-outline', '#343d53'] },
  // — / the card's and the chip's outline
  'neutral-750': { light: [null, '#323844'], dark: ['--seperator', '#323844'] },
  // — / press, the floating card's outline
  'neutral-800': { light: [null, '#2a3142'], dark: ['--dropdown-bg-color-hover', '#2a3142'] },
  // — / chip, hover, rule (a dark scheme forced on the light page has the light ink for its card: a tone off it, not
  // the dark theme's #1a1e26, which would be the card's own)
  'neutral-850': { light: [null, '#1f2835'], dark: ['--dark-3', '#1a1e26'] },
  // ink / raised card, sunk
  'neutral-900': { light: ['--font-1', 'rgb(20, 30, 40)'], dark: ['--modal-bg', '#16161a'] },
  // strong ink / surface, the groove
  'neutral-950': { light: ['--font-tint-1', '#000'], dark: ['--dark-1', '#111215'] },
  // — / strong ink
  white: { light: ['--pure-white', '#fff'], dark: ['--pure-white', '#fff'] },
  // «Отправить» (FS-DOCK-1)
  'brand-500': { light: ['--blue-1', '#2699f7'], dark: ['--blue-1', '#2699f7'] },
  // its hover
  'brand-600': { light: ['--v2-blue-1-hover', '#0d8ae8'], dark: [null, '#0d8ae8'] },
  'brand-400': { light: [null, '#1588e0'], dark: ['--v2-blue-1-hover', '#1588e0'] },
  // a sent message in our feed
  'brand-75': { light: ['--v2-blue-1-alpha-2', 'rgba(38, 153, 247, 0.16)'], dark: [null, '#dceffe'] },
  'brand-800': { light: [null, '#192b3d'], dark: ['--v2-blue-1-alpha-2', 'rgba(38, 153, 247, 0.16)'] },
};

/** What a translucent colour is laid over: the theme's card. */
const BASE: Readonly<Record<Scheme, Source>> = { light: ['--modal-bg', '#ffffff'], dark: ['--modal-bg', '#16161a'] };

type Rgba = readonly [number, number, number, number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i;

/** `#rgb[a]`, `#rrggbb[aa]`, `rgb()` and `rgba()` (commas or spaces) as bytes and alpha; null — anything else. */
export function parseColour(text: string): Rgba | null {
  const value = text.trim();
  const hex = HEX.exec(value)?.[1];
  if (hex !== undefined) {
    const digits = hex.length <= 4 ? [...hex].map((digit) => digit + digit) : (hex.match(/../g) ?? []);
    const [r = 0, g = 0, b = 0, a = 255] = digits.map((pair) => Number.parseInt(pair, 16));
    return [r, g, b, a / 255];
  }
  const rgb = RGB.exec(value);
  if (rgb === null) return null;
  const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] === '%' ? 100 : 1);
  if (channels.some((channel) => !(channel >= 0 && channel <= 255)) || !(alpha >= 0 && alpha <= 1)) return null;
  const [r = 0, g = 0, b = 0] = channels;
  return [r, g, b, alpha];
}

/** The page's variable if it is a colour, else the value on fansly.com. */
function colourOf([variable, value]: Source, read: (name: string) => string): Rgba {
  return (variable === null ? null : parseColour(read(variable))) ?? parseColour(value) ?? [0, 0, 0, 1];
}

/**
 * Fansly's palette in the theme its page shows, as the kit's triplets: `{'--color-om-neutral-0': '255 255 255', …}`.
 * `read` gives a variable of the page's <html> as computed ('' — none).
 */
export function fanslyPalette(scheme: Scheme, read: (name: string) => string): HostPalette {
  const [br, bg, bb] = colourOf(BASE[scheme], read);
  const palette: Record<`--color-om-${string}`, string> = {};
  for (const [step, sources] of Object.entries(FANSLY_SCALE)) {
    const [r, g, b, a] = colourOf(sources[scheme], read);
    const over = (channel: number, base: number): number => Math.round(channel * a + base * (1 - a));
    palette[`--color-om-${step}`] = `${over(r, br)} ${over(g, bg)} ${over(b, bb)}`;
  }
  return palette;
}

/** Fansly's palette as its page shows it now: the computed variables of its <html> in `scheme`. */
export function readFanslyPalette(doc: Document, scheme: Scheme): HostPalette {
  const html = doc.documentElement as HTMLElement | null;
  const style = html === null ? null : (doc.defaultView?.getComputedStyle(html) ?? null);
  return fanslyPalette(scheme, (name) => style?.getPropertyValue(name) ?? '');
}

/** The page's theme as the tab hands it to the site's profile (`HostThemeSource`): what it shows now, and its switches. */
export interface FanslyThemeSource {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
}

/**
 * The palette of Fansly's profile (architecture §1.5): the page's variables in the theme it shows, as they are when a
 * surface mounts — the same values keep the same palette object, so the mounts of one theme share one sheet. Live:
 * whenever the theme reader says the page's theme moved (a switch, or Fansly's theme class arriving — its variables
 * may come with it), the page is read anew and each listener hears a palette that differs from the last it heard.
 */
export function fanslyPaletteSignal(theme: FanslyThemeSource, page: () => Document): ValueSignal<HostPalette> {
  let key = '';
  let palette: HostPalette = {};
  const read = (scheme: Scheme): HostPalette => {
    const next = readFanslyPalette(page(), scheme);
    const nextKey = `${scheme} ${JSON.stringify(next)}`;
    if (nextKey !== key) {
      key = nextKey;
      palette = next;
    }
    return palette;
  };
  return {
    get value() {
      return read(theme.current().scheme);
    },
    subscribe(listener) {
      let last = read(theme.current().scheme);
      return theme.onChange((next) => {
        const now = read(next.scheme);
        if (now === last) return;
        last = now;
        listener(now);
      });
    },
  };
}
