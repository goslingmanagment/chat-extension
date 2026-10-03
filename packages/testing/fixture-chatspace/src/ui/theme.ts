// Theme of the stand (metadata.ts «theme»): `dark`/`light` class on <html>
// from `chat-space:theme-mode` (dark by default), the `--color-om-*` palette
// (ChatSpace's token names, the stand's own values: palette.ts) set inline on
// <html>, and the «fixed width» workspace through `--app-content-max-width`
// and `--app-content-align` — the latter holds CSS align-self values
// (flex-start | center | flex-end), as on the host; the setting itself is
// left | center | right.

import { reactive } from 'vue';

import { record } from '../journal';
import { PALETTE } from '../palette';

const THEME_KEY = 'chat-space:theme-mode';
const FIXED_WIDTH_KEY = 'chat-space:stand-fixed-width';
const FIXED_MAX_WIDTH = '1600px';
/** Setting → the CSS value the variable carries. */
const ALIGN_SELF: Readonly<Record<Align, string>> = { left: 'flex-start', center: 'center', right: 'flex-end' };

export type ThemeMode = 'light' | 'dark';
export type Align = 'left' | 'center' | 'right';

export const theme = reactive<{ mode: ThemeMode; fixedWidth: boolean; align: Align }>({ mode: 'dark', fixedWidth: false, align: 'center' });

function apply(): void {
  const html = document.documentElement;
  html.classList.toggle('dark', theme.mode === 'dark');
  html.classList.toggle('light', theme.mode === 'light');
  html.style.setProperty('--app-content-max-width', theme.fixedWidth ? FIXED_MAX_WIDTH : 'none');
  html.style.setProperty('--app-content-align', ALIGN_SELF[theme.align]);
}

export function installTheme(): void {
  const html = document.documentElement;
  for (const [name, triplet] of Object.entries(PALETTE)) html.style.setProperty(`--color-${name}`, triplet);
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
