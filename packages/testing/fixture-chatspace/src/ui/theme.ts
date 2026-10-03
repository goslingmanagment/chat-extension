// Theme of the stand (metadata.ts «theme»): `dark`/`light` class on <html>
// from `chat-space:theme-mode` (dark by default), a palette of
// `--color-om-*` RGB triplets set inline on <html> (the same in both modes; the
// mode picks other steps), and the «fixed width» workspace through
// `--app-content-max-width` / `--app-content-align`. The colours are the
// stand's own.

import { reactive } from 'vue';

import { record } from '../journal';

const THEME_KEY = 'chat-space:theme-mode';
const FIXED_WIDTH_KEY = 'chat-space:stand-fixed-width';
const FIXED_MAX_WIDTH = '1600px';

const PALETTE: Readonly<Record<string, string>> = {
  'neutral-0': '255 255 255',
  'neutral-50': '247 248 250',
  'neutral-100': '238 240 244',
  'neutral-150': '228 231 237',
  'neutral-200': '213 217 225',
  'neutral-300': '182 188 199',
  'neutral-400': '139 147 160',
  'neutral-500': '103 111 125',
  'neutral-600': '79 86 99',
  'neutral-700': '57 63 75',
  'neutral-800': '39 44 54',
  'neutral-850': '31 35 44',
  'neutral-900': '23 26 33',
  'neutral-950': '14 16 21',
  'brand-100': '219 236 254',
  'brand-300': '139 190 250',
  'brand-500': '58 132 236',
  'brand-600': '40 108 214',
  'brand-700': '31 86 178',
  'brand-2-500': '156 103 238',
  'error-100': '254 226 226',
  'error-500': '226 72 72',
  'error-600': '200 52 52',
  'warning-100': '254 243 199',
  'warning-500': '226 160 40',
  'success-100': '220 252 231',
  'success-500': '42 170 98',
  'success-600': '30 140 78',
};

export type ThemeMode = 'light' | 'dark';
export type Align = 'left' | 'center' | 'right';

export const theme = reactive<{ mode: ThemeMode; fixedWidth: boolean; align: Align }>({ mode: 'dark', fixedWidth: false, align: 'center' });

function apply(): void {
  const html = document.documentElement;
  html.classList.toggle('dark', theme.mode === 'dark');
  html.classList.toggle('light', theme.mode === 'light');
  html.style.setProperty('--app-content-max-width', theme.fixedWidth ? FIXED_MAX_WIDTH : 'none');
  html.style.setProperty('--app-content-align', theme.align);
}

export function installTheme(): void {
  const html = document.documentElement;
  for (const [name, triplet] of Object.entries(PALETTE)) html.style.setProperty(`--color-om-${name}`, triplet);
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') theme.mode = stored;
    const fixed = JSON.parse(localStorage.getItem(FIXED_WIDTH_KEY) ?? 'null') as { on?: unknown; align?: unknown } | null;
    if (fixed !== null) {
      theme.fixedWidth = fixed.on === true;
      if (fixed.align === 'left' || fixed.align === 'center' || fixed.align === 'right') theme.align = fixed.align;
    }
  } catch {
    // Defaults.
  }
  apply();
}

export function setThemeMode(mode: ThemeMode): void {
  theme.mode = mode;
  localStorage.setItem(THEME_KEY, mode);
  apply();
  record('theme', { mode });
}

export function setFixedWidth(on: boolean, align: Align = theme.align): void {
  theme.fixedWidth = on;
  theme.align = align;
  localStorage.setItem(FIXED_WIDTH_KEY, JSON.stringify({ on, align }));
  apply();
  record('fixed-width', { on, align });
}
