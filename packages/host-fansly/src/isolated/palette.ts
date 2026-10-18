// Fansly's palette for our interface (docs/project-unite/architecture.md §1.5, §7.8, §7.17; R20 P8d; FS-PLC-7,
// FS-DOCK-1; decision X57): the kit's `--color-om-*` triplets of Fansly's profile, which the mount puts on every host
// of ours as one shared `:host` sheet. Only the application draws with it, so it is the application half's (§1.5):
// Fansly's `tab-app` chunk and the galleries import this module, the early bundle never does (its theme reader,
// ./theme.ts, says the scheme).
//
// The greys are the family's own (X57): the warm paper of the old Fansly extension — its card #faf9f5, chip #f2f0e9,
// groove #e8e5da, lines #e2dfd3 / #cfcaba, ink #1f1e1d and its dark twins — one ramp for both schemes, the same on
// either theme of the page, as ChatSpace's own ramp is (ui-design §2.1 «Fansly»). Fansly's cool blue-greys under our
// terracotta and warm drafts read as two designs at once; the owner chose the old panel's paper. Only the blue is the
// page's: `--blue-1` in the theme it shows, and only for what reaches the fan (send, the sent bubble). Green and red
// are not translated: Fansly's are bright tones for badges (its light green #27d644 is 1.95 : 1 on white), so money
// and the error dot keep the kit's own. Read when a surface mounts and anew whenever the theme reader says the page's
// theme moved, never on a timer.

import type { HostTheme } from '@cg/contracts/host';
import type { HostPalette, ValueSignal } from '@cg/contracts/vm';

type Scheme = HostTheme['scheme'];

/** Where a blue comes from in one of Fansly's themes: the page's variable (null — not in this theme) and its value on fansly.com (2026-10-12). */
type Source = readonly [variable: string | null, value: string];

/**
 * The family's warm greys as the kit's steps (ui/kit tokens.ts reads exactly these). One triplet per step, as
 * ChatSpace's ramp: a step plays one role in the light scheme and another in the dark one (light / dark below).
 */
export const FAMILY_NEUTRALS: Readonly<Record<string, string>> = {
  // surface, raised card / —
  'neutral-0': '250 249 245',
  // chip, sunk / —
  'neutral-50': '242 240 233',
  // hover, the segment's pick / —
  'neutral-75': '238 235 227',
  // rule, press, the groove / —
  'neutral-100': '232 229 218',
  // the card's and the chip's outline / ink
  'neutral-200': '226 223 211',
  // seams, key caps / secondary ink
  'neutral-300': '207 202 186',
  // faint ink / muted ink
  'neutral-400': '163 158 147',
  // muted ink / — (4.5 : 1 on a draft card)
  'neutral-500': '107 103 94',
  // strong bars / faint ink
  'neutral-600': '93 90 82',
  // secondary ink / seams, key caps
  'neutral-700': '77 73 64',
  // — / the card's and the chip's outline
  'neutral-750': '58 55 47',
  // — / press, the floating card's outline
  'neutral-800': '51 48 42',
  // — / chip, hover, rule
  'neutral-850': '46 43 38',
  // ink / raised card, sunk
  'neutral-900': '38 36 32',
  // strong ink / surface, the groove
  'neutral-950': '27 26 23',
  // — / strong ink
  white: '250 249 245',
};

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

/** What a translucent blue is laid over: our card in that scheme. */
const CARD: Readonly<Record<Scheme, string>> = { light: FAMILY_NEUTRALS['neutral-0'] ?? '', dark: FAMILY_NEUTRALS['neutral-900'] ?? '' };

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
 * Fansly's palette in the theme its page shows, as the kit's triplets: `{'--color-om-neutral-0': '250 249 245', …}` —
 * the family's greys and the page's blue. `read` gives a variable of the page's <html> as computed ('' — none).
 */
export function fanslyPalette(scheme: Scheme, read: (name: string) => string): HostPalette {
  const [br = 0, bg = 0, bb = 0] = CARD[scheme].split(' ').map(Number);
  const palette: Record<`--color-om-${string}`, string> = {};
  for (const [step, triplet] of Object.entries(FAMILY_NEUTRALS)) palette[`--color-om-${step}`] = triplet;
  for (const [step, sources] of Object.entries(FANSLY_BLUE)) {
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
