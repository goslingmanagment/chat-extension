import { HostThemeSchema } from '@cg/contracts/host';
import { afterEach, describe, expect, it } from 'vitest';

import { createThemeReader, readTheme } from './theme';

afterEach(() => {
  const html = document.documentElement;
  html.removeAttribute('style');
  html.className = '';
});

describe('the host theme (§6.1: --color-om-*, .dark, fixed width)', () => {
  it('before <html> exists (a preload or very early start) the theme is unknown and the reader waits for it', async () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.remove();
    const reader = createThemeReader(doc);
    expect(reader.current()).toEqual({ scheme: 'light', tokens: {}, fixedWidth: false });
    const html = doc.createElement('html');
    html.className = 'dark';
    html.style.setProperty('--color-om-neutral-0', '1 1 1');
    doc.append(html);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reader.current().scheme).toBe('dark');
    reader.dispose();
  });

  it('reads the scheme, ChatSpace’s inline tokens (priority palettes first, at most 64) and the fixed width', () => {
    const html = document.documentElement;
    html.classList.add('dark');
    for (let i = 0; i < 40; i += 1) html.style.setProperty(`--color-om-amaranth-${i}`, '1 2 3');
    for (let i = 0; i < 40; i += 1) html.style.setProperty(`--color-om-neutral-${i}`, '4 5 6');
    html.style.setProperty('--color-om-brand-2-500', '7 8 9');
    html.style.setProperty('--app-content-max-width', '1600px');
    const theme = HostThemeSchema.parse(readTheme(document));
    expect(theme.scheme).toBe('dark');
    expect(Object.keys(theme.tokens)).toHaveLength(64);
    expect(Object.keys(theme.tokens).slice(0, 40).every((name) => name.startsWith('--color-om-neutral-'))).toBe(true);
    expect(theme.fixedWidth).toBe(true);
    html.style.setProperty('--app-content-max-width', 'none');
    expect(readTheme(document).fixedWidth).toBe(false);
  });

  it('follows changes of <html> with one attribute observer and reports the anchor', async () => {
    const reader = createThemeReader(document);
    expect(reader.anchor()).toBe('missing');
    const seen: string[] = [];
    reader.onChange((theme) => seen.push(theme.scheme));
    document.documentElement.style.setProperty('--color-om-neutral-0', '255 255 255');
    document.documentElement.classList.add('dark');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen.at(-1)).toBe('dark');
    expect(reader.current().tokens['--color-om-neutral-0']).toBe('255 255 255');
    expect(reader.anchor()).toBe('ok');
    reader.dispose();
  });
});
