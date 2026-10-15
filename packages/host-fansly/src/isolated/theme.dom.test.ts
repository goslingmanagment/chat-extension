// Fansly's theme as our UI reads it (R20 P7d; docs/project-unite/architecture.md §7.8; FS-PLC-7): the scheme of
// the class on <html> — dark by default, light with `bright-theme` —, followed by one attribute observer and said
// only when its scheme or palette changes. In Firefox on the stand, both themes with our
// dock in them: suite-fansly-dock.e2e.ts.

import { afterEach, describe, expect, it } from 'vitest';

import { createFanslyTheme, fanslyPalette, readFanslyTheme } from './theme';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
});

describe('[host:fansly] Fansly’s theme (FS-PLC-7)', () => {
  it('the scheme of the class on <html>: dark by default and with `dark-theme`, light with `bright-theme`; complete fallback palette before CSS arrives', () => {
    expect(readFanslyTheme(document)).toMatchObject({ scheme: 'dark', fixedWidth: false, tokens: { '--color-om-neutral-900': '25 30 38' } });
    document.documentElement.classList.add('bright-theme');
    expect(readFanslyTheme(document).scheme).toBe('light');
    document.documentElement.className = 'dark-theme';
    expect(readFanslyTheme(document).scheme).toBe('dark');
  });

  it('follows the person’s switch of the theme, says each change once, and nothing else: other classes, other attributes', async () => {
    const theme = createFanslyTheme(document);
    const heard: string[] = [];
    theme.onChange((next) => heard.push(next.scheme));
    expect(theme.current().scheme).toBe('dark');
    document.documentElement.classList.add('bright-theme');
    await settle();
    document.documentElement.classList.add('some-other-class');
    document.documentElement.setAttribute('lang', 'ru');
    await settle();
    document.documentElement.classList.remove('bright-theme');
    await settle();
    expect(heard).toEqual(['light', 'dark']);
    theme.dispose();
    document.documentElement.classList.add('bright-theme');
    await settle();
    expect(heard).toEqual(['light', 'dark']);
  });
  it('reads #rgb, #rrggbb and rgb/rgba page variables, flattening alpha against the page surface', () => {
    document.documentElement.className = 'bright-theme';
    document.documentElement.style.cssText = '--dark-1: #abc; --font-1: rgb(20, 30, 40); --blue-1: #123456; --border-color: rgba(0, 0, 0, 0.05)';
    expect(readFanslyTheme(document).tokens).toMatchObject({
      '--color-om-neutral-0': '170 187 204', '--color-om-neutral-900': '20 30 40',
      '--color-om-neutral-100': '162 178 194', '--color-om-brand-500': '18 52 86',
    });
    document.documentElement.style.setProperty('--font-1', 'rgb(10 20 30 / 0.5)');
    expect(readFanslyTheme(document).tokens['--color-om-neutral-900']).toBe('90 104 117');
    document.documentElement.style.setProperty('--blue-1', 'invalid; color: red');
    expect(readFanslyTheme(document).tokens['--color-om-brand-500']).toBe('38 153 247');
  });

  it('projects current palette lazily, publishes changed variables even within one scheme, and unsubscribes', async () => {
    const theme = createFanslyTheme(document);
    const signal = fanslyPalette(theme);
    const heard: string[] = [];
    const off = signal.subscribe((value) => heard.push(value['--color-om-brand-500']!));
    expect(signal.value['--color-om-brand-500']).toBe('38 153 247');
    document.documentElement.style.setProperty('--blue-1', '#123456');
    document.documentElement.classList.add('page-theme-loaded');
    await settle();
    expect(heard).toEqual(['18 52 86']);
    document.documentElement.classList.add('unrelated');
    await settle();
    expect(heard).toHaveLength(1);
    off();
    document.documentElement.classList.add('bright-theme');
    await settle();
    expect(heard).toHaveLength(1);
    expect(signal.value['--color-om-neutral-0']).toBe('255 255 255');
    theme.dispose();
  });

});
