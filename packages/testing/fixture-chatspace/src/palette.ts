// The `--color-om-*` palette of the stand: the token NAMES are ChatSpace's
// (the read contract of architecture.md §6.1), the VALUES are the stand's own
// (generated ramps, not the host's colours). Each token is an "R G B" triplet,
// set inline on <html>; light and dark modes pick other steps of it.

/** Steps per palette, as ChatSpace names them. */
const NEUTRAL_STEPS = [0, 50, 75, 100, 200, 300, 400, 500, 600, 700, 750, 800, 850, 900, 950] as const;
const BRAND_STEPS = [50, 75, 100, 200, 300, 400, 500, 600, 700, 750, 800, 900] as const;
const STATUS_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const ACCENT_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Palette → [hue°, saturation %, steps]; our own hues. */
const PALETTES: ReadonlyArray<readonly [string, number, number, readonly number[]]> = [
  ['om-neutral', 220, 10, NEUTRAL_STEPS],
  ['om-brand', 214, 80, BRAND_STEPS],
  ['om-error', 2, 72, STATUS_STEPS],
  ['om-success', 146, 55, STATUS_STEPS],
  ['om-warning', 40, 85, STATUS_STEPS],
  ['om-brand-2', 268, 60, STATUS_STEPS],
  ['om-amaranth', 345, 70, ACCENT_STEPS],
  ['om-azure', 200, 70, ACCENT_STEPS],
  ['om-cobalt', 232, 60, ACCENT_STEPS],
  ['om-gold', 45, 75, ACCENT_STEPS],
  ['om-indigo', 255, 55, ACCENT_STEPS],
  ['om-mint', 160, 50, ACCENT_STEPS],
  ['om-pink', 320, 65, ACCENT_STEPS],
  ['om-rust', 18, 65, ACCENT_STEPS],
  ['om-steel', 210, 20, ACCENT_STEPS],
  ['om-violet', 280, 55, ACCENT_STEPS],
];

function triplet(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number): number => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `${channel(0)} ${channel(8)} ${channel(4)}`;
}

/** Step 0 is white, 950 near black; the rest spread between. */
const lightnessOf = (step: number): number => (step === 0 ? 100 : Math.max(5, Math.min(97, 97 - (step / 950) * 92)));

/** Every palette token the stand sets: name (without `--color-`) → "R G B". */
export const PALETTE: Readonly<Record<string, string>> = Object.fromEntries([
  ['om-white', '255 255 255'],
  ...PALETTES.flatMap(([name, hue, saturation, steps]) => steps.map((step) => [`${name}-${step}`, triplet(hue, step === 0 ? 0 : saturation, lightnessOf(step))] as const)),
]);

/** The CSS variable names ChatSpace 0.172.0 defines (`--color-om-…`). */
export const PALETTE_VARIABLES: ReadonlySet<string> = new Set(Object.keys(PALETTE).map((name) => `--color-${name}`));
