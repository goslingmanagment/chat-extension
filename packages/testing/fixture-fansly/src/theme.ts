// `app-theme-controller` (main:52583-52597): the theme is a class on `<html>`
// — `bright-theme` for the light one, `dark-theme` for the dark one, switched
// at runtime. The stand starts bright, as the live tab of 2026-10-13 was.

import { record } from './journal';
import type { FanslyStandTheme } from './protocol';

export function setTheme(theme: FanslyStandTheme): void {
  const root = document.documentElement;
  if (root.classList.contains('bright-theme') !== (theme === 'bright')) root.classList.toggle('bright-theme', theme === 'bright');
  if (root.classList.contains('dark-theme') !== (theme === 'dark')) root.classList.toggle('dark-theme', theme === 'dark');
  record('theme', { theme });
}

export function currentTheme(): FanslyStandTheme {
  return document.documentElement.classList.contains('dark-theme') ? 'dark' : 'bright';
}
