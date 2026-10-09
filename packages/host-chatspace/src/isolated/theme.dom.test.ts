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
    // Real host token names (the stand's palette check reads our sources): 9 accent palettes × 9 steps, then neutral.
    const token = (palette: string, step: number): string => ['--color-om', palette, String(step)].join('-');
    for (const palette of ['amaranth', 'azure', 'cobalt', 'gold', 'indigo', 'mint', 'pink', 'rust', 'steel']) {
      for (const step of [100, 200, 300, 400, 500, 600, 700, 800, 900]) html.style.setProperty(token(palette, step), '1 2 3');
    }
    const neutral = [0, 50, 75, 100, 200, 300, 400, 500, 600, 700, 750, 800, 850, 900, 950];
    for (const step of neutral) html.style.setProperty(token('neutral', step), '4 5 6');
    html.style.setProperty('--color-om-brand-2-500', '7 8 9');
    html.style.setProperty('--app-content-max-width', '1600px');
    const theme = HostThemeSchema.parse(readTheme(document));
    expect(theme.scheme).toBe('dark');
    expect(Object.keys(theme.tokens)).toHaveLength(64);
    expect(Object.keys(theme.tokens).slice(0, neutral.length).every((name) => name.startsWith(token('neutral', 0).slice(0, -1)))).toBe(true);
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

  it('[§11] starts without reading <html>: the first touch of `style` waits until the theme is asked for, and a change before that is no news', async () => {
    const html = document.documentElement;
    const style = html.style;
    // Our own reads of `<html>.style` (happy-dom reads it itself when the attribute changes). The first touch of an
    // element's `style` in a page's content-script global costs ~0.3 ms (spike-m0 e2e).
    let reads = 0;
    Object.defineProperty(html, 'style', { configurable: true, get: () => ((reads += /\/isolated\/theme\.ts\b/.test(new Error().stack ?? '') ? 1 : 0), style) });
    try {
      const reader = createThemeReader(document);
      expect(reads).toBe(0);
      style.setProperty('--color-om-neutral-0', '1 1 1');
      html.classList.add('dark');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reads).toBe(0);
      expect(reader.current()).toMatchObject({ scheme: 'dark', tokens: { '--color-om-neutral-0': '1 1 1' } });
      expect(reads).toBeGreaterThan(0);
      // From the first read on, a change is news.
      const seen: string[] = [];
      reader.onChange((theme) => seen.push(theme.scheme));
      html.classList.remove('dark');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual(['light']);
      reader.dispose();
    } finally {
      Reflect.deleteProperty(html, 'style');
    }
  });

  it('[§11] a listener added before any read hears the changes after it', async () => {
    const reader = createThemeReader(document);
    const seen: string[] = [];
    reader.onChange((theme) => seen.push(theme.scheme));
    document.documentElement.classList.add('dark');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['dark']);
    reader.dispose();
  });
});
