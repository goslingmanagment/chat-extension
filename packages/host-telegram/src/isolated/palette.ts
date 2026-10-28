// The palette of Telegram's profile (docs/project-unite/architecture.md §1.5; spec §6.6: the dock styled as Fansly's):
// the family's look on every site (ui/kit tokens.ts, X60) with the page's own accent — Web A's `--color-primary`
// (#3390ec in its light theme, violet in its dark one) — as the kit's brand steps. Read from the page's <html> when a
// surface mounts, and again whenever the page's theme switches.

import type { HostTheme } from '@cg/contracts/host';
import type { HostPalette, ValueSignal } from '@cg/contracts/vm';

type Scheme = HostTheme['scheme'];
type Source = readonly [variable: string | null, value: string];

/** Telegram's accent by its theme: the primary, its shade (hover), and its tint laid over our card. */
export const TELEGRAM_ACCENT: Readonly<Record<string, { readonly light: Source; readonly dark: Source }>> = {
  'brand-500': { light: ['--color-primary', '#3390ec'], dark: ['--color-primary', '#8774e1'] },
  'brand-600': { light: ['--color-primary-shade', '#2f85d9'], dark: [null, '#7c6ad0'] },
  'brand-400': { light: [null, '#2f85d9'], dark: ['--color-primary-shade', '#7c6ad0'] },
  'brand-75': { light: [null, 'rgba(51, 144, 236, 0.16)'], dark: [null, '#e6e1fb'] },
  'brand-800': { light: [null, '#1c2c3d'], dark: [null, 'rgba(135, 116, 225, 0.16)'] },
};

/** What a translucent accent is laid over: our card in that scheme (the family's `neutral-0` and `neutral-900`). */
const OUR_CARD: Readonly<Record<Scheme, string>> = { light: '250 249 245', dark: '38 36 32' };

type Rgba = readonly [number, number, number, number];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i;

/** `#rgb`, `#rrggbb`, `rgb()` and `rgba()` as bytes and alpha; null — anything else. */
export function parseColour(text: string): Rgba | null {
  const value = text.trim();
  const hex = HEX.exec(value)?.[1];
  if (hex !== undefined) {
    const digits = hex.length === 3 ? [...hex].map((digit) => digit + digit) : (hex.match(/../g) ?? []);
    const [r = 0, g = 0, b = 0] = digits.map((pair) => Number.parseInt(pair, 16));
    return [r, g, b, 1];
  }
  const rgb = RGB.exec(value);
  if (rgb === null) return null;
  const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if (channels.some((channel) => !(channel >= 0 && channel <= 255)) || !(alpha >= 0 && alpha <= 1)) return null;
  const [r = 0, g = 0, b = 0] = channels;
  return [r, g, b, alpha];
}

/** Telegram's accent in `scheme` as the kit's triplets; `read` gives a variable of the page's <html> ('' — none). */
export function telegramPalette(scheme: Scheme, read: (name: string) => string): HostPalette {
  const [br = 0, bg = 0, bb = 0] = OUR_CARD[scheme].split(' ').map(Number);
  const palette: Record<`--color-om-${string}`, string> = {};
  for (const [step, sources] of Object.entries(TELEGRAM_ACCENT)) {
    const [variable, value] = sources[scheme];
    const [r, g, b, a] = (variable === null ? null : parseColour(read(variable))) ?? parseColour(value) ?? [0, 0, 0, 1];
    const over = (channel: number, base: number): number => Math.round(channel * a + base * (1 - a));
    palette[`--color-om-${step}`] = `${over(r, br)} ${over(g, bg)} ${over(b, bb)}`;
  }
  return palette;
}

export interface TelegramThemeSource {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
}

/** The palette signal of Telegram's profile: the same values keep the same object; a theme switch reads the page anew. */
export function telegramPaletteSignal(theme: TelegramThemeSource, page: () => Document): ValueSignal<HostPalette> {
  let key = '';
  let palette: HostPalette = {};
  const read = (scheme: Scheme): HostPalette => {
    const doc = page();
    const html = doc.documentElement as HTMLElement | null;
    const style = html === null ? null : (doc.defaultView?.getComputedStyle(html) ?? null);
    const next = telegramPalette(scheme, (name) => style?.getPropertyValue(name) ?? '');
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
