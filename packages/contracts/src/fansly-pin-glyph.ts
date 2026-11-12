// The pin glyph of temporary chat pins on Fansly (2026-11-12): plain data with no import, so the early isolated content
// script that draws the rows' pins carries no schema of fansly-pins.ts.

/**
 * The pin glyph both drawings of a pin use — the rows' plain nodes (host-fansly) and the strip and the header (ui): a
 * push pin on a 24 × 24 box, its head and its needle, drawn with `currentColor` (the head filled for a pinned chat).
 */
export const FANSLY_PIN_GLYPH = {
  viewBox: '0 0 24 24',
  head: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  needle: 'M12 17v5',
} as const;
