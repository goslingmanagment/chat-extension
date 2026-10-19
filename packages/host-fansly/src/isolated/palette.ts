// Fansly's blue for our interface (docs/project-unite/architecture.md §1.5, §7.8, §7.17; R20 P8d; FS-PLC-7,
// FS-DOCK-1; decisions X57, X60): the brand steps of the kit's `--color-om-*` triplets in Fansly's profile, which the mount puts on
// every host of ours as one shared `:host` sheet. Only the application draws with it, so it is the application half's
// (§1.5): Fansly's `tab-app` chunk and the galleries import this module, the early bundle never does (its theme
// reader, ./theme.ts, says the scheme).
//
// The rest of the palette is the family's own and lives in the kit (ui/kit tokens.ts `FAMILY_TRIPLETS`): the warm
// paper of the old Fansly panel, the same on every site and either theme of the page (X60, after X57). What a site
// gives is its blue — `--blue-1` in the theme Fansly shows, and only for what reaches the fan (send, the sent bubble).
// Read when a surface mounts and anew whenever the theme reader says the page's theme moved, never on a timer.

import type { HostTheme } from '@cg/contracts/host';
import type { HostPalette, ValueSignal } from '@cg/contracts/vm';

type Scheme = HostTheme['scheme'];

/** Where a blue comes from in one of Fansly's themes: the page's variable (null — not in this theme) and its value on fansly.com (2026-10-12). */
type Source = readonly [variable: string | null, value: string];

/** Fansly's blue by its theme: `--blue-1` and its hover, and the translucent tint of a sent message laid over our card. */
export const FANSLY_BLUE: Readonly<Record<string, { readonly light: Source; readonly dark: Source }>> = {
  // «Отправить» (FS-DOCK-1)
  'brand-500': { light: ['--blue-1', '#2699f7'], dark: ['--blue-1', '#2699f7'] },
  // its hover
  'brand-600': { light: ['--v2-blue-1-hover', '#0d8ae8'], dark: [null, '#0d8ae8'] },
  'brand-400': { light: [null, '#1588e0'], dark: ['--v2-blue-1-hover', '#1588e0'] },
  // a sent message in our feed
  'brand-75': { light: ['--v2-blue-1-alpha-2', 'rgba(38, 153, 247, 0.16)'], dark: [null, '#dceffe'] },
  'brand-800': { light: [null, '#192b3d'], dark: ['--v2-blue-1-alpha-2', 'rgba(38, 153, 247, 0.16)'] },
};

/**
 * What a translucent blue is laid over: our card in that scheme — the family's `neutral-0` and `neutral-900` (ui/kit
 * tokens.ts `FAMILY_TRIPLETS`, which this package does not import; a test holds the two equal).
 */
export const OUR_CARD: Readonly<Record<Scheme, string>> = { light: '250 249 245', dark: '38 36 32' };

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
 * Fansly's blue in the theme its page shows, as the kit's triplets: `{'--color-om-brand-500': '38 153 247', …}`. `read`
 * gives a variable of the page's <html> as computed ('' — none).
 */
export function fanslyPalette(scheme: Scheme, read: (name: string) => string): HostPalette {
  const [br = 0, bg = 0, bb = 0] = OUR_CARD[scheme].split(' ').map(Number);
  const palette: Record<`--color-om-${string}`, string> = {};
  for (const [step, sources] of Object.entries(FANSLY_BLUE)) {
    const [r, g, b, a] = colourOf(sources[scheme], read);
    const over = (channel: number, base: number): number => Math.round(channel * a + base * (1 - a));
    palette[`--color-om-${step}`] = `${over(r, br)} ${over(g, bg)} ${over(b, bb)}`;
  }
  return palette;
}

/** Fansly's blue as its page shows it now: the computed variables of its <html> in `scheme`. */
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
