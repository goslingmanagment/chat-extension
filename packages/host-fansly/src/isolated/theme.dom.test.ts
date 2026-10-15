// Fansly's theme as our UI reads it (R20 P7d; docs/project-unite/architecture.md §7.8; FS-PLC-7): the scheme of
// the class on <html> — dark by default, light with `bright-theme` —, followed by one attribute observer and said
// only when it changes. The palette of the page's variables is P8d's. In Firefox on the stand, both themes with our
// dock in them: suite-fansly-dock.e2e.ts.

import { afterEach, describe, expect, it } from 'vitest';

import { createFanslyTheme, readFanslyTheme } from './theme';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.documentElement.className = '';
});

describe('[host:fansly] Fansly’s theme (FS-PLC-7)', () => {
  it('the scheme of the class on <html>: dark by default and with `dark-theme`, light with `bright-theme`; no palette before P8d', () => {
    expect(readFanslyTheme(document)).toEqual({ scheme: 'dark', tokens: {}, fixedWidth: false });
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

  it('[R20-P8d] Fansly’s theme class appearing with the scheme it already said is said too: the page’s variables may have come with it (the palette reads them anew)', async () => {
    const theme = createFanslyTheme(document);
    const heard: string[] = [];
    theme.onChange((next) => heard.push(next.scheme));
    expect(theme.current().scheme).toBe('dark');
    document.documentElement.classList.add('dark-theme');
    await settle();
    document.documentElement.classList.add('some-other-class');
    await settle();
    document.documentElement.className = 'bright-theme';
    await settle();
    expect(heard).toEqual(['dark', 'light']);
    theme.dispose();
  });
});
