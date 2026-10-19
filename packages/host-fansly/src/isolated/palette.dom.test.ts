// Fansly's blue for our interface (R20 P8d; decisions X57, X60; docs/project-unite/architecture.md §7.8, §7.17;
// FS-PLC-7, FS-DOCK-1): the page's own blue in the theme it shows, read anew when the theme reader says the page switched
// — the greys are the family's and live in the kit (ui-design §2.1). In Firefox on the stand, both themes with our dock
// in them: suite-fansly-dock.e2e.ts; the galleries with Fansly's profile: dock-gallery-fansly.e2e.ts.

import { afterEach, describe, expect, it } from 'vitest';

import { FANSLY_BLUE, fanslyPalette, fanslyPaletteSignal, parseColour, readFanslyPalette } from './palette';
import { createFanslyTheme } from './theme';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The steps of the site's blue the kit reads (ui/kit tokens.ts SITE_BLUE_FALLBACK). */
const STEPS = ['75', '400', '500', '600', '800'].map((step) => `brand-${step}`);

/** fansly.com's variables the scale reads, as its `styles.css` has them (2026-10-12): dark on :root, light on html.bright-theme. */
const FANSLY_CSS = `
:root { --modal-bg: #16161a; --font-1: #d6dce8; --font-tint-2: #bbc1cb; --font-tint-3: #9da2ad; --dark-blue-1: #637395;
  --dark-blue-1-outline: #343d53; --seperator: #323844; --dropdown-bg-color-hover: #2a3142; --dark-3: #1a1e26; --dark-1: #111215;
  --pure-white: #fff; --blue-1: #2699f7; --v2-blue-1-hover: #1588e0; --v2-blue-1-alpha-2: rgba(38, 153, 247, 0.16); }
html.bright-theme { --modal-bg: #ffffff; --dark-2: #f5f5f5; --dark-3: #f0f2f4; --v2-btn-grey-hover: #e1e7e9; --v2-btn-grey-active: #d5dcdf;
  --seperator: #b0b0b098; --font-tint-6: rgb(157, 162, 173); --dark-blue-1: rgba(86, 102, 120, 1); --font-tint-3: rgb(85, 90, 100);
  --font-tint-7: rgba(20, 30, 40, 0.801); --font-1: rgb(20, 30, 40); --font-tint-1: #000; --v2-blue-1-hover: #0d8ae8; }
`;

function playFansly(css = FANSLY_CSS): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return style;
}

afterEach(() => {
  document.documentElement.className = '';
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

describe('[host:fansly] Fansly’s palette: the page’s blue as the kit’s triplets, nothing else (R20 P8d, X57, X60, FS-DOCK-1)', () => {
  it('[I18-005] in each theme every blue step the kit reads, from `--blue-1`; a translucent one laid over our card', () => {
    playFansly();
    const dark = readFanslyPalette(document, 'dark');
    expect(Object.keys(dark).sort()).toEqual(STEPS.map((step) => `--color-om-${step}`).sort());
    expect(dark).toMatchObject({
      '--color-om-brand-500': '38 153 247',
      // Fansly's translucent blue laid over our dark card.
      '--color-om-brand-800': '38 55 66',
    });
    document.documentElement.classList.add('bright-theme');
    const light = readFanslyPalette(document, 'light');
    expect(light).toMatchObject({
      '--color-om-brand-500': '38 153 247',
      '--color-om-brand-600': '13 138 232',
      // Fansly's translucent blue over our light card.
      '--color-om-brand-75': '216 234 245',
    });
  });

  it('the page’s greys say nothing to us; its blue is the page’s: a `--blue-1` Fansly changes reaches «Отправить»', () => {
    playFansly(`${FANSLY_CSS}\n:root { --dark-1: #000000; --modal-bg: #202020; --blue-1: #0000ff; }`);
    const palette = readFanslyPalette(document, 'dark');
    expect(Object.keys(palette).filter((name) => !name.startsWith('--color-om-brand-'))).toEqual([]);
    expect(palette['--color-om-brand-500']).toBe('0 0 255');
  });

  it('a variable the page has not (another build of Fansly) stands in with its value on fansly.com: the same palette as the page’s own', () => {
    const bare = { dark: readFanslyPalette(document, 'dark'), light: fanslyPalette('light', () => '') };
    playFansly();
    expect(readFanslyPalette(document, 'dark')).toEqual(bare.dark);
    document.documentElement.classList.add('bright-theme');
    expect(readFanslyPalette(document, 'light')).toEqual(bare.light);
    // Something that is no colour is no colour: the value on fansly.com stands in.
    expect(fanslyPalette('dark', (name) => (name === '--blue-1' ? 'var(--nope)' : ''))['--color-om-brand-500']).toBe('38 153 247');
  });

  it('[I18-005] either theme gives every step a triplet: a scheme forced against the page’s (`ui.theme`) reads a whole palette (its contrast in all four: testing kit/fansly-profile.test.tsx)', () => {
    for (const scheme of ['light', 'dark'] as const) expect(Object.keys(fanslyPalette(scheme, () => '')).sort(), scheme).toEqual(STEPS.map((step) => `--color-om-${step}`).sort());
    // Every blue reads the page in at least one theme.
    for (const [step, sources] of Object.entries(FANSLY_BLUE)) expect(sources.light[0] !== null || sources.dark[0] !== null, step).toBe(true);
  });

  it('[I18-005] the profile’s palette is the page’s as it is now: the same values keep the same palette; a switch of the theme says the new one once to each listener', async () => {
    playFansly();
    const theme = createFanslyTheme(document);
    const signal = fanslyPaletteSignal(theme, () => document);
    const first = signal.value;
    expect(first['--color-om-brand-75']).toBe('220 239 254');
    expect(signal.value).toBe(first);
    const heard: string[] = [];
    const also: string[] = [];
    const off = signal.subscribe((palette) => heard.push(palette['--color-om-brand-75'] ?? ''));
    const offAlso = signal.subscribe((palette) => also.push(palette['--color-om-brand-75'] ?? ''));
    document.documentElement.classList.add('bright-theme');
    await settle();
    expect(signal.value['--color-om-brand-75']).toBe('216 234 245');
    document.documentElement.setAttribute('class', 'bright-theme');
    await settle();
    document.documentElement.className = 'dark-theme';
    await settle();
    off();
    document.documentElement.className = 'bright-theme';
    await settle();
    expect(heard).toEqual(['216 234 245', '220 239 254']);
    expect(also).toEqual(['216 234 245', '220 239 254', '216 234 245']);
    offAlso();
    theme.dispose();
  });

  it('[I18-005] variables that come after the first read — Fansly’s sheet and its theme class, the scheme the same — reach the palette and are said; a later mount reads the page as it is', async () => {
    // Read before Fansly's sheet and class: the dark theme in fansly.com's values.
    const theme = createFanslyTheme(document);
    const signal = fanslyPaletteSignal(theme, () => document);
    expect(signal.value['--color-om-brand-500']).toBe('38 153 247');
    const heard: string[] = [];
    const off = signal.subscribe((palette) => heard.push(palette['--color-om-brand-500'] ?? ''));
    playFansly(`${FANSLY_CSS}\n:root { --blue-1: #202020; }`);
    document.documentElement.classList.add('dark-theme');
    await settle();
    expect(heard).toEqual(['32 32 32']);
    expect(signal.value['--color-om-brand-500']).toBe('32 32 32');
    // A sheet that lands with no class change says nothing (nothing on the page to hear), but a mount reads it.
    playFansly(':root { --blue-1: #303030; }');
    await settle();
    expect(heard).toEqual(['32 32 32']);
    expect(signal.value['--color-om-brand-500']).toBe('48 48 48');
    off();
    theme.dispose();
  });

  it('reads the colours Fansly writes: hex of 3, 4, 6 and 8 digits, rgb() and rgba() with commas or spaces; nothing else', () => {
    expect(parseColour('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColour(' #2699F7 ')).toEqual([38, 153, 247, 1]);
    expect(parseColour('#b0b0b098')).toEqual([176, 176, 176, 0x98 / 255]);
    expect(parseColour('#0008')).toEqual([0, 0, 0, 0x88 / 255]);
    expect(parseColour('rgb(20, 30, 40)')).toEqual([20, 30, 40, 1]);
    expect(parseColour('rgba(86, 102, 120, 1)')).toEqual([86, 102, 120, 1]);
    expect(parseColour('rgba(244 247 251)')).toEqual([244, 247, 251, 1]);
    expect(parseColour('rgb(0 0 0 / 50%)')).toEqual([0, 0, 0, 0.5]);
    for (const text of ['', 'red', '#12', 'rgb(300, 0, 0)', 'rgba(0, 0, 0, 2)', 'var(--x)', 'hsl(0 0% 0%)']) expect(parseColour(text), text).toBeNull();
  });
});
