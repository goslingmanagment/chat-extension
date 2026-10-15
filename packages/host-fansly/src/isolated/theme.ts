// Fansly's theme as our UI needs it (docs/project-unite/architecture.md §7.8;
// FS-PLC-7): the scheme its page shows, from the class on <html> — dark by
// default, light with `bright-theme` (`dark-theme` says dark outright). One
// attribute observer on <html> (`class` only, no subtree) follows it; no
// timers, and idle it is silent: the class changes only when the person
// switches the theme.
//
// Read when first asked for, not at document_start: nothing needs the theme
// before the UI does, and Angular sets the class only once it runs.

import type { HostTheme } from '@cg/contracts/host';
import type { HostPalette, ValueSignal } from '@cg/contracts/vm';

import { FANSLY_SELECTORS } from './anchors';

const [LIGHT_CLASS, DARK_CLASS] = FANSLY_SELECTORS.themeClasses;

/** Fansly's theme as its page shows it (the port's `theme`, the tab's scheme «как на сайте»). */
export interface FanslyTheme {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
  dispose(): void;
}

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

/** Only colour data enters the palette sheet, never arbitrary page CSS. */
function rgba(value: string): Rgba | null {
  const hex = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(value);
  if (hex?.[1]) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16), 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value);
  if (!rgb) return null;
  const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)] as const;
  return channels.every(Number.isFinite) && channels.slice(0, 3).every((x) => x >= 0 && x <= 255) && channels[3] >= 0 && channels[3] <= 1 ? channels : null;
}

function mix(under: Rgb, over: Rgb, alpha: number): Rgb {
  const channel = (i: 0 | 1 | 2): number => Math.round(under[i] * (1 - alpha) + over[i] * alpha);
  return [channel(0), channel(1), channel(2)];
}

/** The scale contains both ends, so an explicit UI scheme remains legible too. */
function palette(style: CSSStyleDeclaration | undefined, light: boolean): HostPalette {
  const read = (name: string, fallback: string, under: Rgb = [255, 255, 255]): Rgb => {
    const colour = rgba(style?.getPropertyValue(name).trim() ?? '') ?? rgba(fallback)!;
    return mix(under, [colour[0], colour[1], colour[2]], colour[3]);
  };
  const surface = read('--dark-1', light ? '#ffffff' : '#111215');
  const raised = read('--dark-2', light ? '#f5f5f5' : '#191e26');
  const hover = read('--dark-3', light ? '#f0f2f4' : '#1a1e26');
  const ink = read('--font-1', light ? '#141e28' : '#d6dce8', surface);
  const muted = read('--dark-blue-1', light ? '#566678' : '#637395', surface);
  const rule = read('--border-color', light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)', surface);
  const blue = read('--blue-1', '#2699f7');
  const white = read('--pure-white', '#fff');
  const red = read('--red-1', light ? '#df4343' : '#c35b5b');
  const green = read('--green-1', light ? '#27d644' : '#40bb55');
  // Opposite end: Fansly's captured scale, retained when UI theme is forced.
  const steps: Record<string, Rgb> = {
    'neutral-0': white, 'neutral-50': [245,245,245], 'neutral-75': [240,242,244],
    'neutral-100': [242,242,242], 'neutral-200': [214,220,232], 'neutral-300': [194,202,216],
    'neutral-400': [134,147,174], 'neutral-500': [86,102,120], 'neutral-600': [68,80,96],
    'neutral-700': [56,66,82], 'neutral-750': [45,53,65], 'neutral-800': [35,42,54],
    'neutral-850': [26,30,38], 'neutral-900': [25,30,38], 'neutral-950': [17,18,21], white,
    'brand-50': mix(white, blue, 0.08), 'brand-75': mix(white, blue, 0.22),
    'brand-300': mix(blue, white, 0.2), 'brand-400': blue, 'brand-500': blue,
    'brand-600': mix(blue, [0,0,0], 0.18), 'brand-800': mix([17,18,21], blue, 0.3),
    'success-400': green, 'success-600': light ? mix(green, [0,0,0], 0.42) : [23,124,49],
    'error-400': light ? [220,126,126] : mix(red, white, 0.2), 'error-500': light ? red : [190,55,55],
  };
  Object.assign(steps, light ? {
    'neutral-0': surface, 'neutral-50': raised, 'neutral-75': hover, 'neutral-100': rule,
    'neutral-200': mix(surface, ink, 0.14), 'neutral-300': mix(surface, ink, 0.25),
    'neutral-400': mix(surface, ink, 0.48), 'neutral-500': muted,
    'neutral-700': mix(ink, muted, 0.4), 'neutral-900': ink, 'neutral-950': ink,
  } : {
    'neutral-200': ink, 'neutral-300': mix(ink, muted, 0.25),
    'neutral-400': mix(muted, ink, 0.3), 'neutral-600': muted,
    'neutral-700': mix(raised, ink, 0.25), 'neutral-750': mix(raised, ink, 0.14),
    'neutral-800': mix(hover, ink, 0.08), 'neutral-850': mix(rule, hover, 0.5), 'neutral-900': raised,
    'neutral-950': surface,
  });
  return Object.fromEntries(Object.entries(steps).map(([step, rgb]) => [`--color-om-${step}`, rgb.join(' ')]));
}

/** Theme classes and computed variables are read together, only when the UI asks. */
export function readFanslyTheme(doc: Document): HostTheme {
  const root = doc.documentElement as HTMLElement | null;
  const light = root?.classList.contains(LIGHT_CLASS) === true && !root.classList.contains(DARK_CLASS);
  return { scheme: light ? 'light' : 'dark', tokens: palette(root === null ? undefined : doc.defaultView?.getComputedStyle(root), light), fixedWidth: false };
}

/** A lazy projection: every kit mount owns and removes its own subscription. */
export function fanslyPalette(theme: Pick<FanslyTheme, 'current' | 'onChange'>): ValueSignal<HostPalette> {
  return {
    get value() { return theme.current().tokens; },
    subscribe: (listener) => theme.onChange((next) => listener(next.tokens)),
  };
}

export function createFanslyTheme(doc: Document): FanslyTheme {
  /** null — nothing asked for it yet. */
  let theme: HostTheme | null = null;
  const listeners = new Set<(theme: HostTheme) => void>();
  let observer: MutationObserver | null = null;
  let waiting: MutationObserver | null = null;
  let disposed = false;

  const refresh = (): void => {
    if (theme === null) return;
    const next = readFanslyTheme(doc);
    if (next.scheme === theme.scheme && JSON.stringify(next.tokens) === JSON.stringify(theme.tokens)) return;
    theme = next;
    for (const listener of [...listeners]) listener(next);
  };
  /** The class on <html>, from the first read on; a document_start script may run before <html> exists. */
  const watch = (): void => {
    if (observer !== null || waiting !== null || disposed) return;
    if ((doc.documentElement as HTMLElement | null) === null) {
      waiting = new MutationObserver(() => {
        if ((doc.documentElement as HTMLElement | null) === null) return;
        waiting?.disconnect();
        waiting = null;
        watch();
        refresh();
      });
      waiting.observe(doc, { childList: true });
      return;
    }
    observer = new MutationObserver(refresh);
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
  };
  const read = (): HostTheme => {
    if (theme === null) {
      theme = readFanslyTheme(doc);
      watch();
    }
    return theme;
  };

  return {
    current: read,
    onChange(listener) {
      read();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      waiting?.disconnect();
      observer = null;
      waiting = null;
      listeners.clear();
    },
  };
}
