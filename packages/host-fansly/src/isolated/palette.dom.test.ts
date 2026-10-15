// Fansly's palette for our interface (R20 P8d; docs/project-unite/architecture.md §7.8, §7.15; FS-PLC-7, FS-DOCK-1): the
// page's own variables in the theme it shows as the kit's triplets (the correspondence table, ui-design §2.1
// «Fansly»), read anew when the theme reader says the page switched. In Firefox on the stand, both themes with our dock
// in them: suite-fansly-dock.e2e.ts; the galleries with Fansly's profile: dock-gallery-fansly.e2e.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FANSLY_SCALE, fanslyPalette, fanslyPaletteSignal, parseColour, readFanslyPalette } from './palette';
import { createFanslyTheme } from './theme';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The kit's steps (ui/kit tokens.ts HOST_FALLBACK_TRIPLETS) but success and error, which stay the kit's own. */
const STEPS = [
  ...['0', '50', '75', '100', '200', '300', '400', '500', '600', '700', '750', '800', '850', '900', '950'].map((step) => `neutral-${step}`),
  'white',
  ...['75', '400', '500', '600', '800'].map((step) => `brand-${step}`),
];

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

const luminance = (triplet: string): number => {
  const [r = 0, g = 0, b = 0] = triplet.split(' ').map((byte) => {
    const channel = Number(byte) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('[host:fansly] Fansly’s palette: the page’s own variables as the kit’s triplets (R20 P8d, FS-DOCK-1)', () => {
  it('[I18-005] in each theme every step the kit reads, from the variables of that theme: the card is `--modal-bg`, the ink `--font-1`, blue `--blue-1`', () => {
    playFansly();
    const dark = readFanslyPalette(document, 'dark');
    expect(Object.keys(dark).sort()).toEqual(STEPS.map((step) => `--color-om-${step}`).sort());
    expect(dark).toMatchObject({
      '--color-om-neutral-950': '17 18 21',
      '--color-om-neutral-900': '22 22 26',
      '--color-om-neutral-850': '26 30 38',
      '--color-om-neutral-200': '214 220 232',
      '--color-om-neutral-400': '157 162 173',
      '--color-om-white': '255 255 255',
      '--color-om-brand-500': '38 153 247',
      // Fansly's translucent blue laid over its dark card.
      '--color-om-brand-800': '25 43 61',
    });
    document.documentElement.classList.add('bright-theme');
    const light = readFanslyPalette(document, 'light');
    expect(light).toMatchObject({
      '--color-om-neutral-0': '255 255 255',
      '--color-om-neutral-50': '245 245 245',
      '--color-om-neutral-500': '86 102 120',
      '--color-om-neutral-900': '20 30 40',
      '--color-om-neutral-950': '0 0 0',
      // `#b0b0b098` and `rgba(20, 30, 40, 0.801)` over the light card.
      '--color-om-neutral-300': '208 208 208',
      '--color-om-neutral-700': '67 75 83',
      '--color-om-brand-500': '38 153 247',
      '--color-om-brand-75': '220 239 254',
    });
  });

  it('the page’s values, not ours: a variable Fansly changes reaches its step; a translucent one is laid over the theme’s own card', () => {
    playFansly(`${FANSLY_CSS}\n:root { --dark-1: #000000; --modal-bg: #202020; --dark-blue-1-outline: rgba(255, 255, 255, 0.5); }`);
    expect(readFanslyPalette(document, 'dark')).toMatchObject({
      '--color-om-neutral-950': '0 0 0',
      '--color-om-neutral-900': '32 32 32',
      '--color-om-neutral-700': '144 144 144',
    });
  });

  it('a variable the page has not (another build of Fansly) stands in with its value on fansly.com: the same palette as the page’s own', () => {
    const bare = { dark: readFanslyPalette(document, 'dark'), light: fanslyPalette('light', () => '') };
    playFansly();
    expect(readFanslyPalette(document, 'dark')).toEqual(bare.dark);
    document.documentElement.classList.add('bright-theme');
    expect(readFanslyPalette(document, 'light')).toEqual(bare.light);
    // Something that is no colour is no colour: the value on fansly.com stands in.
    expect(fanslyPalette('dark', (name) => (name === '--dark-1' ? 'var(--nope)' : ''))['--color-om-neutral-950']).toBe('17 18 21');
  });

  it('[I18-005] either theme gives a whole scale, light to dark: a scheme forced against the page’s (`ui.theme`) reads every step it needs', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = fanslyPalette(scheme, () => '');
      const neutrals = STEPS.filter((step) => step.startsWith('neutral-')).map((step) => luminance(palette[`--color-om-${step}`] ?? ''));
      for (let index = 1; index < neutrals.length; index += 1) expect(neutrals[index], `${scheme}: ${STEPS[index]}`).toBeLessThanOrEqual(neutrals[index - 1] ?? 1);
    }
    // Every row reads the page in at least one theme (which steps each scheme reads: testing kit/fansly-profile.test.ts).
    for (const [step, sources] of Object.entries(FANSLY_SCALE)) expect(sources.light[0] !== null || sources.dark[0] !== null, step).toBe(true);
  });

  it('[I18-005] the profile’s palette follows the theme reader: the page read once per theme, anew on each switch, said once', async () => {
    playFansly();
    const theme = createFanslyTheme(document);
    const reads = vi.spyOn(window, 'getComputedStyle');
    const signal = fanslyPaletteSignal(theme, () => document);
    expect(signal.value['--color-om-neutral-900']).toBe('22 22 26');
    expect(signal.value['--color-om-neutral-950']).toBe('17 18 21');
    expect(reads).toHaveBeenCalledTimes(1);
    const heard: string[] = [];
    const off = signal.subscribe((palette) => heard.push(palette['--color-om-neutral-900'] ?? ''));
    document.documentElement.classList.add('bright-theme');
    await settle();
    expect(signal.value['--color-om-neutral-900']).toBe('20 30 40');
    expect(reads).toHaveBeenCalledTimes(2);
    document.documentElement.setAttribute('class', 'bright-theme');
    await settle();
    document.documentElement.className = 'dark-theme';
    await settle();
    off();
    document.documentElement.className = 'bright-theme';
    await settle();
    expect(heard).toEqual(['20 30 40', '22 22 26']);
    reads.mockRestore();
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
